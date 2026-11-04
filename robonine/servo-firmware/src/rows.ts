import type { ServoFirmware } from '@robonine/plugin-sdk'
import type { FlashReport } from './firmware/flasher'

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
