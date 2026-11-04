// Packet I/O over a raw bus session (the host's `bus.exclusive`), ported from
// STS32XX-Firmware tools/flash/bootloader.py (send/receive/exchange) and serial_io.py.
//
// One addition the Python tools do not need: half-duplex adapter echo. Some adapters
// loop every transmitted byte back to RX. The Python flasher assumes they do not; here
// the session measures it once (`detectEcho`) and every write then consumes exactly its
// own echo, so a firmware block's echo (which contains 0x06 bytes) is never mistaken
// for the bootloader's ACK.

/** The parts of the host's RawBusSession the flasher uses. */
export interface RawBus {
  readonly baudRate: number
  readonly canChangeBaud: boolean
  write(data: Uint8Array): Promise<void>
  read(size: number, timeoutMs: number): Promise<Uint8Array>
  readUntil(byte: number, timeoutMs: number): Promise<{ found: boolean; data: Uint8Array }>
  available(): number
  flushInput(): void
  setBaud(rate: number): Promise<number>
}

export interface Reply {
  id: number
  error: number
  data: number[]
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** How long a write's echo may take to come back (USB latency dominates, not the UART). */
const ECHO_TIMEOUT_MS = 100

export function checksum(id: number, length: number, code: number, data: ArrayLike<number> = []): number {
  let sum = id + length + code

  for (let i = 0; i < data.length; i++) {
    sum += data[i]!
  }

  return ~sum & 0xff
}

/** Standard STS packet: FF FF ID LEN INSTRUCTION PARAMS… CHECKSUM. */
export function packet(id: number, instruction: number, params: ArrayLike<number> = []): Uint8Array {
  const length = params.length + 2

  return new Uint8Array([0xff, 0xff, id, length, instruction, ...Array.from(params), checksum(id, length, instruction, params)])
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Find out whether the adapter echoes transmitted bytes. Sends four zero bytes, which no
 * servo or bootloader treats as a packet, and checks whether they come back.
 */
export async function detectEcho(bus: RawBus): Promise<boolean> {
  const probe = new Uint8Array(4)

  bus.flushInput()
  await bus.write(probe)

  return sameBytes(await bus.read(probe.length, ECHO_TIMEOUT_MS), probe)
}

export class Link {
  constructor(
    readonly bus: RawBus,
    readonly echo: boolean,
  ) {}

  /** Write bytes and, on an echoing adapter, consume their echo. */
  async send(bytes: Uint8Array): Promise<void> {
    await this.bus.write(bytes)

    if (!this.echo) {
      return
    }

    const echoed = await this.bus.read(bytes.length, ECHO_TIMEOUT_MS)

    if (!sameBytes(echoed, bytes)) {
      throw new Error('Adapter echo did not match the transmitted bytes')
    }
  }

  /** Write a packet without waiting for its echo (used right before a baud switch). */
  async sendNow(bytes: Uint8Array): Promise<void> {
    await this.bus.write(bytes)
  }

  /** Read one status packet within a single deadline; null on timeout or a bad frame. */
  async receive(timeoutMs = 100): Promise<Reply | null> {
    const deadline = Date.now() + timeoutMs
    const take = (size: number) => this.bus.read(size, Math.max(0, deadline - Date.now()))
    const header = await take(2)

    if (header.length !== 2 || header[0] !== 0xff || header[1] !== 0xff) {
      return null
    }

    const prefix = await take(2)

    if (prefix.length !== 2) {
      return null
    }

    const [id, length] = [prefix[0]!, prefix[1]!]

    if (id > 253 || length < 2) {
      return null
    }

    const payload = await take(length)

    if (payload.length !== length) {
      return null
    }

    const error = payload[0]!
    const data = Array.from(payload.slice(1, -1))

    return payload[length - 1] === checksum(id, length, error, data) ? { id, error, data } : null
  }

  /** Read-only query with retries. Never use for a reset or a firmware block. */
  async exchange(id: number, instruction: number, params: number[], size: number, attempts = 5): Promise<number[]> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      this.bus.flushInput()
      await this.send(packet(id, instruction, params))

      const reply = await this.receive()

      if (reply && reply.id === id) {
        if (reply.error) {
          throw new Error(`Servo ${id}: status alarm 0x${reply.error.toString(16).padStart(2, '0')}`)
        }

        if (reply.data.length === size) {
          return reply.data
        }
      }

      if (attempt + 1 < attempts) {
        await sleep(20)
      }
    }

    throw new Error(`Servo ${id}: no valid reply to instruction 0x${instruction.toString(16).padStart(2, '0')}`)
  }

  /** The 87-byte register table 0–86. */
  async registers(id: number): Promise<Uint8Array> {
    return new Uint8Array(await this.exchange(id, 0x02, [0, 87], 87))
  }
}
