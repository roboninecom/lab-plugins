// Multi-step jobs the UI runs inside one exclusive bus session.

import { flashServo, type FlashOptions, type FlashReport } from './flasher'
import type { Link } from './link'
import type { FirmwareRelease } from './release'
import { restoreSettings, type RestorePhase } from './settings'

/**
 * IDs among `ids` that answer a one-byte register read. Used to prove a servo is alone on
 * the bus before a rollback or recovery (bootloader traffic is not addressed).
 */
export async function respondingIds(link: Link, ids: number[]): Promise<number[]> {
  const found: number[] = []

  for (const id of ids) {
    try {
      await link.exchange(id, 0x02, [5, 1], 1, 2)
      found.push(id)
    } catch {
      // silent: not on the bus
    }
  }

  return found
}

export interface RestoreResult {
  report: FlashReport
  /** Register table after the settings restore, or null when no restore was needed. */
  restored: Uint8Array | null
}

/**
 * Install factory firmware on one isolated servo and put its own settings back.
 * Factory startup may fall back to defaults (ID 1, default calibration), so the backup is
 * always restored — "settings look right" is not proof the saved template is valid.
 */
export async function rollbackServo(
  link: Link,
  factory: FirmwareRelease,
  backup: Uint8Array,
  options: Omit<FlashOptions, 'release' | 'backup'>,
  onRestorePhase?: (p: RestorePhase) => void,
): Promise<RestoreResult> {
  if (factory.flavour !== 'feetech') {
    throw new Error('Rollback needs the factory release')
  }

  const report = await flashServo(link, 'flash', { ...options, release: factory })

  return { report, restored: await restoreAt(link, report, backup, onRestorePhase) }
}

/**
 * Recover an isolated servo through a power cycle. After a factory recovery the servo's
 * settings are restored from the backup when one is given.
 */
export async function recoverServo(
  link: Link,
  release: FirmwareRelease,
  backup: Uint8Array | null,
  options: Omit<FlashOptions, 'release' | 'backup'>,
  onRestorePhase?: (p: RestorePhase) => void,
): Promise<RestoreResult> {
  const report = await flashServo(link, 'recover', { ...options, release })

  if (release.flavour !== 'feetech' || !backup) {
    return { report, restored: null }
  }

  return { report, restored: await restoreAt(link, report, backup, onRestorePhase) }
}

async function restoreAt(link: Link, report: FlashReport, backup: Uint8Array, onRestorePhase?: (p: RestorePhase) => void): Promise<Uint8Array> {
  const connection = report.connection!

  if (link.bus.baudRate !== connection.baud) {
    await link.bus.setBaud(connection.baud)
  }

  return restoreSettings(link, connection.id, backup, onRestorePhase)
}
