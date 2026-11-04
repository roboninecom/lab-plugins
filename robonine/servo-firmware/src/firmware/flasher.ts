// Flash, verify and recover, ported from STS32XX-Firmware tools/flash/flash.py (execute,
// check_device, verify_application, verify_factory, read_application).

import { APP_BAUD, upload, type Progress } from './bootloader'
import { Link, packet, sleep } from './link'
import { acceptsModel, type FirmwareRelease } from './release'

export const BAUD_RATES = [1_000_000, 500_000, 250_000, 128_000, 115_200, 76_800, 57_600, 38_400] as const

/** Registers that must survive a flash: 4–39 and 78–86. */
export function persistent(table: Uint8Array): number[] {
  return [...table.subarray(4, 40), ...table.subarray(78, 87)]
}

export function samePersistent(a: Uint8Array, b: Uint8Array): boolean {
  const pa = persistent(a)
  const pb = persistent(b)

  return pa.length === pb.length && pa.every((v, i) => v === pb[i])
}

/** Why a servo may not be flashed in its current state, or null when it may. */
export function deviceProblem(table: Uint8Array, release: FirmwareRelease, servoId: number, baud: number): string | null {
  if (table.length !== 87 || table[5] !== servoId) {
    return 'Register snapshot has the wrong length or ID'
  }

  if (!acceptsModel(release, table[3]!, table[4]!)) {
    return `Unsupported model bytes [${table[3]}, ${table[4]}]`
  }

  if (table[6]! >= BAUD_RATES.length || BAUD_RATES[table[6]!] !== baud) {
    return 'Saved baud selector differs from the requested application baud'
  }

  if (table[40] !== 0 || table[55] !== 1 || table[65] !== 0) {
    return 'Requires torque off (40=0), persistence locked (55=1), no alarm (65=0)'
  }

  return null
}

function checkDevice(table: Uint8Array, release: FirmwareRelease, servoId: number, baud: number) {
  const problem = deviceProblem(table, release, servoId, baud)

  if (problem) {
    throw new Error(problem)
  }
}

/** Check legacy identity and reject custom firmware that reports identical version bytes. */
export async function verifyFactory(link: Link, servoId: number, table: Uint8Array): Promise<void> {
  if (table.length !== 87 || table[0] !== 3 || table[1] !== 10 || table[2] !== 0 || table[3] !== 9 || (table[8] !== 0 && table[8] !== 1)) {
    throw new Error('Expected factory firmware 3.10 with a valid response level')
  }

  link.bus.flushInput()
  await link.send(packet(servoId, 0x90, [0x90, 8]))

  const reply = await link.receive(300)

  if (reply && reply.id === servoId && reply.data[0] === 0 && String.fromCharCode(...reply.data.slice(1, 5)) === 'ARMC') {
    throw new Error('Custom firmware detected; install factory firmware before repair')
  }

  // Factory answers unknown instructions with an empty status packet, or stays silent at
  // response level zero. Custom extension reads still reply.
  const emptyStatus = reply !== null && reply.id === servoId && reply.error === 0 && reply.data.length === 0

  if (!emptyStatus && (reply !== null || table[8] === 1)) {
    throw new Error('Cannot establish factory protocol; no valid unsupported-command reply')
  }

  // Prove the application still responds after the unsupported instruction.
  const fresh = await link.registers(servoId)

  if (!samePersistent(fresh, table) || fresh.subarray(0, 4).some((v, i) => v !== table[i]) || fresh[40] !== 0 || fresh[55] !== 1 || fresh[65] !== 0) {
    throw new Error('Factory application settings or safety state changed during verification')
  }
}

/** Check the application after an upload. Returns the capability bytes for extension releases. */
export async function verifyApplication(link: Link, release: FirmwareRelease, servoId: number, baud: number, table: Uint8Array, before: Uint8Array | null): Promise<number[] | null> {
  checkDevice(table, release, servoId, baud)

  if (release.flavour === 'feetech') {
    await verifyFactory(link, servoId, table)

    return null
  }

  if (before && !samePersistent(table, before)) {
    throw new Error('Persistent settings changed; inspect the saved before/after snapshots')
  }

  // Extension replies add a result byte before the eight capability bytes.
  const caps = await link.exchange(servoId, 0x90, [0x90, 8], 9)
  const version = release.manifest.extension!

  if (String.fromCharCode(...caps.slice(0, 5)) !== '\u0000ARMC' || caps[5] !== version.major || caps[6] !== version.minor || caps[8] !== 1) {
    throw new Error('Application extension capabilities do not match the release')
  }

  return caps
}

