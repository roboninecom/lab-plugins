// Run: node --import tsx/esm --test plugins/robonine/servo-firmware/test/*.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { blockPacket, crc16, HandshakeError } from '../src/firmware/bootloader'
import { detectEcho, Link, packet } from '../src/firmware/link'
import { loadRelease, fromBase64, type FirmwareRelease, type ReleaseManifest } from '../src/firmware/release'
import { flashServo, FlashError, persistent } from '../src/firmware/flasher'
import { buildBackup, parseBackup, restoreSettings, toHex } from '../src/firmware/settings'
import * as robonine from '../src/releases/robonine-9-0'
import * as feetech from '../src/releases/feetech-3-10'
import { recoverServo, respondingIds, rollbackServo } from '../src/firmware/jobs'
import { SimBus, stockTable } from './simBus'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** Small synthetic releases (5 and 3 blocks) so transfers take milliseconds, not seconds. */
async function testRelease(kind: 'robonine' | 'feetech', blocks: number): Promise<FirmwareRelease> {
  const image = new Uint8Array(blocks * 64).map((_, i) => (i * 7 + blocks) & 0xff)

  const manifest: ReleaseManifest = {
    format: 'sts-gd32-encoded-v1',
    release: `test-${kind}`,
    image: 'firmware.enc',
    size: image.length,
    sha256: createHash('sha256').update(image).digest('hex'),
    target: 'gd32f130-sts-ttl',
    model_bytes: [[9, 3]],
    ...(kind === 'robonine' ? { extension: { major: 9, minor: 0 } } : { factory: { major: 3, minor: 10 } }),
  }

  return loadRelease(manifest, image)
}

const IMAGES = new Map<number, 'robonine' | 'feetech'>([
  [5, 'robonine'],
  [3, 'feetech'],
])

describe('bootloader framing matches the Python reference', () => {
  // Vectors produced by STS32XX-Firmware tools/flash/bootloader.py.
  const image = new Uint8Array(512).map((_, i) => i & 0xff)

  it('crc16', () => assert.equal(crc16(new TextEncoder().encode('123456789')), 12739))
  it('first block', () =>
    assert.equal(
      hex(blockPacket(1, image.subarray(0, 64), false)),
      '01fe06000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f64fd06',
    ))
  it('block 6 (flag and number are 0x06, like ACK)', () =>
    assert.equal(
      hex(blockPacket(6, image.subarray(64, 128), false)),
      '06f906404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7ffb5c06',
    ))
  it('short last block is 0xFF padded', () =>
    assert.equal(
      hex(blockPacket(300, image.subarray(0, 16), true)),
      '2cd304000102030405060708090a0b0c0d0e0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff223204',
    ))
  it('register read packet', () => assert.equal(hex(packet(3, 0x02, [0, 87])), 'ffff03040200579f'))
})

describe('bundled releases', () => {
  it('both bundled images match their manifests', async () => {
    const custom = await loadRelease(robonine.manifest, fromBase64(robonine.imageBase64))
    const factory = await loadRelease(feetech.manifest, fromBase64(feetech.imageBase64))

    assert.deepEqual([custom.flavour, custom.version, custom.image.length], ['robonine', '9.0', 25744])
    assert.deepEqual([factory.flavour, factory.version, factory.image.length], ['feetech', '3.10', 16816])
  })

  it('rejects a tampered image', async () => {
    const image = fromBase64(robonine.imageBase64)

    image[100] ^= 1
    await assert.rejects(loadRelease(robonine.manifest, image), /SHA-256/)
  })
})

describe('echo detection', () => {
  it('detects an echoing adapter and a clean one', async () => {
    assert.equal(await detectEcho(new SimBus({ echo: true })), true)
    assert.equal(await detectEcho(new SimBus({ echo: false })), false)
  })
})

