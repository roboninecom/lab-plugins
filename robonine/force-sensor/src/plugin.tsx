import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginContext } from '@robonine/plugin-sdk'
import { Activity, Loader2 } from 'lucide-react'
import { translations } from './translations'

const RAW_TO_NEWTONS = 0.001
const MAX_FORCE_N = 65536 * RAW_TO_NEWTONS

type Phase = 'disconnected' | 'scanning' | 'connected' | 'noSensors'

interface SensorReading {
  id: number
  valueN: number
}

function polarPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180

  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function ForceGauge({ valueN }: { valueN: number }) {
  const cx = 100
  const cy = 110
  const r = 86
  const sw = 14
  const fraction = Math.min(1, Math.max(0, valueN / MAX_FORCE_N))
  const [sx, sy] = polarPoint(cx, cy, r, 180)
  const [ex, ey] = polarPoint(cx, cy, r, 0)
  const trackD = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`
  const vAngle = 180 + fraction * 180
  const [vx, vy] = polarPoint(cx, cy, r, vAngle)
  const valueD = fraction > 0.002 ? `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${vx.toFixed(2)} ${vy.toFixed(2)}` : null
  const strokeColor = fraction < 0.4 ? '#16a34a' : fraction < 0.7 ? '#d97706' : '#dc2626'

  return (
    <svg viewBox="0 0 200 118" className="w-full">
      <path d={trackD} fill="none" strokeWidth={sw} strokeLinecap="round" className="stroke-muted-foreground/25" />
      {valueD && <path d={valueD} fill="none" strokeWidth={sw} strokeLinecap="round" stroke={strokeColor} />}
      <text x="100" y="84" textAnchor="middle" fontSize="24" fontWeight="700" className="fill-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {valueN.toFixed(2)} N
      </text>
    </svg>
  )
}

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const [phase, setPhase] = useState<Phase>('disconnected')
  const [sensors, setSensors] = useState<SensorReading[]>([])
  const stopPollingRef = useRef<(() => void) | null>(null)
  const sensorIdsRef = useRef<number[]>([])
  const { Button } = context.ui

  const startScan = useCallback(async () => {
    const ids: number[] = []
    let running = true

    stopPollingRef.current?.()
    setPhase('scanning')
    setSensors([])

    for (let id = 1; id <= 6; id++) {
      try {
        const model = await context.servo.readRegisters(id, 0x03, 2)

        await context.servo.readPosition(id)
        if (model[0] === 0 && model[1] === 0) {
          ids.push(id)
        }
      } catch {
        /* absent */
      }
    }

    for (let id = 7; id <= 253; id++) {
      try {
        const model = await context.servo.readRegisters(id, 0x03, 2)

        await context.servo.readPosition(id)
        if (model[0] === 0 && model[1] === 0) {
          ids.push(id)
        } else {
          break
        }
      } catch {
        break
      }
    }

    if (ids.length === 0) {
      setPhase('noSensors')

      return
    }

    sensorIdsRef.current = ids
    setSensors(ids.map((id) => ({ id, valueN: 0 })))
    setPhase('connected')

    const poll = async () => {
      if (!running) {
        return
      }
      for (const id of sensorIdsRef.current) {
        try {
          const raw = await context.servo.readPosition(id)

          setSensors((prev) => prev.map((s) => (s.id === id ? { ...s, valueN: raw * RAW_TO_NEWTONS } : s)))
        } catch {
          /* ignore */
        }
      }
      if (running) {
        setTimeout(poll, 100)
      }
    }

    setTimeout(poll, 0)
    stopPollingRef.current = () => {
      running = false
    }
  }, [context.servo])

  useEffect(() => {
    if (context.connection.connected && phase === 'disconnected') {
      void startScan()
    }
    if (!context.connection.connected && phase !== 'disconnected') {
      stopPollingRef.current?.()
      setPhase('disconnected')
    }
  }, [context.connection.connected, phase, startScan])

  useEffect(
    () => () => {
      stopPollingRef.current?.()
    },
    [],
  )

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

  if (phase === 'scanning') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t.scanning}</p>
        </div>
      </div>
    )
  }

  if (phase === 'noSensors') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm w-full text-center space-y-4">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto" />
          <div>
            <h2 className="text-lg font-semibold">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.noSensors}</p>
          </div>
          <Button variant="outline" onClick={() => void startScan()}>
            {t.scanAgain}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <Button variant="outline" size="sm" onClick={() => void startScan()}>
          {t.scanAgain}
        </Button>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {sensors.map((sensor) => (
          <div key={sensor.id} className="flex flex-col items-center gap-1 rounded-lg border bg-card p-4">
            <ForceGauge valueN={sensor.valueN} />
            <p className="text-sm font-medium text-muted-foreground">{t.sensorLabel(sensor.id)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
