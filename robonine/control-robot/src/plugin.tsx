import type { JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const viewRef = useRef<WorldViewApi>(null)
  const jointsRef = useRef<JointInfo[]>([])
  const [joints, setJoints] = useState<JointInfo[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [fkResult, setFkResult] = useState<{ node: string; label: string; x: number; y: number; z: number } | null>(null)
  const isDraggingRef = useRef(false)
  const safetyShownRef = useRef(false)
  const extraNodes = useMemo(() => (context.robotConfig?.fkNodes ?? []).map((n) => ({ name: n.linkName, label: context.localize(n.label) })), [context.robotConfig?.fkNodes, context.locale])

  useEffect(() => {
    if (context.connection.connected && !safetyShownRef.current) {
      safetyShownRef.current = true
      void context.showSafetyWarning()
    }

    if (!context.connection.connected) {
      safetyShownRef.current = false
    }
  }, [context, t.safetyMessage])

  const handleLoad = useCallback(
    (loadedJoints: JointInfo[]) => {
      const config = context.robotConfig
      const initial: Record<string, number> = {}

      jointsRef.current = loadedJoints
      setJoints(loadedJoints)
      setSelectedNode(loadedJoints[loadedJoints.length - 1]?.name ?? '')

      for (const joint of loadedJoints) {
        const servoId = config?.jointServoId[joint.name]

        if (servoId !== undefined) {
          initial[joint.name] = config?.neutralJointValue(servoId) ?? 0
        }
      }

      setValues(initial)
    },
    [context.robotConfig],
  )

  const handleJointChange = (name: string, value: number) => {
    const joint = jointsRef.current.find((j) => j.name === name)
    const servoId = context.robotConfig?.jointServoId[name]

    if (!joint) {
      return
    }

    setValues((prev) => ({ ...prev, [name]: value }))
    viewRef.current?.setJoint(name, value)

    if (servoId !== undefined && context.connection.connected) {
      const raw = context.robotConfig?.jointToEncoder(servoId, value) ?? 0

      void context.servo.setPosition(servoId, Math.max(0, Math.min(4095, raw)))
    }
  }

  const handleComputePosition = async () => {
    const allNodes = [...jointsRef.current, ...extraNodes]
    let x: number
    let y: number
    let z: number

    if (!selectedNode) {
      return
    }

    if (extraNodes.some((n) => n.name === selectedNode)) {
      const result = await context.kinematics.forwardKinematics(values, selectedNode)

      ;[x, y, z] = result.position
    } else {
      const pos = viewRef.current.getJointWorldPosition(selectedNode)

      if (!viewRef.current) {
        return
      }

      if (!pos) {
        return
      }
      x = pos.x
      y = pos.y
      z = pos.z
    }

    const label = allNodes.find((n) => n.name === selectedNode)?.label ?? selectedNode

    setFkResult({ node: selectedNode, label, x, y, z })
  }

  const handleHome = () => {
    const config = context.robotConfig
    const currentJoints = jointsRef.current
    const reset: Record<string, number> = {}
    const positions: Array<{ id: number; position: number }> = []

    if (!config) {
      return
    }

    for (const joint of currentJoints) {
      const servoId = config.jointServoId[joint.name]

      if (servoId === undefined) {
        continue
      }

      const angle = config.neutralJointValue(servoId)

      reset[joint.name] = angle
      viewRef.current?.setJoint(joint.name, angle)
      positions.push({ id: servoId, position: Math.max(0, Math.min(4095, config.servoNeutral[servoId] ?? 2048)) })
    }

    setValues(reset)

    if (context.connection.connected) {
      void context.servo.syncSetPositions(positions)
    }
  }

  if (!context.connection.connected) {
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
          <context.ui.Button className="w-full" onClick={context.openConnectDialog}>
            {t.connectRobot}
          </context.ui.Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0 lg:flex-row">
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        <div>
          <h2 className="hidden lg:block text-lg font-semibold">{t.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.liveDescription}</p>
        </div>
        <div className="relative overflow-hidden rounded-lg border flex-1 min-h-0">
          <context.WorldView ref={viewRef} onLoad={handleLoad} motionMode="realistic" />
        </div>
      </div>

      <div className="space-y-4 lg:w-[280px] lg:max-w-[280px] lg:shrink-0">
        {[...joints].reverse().map((j) => (
          <div key={j.name} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-mono font-medium">{j.label}</span>
              <span className="text-muted-foreground">
                {j.type === 'prismatic' ? ((values[j.name] ?? 0) * 2 * 1000).toFixed(1) + 'mm' : (((values[j.name] ?? 0) * 180) / Math.PI).toFixed(1) + '°'}
              </span>
            </div>
            <input
              type="range"
              min={j.lower}
              max={j.upper}
              step={0.001}
              value={values[j.name] ?? 0}
              onPointerDown={() => {
                isDraggingRef.current = true
              }}
              onPointerUp={() => {
                isDraggingRef.current = false
              }}
              onChange={(e) => handleJointChange(j.name, parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        ))}

        {joints.length > 0 && (
          <>
            <context.ui.Button variant="outline" className="w-full" onClick={handleHome}>
              {t.goHome}
            </context.ui.Button>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.node}</p>
              <select
                value={selectedNode}
                onChange={(e) => {
                  setSelectedNode(e.target.value)
                  setFkResult(null)
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {joints.map((j) => (
                  <option key={j.name} value={j.name}>
                    {j.label}
                  </option>
                ))}
                {extraNodes.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>

            <context.ui.Button variant="outline" className="w-full" onClick={() => void handleComputePosition()} disabled={!selectedNode}>
              {t.computePosition}
            </context.ui.Button>

            {fkResult && (
              <div className="rounded-md border bg-muted/50 p-3 text-sm font-mono space-y-0.5">
                <p className="text-xs font-sans font-semibold text-muted-foreground mb-1.5">{fkResult.label}</p>
                <p>x: {(fkResult.x * 1000).toFixed(1)} mm</p>
                <p>y: {(fkResult.y * 1000).toFixed(1)} mm</p>
                <p>z: {(fkResult.z * 1000).toFixed(1)} mm</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