for (const echo of [false, true]) {
  describe(`flash with all six servos connected (echo ${echo})`, () => {
    it('flashes only the selected servo and verifies it', async () => {
      const bus = new SimBus({ echo, images: IMAGES })
      const release = await testRelease('robonine', 5)
      const others = [1, 2, 4, 5, 6].map((id) => hex(bus.servos.get(id)!.table))
      const progress: number[] = []

      const report = await flashServo(new Link(bus, echo), 'flash', { servoId: 3, release, onProgress: (done) => progress.push(done) })

      assert.equal(report.status, 'verified')
      assert.equal(report.settings, 'unchanged')
      assert.deepEqual(report.connection, { id: 3, baud: 1_000_000 })
      assert.deepEqual(progress, [1, 2, 3, 4, 5])
      assert.equal(bus.servos.get(3)!.flavour, 'robonine')
      assert.deepEqual(
        [1, 2, 4, 5, 6].map((id) => bus.servos.get(id)!.flavour),
        ['feetech', 'feetech', 'feetech', 'feetech', 'feetech'],
      )
      assert.deepEqual(
        [1, 2, 4, 5, 6].map((id) => hex(bus.servos.get(id)!.table)),
        others,
      )
      assert.equal(bus.baudRate, 1_000_000)
    })
  })
}

describe('full-size bundled image', () => {
  it('transfers all 403 blocks of the v9 release through an echoing adapter', async () => {
    const bus = new SimBus({ echo: true, images: new Map([[403, 'robonine']]) })
    const release = await loadRelease(robonine.manifest, fromBase64(robonine.imageBase64))
    let total = 0

    const report = await flashServo(new Link(bus, true), 'flash', { servoId: 6, release, onProgress: (_, t) => (total = t) })

    assert.equal(total, 403)
    assert.equal(report.acknowledgedBlocks, 403)
    assert.equal(report.status, 'verified')
  })
})

describe('preflight refuses before any reset', () => {
  const cases: Array<[string, (t: Uint8Array) => void, RegExp]> = [
    ['torque on', (t) => (t[40] = 1), /torque off/],
    ['settings unlocked', (t) => (t[55] = 0), /persistence locked/],
    ['active alarm', (t) => (t[65] = 4), /no alarm/],
    ['other model', (t) => (t[4] = 8), /Unsupported model bytes \[9, 8\]/],
  ]

  for (const [name, mutate, message] of cases) {
    it(name, async () => {
      const bus = new SimBus({ images: IMAGES })

      mutate(bus.servos.get(2)!.table)
      await assert.rejects(flashServo(new Link(bus, false), 'flash', { servoId: 2, release: await testRelease('robonine', 5) }), message)
      assert.ok(!bus.log.some((l) => l.startsWith('reset')))
    })
  }

  it('settings that no longer match the backup', async () => {
    const bus = new SimBus({ images: IMAGES })
    const backup = bus.servos.get(2)!.table.slice()

    bus.servos.get(2)!.table[31] ^= 1 // recalibrated since the backup
    await assert.rejects(flashServo(new Link(bus, false), 'flash', { servoId: 2, release: await testRelease('robonine', 5), backup }), /differ from your backup/)
    assert.ok(!bus.log.some((l) => l.startsWith('reset')))
  })
})

describe('missed boot window', () => {
  it('fails the handshake and leaves the old firmware running', async () => {
    const bus = new SimBus({ images: IMAGES, bootWindowMs: 20, baudSwitchMs: 60 })

    await assert.rejects(flashServo(new Link(bus, false), 'flash', { servoId: 4, release: await testRelease('robonine', 5) }), (e: unknown) => {
      assert.ok(e instanceof FlashError)
      assert.equal(e.report.phase, 'transfer')
      assert.equal(e.report.acknowledgedBlocks, 0)

      return true
    })
    assert.equal(bus.servos.get(4)!.flavour, 'feetech')
    // The servo is still answering on its old firmware.
    assert.equal((await new Link(bus, false).registers(4))[5], 4)
  })

  it('HandshakeError is the failure type', () => assert.ok(new HandshakeError('x') instanceof Error))
})

