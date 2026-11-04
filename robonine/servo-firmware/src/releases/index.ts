import { fromBase64, loadRelease, type FirmwareRelease } from '../firmware/release'
import * as robonine90 from './robonine-9-0'
import * as feetech310 from './feetech-3-10'

/** Releases bundled with the plugin. Add a version: embed it with scripts/embedRelease.mjs and list it here. */
export const BUNDLED_RELEASES = [
  { key: 'robonine-9.0', module: robonine90 },
  { key: 'feetech-3.10', module: feetech310 },
] as const

export type ReleaseKey = (typeof BUNDLED_RELEASES)[number]['key']

/** Validate every bundled release (size + SHA-256) before the UI offers it. */
export async function loadBundledReleases(): Promise<Map<ReleaseKey, FirmwareRelease>> {
  const out = new Map<ReleaseKey, FirmwareRelease>()

  for (const { key, module } of BUNDLED_RELEASES) {
    out.set(key, await loadRelease(module.manifest, fromBase64(module.imageBase64)))
  }

  return out
}
