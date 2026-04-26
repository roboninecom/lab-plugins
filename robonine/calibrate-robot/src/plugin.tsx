import type { JointCalibration, JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { translations } from './translations'

const RAW_TO_RAD = (2 * Math.PI) / 4096
const MOVED_THRESHOLD_RAD = 0.05
const CALIBRATION_HIGHLIGHT_RAD = 5 * (Math.PI / 180)
const MIN_CALIBRATION_RANGE_RAD = 10 * (Math.PI / 180)

type Phase = 'disconnected' | 'calibrating' | 'done'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const { Button } = context.ui
  const [phase, setPhase] = useState<Phase>('disconnected')
  const [joints, setJoints] = useState<JointInfo[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const [movedJoints, setMovedJoints] = useState<Set<string>>(new Set())
  const [liveRawRanges, setLiveRawRanges] = useState<Record<string, { min: number; max: number }>>({})
  const [lastMovedMotorId, setLastMovedMotorId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const viewRef = useRef<WorldViewApi>(null)
  const jointsRef = useRef<JointInfo[]>([])
  const stopPollingRef = useRef<(() => void) | null>(null)
  const motorRangesRef = useRef<Record<number, { min: number; max: number }>>({})
  const prevRawRef = useRef<Record<number, number>>({})

  // Keep refs in sync with context so the polling closure always has fresh values.
  const robotConfigRef = useRef(context.robotConfig)
  const servoRef = useRef(context.servo)
  const toDeg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1) + '°'

  robotConfigRef.current = context.robotConfig
  servoRef.current = context.servo

  useEffect(() => {
    if (context.connection.connected && phase === 'disconnected') {
      setPhase('calibrating')
    }
    if (!context.connection.connected && phase === 'calibrating') {
      stopPollingRef.current?.()
      setPhase('disconnected')
    }
  }, [context.connection.connected, phase])

  useEffect(() => {
    if (phase === 'calibrating') {
      servoRef.current.disableTorque().catch(() => {})
    }
  }, [phase])

  useEffect(
    () => () => {
      stopPollingRef.current?.()
    },
    [],
  )

  const startPolling = useCallback(() => {
    let running = true
    let busy = false

    stopPollingRef.current?.()

    const poll = async () => {
      if (!running) {
        return
      }

      if (!busy) {
        const currentJoints = jointsRef.current
        const cfg = robotConfigRef.current

        busy = true

        if (currentJoints.length > 0 && cfg) {
          const newVals: Record<string, number> = {}
          const newMoved: string[] = []
          const newLiveRaw: Record<string, { min: number; max: number }> = {}
          let movedMotorId: number | null = null

          for (let i = 0; i < currentJoints.length; i++) {
            const servoId = currentJoints.length - i

            try {
              const raw = await servoRef.current.readPosition(servoId)
              const j = currentJoints[i]
              const val = cfg.encoderToJoint(servoId, raw)
              const r = motorRangesRef.current[servoId]
              const prev = prevRawRef.current[servoId]
              const updatedR = motorRangesRef.current[servoId]

              newVals[j.name] = Math.max(j.lower, Math.min(j.upper, val))
              motorRangesRef.current[servoId] = r ? { min: Math.min(r.min, raw), max: Math.max(r.max, raw) } : { min: raw, max: raw }

              if (updatedR && (updatedR.max - updatedR.min) * RAW_TO_RAD > MOVED_THRESHOLD_RAD) {
                newMoved.push(j.name)
              }

              if (prev !== undefined && Math.abs(raw - prev) >= CALIBRATION_HIGHLIGHT_RAD / RAW_TO_RAD) {
                movedMotorId = servoId
              }

              prevRawRef.current[servoId] = raw
            } catch {
              // ignore individual read errors
            }
          }

          if (movedMotorId !== null) {
            setLastMovedMotorId(movedMotorId)
          }

          setValues((prev) => ({ ...prev, ...newVals }))

          for (let i = 0; i < currentJoints.length; i++) {
            const servoId = currentJoints.length - i
            const r = motorRangesRef.current[servoId]

            if (r) {
              newLiveRaw[currentJoints[i].name] = { min: r.min, max: r.max }
            }
          }

          setLiveRawRanges(newLiveRaw)

          if (newMoved.length > 0) {
            setMovedJoints((prev) => {
              const next = new Set(prev)

              for (const name of newMoved) {
                next.add(name)
              }

              return next
            })
          }

          for (const [name, value] of Object.entries(newVals)) {
            viewRef.current?.setJoint(name, value)
          }
        }

        busy = false
      }

      if (running) {
        setTimeout(poll, 100)
      }
    }

    setTimeout(poll, 0)
    stopPollingRef.current = () => {
      running = false
    }
  }, [])

  const handleLoad = useCallback(
    (loadedJoints: JointInfo[]) => {
      const cfg = robotConfigRef.current
      const initial: Record<string, number> = {}

      jointsRef.current = loadedJoints
      setJoints(loadedJoints)

      for (let i = 0; i < loadedJoints.length; i++) {
        const servoId = loadedJoints.length - i

        if (cfg) {
          initial[loadedJoints[i].name] = cfg.neutralJointValue(servoId)
        }
      }

      setValues(initial)
      startPolling()
    },
    [startPolling],
  )

  const handleDone = useCallback(async () => {
    const currentJoints = jointsRef.current
    const cfg = robotConfigRef.current
    const newCalibration: Record<number, JointCalibration> = {}
    let failed = false

    stopPollingRef.current?.()
    stopPollingRef.current = null
    setLastMovedMotorId(null)
    setSaving(true)

    for (let i = 0; i < currentJoints.length; i++) {
      const servoId = currentJoints.length - i
      const range = motorRangesRef.current[servoId]
      const j = currentJoints[i]
      const rangeInRad = range ? (range.max - range.min) * RAW_TO_RAD : 0

      if (range && rangeInRad >= MIN_CALIBRATION_RANGE_RAD) {
        newCalibration[servoId] = { rawMin: range.min, rawMax: range.max, urdfMin: j.lower, urdfMax: j.upper }
      } else if (cfg) {
        newCalibration[servoId] = {
          rawMin: cfg.jointToEncoder(servoId, j.lower),
          rawMax: cfg.jointToEncoder(servoId, j.upper),
          urdfMin: j.lower,
          urdfMax: j.upper,
        }
      }
    }

    try {
      await context.saveRangeCalibration(newCalibration)
    } catch {
      failed = true
    }

    setSaving(false)
    setSaveError(failed)
    setPhase('done')
  }, [context])

  if (phase === 'disconnected') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold">{t.beforeYouStart}</p>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
            </ol>
          </div>
          <Button className="w-full" onClick={context.openConnectDialog}>
            {t.connectRobot}
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>
          {saveError ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-600">
              <span className="shrink-0 mt-0.5">⚠</span>
              {t.saveError}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {t.success}
            </div>
          )}
          <Button className="w-full" onClick={() => context.navigate('/tools')}>
            {t.calibrateAgain}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0 lg:flex-row">
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div>
          <h2 className="hidden lg:block text-lg font-semibold">{t.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.calibratingDescription}</p>
        </div>
        <div className="relative overflow-hidden rounded-lg border flex-1 min-h-0">
          <context.WorldView ref={viewRef} onLoad={handleLoad} motionMode="instant" />
        </div>
      </div>

      <div className="space-y-4 lg:w-70 lg:shrink-0">
        <div className="text-xs text-muted-foreground">{t.jointsMoved(movedJoints.size, joints.length)}</div>

        {[...joints].reverse().map((j) => {
          const origIdx = joints.findIndex((jj) => jj.name === j.name)
          const servoId = joints.length - origIdx
          const isSignificant = lastMovedMotorId === servoId
          const isMoved = movedJoints.has(j.name)
          const liveRaw = liveRawRanges[j.name]
          const cfg = robotConfigRef.current

          const positionLabel = (() => {
            if (liveRaw && cfg) {
              if (j.type === 'prismatic') {
                const loM = cfg.encoderToJoint(servoId, liveRaw.max)
                const hiM = cfg.encoderToJoint(servoId, liveRaw.min)

                return `${(loM * 2 * 1000).toFixed(1)} – ${(hiM * 2 * 1000).toFixed(1)} mm`
              }

              return `${toDeg(cfg.encoderToJoint(servoId, liveRaw.min))} – ${toDeg(cfg.encoderToJoint(servoId, liveRaw.max))}`
            }

            return j.type === 'prismatic' ? ((values[j.name] ?? 0) * 2 * 1000).toFixed(1) + 'mm' : toDeg(values[j.name] ?? 0)
          })()

          return (
            <div key={j.name} className={`space-y-1 rounded px-1 -mx-1 transition-colors ${isSignificant ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
              <div className="flex justify-between text-sm">
                <span className={`font-mono font-medium ${isMoved ? 'text-green-600' : ''}`}>
                  {isMoved ? '✓ ' : ''}
                  {j.label}
                </span>
                <span className="text-muted-foreground">{positionLabel}</span>
              </div>
              <input type="range" min={j.lower} max={j.upper} step={0.001} value={values[j.name] ?? 0} onChange={() => {}} disabled className="w-full accent-primary disabled:opacity-40" />
            </div>
          )
        })}

        {joints.length > 0 && (
          <Button className="w-full" disabled={saving} onClick={() => void handleDone()}>
            {saving ? <Loader2 className="animate-spin" /> : t.imDone}
          </Button>
        )}
      </div>
    </div>
  )
}