describe('recovery of an isolated servo', () => {
  it('waits for the power cycle, uploads and verifies', async () => {
    const bus = new SimBus({ ids: [2], images: IMAGES })

    bus.servos.get(2)!.dead = true
    setTimeout(() => bus.powerCycle(2), 300)

    const report = await flashServo(new Link(bus, false), 'recover', { servoId: 2, release: await testRelease('robonine', 5) })

    assert.equal(report.status, 'verified')
    assert.equal(report.settings, 'unavailable in recovery')
    assert.equal(bus.servos.get(2)!.flavour, 'robonine')
  })
})

describe('rollback to factory firmware', () => {
  it('flashes factory, finds the servo at ID 1, restores its own backup', async () => {
    const bus = new SimBus({ ids: [5], images: IMAGES, factoryResetsSettings: true })
    const link = new Link(bus, false)

    bus.servos.get(5)!.flavour = 'robonine'

    const backupTable = bus.servos.get(5)!.table.slice()
    const backup = parseBackup(JSON.stringify(buildBackup([{ table: backupTable }], { model: 'so-arm102', robotId: null })))
    const report = await flashServo(link, 'flash', { servoId: 5, release: await testRelease('feetech', 3) })

    assert.equal(report.status, 'settings-recovery-required')
    assert.deepEqual(report.connection, { id: 1, baud: 1_000_000 })

    const after = await restoreSettings(link, 1, backup.get(5)!)

    assert.equal(after[5], 5)
    assert.deepEqual(persistent(after), persistent(backupTable))
    assert.equal(bus.servos.get(5)!.flavour, 'feetech')
    assert.equal(bus.servos.get(5)!.table[55], 1, 'settings locked again')
  })

  it('refuses to restore onto custom firmware', async () => {
    const bus = new SimBus({ ids: [5] })

    bus.servos.get(5)!.flavour = 'robonine'
    await assert.rejects(restoreSettings(new Link(bus, false), 5, stockTable(5)), /Custom firmware detected/)
  })
})

describe('jobs', () => {
  it('lists the servos that answer', async () => {
    const bus = new SimBus({ ids: [2, 5] })

    assert.deepEqual(await respondingIds(new Link(bus, false), [1, 2, 3, 4, 5, 6]), [2, 5])
  })

  it('rollback always restores the backup, even when factory kept the ID', async () => {
    const bus = new SimBus({ ids: [3], images: IMAGES })
    const backup = bus.servos.get(3)!.table.slice()

    bus.servos.get(3)!.flavour = 'robonine'

    const { report, restored } = await rollbackServo(new Link(bus, false), await testRelease('feetech', 3), backup, { servoId: 3 })

    assert.equal(report.status, 'verified')
    assert.ok(restored)
    assert.deepEqual(persistent(restored), persistent(backup))
    assert.ok(bus.log.some((l) => l === 'write 3 55=0'), 'restore ran')
  })

  it('factory recovery restores the backup onto the recovered servo', async () => {
    const bus = new SimBus({ ids: [4], images: IMAGES, factoryResetsSettings: true })
    const backup = bus.servos.get(4)!.table.slice()

    bus.servos.get(4)!.flavour = 'robonine'
    bus.servos.get(4)!.dead = true
    setTimeout(() => bus.powerCycle(4), 200)

    const { restored } = await recoverServo(new Link(bus, false), await testRelease('feetech', 3), backup, { servoId: 4 })

    assert.equal(restored?.[5], 4)
    assert.equal(bus.servos.get(4)!.flavour, 'feetech')
  })
})

describe('backup files', () => {
  it('round-trips the multi-servo file and reads settings.py backups', () => {
    const tables = [stockTable(1), stockTable(2)]
    const file = parseBackup(JSON.stringify(buildBackup(tables.map((table) => ({ table })), { model: null, robotId: null })))

    assert.deepEqual([...file.keys()], [1, 2])
    assert.deepEqual(parseBackup(JSON.stringify({ format: 'sts-settings-v1', registers_hex: toHex(stockTable(4)) })).get(4), stockTable(4))
    assert.throws(() => parseBackup('{"format":"other"}'), /Not a servo settings backup/)
  })
})
