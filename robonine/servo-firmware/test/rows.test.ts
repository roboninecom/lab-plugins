import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeRows, modelSupported, type Row } from '../src/rows'
import type { FirmwareRelease } from '../src/firmware/release'

const row = (id: number, patch: Partial<Row> = {}): Row => ({ id, table: null, firmware: null, state: 'idle', done: 0, total: 0, message: '', report: null, ...patch })

describe('re-reading the bus', () => {
  it('keeps the last flash status and report', () => {
    const report = { status: 'verified', baudSwitchMs: 12 } as unknown as Row['report']
    const previous = [row(3, { state: 'done', report, done: 403, total: 403 })]
    const fresh = [row(3, { firmware: { flavour: 'robonine', version: '9.0', supported: true, model: [9, 3] } })]
    const [merged] = mergeRows(previous, fresh)

    assert.equal(merged!.state, 'done')
    assert.equal(merged!.report, report)
    assert.equal(merged!.firmware?.flavour, 'robonine', 'firmware comes from the fresh read')
  })

  it('keeps a failure message, and leaves untouched rows as read', () => {
    const merged = mergeRows([row(2, { state: 'error', message: 'Bootloader handshake failed' }), row(4)], [row(2, { message: '' }), row(4, { message: 'no reply' })])

    assert.equal(merged[0]!.message, 'Bootloader handshake failed')
    assert.equal(merged[1]!.message, 'no reply')
  })
})

describe('hardware the release accepts', () => {
  const release = { manifest: { model_bytes: [[9, 3]] } } as unknown as FirmwareRelease
  const table = (major: number, minor: number) => Uint8Array.from({ length: 87 }, (_, i) => (i === 3 ? major : i === 4 ? minor : 0))

  it('accepts every 9.x model, skips other families, and treats a silent servo as recoverable', () => {
    assert.equal(modelSupported(table(9, 3), release), true)
    assert.equal(modelSupported(table(9, 11), release), true)
    assert.equal(modelSupported(table(8, 3), release), false)
    assert.equal(modelSupported(null, release), true)
  })
})
