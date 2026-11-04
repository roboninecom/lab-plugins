// A simulated STS bus for flasher tests: GD32 servos with factory or robonine firmware,
// the bootloader's handshake and block protocol, an optional echoing adapter, and a
// boot window after reset that a slow baud switch can miss.

import { checksum } from '../src/firmware/link'
import { crc16 } from '../src/firmware/bootloader'
import type { RawBus } from '../src/firmware/link'

type Flavour = 'feetech' | 'robonine'

export interface SimServo {
  table: Uint8Array
  flavour: Flavour
  /** Saved settings the factory firmware reloads on reset ("reset template"). */
  template: Uint8Array
  boot: null | { until: number; stage: 'magic' | 'start' | 'blocks'; magicBuf: number[]; image: number[]; expect: number; pending: number[] }
  /** When true the servo answers nothing in application mode (bricked app). */
  dead: boolean
}

/** Factory-like table for an STS3215 (model 9.3) with firmware 3.10 at 1 Mbaud. */
export function stockTable(id: number): Uint8Array {
  const t = new Uint8Array(87)

  t.set([3, 10, 0, 9, 3, id, 0, 0, 1], 0)
  t[31] = (id * 37) & 0xff // homing offset low byte: makes every servo's calibration distinct
  t[55] = 1 // locked
  return t
}

export interface SimOptions {
  ids?: number[]
  echo?: boolean
  /** How long a servo listens for the bootloader magic after a reset. */
  bootWindowMs?: number
  /** Simulated time the port is closed during setBaud. */
  baudSwitchMs?: number
  /** Images the sim recognises: sha-free mapping from image length to resulting flavour. */
  images?: Map<number, Flavour>
  /** Factory firmware falls back to ID 1 / defaults after replacing custom firmware. */
  factoryResetsSettings?: boolean
}

export class SimBus implements RawBus {
  baudRate = 1_000_000
  readonly canChangeBaud = true
  readonly servos = new Map<number, SimServo>()
  readonly log: string[] = []
  private rx: number[] = []
  private rxPending: number[] = []
  private closedUntil = 0

  constructor(readonly options: SimOptions = {}) {
    for (const id of options.ids ?? [1, 2, 3, 4, 5, 6]) {
      const table = stockTable(id)

      this.servos.set(id, { table, flavour: 'feetech', template: table.slice(), boot: null, dead: false })
    }
  }

  private now() {
    return Date.now()
  }

  private push(bytes: number[]) {
    this.rx.push(...bytes)
  }

  private status(id: number, data: number[] = [], error = 0) {
    const length = data.length + 2

    this.push([0xff, 0xff, id, length, error, ...data, checksum(id, length, error, data)])
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.now() < this.closedUntil) {
      throw new Error('port closed')
    }

    if (this.options.echo) {
      this.push(Array.from(data))
    }

