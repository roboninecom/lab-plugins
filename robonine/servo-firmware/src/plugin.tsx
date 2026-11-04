import type { FirmwareRelease } from './firmware/release'
import type { PluginContext, ServoFirmware } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildBackup, parseBackup, settingsDifferences } from './firmware/settings'
import { recoverServo, respondingIds, rollbackServo } from './firmware/jobs'
import { FlashError, flashServo, type FlashReport } from './firmware/flasher'
import { loadBundledReleases, type ReleaseKey } from './releases'
import { translations, type Copies } from './translations'
import { mergeRows, modelSupported, type Row, type RowState } from './rows'
import { detectEcho, Link } from './firmware/link'

interface Props {
  context: PluginContext
}


interface Isolation {
  servoId: number
  kind: 'rollback' | 'recover'
  release: ReleaseKey
  checked: 'no' | 'ok' | string
  running: boolean
}

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''))

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }))
  const a = document.createElement('a')

  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function PluginRoot({ context }: Props) {
  const copies: Copies = useMemo(() => translations[context.locale] ?? translations['en']!, [context.locale])
  const { Button, Card, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = context.ui
  const { connected, transport } = context.connection
  const servoIds = useMemo(() => {
    const ids = Object.values(context.robotConfig?.jointServoId ?? {})

    return ids.length ? [...new Set(ids)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6]
  }, [context.robotConfig])

  const [releases, setReleases] = useState<Map<ReleaseKey, FirmwareRelease> | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [scanning, setScanning] = useState(false)
  const [adapter, setAdapter] = useState<{ echo: boolean; canChangeBaud: boolean } | null>(null)
  const [backupDownloaded, setBackupDownloaded] = useState(false)
  const [backup, setBackup] = useState<Map<number, Uint8Array> | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [isolation, setIsolation] = useState<Isolation | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const gravityAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    loadBundledReleases()
      .then(setReleases)
      .catch((e: Error) => context.toast.error(e.message))
  }, [context.toast])

  const patchRow = useCallback((id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))), [])

  const readRow = useCallback(
    async (id: number): Promise<Row> => {
      try {
        const table = new Uint8Array(await context.servo.readRegisters(id, 0, 87))
        const firmware = await context.servo.readFirmware(id).catch(() => null)

        return { id, table, firmware, state: 'idle', done: 0, total: 0, message: '', report: null }
      } catch {
        return { id, table: null, firmware: null, state: 'idle', done: 0, total: 0, message: copies.noReply, report: null }
      }
    },
    [context.servo, copies.noReply],
  )

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const found: Row[] = []

      for (const id of servoIds) {
        found.push(await readRow(id))
      }
      setRows((previous) => mergeRows(previous, found))
      setAdapter(await context.bus.exclusive(async (bus) => ({ echo: await detectEcho(bus), canChangeBaud: bus.canChangeBaud })))
    } catch (e) {
      context.toast.error((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [context.bus, context.toast, readRow, servoIds])

  useEffect(() => {
    if (connected && transport === 'usb') {
      void scan()
    }
    // Read once per connection; later reads are explicit.
  }, [connected, transport])

  const liveTables = rows.filter((r) => r.table).map((r) => r.table!)

  const downloadBackup = useCallback(async () => {
    const fresh: Row[] = []

    for (const id of servoIds) {
      fresh.push(await readRow(id))
    }
    setRows((previous) => mergeRows(previous, fresh))

    const tables = fresh.filter((r) => r.table)
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    download(
      `servo-backup-${context.connection.robotModel ?? 'robot'}-${date}.json`,
      buildBackup(
        tables.map((r) => ({ table: r.table!, firmware: r.firmware ? { flavour: r.firmware.flavour, version: r.firmware.version } : undefined })),
        { model: context.connection.robotModel, robotId: context.connection.robotId },
      ),
    )
    setBackupDownloaded(true)
    setBackup(null)
  }, [context.connection.robotId, context.connection.robotModel, readRow, servoIds])

  const confirmBackup = useCallback(
    async (file: File) => {
      try {
        const parsed = parseBackup(await file.text())
        const mismatched = liveTables.filter((t) => {
          const saved = parsed.get(t[5]!)

          return !saved || settingsDifferences(t, saved).length > 0
        })

        if (mismatched.length) {
          throw new Error(`${copies.backupMismatch}: ${mismatched.map((t) => t[5]).join(', ')}`)
        }
        setBackup(parsed)
        setBackupError(null)
      } catch (e) {
        setBackup(null)
        setBackupError((e as Error).message)
      }
    },
    [copies.backupMismatch, liveTables],
  )

  const progressHandlers = (id: number) => ({
    onPhase: (phase: string) => patchRow(id, { state: phase === 'done' ? 'verify' : (phase as RowState), message: '' }),
    onProgress: (done: number, total: number) => patchRow(id, { done, total }),
  })

  const finishRow = useCallback(
    async (id: number, report: FlashReport | null, error: string | null) => {
      const answeringId = report?.connection?.id ?? id
      const fresh = await readRow(answeringId)

      setRows((rs) => rs.map((r) => (r.id === id ? { ...fresh, id, state: error ? 'error' : 'done', message: error ?? '', report, done: r.done, total: r.total } : r)))
    },
    [readRow],
  )

  /** Ready the servo for preflight: torque off and settings locked. */
  const prepare = useCallback(
    async (id: number) => {
      await context.servo.setTorque(id, false)
      await context.servo.writeRegisters(id, 55, [1])
    },
    [context.servo],
  )

  const installAll = useCallback(async () => {
    const release = releases?.get('robonine-9.0')

    if (!release || !backup || !adapter) {
      return
    }
    setBusy(true)
    setConfirmText('')
    try {
      await context.servo.disableTorque()
      for (const row of rows) {
        if (!row.table || !modelSupported(row.table, release) || (row.firmware?.flavour === 'robonine' && row.firmware.version === release.version)) {
          continue
        }

        let report: FlashReport | null = null
        let error: string | null = null

        patchRow(row.id, { state: 'preflight', done: 0, total: 0, message: '', report: null })
        try {
          await prepare(row.id)
          report = await context.bus.exclusive((bus) =>
            flashServo(new Link(bus, adapter.echo), 'flash', { servoId: row.id, release, backup: backup.get(row.id), ...progressHandlers(row.id) }),
          )
        } catch (e) {
          report = e instanceof FlashError ? e.report : null
          error = (e as Error).message
        }
        await finishRow(row.id, report, error)

        if (error) {
          context.toast.error(`${row.id}: ${error}`)
          break // stop the sequence on the first failure
        }
      }
    } finally {
      setBusy(false)
    }
  }, [adapter, backup, context, finishRow, patchRow, prepare, releases, rows])

  const checkIsolation = useCallback(async () => {
    if (!isolation || !adapter) {
      return
    }

    const candidates = [...new Set([...servoIds, 1, isolation.servoId])]
    const found = await context.bus.exclusive((bus) => respondingIds(new Link(bus, adapter.echo), candidates))
    // Rollback needs exactly the target answering; recovery may find nothing (bricked app).
    const others = found.filter((id) => id !== isolation.servoId)
    const ok = isolation.kind === 'rollback' ? others.length === 0 && found.includes(isolation.servoId) : others.length === 0

    setIsolation({ ...isolation, checked: ok ? 'ok' : others.join(', ') || copies.noReply })
  }, [adapter, context.bus, copies.noReply, isolation, servoIds])

  const runIsolated = useCallback(async () => {
    const job = isolation
    const release = job && releases?.get(job.release)
    const saved = job && backup?.get(job.servoId)

    if (!job || !release || !adapter || !saved) {
      return
    }
    setIsolation({ ...job, running: true })
    patchRow(job.servoId, { state: 'preflight', done: 0, total: 0, message: '', report: null })
    setBusy(true)

    let report: FlashReport | null = null
    let error: string | null = null

    try {
      if (job.kind === 'rollback') {
        await prepare(job.servoId)
      }

      const handlers = { servoId: job.servoId, ...progressHandlers(job.servoId) }
      const onRestore = () => patchRow(job.servoId, { state: 'restore' })

      const result = await context.bus.exclusive((bus) => {
        const link = new Link(bus, adapter.echo)

        return job.kind === 'rollback' ? rollbackServo(link, release, saved, handlers, onRestore) : recoverServo(link, release, saved, handlers, onRestore)
      })

      report = result.report
    } catch (e) {
      report = e instanceof FlashError ? e.report : null
      error = (e as Error).message
    } finally {
      setBusy(false)
    }
    await finishRow(job.servoId, report, error)
    setIsolation(null)

    if (error) {
      context.toast.error(error)
    } else {
      context.toast.success(fill(copies.reconnectOthers, { id: job.servoId }))
    }
  }, [adapter, backup, context, copies.reconnectOthers, finishRow, isolation, patchRow, prepare, releases])

  // --- Render ---

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <p className="text-sm max-w-md">{copies.notConnected}</p>
        <Button size="sm" onClick={context.openConnectDialog}>
          {copies.connect}
        </Button>
      </div>
    )
  }

  if (transport !== 'usb') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <p className="text-sm font-medium max-w-md">{copies.notUsb}</p>
        <p className="text-xs text-muted-foreground">{copies.reconnectUsb}</p>
      </div>
    )
  }

  const phaseLabel = (r: Row) => {
    switch (r.state) {
      case 'preflight':
        return copies.phasePreflight
      case 'transfer':
        return `${copies.phaseTransfer} ${r.total ? Math.round((100 * r.done) / r.total) : 0}% (${r.done}/${r.total || '…'})`
      case 'verify':
        return copies.phaseVerify
      case 'restore':
        return copies.phaseRestore
      case 'done':
        return copies.done + (r.report?.baudSwitchMs != null ? ` · ${fill(copies.baudSwitch, { ms: Math.round(r.report.baudSwitchMs) })}` : '')
      case 'error':
        return `${copies.failed}: ${r.message}`
      default:
        return r.message || (modelSupported(r.table, releases?.get('robonine-9.0')) ? '' : fill(copies.modelUnsupported, { model: `${r.table![3]}.${r.table![4]}` }))
    }
  }

  /** Why a row's rollback/recover is unavailable, or '' when it can run. */
  const rowActionBlocked = (id: number) => {
    const table = rows.find((r) => r.id === id)?.table ?? null

    if (busy) {
      return copies.busyHint
    }

    // Rollback and recovery images accept the same hardware as the install image.
    if (!modelSupported(table, releases?.get('feetech-3.10'))) {
      return fill(copies.modelUnsupported, { model: `${table![3]}.${table![4]}` })
    }

    if (adapter && !adapter.canChangeBaud) {
      return copies.noBaudSwitch
    }

    return backup?.get(id) ? '' : copies.needBackupHint
  }

  const firmwareLabel = (r: Row) => (r.firmware ? `${r.firmware.flavour} ${r.firmware.version}${r.firmware.supported ? '' : ` (${copies.untested})`}` : r.table ? '—' : copies.noReply)
  const motion = context.connection.motion
  const gravity = motion?.gravity ?? null

  const calibrateGravity = async () => {
    if (!(await context.showSafetyWarning())) {
      return
    }

    const abort = new AbortController()

    gravityAbort.current = abort
    try {
      await context.calibrateGravity(abort.signal)
      context.toast.success(copies.gravityDone)
    } catch (e) {
      context.toast.error((e as Error).message)
    } finally {
      gravityAbort.current = null
    }
  }

  const switchGravity = async (enabled: boolean) => {
    try {
      await context.setGravityEnabled(enabled)
    } catch (e) {
      context.toast.error((e as Error).message)
    }
  }
  const switchMotion = async (protocol: 'sts' | 'sts-v9') => {
    try {
      await context.setMotionProtocol(protocol)
    } catch (e) {
      context.toast.error((e as Error).message)
    }
  }

  const canFlash = !!backup && !!adapter?.canChangeBaud && !busy && confirmText === 'FLASH' && !!releases
  const pending = rows.filter((r) => r.table && modelSupported(r.table, releases?.get('robonine-9.0')) && !(r.firmware?.flavour === 'robonine' && r.firmware.version === '9.0'))

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{copies.title}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">{copies.experimental}</span>
        <Button className="ml-auto" size="sm" variant="outline" onClick={scan} disabled={scanning || busy}>
          {scanning ? copies.scanning : copies.scan}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground border-l-2 border-amber-500 pl-3">{copies.warning}</p>

      {adapter && !adapter.canChangeBaud && <p className="text-sm text-red-500">{copies.noBaudSwitch}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">{copies.colId}</TableHead>
            <TableHead className="w-20">{copies.colModel}</TableHead>
            <TableHead className="w-44">{copies.colFirmware}</TableHead>
            <TableHead>{copies.colStatus}</TableHead>
            <TableHead className="w-64" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.id}</TableCell>
              <TableCell className="font-mono text-xs">{r.table ? `${r.table[3]}.${r.table[4]}` : '—'}</TableCell>
              <TableCell className="text-xs">{firmwareLabel(r)}</TableCell>
              <TableCell className="text-xs">
                <div className="flex flex-col gap-1">
                  <span className={r.state === 'error' ? 'text-red-500' : ''}>{phaseLabel(r)}</span>
                  {r.state === 'transfer' && r.total > 0 && (
                    <div className="h-1.5 w-full max-w-48 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${(100 * r.done) / r.total}%` }} />
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {r.report && (
                    <Button size="sm" variant="ghost" onClick={() => download(`flash-report-servo-${r.id}.json`, r.report)}>
                      {copies.downloadReport}
                    </Button>
                  )}
                  {r.firmware?.flavour === 'robonine' && (
                    // Disabled buttons ignore the pointer, so the reason sits on a wrapper.
                    <span title={rowActionBlocked(r.id)}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!rowActionBlocked(r.id)}
                        onClick={() => setIsolation({ servoId: r.id, kind: 'rollback', release: 'feetech-3.10', checked: 'no', running: false })}
                      >
                        {copies.rollback}
                      </Button>
                    </span>
                  )}
                  <span title={rowActionBlocked(r.id)}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!rowActionBlocked(r.id)}
                      onClick={() => setIsolation({ servoId: r.id, kind: 'recover', release: r.firmware?.flavour === 'robonine' ? 'robonine-9.0' : 'feetech-3.10', checked: 'no', running: false })}
                    >
                      {copies.recover}
                    </Button>
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{copies.step1}</span>
          <span className="text-xs text-muted-foreground">{copies.step1Hint}</span>
          <div>
            <Button size="sm" onClick={downloadBackup} disabled={busy || scanning || rows.length === 0}>
              {copies.downloadBackup}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{copies.step2}</span>
          <span className="text-xs text-muted-foreground">{copies.step2Hint}</span>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]

                if (file) {
                  void confirmBackup(file)
                }
                e.target.value = ''
              }}
            />
            <Button size="sm" variant="outline" disabled={!backupDownloaded || busy} onClick={() => fileInput.current?.click()}>
              {copies.chooseBackup}
            </Button>
            {backup && <span className="text-xs text-green-600">{copies.backupConfirmed}</span>}
            {backupError && <span className="text-xs text-red-500">{backupError}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{copies.step3}</span>
          <span className="text-xs text-muted-foreground">{copies.step3Hint}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-64 font-mono"
              placeholder={copies.typeFlash}
              value={confirmText}
              disabled={!backup || busy}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmText(e.target.value.trim())}
            />
            <Button size="sm" disabled={!canFlash || pending.length === 0} onClick={installAll}>
              {copies.installAll}
            </Button>
            {pending.length === 0 && rows.length > 0 && <span className="text-xs text-muted-foreground">robonine 9.0 {copies.alreadyInstalled}</span>}
          </div>
        </div>
      </Card>

      {motion && typeof context.setMotionProtocol === 'function' && (
        <Card className="p-4 flex flex-col gap-2">
          <span className="text-sm font-medium">{copies.motionTitle}</span>
          <span className="text-xs text-muted-foreground">{motion.available ? copies.motionHint : copies.motionUnavailable}</span>
          {motion.available && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={motion.active ? 'outline' : 'default'} disabled={busy} onClick={() => switchMotion('sts')}>
                {copies.motionStandard}
              </Button>
              <Button size="sm" variant={motion.active ? 'default' : 'outline'} disabled={busy} onClick={() => switchMotion('sts-v9')}>
                {copies.motionV9}
              </Button>
            </div>
          )}
          {motion.fallback.length > 0 && <span className="text-xs text-amber-600">{fill(copies.motionFallback, { ids: motion.fallback.join(', ') })}</span>}
        </Card>
      )}

      {gravity && typeof context.calibrateGravity === 'function' && (
        <Card className="p-4 flex flex-col gap-2">
          <span className="text-sm font-medium">{copies.gravityTitle}</span>
          <span className="text-xs text-muted-foreground">{motion?.active ? copies.gravityHint : copies.gravityNeedsV9}</span>
          {gravity.fitted && (
            <span className="text-xs">
              {fill(copies.gravityFitted, {
                date: new Date(gravity.fittedAt ?? '').toLocaleString(context.locale),
                rms: Object.entries(gravity.rms)
                  .map(([id, v]) => `${copies.colId} ${id}: ${v}`)
                  .join(', '),
              })}
            </span>
          )}
          {gravity.lastError && !gravity.calibrating && <span className="text-xs text-red-500">{fill(copies.gravityStopped, { error: gravity.lastError })}</span>}
          <div className="flex flex-wrap items-center gap-2">
            {gravity.calibrating ? (
              <>
                <span className="text-xs">{fill(copies.gravityProgress, { done: gravity.progress?.done ?? 0, total: gravity.progress?.total ?? '…' })}</span>
                <Button size="sm" variant="outline" onClick={() => gravityAbort.current?.abort()}>
                  {copies.cancel}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={!motion?.active || busy} onClick={calibrateGravity}>
                {gravity.fitted ? copies.gravityRecalibrate : copies.gravityCalibrate}
              </Button>
            )}
            {gravity.fitted && (
              <>
                <Button size="sm" variant={gravity.enabled ? 'outline' : 'default'} disabled={gravity.calibrating} onClick={() => switchGravity(false)}>
                  {copies.gravityOff}
                </Button>
                <Button size="sm" variant={gravity.enabled ? 'default' : 'outline'} disabled={gravity.calibrating} onClick={() => switchGravity(true)}>
                  {copies.gravityOn}
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      <Dialog open={isolation !== null} onOpenChange={(open: boolean) => !open && !isolation?.running && setIsolation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {copies.isolateTitle} · {copies.colId} {isolation?.servoId}
            </DialogTitle>
            <DialogDescription>{isolation && fill(isolation.kind === 'rollback' ? copies.isolateRollback : copies.isolateRecover, { id: isolation.servoId })}</DialogDescription>
          </DialogHeader>

          {isolation?.kind === 'recover' && (
            <label className="flex items-center gap-2 text-sm">
              {copies.releaseLabel}
              <select
                className="h-8 rounded border border-input bg-background px-2 text-sm"
                value={isolation.release}
                disabled={isolation.running}
                onChange={(e) => setIsolation({ ...isolation, release: e.target.value as ReleaseKey })}
              >
                <option value="robonine-9.0">robonine 9.0</option>
                <option value="feetech-3.10">feetech 3.10</option>
              </select>
            </label>
          )}

          {isolation && isolation.checked !== 'no' && (
            <p className={`text-sm ${isolation.checked === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
              {isolation.checked === 'ok' ? copies.isolated : fill(copies.notIsolated, { ids: isolation.checked })}
            </p>
          )}

          {isolation?.running && (
            <p className="text-sm">
              {isolation.kind === 'recover' && rows.find((r) => r.id === isolation.servoId)?.state === 'transfer' && rows.find((r) => r.id === isolation.servoId)?.total === 0
                ? copies.powerCycleNow
                : phaseLabel(rows.find((r) => r.id === isolation.servoId)!)}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={isolation?.running} onClick={() => setIsolation(null)}>
              {copies.cancel}
            </Button>
            <Button variant="outline" disabled={isolation?.running} onClick={checkIsolation}>
              {copies.checkBus}
            </Button>
            <Button disabled={isolation?.checked !== 'ok' || isolation.running} onClick={runIsolated}>
              {isolation?.kind === 'rollback' ? copies.rollback : copies.startRecovery}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
