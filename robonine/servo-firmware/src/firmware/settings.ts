// Settings backup and factory restore, ported from STS32XX-Firmware tools/flash/settings.py.
//
// The servo's firmware cannot be read back over the bus, so the backup holds what makes
// each servo *that* servo: its 87-byte register table (ID, baud, calibration, limits).
// Rolling back = flash the bundled factory 3.10 image, then `restoreSettings` from here.

import { BAUD_RATES, persistent, verifyFactory } from './flasher'
import { Link, packet, sleep } from './link'

/** Registers restored and compared: 4–39 and 78–86. */
export const SETTINGS_ADDRESSES = [...Array.from({ length: 36 }, (_, i) => 4 + i), ...Array.from({ length: 9 }, (_, i) => 78 + i)]

export const BACKUP_FORMAT = 'robonine-servo-backup-v1'
/** settings.py's single-servo format, accepted on import. */
const SETTINGS_PY_FORMAT = 'sts-settings-v1'

export interface ServoBackupEntry {
  id: number
  /** 87 register bytes, hex. */
  registers_hex: string
  firmware?: { flavour: string; version: string }
}

export interface ServoBackupFile {
  format: typeof BACKUP_FORMAT
  created: string
  robot: { model: string | null; robotId: string | null }
  servos: ServoBackupEntry[]
}

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(text: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(text)) {
    throw new Error('Invalid hex')
  }

  return new Uint8Array(text.match(/../g)?.map((h) => parseInt(h, 16)) ?? [])
}

/** Reject anything that is not an 87-byte GD32 STS register snapshot. */
export function validateTable(table: Uint8Array): Uint8Array {
  if (table.length !== 87 || table[0] !== 3 || table[3] !== 9) {
    throw new Error('Expected an 87-byte GD32 STS register snapshot')
  }

  if (table[5]! > 253 || table[6]! >= BAUD_RATES.length || (table[8] !== 0 && table[8] !== 1)) {
    throw new Error('Invalid saved ID, baud selector or response level')
  }

  return table
}

/**
 * Parse a backup file into register tables keyed by servo ID.
 * Accepts this plugin's multi-servo file, settings.py backups and flash.py reports.
 */
export function parseBackup(text: string): Map<number, Uint8Array> {
  const data = JSON.parse(text) as Record<string, unknown>
  const out = new Map<number, Uint8Array>()
  const add = (hex: unknown) => {
    if (typeof hex !== 'string' || hex.length !== 174) {
      throw new Error('Expected exactly 87 register bytes encoded as hex')
    }

    const table = validateTable(fromHex(hex))

    out.set(table[5]!, table)
  }

  if (data?.format === BACKUP_FORMAT && Array.isArray(data.servos)) {
    for (const servo of data.servos as ServoBackupEntry[]) {
      add(servo.registers_hex)
    }
  } else if (data?.format === SETTINGS_PY_FORMAT) {
    add(data.registers_hex)
  } else if (data?.mode === 'flash' && 'before_registers_hex' in data) {
    add(data.before_registers_hex)
  } else {
    throw new Error('Not a servo settings backup')
  }

  return out
}

export function buildBackup(tables: Array<{ table: Uint8Array; firmware?: { flavour: string; version: string } }>, robot: ServoBackupFile['robot']): ServoBackupFile {
  return {
    format: BACKUP_FORMAT,
    created: new Date().toISOString(),
    robot,
    servos: tables.map(({ table, firmware }) => ({ id: table[5]!, registers_hex: toHex(table), firmware })),
  }
}

/** Registers that differ between a live table and the expected one. */
export function settingsDifferences(table: Uint8Array, expected: Uint8Array): number[] {
  return SETTINGS_ADDRESSES.filter((a) => table[a] !== expected[a])
}

function ready(table: Uint8Array, servoId: number, baud: number) {
  validateTable(table)

  if (table[5] !== servoId || BAUD_RATES[table[6]!] !== baud) {
    throw new Error('Live ID/baud differs from the requested connection')
  }

  if (table[40] !== 0 || table[55] !== 1 || table[65] !== 0) {
    throw new Error('Requires torque off, settings locked and no active alarm')
  }
}