    if (this.baudRate === 1_000_000) {
      this.appBytes(Array.from(data))
    } else if (this.baudRate === 500_000) {
      for (const servo of this.servos.values()) {
        this.bootBytes(servo, Array.from(data))
      }
    }
  }

  private expireBoot(servo: SimServo) {
    if (servo.boot && servo.boot.stage === 'magic' && this.now() > servo.boot.until) {
      servo.boot = null
    }
  }

  private appBytes(bytes: number[]) {
    this.rxPending.push(...bytes)

    while (this.rxPending.length >= 6) {
      if (this.rxPending[0] !== 0xff || this.rxPending[1] !== 0xff) {
        this.rxPending.shift()
        continue
      }

      const length = this.rxPending[3]!

      if (this.rxPending.length < length + 4) {
        return
      }

      const frame = this.rxPending.splice(0, length + 4)

      this.handlePacket(frame[2]!, frame[4]!, frame.slice(5, -1))
    }
  }

  private handlePacket(id: number, instruction: number, params: number[]) {
    const servo = this.servos.get(id)

    if (!servo) {
      return
    }
    this.expireBoot(servo)

    if (servo.boot || servo.dead) {
      return
    }

    const t = servo.table
    const level = t[8]

    switch (instruction) {
      case 0x02: {
        const [addr, len] = params as [number, number]

        this.status(id, Array.from(t.subarray(addr, addr + len)))
        break
      }
      case 0x03: {
        const [addr, ...values] = params as [number, ...number[]]
        const eeprom = addr < 40

        if (eeprom && t[55] === 1 && addr !== 55) {
          break // locked: ignored
        }
        t.set(values, addr)
        this.log.push(`write ${id} ${addr}=${values.join(',')}`)
        if (level) {
          this.status(addr === 5 ? values[0]! : id)
        }

        if (addr === 5) {
          this.servos.delete(id)
          this.servos.set(values[0]!, servo)
        }
        break
      }
      case 0x90:
        if (servo.flavour === 'robonine') {
          this.status(id, [0, 0x41, 0x52, 0x4d, 0x43, 9, 0, 0, 1])
        } else if (level) {
          this.status(id)
        }
        break
      case 0x09: // save template
        servo.template = t.slice()
        if (level) {
          this.status(id)
        }
        break
      case 0x06: // apply template
        t.set(servo.template.subarray(4, 87), 4)
        if (level) {
          this.status(id)
        }
        break
      case 0x08: // reset → bootloader window
        this.log.push(`reset ${id}`)
        servo.boot = { until: this.now() + (this.options.bootWindowMs ?? 300), stage: 'magic', magicBuf: [], image: [], expect: 1, pending: [] }
        break
    }
  }

  /** Simulate a power cycle of one servo: it enters its bootloader window. */
  powerCycle(id: number) {
    const servo = this.servos.get(id)!

    servo.boot = { until: this.now() + (this.options.bootWindowMs ?? 300), stage: 'magic', magicBuf: [], image: [], expect: 1, pending: [] }
  }

  private bootBytes(servo: SimServo, bytes: number[]) {
    this.expireBoot(servo)

    const boot = servo.boot

    if (!boot) {
      return
    }

    if (boot.stage === 'magic') {
      boot.magicBuf.push(...bytes)
      if (String.fromCharCode(...boot.magicBuf).includes('1fBVA')) {
        boot.stage = 'start'
        boot.magicBuf = []
        this.push([0x06])
      }
      return
    }

    if (boot.stage === 'start') {
      if (bytes.includes(0x01)) {
        boot.stage = 'blocks'
        this.push([0x06])
      } else if (String.fromCharCode(...bytes).includes('1fBVA')) {
        this.push([0x06])
      }
      return
    }

    boot.pending.push(...bytes)
    while (boot.pending.length >= 70) {
      const block = boot.pending.splice(0, 70)
      const [number, inverse, flag] = block as [number, number, number]
      const crc = crc16(new Uint8Array(block.slice(0, 64)))

      if (number !== (boot.expect & 0xff) || inverse !== (~boot.expect & 0xff) || block[67] !== crc >> 8 || block[68] !== (crc & 0xff) || block[69] !== flag) {
        this.push([0x15])
        continue
      }
      boot.image.push(...block.slice(3, 67))
      boot.expect++
      this.push([0x06])

      if (flag === 4) {
        this.finishUpload(servo, boot.expect - 1)
      }
    }
  }

  private finishUpload(servo: SimServo, blocks: number) {
    const flavour = this.options.images?.get(blocks) ?? 'robonine'
    const id = servo.table[5]!

    servo.boot = null
    servo.dead = false

    if (flavour === 'feetech' && servo.flavour === 'robonine' && this.options.factoryResetsSettings) {
      // Factory startup finds no valid settings header: defaults, ID 1.
      const defaults = stockTable(1)

      this.servos.delete(id)
      servo.table = defaults
      servo.template = defaults.slice()
      this.servos.set(1, servo)
    }
    servo.flavour = flavour
  }

  async read(size: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = this.now() + timeoutMs

    while (this.rx.length < size && this.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1))
    }

    return new Uint8Array(this.rx.splice(0, Math.min(size, this.rx.length)))
  }

  async readUntil(byte: number, timeoutMs: number) {
    const deadline = this.now() + timeoutMs

    while (true) {
      const at = this.rx.indexOf(byte)

      if (at >= 0) {
        return { found: true, data: new Uint8Array(this.rx.splice(0, at + 1)) }
      }

      if (this.now() >= deadline) {
        return { found: false, data: new Uint8Array(this.rx.splice(0)) }
      }
      await new Promise((r) => setTimeout(r, 1))
    }
  }

  available() {
    return this.rx.length
  }

  flushInput() {
    this.rx.length = 0
  }

  async setBaud(rate: number): Promise<number> {
    const ms = this.options.baudSwitchMs ?? 5

    this.closedUntil = this.now() + ms
    await new Promise((r) => setTimeout(r, ms))
    this.closedUntil = 0
    this.baudRate = rate
    this.rx.length = 0
    this.rxPending.length = 0
    this.log.push(`baud ${rate}`)

    return ms
  }
}
