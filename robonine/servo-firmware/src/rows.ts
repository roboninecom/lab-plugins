import type { ServoFirmware } from '@robonine/plugin-sdk'
import type { FlashReport } from './firmware/flasher'
import { acceptsModel, type FirmwareRelease } from './firmware/release'

export type RowState = 'idle' | 'preflight' | 'transfer' | 'verify' | 'restore' | 'done' | 'error'

export interface Row {
  id: number
  table: Uint8Array | null
  firmware: ServoFirmware | null
  state: RowState
  done: number
  total: number
  message: string
  report: FlashReport | null
}

/**
 * Rows from a fresh read, keeping each servo's last flash outcome (status line and report)
 * so re-reading the bus never throws away a report the user has not saved yet.
 */
export function mergeRows(previous: Row[], fresh: Row[]): Row[] {
  return fresh.map((row) => {
    const last = previous.find((p) => p.id === row.id)

    if (!last || (last.state !== 'done' && last.state !== 'error')) {
      return row
    }

    return { ...row, state: last.state, report: last.report, done: last.done, total: last.total, message: last.state === 'error' ? last.message : row.message }
  })
}

/**
 * Whether a release accepts this servo's hardware (registers 3–4, e.g. 9.3). Unknown
 * (no table: the servo did not answer) counts as supported so recovery stays possible.
 */
export function modelSupported(table: Uint8Array | null, release: FirmwareRelease | undefined): boolean {
  if (!table || !release) {
    return true
  }

  return acceptsModel(release, table[3]!, table[4]!)
}
