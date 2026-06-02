import type { JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

const IK_AXIS_RANGES = {
  x: { min: -0.1, max: 0.45 },
  y: { min: -0.4, max: 0.4 },
  z: { min: -0.05, max: 0.45 },
} as const

const IK_AXES: Array<{ label: string; axis: 0 | 1 | 2; rangeKey: keyof typeof IK_AXIS_RANGES }> = [
  { label: 'X', axis: 0, rangeKey: 'x' },
  { label: 'Y', axis: 1, rangeKey: 'y' },
  { label: 'Z', axis: 2, rangeKey: 'z' },
]

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const viewRef = useRef<WorldViewApi>(null)
  const jointsRef = useRef<JointInfo[]>([])
  const [joints, setJoints] = useState<JointInfo[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const valuesRef = useRef<Record<string, number>>({})
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [fkResult, setFkResult] = useState<{ node: string; label: string; x: number; y: number; z: number } | null>(null)
  const isDraggingRef = useRef(false)
  const safetyShownRef = useRef(false)
  const [debounceEnabled, setDebounceEnabled] = useState(false)
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const extraNodes = useMemo(() => (context.robotConfig?.fkNodes ?? []).map((n) => ({ name: n.linkName, label: context.localize(n.label) })), [context.robotConfig?.fkNodes, context.locale])
  const [activeTab, setActiveTab] = useState('forward')
  const [ikTarget, setIkTarget] = useState<[number, number, number]>([0.15, 0, 0.2])
  const ikDebounceRef = useRef<ReturnType<typeof setTimeout>>()
  const ikVersionRef = useRef(0)
  const [ikSolving, setIkSolving] = useState(false)
  const [ikFailed, setIkFailed] = useState(false)
  // IK target node: link name from extraNodes, or childLink from joints.
  // Default to gripperTipLink (first extraNode) when nodes load.
  const [ikEndEffectorLink, setIkEndEffectorLink] = useState<string>('')
  const { Tabs, TabsList, TabsTrigger, TabsContent } = context.ui

  useEffect(() => {
    if (context.connection.connected && !safetyShownRef.current) {
      safetyShownRef.current = true
      void context.showSafetyWarning()
    }

    if (!context.connection.connected) {
      safetyShownRef.current = false
    }
  }, [context])

  // Nodes available as IK end-effector targets: extraNodes first (have link names directly),
  // then movable joints (use their childLink). Populated once joints load.
  const ikNodes = useMemo(() => [...extraNodes.map((n) => ({ linkName: n.name, label: n.label })), ...joints.map((j) => ({ linkName: j.childLink, label: j.label }))], [extraNodes, joints])

  const handleLoad = useCallback(
    (loadedJoints: JointInfo[]) => {
      const config = context.robotConfig
      const initial: Record<string, number> = {}

      // Default IK target: first extraNode (expected to be gripperTipLink = l_hand001)
      // or fall back to last joint's child link.
      const defaultIkLink = context.robotConfig?.fkNodes[0]?.linkName ?? loadedJoints[loadedJoints.length - 1]?.childLink ?? ''

      jointsRef.current = loadedJoints
      setJoints(loadedJoints)
      setSelectedNode(loadedJoints[loadedJoints.length - 1]?.name ?? '')
      setIkEndEffectorLink(defaultIkLink)

      for (const joint of loadedJoints) {
        const servoId = config?.jointServoId[joint.name]

        if (servoId !== undefined) {
          initial[joint.name] = config?.neutralJointValue(servoId) ?? 0
        }
      }

      valuesRef.current = initial
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

    valuesRef.current = { ...valuesRef.current, [name]: value }
    setValues((prev) => ({ ...prev, [name]: value }))
    viewRef.current?.setJoint(name, value)

    if (servoId !== undefined && context.connection.connected) {
      const send = () => {
        const raw = context.robotConfig?.jointToEncoder(servoId, value) ?? 0

        void context.servo.setPosition(servoId, Math.max(0, Math.min(4095, raw)))
      }

      if (debounceEnabled) {
        clearTimeout(debounceTimersRef.current[name])
        debounceTimersRef.current[name] = setTimeout(send, 200)
      } else {
        send()
      }
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
      const result = await context.kinematics.forwardKinematics(valuesRef.current, selectedNode)

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

  const handleIkAxisChange = (axis: 0 | 1 | 2, value: number) => {
    const newTarget: [number, number, number] = [ikTarget[0], ikTarget[1], ikTarget[2]]
    const version = ++ikVersionRef.current

    newTarget[axis] = value
    setIkTarget(newTarget)
    viewRef.current?.setTargetPosition(newTarget)

    clearTimeout(ikDebounceRef.current)
    ikDebounceRef.current = setTimeout(() => {
      const doIk = async () => {
        const result = await context.kinematics.inverseKinematics(newTarget, valuesRef.current, { endEffectorLink: ikEndEffectorLink || undefined })

        if (version !== ikVersionRef.current) {
          setIkSolving(false)

          return
        }

        setIkSolving(false)

        if (!result) {
          setIkFailed(true)

          return
        }

        valuesRef.current = { ...valuesRef.current, ...result }
        setValues((prev) => ({ ...prev, ...result }))

        for (const [name, val] of Object.entries(result)) {
          viewRef.current?.setJoint(name, val)
        }

        if (context.connection.connected) {
          const positions = Object.entries(result)
            .map(([name, val]) => {
              const id = context.robotConfig?.jointServoId[name]

              if (id === undefined) {
                return null
              }

              const raw = context.robotConfig?.jointToEncoder(id, val) ?? 0

              return { id, position: Math.max(0, Math.min(4095, raw)) }
            })
            .filter((p): p is { id: number; position: number } => p !== null)

          if (positions.length > 0) {
            void context.servo.syncSetPositions(positions)
          }
        }
      }

      setIkSolving(true)
      setIkFailed(false)

      void doIk()
    }, 50)
  }

  const handleTabChange = async (tab: string) => {
    setActiveTab(tab)

    if (tab === 'reverse' && jointsRef.current.length > 0) {
      try {
        const fk = await context.kinematics.forwardKinematics(valuesRef.current)

        setIkTarget(fk.position)
        viewRef.current?.setTargetPosition(fk.position)
      } catch {
        // keep current target
      }
    }
  }

  const handleHome = async () => {
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

    valuesRef.current = reset
    setValues(reset)

    if (context.connection.connected) {
      void context.servo.syncSetPositions(positions)
    }

    if (activeTab === 'reverse') {
      try {
        const fk = await context.kinematics.forwardKinematics(reset)

        setIkTarget(fk.position)
        viewRef.current?.setTargetPosition(fk.position)
      } catch {
        // ignore
      }
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
          <context.WorldView ref={viewRef} onLoad={handleLoad} motionMode="realistic" showTargetSphere={activeTab === 'reverse'} targetPosition={ikTarget} />
        </div>
      </div>

      <div className="lg:w-[280px] lg:max-w-[280px] lg:shrink-0">
        <Tabs defaultValue="forward" onValueChange={(v: string) => void handleTabChange(v)} className="flex flex-col gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="forward" className="flex-1">
              {t.forwKinem}
            </TabsTrigger>
            <TabsTrigger value="reverse" className="flex-1">
              {t.revKinem}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="forward" className="mt-0 space-y-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={debounceEnabled} onChange={(e) => setDebounceEnabled(e.target.checked)} className="accent-primary w-4 h-4" />
              {t.debounce}
            </label>

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
                <context.ui.Button variant="outline" className="w-full" onClick={() => void handleHome()}>
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
          </TabsContent>

          <TabsContent value="reverse" className="mt-0 space-y-4">
            {joints.length > 0 && (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.applyXyzTo}</p>
                  <select
                    value={ikEndEffectorLink}
                    onChange={(e) => setIkEndEffectorLink(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {ikNodes.map((n) => (
                      <option key={n.linkName} value={n.linkName}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.targetPosition}</p>
                  {IK_AXES.map(({ label, axis, rangeKey }) => (
                    <div key={rangeKey} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-mono font-medium">{label}</span>
                        <span className="text-muted-foreground">{(ikTarget[axis] * 1000).toFixed(1)} mm</span>
                      </div>
                      <input
                        type="range"
                        min={IK_AXIS_RANGES[rangeKey].min}
                        max={IK_AXIS_RANGES[rangeKey].max}
                        step={0.001}
                        value={ikTarget[axis]}
                        onChange={(e) => handleIkAxisChange(axis, parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                  ))}
                  {ikSolving && <p className="text-xs text-muted-foreground">{t.solving}</p>}
                  {ikFailed && <p className="text-xs text-destructive">{t.ikFailed}</p>}
                </div>

                <context.ui.Button variant="outline" className="w-full" onClick={() => void handleHome()}>
                  {t.goHome}
                </context.ui.Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
