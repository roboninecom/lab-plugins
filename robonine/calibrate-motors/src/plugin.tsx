import type { CalibrationData, JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from './translations'

type Phase = 'connected' | 'disconnected' | 'done' | 'homing'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const viewRef = useRef<WorldViewApi>(null)
  const jointsRef = useRef<JointInfo[]>([])
  const [joints, setJoints] = useState<JointInfo[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const [phase, setPhase] = useState<Phase>('disconnected')
  const stopPollingRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (context.connection.connected && phase === 'disconnected') {
      setPhase('connected')
    } else if (!context.connection.connected && phase === 'connected') {
      setPhase('disconnected')
    }
  }, [context.connection.connected, phase])

  useEffect(() => {
    return () => {
      stopPollingRef.current?.()
    }
  }, [])

  const startPolling = useCallback(() => {
    let running = true
    let busy = false

    stopPollingRef.current?.()

    const poll = async () => {
      if (!running) return

      if (!busy && context.connection.connected) {
        busy = true

        const config = context.robotConfig
        const currentJoints = jointsRef.current

        if (config && currentJoints.length > 0) {
          const newVals: Record<string, number> = {}

          for (const joint of currentJoints) {
            const servoId = config.jointServoId[joint.name]

            if (servoId === undefined) continue

            try {
              const raw = await context.servo.readPosition(servoId)
              const val = config.encoderToJoint(servoId, raw)

              newVals[joint.name] = Math.max(joint.lower, Math.min(joint.upper, val))
            } catch {
              // ignore individual read errors
            }
          }

          setValues((prev) => ({ ...prev, ...newVals }))

          for (const [name, value] of Object.entries(newVals)) {
            viewRef.current?.setJoint(name, value)
          }
        }

        busy = false
      }

      if (running) setTimeout(poll, 100)
    }

    setTimeout(poll, 0)
    stopPollingRef.current = () => {
      running = false
    }
  }, [context.connection.connected, context.robotConfig, context.servo])

  useEffect(() => {
    if (phase === 'connected') {
      startPolling()
    } else {
      stopPollingRef.current?.()
    }
  }, [phase, startPolling])

  const handleLoad = useCallback(
    (loadedJoints: JointInfo[]) => {
      jointsRef.current = loadedJoints
      setJoints(loadedJoints)

      const config = context.robotConfig
      const initial: Record<string, number> = {}

      for (const joint of loadedJoints) {
        const servoId = config?.jointServoId[joint.name]

        if (servoId !== undefined) {
          initial[joint.name] = config?.neutralJointValue(servoId) ?? 0
        }
      }

      setValues(initial)

      for (const [name, value] of Object.entries(initial)) {
        viewRef.current?.setJoint(name, value)
      }
    },
    [context.robotConfig],
  )

  const handleDone = async () => {
    const config = context.robotConfig
    const currentJoints = jointsRef.current

    setPhase('homing')
    stopPollingRef.current?.()
    stopPollingRef.current = null

    if (config && currentJoints.length > 0) {
      const gripperJoint = currentJoints.find((j) => j.type === 'prismatic')

      if (gripperJoint) {
        const servoId = config.jointServoId[gripperJoint.name]

        if (servoId !== undefined) {
          try {
            await context.servo.setPosition(servoId, config.servoNeutral[servoId] ?? 100)
            await new Promise<void>((r) => setTimeout(r, 400))
          } catch {
            // gripper not connected, skip
          }
        }
      }

      const connectedMotors: Array<{ id: number; neutral: number }> = []

      for (const joint of currentJoints) {
        const servoId = config.jointServoId[joint.name]

        if (servoId === undefined) continue

        try {
          await context.servo.readPosition(servoId)
          connectedMotors.push({ id: servoId, neutral: config.servoNeutral[servoId] ?? 2048 })
        } catch {
          // not connected
        }
      }

      await context.servo.disableTorque()
      await context.servo.calibrateNeutralPositions(connectedMotors)

      const calibrationData: CalibrationData = {
        version: 1,
        motors: Object.fromEntries(
          connectedMotors.map(({ id, neutral }) => [id, { rawMin: neutral, rawMax: neutral, urdfMin: 0, urdfMax: 0 }]),
        ),
      }

      try {
        await context.saveCalibration(calibrationData)
      } catch {
        // non-fatal — EEPROM write succeeded even if API is unavailable
      }
    }

    setPhase('done')
  }

  if (phase === 'disconnected') {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='max-w-md w-full space-y-6'>
          <div>
            <h1 className='text-xl font-semibold'>{ t.title }</h1>
            <p className='text-sm text-muted-foreground mt-1'>{ t.description }</p>
          </div>
          <div className='rounded-lg border bg-card p-5 space-y-3'>
            <p className='font-semibold'>{ t.beforeYouStart }</p>
            <ol className='space-y-1.5 text-sm text-muted-foreground list-decimal list-inside'>
              <li>{ t.step1 }</li>
              <li>{ t.step2 }</li>
              <li>{ t.step3 }</li>
            </ol>
          </div>
          <context.ui.Button className='w-full' onClick={ context.openConnectDialog }>
            { t.connectRobot }
          </context.ui.Button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='max-w-md w-full space-y-6'>
          <div>
            <h1 className='text-xl font-semibold'>{ t.title }</h1>
            <p className='text-sm text-muted-foreground mt-1'>{ t.description }</p>
          </div>
          <div className='flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm text-green-600'>
            <CheckCircle2 className='w-4 h-4 shrink-0' />
            { t.success }
          </div>
          <context.ui.Button className='w-full' onClick={ () => setPhase('connected') }>
            { t.done }
          </context.ui.Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6 flex-1 min-h-0 lg:flex-row'>
      <div className='flex flex-col gap-4 flex-1 min-h-0'>
        <div>
          <h2 className='hidden lg:block text-lg font-semibold'>{ t.title }</h2>
          <p className='mt-1 text-sm text-muted-foreground'>{ t.liveDescription }</p>
        </div>
        <div className='relative overflow-hidden rounded-lg border flex-1 min-h-0'>
          <context.WorldView ref={ viewRef } onLoad={ handleLoad } trackLivePosition={ false } />
        </div>
      </div>

      <div className='space-y-4 lg:w-70 lg:shrink-0'>
        {
          [...joints].reverse().map((j) =>
            <div key={ j.name } className='space-y-1'>
              <div className='flex justify-between text-sm'>
                <span className='font-mono font-medium'>{ j.label }</span>
                <span className='text-muted-foreground'>
                  { j.type === 'prismatic' ? ((values[j.name] ?? 0) * 2 * 1000).toFixed(1) + 'mm' : (((values[j.name] ?? 0) * 180) / Math.PI).toFixed(1) + '°' }
                </span>
              </div>
              <input type='range' min={ j.lower } max={ j.upper } step={ 0.001 } value={ values[j.name] ?? 0 } disabled className='w-full accent-primary disabled:opacity-40' onChange={ () => {} } />
            </div>,
          )
        }

        {
          joints.length > 0 &&
            <context.ui.Button className='w-full' disabled={ phase === 'homing' } onClick={ handleDone }>
              { phase === 'homing' ? <Loader2 className='animate-spin' /> : t.save }
            </context.ui.Button>
        }
      </div>
    </div>
  )
}
