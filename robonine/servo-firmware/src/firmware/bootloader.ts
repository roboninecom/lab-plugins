// STS GD32 TTL bootloader transport, ported from STS32XX-Firmware tools/flash/bootloader.py.
// Input images are already encoded by the publisher; nothing here converts them.
// Keep the framing, pacing and retry counts identical to the Python reference.

import { Link, packet, sleep } from './link'

export const BOOT_BAUD = 500_000
export const APP_BAUD = 1_000_000
const MAGIC = new TextEncoder().encode('1fBVA')
export const BLOCK_SIZE = 64
const ACK = 0x06
/** Stop before the settings backup region. */
export const MAX_IMAGE_SIZE = 0x7000
const INST_RESET = 0x08

export function crc16(data: Uint8Array): number {
  let crc = 0

  for (const value of data) {
    crc ^= value << 8
    for (let i = 0; i < 8; i++) {
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
    }
  }

  return crc
}

/** One 70-byte firmware block: number, ~number, flag, 64 data bytes (0xFF padded), CRC16, flag. */
export function blockPacket(number: number, data: Uint8Array, last: boolean): Uint8Array {
  if (number < 1 || data.length < 1 || data.length > BLOCK_SIZE) {
    throw new Error('Invalid firmware block')
  }

  const flag = last ? 4 : 6
  const out = new Uint8Array(3 + BLOCK_SIZE + 3)

  out.set([number & 0xff, ~number & 0xff, flag], 0)
  out.fill(0xff, 3, 3 + BLOCK_SIZE)
  out.set(data, 3)

  // This bootloader checks the first 64 bytes of header + payload, NOT just the
  // payload. Preserve this unusual factory framing exactly.
  const crc = crc16(out.subarray(0, 64))

  out.set([crc >> 8, crc & 0xff, flag], 3 + BLOCK_SIZE)

  return out
}

export function validateImage(image: Uint8Array): void {
  if (image.length === 0 || image.length % 16 || image.length > MAX_IMAGE_SIZE) {
    throw new Error('Encoded image must be 16-byte aligned and at most 28672 bytes')
  }
}

export class HandshakeError extends Error {}

/**
 * Acquire the bootloader: magic, then the start byte, each answered by ACK.
 * Normal mode makes 10 attempts right after the reset; recovery keeps probing for 60 s
 * while the user power-cycles the servo.
 */
export async function acquire(link: Link, recovery: boolean, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 60_000
  let attempt = 0

  while (recovery ? Date.now() < deadline : attempt < 10) {
    if (signal?.aborted) {
      throw new Error('Cancelled')
    }
    attempt++

    for (let i = 0; i < 3; i++) {
      await link.bus.write(MAGIC)
      await sleep(5)
    }

    if ((await link.bus.readUntil(ACK, 40)).found) {
      await sleep(10)
      link.bus.flushInput()
      await link.bus.write(new Uint8Array([1]))
      if ((await link.bus.readUntil(ACK, 250)).found) {
        return
      }
    }

    // Reacquire from magic rather than resending a standalone start byte.
    await sleep(10)
  }

  throw new HandshakeError('Bootloader handshake failed')
}

export type Progress = (done: number, total: number) => void

export async function transfer(link: Link, image: Uint8Array, progress: Progress): Promise<void> {
  validateImage(image)

  const total = Math.ceil(image.length / BLOCK_SIZE)

  await sleep(5)

  for (let number = 1; number <= total; number++) {
    const data = image.subarray((number - 1) * BLOCK_SIZE, number * BLOCK_SIZE)
    const block = blockPacket(number, data, number === total)

    for (let attempt = 0; attempt < 3; attempt++) {
      link.bus.flushInput()
      await link.send(block)
      await sleep(10)

      const response = await link.bus.read(1, 2000)

      if (response.length === 1 && response[0] === ACK) {
        break
      }

      if (attempt === 2) {
        throw new Error(`Block ${number}/${total} not acknowledged after 3 attempts`)
      }
      await sleep(100)
    }

    progress(number, total)
    await sleep(number % 16 === 0 ? 50 : 5)
  }
}

export interface UploadResult {
  /** Milliseconds the port was closed for the 1 M → 500 k switch (normal mode only). */
  baudSwitchMs: number | null
}

/**
 * Put the servo in its bootloader and send the image.
 * Normal mode: addressed reset at 1 Mbaud, then switch to 500 kbaud at once — waiting
 * for a reply to the reset misses the boot window. Recovery: the port is switched first
 * and the user power-cycles the (isolated) servo while the handshake probes.
 */
export async function upload(link: Link, servoId: number, image: Uint8Array, recovery: boolean, progress: Progress, signal?: AbortSignal): Promise<UploadResult> {
  let baudSwitchMs: number | null = null

  validateImage(image)

  if (recovery) {
    if (link.bus.baudRate !== BOOT_BAUD) {
      await link.bus.setBaud(BOOT_BAUD)
    }
    link.bus.flushInput()
  } else {
    // Reset is addressed; the bootloader traffic that follows is not.
    await link.sendNow(packet(servoId, INST_RESET))
    baudSwitchMs = await link.bus.setBaud(BOOT_BAUD)
    link.bus.flushInput()
  }

  await acquire(link, recovery, signal)
  await transfer(link, image, progress)

  return { baudSwitchMs }
}