function compare(table: Uint8Array, expected: Uint8Array) {
  const differences = settingsDifferences(table, expected)

  if (differences.length) {
    throw new Error(`Settings differ at registers: ${differences.join(', ')}`)
  }
}

class Device {
  constructor(
    readonly link: Link,
    public id: number,
  ) {}

  read() {
    return this.link.registers(this.id)
  }

  /**
   * Never retry a mutation. Later reads verify its effects; WRITE status replies may use
   * the old ID/baud or be disabled by response level zero.
   */
  async command(code: number, data: number[] = [], delayMs = 250) {
    const expectStatus = (code === 0x09 || code === 0x06) && (await this.read())[8] !== 0

    this.link.bus.flushInput()
    await this.link.send(packet(this.id, code, data))
    await sleep(delayMs)

    if (expectStatus) {
      const reply = await this.link.receive(300)

      if (!reply || reply.id !== this.id || reply.error !== 0 || reply.data.length !== 0) {
        throw new Error(`Template instruction 0x${code.toString(16).padStart(2, '0')} was not acknowledged successfully`)
      }
    }
  }

  async write(address: number, value: number): Promise<Uint8Array> {
    await this.command(0x03, [address, value], 60)

    // Follow changes even if the read fails, so cleanup addresses the new connection.
    if (address === 5) {
      this.id = value
    } else if (address === 6) {
      await this.link.bus.setBaud(BAUD_RATES[value]!)
    }

    const table = await this.read()

    if (table[address] !== value) {
      throw new Error(`Register ${address} did not retain the requested value`)
    }

    if (table[40] !== 0 || table[65] !== 0) {
      throw new Error('Torque or alarm state changed during recovery')
    }

    return table
  }
}

export type RestorePhase = 'checking' | 'restoring-settings' | 'saving-template' | 'applying-template' | 'restarting' | 'done'

/**
 * Restore a servo's backed-up settings onto factory 3.10 firmware: write the registers,
 * replace the saved reset template, re-lock and restart, verifying every step.
 * Connect ONE servo — the restore may change its ID and baud.
 * @param link Link at the servo's current baud.
 * @param servoId The ID the servo answers to now (often 1 right after a factory flash).
 * @param expected The servo's own backup table.
 * @returns The table read back after the restart.
 */
export async function restoreSettings(link: Link, servoId: number, expected: Uint8Array, onPhase?: (p: RestorePhase) => void): Promise<Uint8Array> {
  const device = new Device(link, servoId)
  let unlocked = false

  validateTable(expected)
  onPhase?.('checking')

  const before = await device.read()

  await verifyFactory(link, servoId, before)
  ready(before, servoId, link.bus.baudRate)

  try {
    onPhase?.('restoring-settings')
    unlocked = true // include ambiguous failures during the unlock write
    await device.write(55, 0)
    for (const address of SETTINGS_ADDRESSES) {
      if (address !== 5 && address !== 6 && address !== 8 && before[address] !== expected[address]) {
        await device.write(address, expected[address]!)
      }
    }
    for (const address of [8, 5, 6]) {
      if (before[address] !== expected[address]) {
        await device.write(address, expected[address]!)
      }
    }
    compare(await device.read(), expected)
    onPhase?.('saving-template')
    await device.command(0x09)
    onPhase?.('applying-template')
    await device.command(0x06)
    compare(await device.read(), expected)
    await device.write(55, 1)
    unlocked = false
    onPhase?.('restarting')
    await device.command(0x08, [], 1000)

    const after = await device.read()

    ready(after, expected[5]!, BAUD_RATES[expected[6]!]!)
    compare(after, expected)
    onPhase?.('done')

    return after
  } finally {
    if (unlocked) {
      try {
        await device.write(55, 1)
      } catch {
        // reported by the caller's error; the servo may need a manual relock
      }
    }
  }
}

/** Expose for the UI: the persistent part of a table, for comparisons in tests. */
export { persistent }
