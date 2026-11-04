// Release bundle validation, ported from STS32XX-Firmware tools/flash/flash.py (load_release).
// The whole bundle is checked before any port traffic; the image is never transformed.

import { MAX_IMAGE_SIZE } from './bootloader'

export const RELEASE_FORMAT = 'sts-gd32-encoded-v1'

export interface ReleaseManifest {
  format: string
  release: string
  image: string
  size: number
  sha256: string
  target: string
  model_bytes: number[][]
  extension?: { major: number; minor: number }
  factory?: { major: number; minor: number }
}

export type ReleaseFlavour = 'robonine' | 'feetech'

export interface FirmwareRelease {
  manifest: ReleaseManifest
  image: Uint8Array
  /** `robonine` for extension (custom) releases, `feetech` for the factory image. */
  flavour: ReleaseFlavour
  /** `major.minor` of the application the release installs. */
  version: string
}

function exactKeys(value: object, keys: string[], label: string) {
  const actual = Object.keys(value).sort()

  if (actual.length !== keys.length || keys.slice().sort().some((k, i) => k !== actual[i])) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}`)
  }
}

function integer(value: unknown, lo: number, hi: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
    throw new Error(`Invalid ${label}; expected ${lo}..${hi}`)
  }

  return value
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)

  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate a manifest + encoded image pair.
 * @throws When any field, the size, the SHA-256 or the image shape does not match.
 */
export async function loadRelease(manifest: ReleaseManifest, image: Uint8Array): Promise<FirmwareRelease> {
  const application = 'factory' in manifest ? 'factory' : 'extension'
  const version = manifest[application]

  exactKeys(manifest, ['format', 'release', 'image', 'size', 'sha256', 'target', 'model_bytes', application], 'Manifest')

  if (manifest.format !== RELEASE_FORMAT || manifest.target !== 'gd32f130-sts-ttl') {
    throw new Error('Unsupported encoded format or hardware target')
  }

  if (typeof manifest.release !== 'string' || !manifest.release.trim()) {
    throw new Error('Release name is required')
  }

  if (integer(manifest.size, 16, MAX_IMAGE_SIZE, 'image size') % 16) {
    throw new Error('Encoded size must be a multiple of 16 bytes')
  }

  if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    throw new Error('sha256 must be 64 lowercase hexadecimal digits')
  }

  if (!Array.isArray(manifest.model_bytes) || manifest.model_bytes.length === 0) {
    throw new Error('At least one supported model-byte pair is required')
  }

  for (const pair of manifest.model_bytes) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error('Each model-byte pair needs registers 3 and 4')
    }
    pair.forEach((v) => integer(v, 0, 255, 'model byte'))
  }

  if (!version) {
    throw new Error('Application version is required')
  }

  exactKeys(version, ['major', 'minor'], application)
  integer(version.major, 0, 255, 'application major')
  integer(version.minor, 0, 255, 'application minor')

  if (application === 'factory' && (version.major !== 3 || version.minor !== 10)) {
    throw new Error('Factory verification supports firmware 3.10 only')
  }

  if (application === 'extension' && version.major !== 9) {
    throw new Error('Custom firmware verification supports extension v9 only')
  }

  if (image.length !== manifest.size || (await sha256Hex(image)) !== manifest.sha256) {
    throw new Error('Encoded image size or SHA-256 does not match the release manifest')
  }

  // A common accidental input is a raw Cortex-M image with a plausible SP/PC.
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  const sp = view.getUint32(0, true)
  const pc = view.getUint32(4, true)

  if (sp >= 0x20000000 && sp <= 0x20001000 && pc >= 0x08000000 && pc < 0x08007000 && pc & 1) {
    throw new Error('Input resembles a raw firmware image; obtain the encoded release')
  }

  return { manifest, image, flavour: application === 'factory' ? 'feetech' : 'robonine', version: `${version.major}.${version.minor}` }
}

/** Decode a base64 string (bundled images) without Node's Buffer. */
export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)

  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i)
  }

  return out
}