/** Factory startup may fall back to defaults (ID 1, 1 Mbaud) when its saved settings header is invalid. */
async function readApplication(link: Link, release: FirmwareRelease, servoId: number, baud: number): Promise<{ table: Uint8Array; id: number; baud: number }> {
  const connections: Array<[number, number]> = [[servoId, baud]]

  if (release.flavour === 'feetech' && (servoId !== 1 || baud !== APP_BAUD)) {
    connections.push([1, APP_BAUD])
  }

  for (let i = 0; i < connections.length; i++) {
    const [id, rate] = connections[i]!

    try {
      if (link.bus.baudRate !== rate) {
        await link.bus.setBaud(rate)
      }

      return { table: await link.registers(id), id, baud: rate }
    } catch (e) {
      if (i === connections.length - 1) {
        throw e
      }
    }
  }

  throw new Error('unreachable')
}

export type FlashPhase = 'preflight' | 'transfer' | 'verify' | 'done'

export type FlashStatus = 'verified' | 'settings-recovery-required'

export interface FlashReport {
  release: string
  mode: 'flash' | 'recover'
  servoId: number
  status: FlashStatus | 'failed'
  phase: FlashPhase
  before: number[] | null
  after: number[] | null
  capabilities: number[] | null
  /** Where the servo answers after the flash (factory firmware may come back as ID 1). */
  connection: { id: number; baud: number } | null
  settings: 'unchanged' | 'changed' | 'unavailable in recovery' | 'pending'
  baudSwitchMs: number | null
  acknowledgedBlocks: number
  totalBlocks: number
  error?: string
}

export class FlashError extends Error {
  constructor(
    message: string,
    readonly report: FlashReport,
  ) {
    super(message)
  }
}

export interface FlashOptions {
  servoId: number
  release: FirmwareRelease
  /** Application baud rate the servo is configured for. */
  baud?: number
  /**
   * Snapshot from the user's backup. The flash is refused when the servo's settings no
   * longer match it, so the backup the user holds is always the one that can restore it.
   */
  backup?: Uint8Array
  onPhase?: (phase: FlashPhase) => void
  onProgress?: Progress
  signal?: AbortSignal
}

/**
 * Flash one servo by ID with the rest of the bus connected (normal mode), or recover an
 * isolated servo through a power cycle (recovery mode).
 * @throws FlashError carrying the report so far.
 */
export async function flashServo(link: Link, mode: 'flash' | 'recover', options: FlashOptions): Promise<FlashReport> {
  const { servoId, release } = options
  const baud = options.baud ?? APP_BAUD
  const recovery = mode === 'recover'
  const phase = (p: FlashPhase) => {
    report.phase = p
    options.onPhase?.(p)
  }

  const report: FlashReport = {
    release: release.manifest.release,
    mode,
    servoId,
    status: 'failed',
    phase: 'preflight',
    before: null,
    after: null,
    capabilities: null,
    connection: null,
    settings: recovery ? 'unavailable in recovery' : 'pending',
    baudSwitchMs: null,
    acknowledgedBlocks: 0,
    totalBlocks: 0,
  }

  try {
    let before: Uint8Array | null = null

    phase('preflight')
    if (!recovery) {
      before = await link.registers(servoId)
      report.before = Array.from(before)
      checkDevice(before, release, servoId, baud)

      if (options.backup && !samePersistent(before, options.backup)) {
        throw new Error('Settings differ from your backup; download a new backup first')
      }
    }

    phase('transfer')

    const result = await upload(
      link,
      servoId,
      release.image,
      recovery,
      (done, total) => {
        report.acknowledgedBlocks = done
        report.totalBlocks = total
        options.onProgress?.(done, total)
      },
      options.signal,
    )

    report.baudSwitchMs = result.baudSwitchMs
    phase('verify')
    await link.bus.setBaud(baud)
    await sleep(1000)

    const app = await readApplication(link, release, servoId, baud)

    report.connection = { id: app.id, baud: app.baud }
    report.after = Array.from(app.table)
    report.capabilities = await verifyApplication(link, release, app.id, app.baud, app.table, before)

    if (!recovery) {
      report.settings = before && !samePersistent(app.table, before) ? 'changed' : 'unchanged'
    }

    report.status = release.flavour === 'feetech' && report.settings === 'changed' ? 'settings-recovery-required' : 'verified'
    phase('done')

    return report
  } catch (e) {
    report.status = 'failed'
    report.error = e instanceof Error ? e.message : String(e)

    // Back to the application baud, so the UI can re-read the servo or retry in the same session.
    try {
      if (link.bus.baudRate !== baud) {
        await link.bus.setBaud(baud)
      }
    } catch {
      // the host restores 1 Mbaud when the session ends
    }
    throw new FlashError(report.error, report)
  }
}
