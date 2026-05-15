import type { CameraViewHandle, FKResult, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

const MIN_DEPTH = 0.05
const SIM_BALL_HIDDEN: [number, number, number] = [0, 0, 100]

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]]

function rpyToMat3(rpy: [number, number, number]): Mat3 {
  const [rx, ry, rz] = rpy
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)

  return [
    [cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz],
    [cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx],
    [-sy, cy * sx, cx * cy],
  ]
}

function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0], a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0], a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2]],
    [a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0], a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1], a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2]],
  ]
}

function Crosshair({ x, y }: { x: number; y: number }) {
  const R = 28
  const G = 7

  return (
    <svg className="absolute pointer-events-none" style={{ left: x - R, top: y - R, width: R * 2, height: R * 2 }} viewBox={`0 0 ${R * 2} ${R * 2}`}>
      <line x1={0} y1={R} x2={R - G} y2={R} stroke="#00ff41" strokeWidth={2} strokeLinecap="round" />
      <line x1={R + G} y1={R} x2={R * 2} y2={R} stroke="#00ff41" strokeWidth={2} strokeLinecap="round" />
      <line x1={R} y1={0} x2={R} y2={R - G} stroke="#00ff41" strokeWidth={2} strokeLinecap="round" />
      <line x1={R} y1={R + G} x2={R} y2={R * 2} stroke="#00ff41" strokeWidth={2} strokeLinecap="round" />
      <circle cx={R} cy={R} r={2} fill="#00ff41" />
    </svg>
  )
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const cameraViewRef = useRef<CameraViewHandle>(null)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [simMode, setSimMode] = useState(true)
  const ikPendingRef = useRef(false)
  const lastPositionsRef = useRef<number[] | null>(null)
  const safetyShownRef = useRef(false)
  const cameraLinkRef = useRef('camera_virtual')
  const cameraOffsetRef = useRef<[number, number, number]>([0, 0, 0])
  const cameraRpyRef = useRef<[number, number, number]>([0, 0, 0])
  const sortedJointNamesRef = useRef<string[]>([])
  const simModeRef = useRef(simMode)
  const worldViewRef = useRef<WorldViewApi>(null)

  simModeRef.current = simMode

  useEffect(() => {
    const config = context.robotConfig

    if (!config) {
      setStatusMsg(t.noRobotConfig)

      return
    }

    setStatusMsg(null)
    sortedJointNamesRef.current = Object.entries(config.jointServoId)
      .sort(([, a], [, b]) => a - b)
      .map(([name]) => name)

    const camDef = (config as unknown as Record<string, unknown>).camera as { parentLink: string; xyz: [number, number, number]; rpy: [number, number, number] } | undefined

    if (camDef) {
      cameraLinkRef.current = camDef.parentLink
      cameraOffsetRef.current = camDef.xyz
      cameraRpyRef.current = camDef.rpy
    }
  }, [context.robotConfig, t.noRobotConfig])

  // Apply camera-local offset to FK world position.
  const applyLocalOffset = useCallback((pos: [number, number, number], rot: [[number, number, number], [number, number, number], [number, number, number]]): [number, number, number] => {
    const [ox, oy, oz] = cameraOffsetRef.current

    return [pos[0] + rot[0][0] * ox + rot[0][1] * oy + rot[0][2] * oz, pos[1] + rot[1][0] * ox + rot[1][1] * oy + rot[1][2] * oz, pos[2] + rot[2][0] * ox + rot[2][1] * oy + rot[2][2] * oz]
  }, [])

  const selectedCamera = useMemo(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (context.connection.connected && !safetyShownRef.current) {
      safetyShownRef.current = true
      void context.showSafetyWarning()
    }

    if (!context.connection.connected) {
      safetyShownRef.current = false
    }
  }, [context.connection.connected])

  useEffect(() => {
    return context.servo.registerEmergencyStop()
  }, [context.servo])

  useEffect(() => {
    let cancelled = false

    if (!context.connection.connected) {
      return
    }

    const poll = async () => {
      const config = context.robotConfig

      if (!config) {
        return
      }

      const entries = Object.entries(config.jointServoId).sort((a, b) => a[1] - b[1])

      while (!cancelled) {
        const positions: number[] = []

        for (const [, servoId] of entries) {
          try {
            const raw = await context.servo.readPosition(servoId)

            positions.push(config.encoderToJoint(servoId, raw))
          } catch {
            positions.push(0)
          }
        }

        lastPositionsRef.current = positions
        await new Promise<void>((r) => setTimeout(r, 300))
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [context.connection.connected, context.servo])

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftHeld(true)
      }
    }

    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftHeld(false)
        setCrosshairPos(null)
        setIsTracking(false)
      }
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  const computeAndMove = useCallback(
    async (u: number, v: number) => {
      const names = sortedJointNamesRef.current

      if (!context.connection.connected || ikPendingRef.current) {
        return
      }

      if (names.length === 0) {
        return
      }

      ikPendingRef.current = true

      try {
        const positions = lastPositionsRef.current
        const angleMap: Record<string, number> = {}
        const cal = context.cameraCalibration
        const vid = cameraViewRef.current?.video ?? null
        const config = context.robotConfig
        let fkCam: FKResult
        let camLinkUsed = cameraLinkRef.current

        if (!positions) {
          return
        }

        names.forEach((name, i) => {
          angleMap[name] = positions[i] ?? 0
        })
        try {
          fkCam = await context.kinematics.forwardKinematics(angleMap, camLinkUsed)
        } catch {
          camLinkUsed = '(fallback: end-effector)'
          fkCam = await context.kinematics.forwardKinematics(angleMap)
        }

        const fkEff = await context.kinematics.forwardKinematics(angleMap)
        const R = fkCam.rotation
        const finalR = mat3Mul(R, rpyToMat3(cameraRpyRef.current))
        const [cx, cy, cz] = applyLocalOffset(fkCam.position, R)
        const [ex, ey, ez] = fkEff.position
        const vw = vid?.videoWidth ?? 640
        const vh = vid?.videoHeight ?? 480
        const fx = cal?.fx ?? 0.8 * Math.max(vw, vh)
        const fy = cal?.fy ?? fx
        const ppx = cal?.cx ?? vw / 2
        const ppy = cal?.cy ?? vh / 2
        const rxc = (u - ppx) / fx
        const ryc = (v - ppy) / fy
        const rlen = Math.sqrt(rxc * rxc + ryc * ryc + 1)
        const nc = [rxc / rlen, ryc / rlen, 1 / rlen]
        const rdx = finalR[0][0] * nc[0] + finalR[0][1] * nc[1] + finalR[0][2] * nc[2]
        const rdy = finalR[1][0] * nc[0] + finalR[1][1] * nc[1] + finalR[1][2] * nc[2]
        const rdz = finalR[2][0] * nc[0] + finalR[2][1] * nc[1] + finalR[2][2] * nc[2]

        // Depth = euclidean distance camera→end-effector (always positive, never tiny)
        const toEx = ex - cx
        const toEy = ey - cy
        const toEz = ez - cz
        const depth = Math.max(MIN_DEPTH, Math.sqrt(toEx * toEx + toEy * toEy + toEz * toEz))
        const ikTarget: [number, number, number] = [cx + depth * rdx, cy + depth * rdy, cz + depth * rdz]

        console.log(
          '[follow-camera] link:',
          camLinkUsed,
          'cam:',
          [cx, cy, cz].map((v) => v.toFixed(3)),
          'opt-axis:',
          [finalR[0][2], finalR[1][2], finalR[2][2]].map((v) => v.toFixed(3)),
          'depth:',
          depth.toFixed(3),
          'ray:',
          [rdx, rdy, rdz].map((v) => v.toFixed(3)),
          'target:',
          ikTarget.map((v) => v.toFixed(3)),
        )

        if (simModeRef.current) {
          worldViewRef.current?.setTargetPosition(ikTarget)
          setStatusMsg(null)
          setIsTracking(true)

          return
        }

        const solution = await context.kinematics.inverseKinematics(ikTarget, angleMap)

        if (!solution) {
          const [tx, ty, tz] = ikTarget

          setStatusMsg(`${t.noIkModel} (${(tx * 1000).toFixed(0)}, ${(ty * 1000).toFixed(0)}, ${(tz * 1000).toFixed(0)} mm)`)

          return
        }

        setStatusMsg(null)

        const ordered = config
          ? Object.entries(solution)
              .sort(([a], [b]) => (config.jointServoId[a] ?? 0) - (config.jointServoId[b] ?? 0))
              .map(([, v]) => v)
          : Object.values(solution)

        await context.servo.setJointPositions(ordered)
        setIsTracking(true)
      } catch (err) {
        console.error('[follow-camera] computeAndMove error:', err)
      } finally {
        ikPendingRef.current = false
      }
    },
    [context, t],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()

      if (!shiftHeld) {
        return
      }

      setCrosshairPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    },
    [shiftHeld],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const vid = cameraViewRef.current?.video ?? null

      if (!shiftHeld) {
        return
      }

      if (!vid || vid.videoWidth === 0) {
        return
      }

      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      const rawU = (relX / rect.width) * vid.videoWidth
      const rawV = (relY / rect.height) * vid.videoHeight
      const pixelU = cameraViewRef.current?.mirrorH ? vid.videoWidth - rawU : rawU
      const pixelV = cameraViewRef.current?.mirrorV ? vid.videoHeight - rawV : rawV

      void computeAndMove(pixelU, pixelV)
    },
    [shiftHeld, computeAndMove],
  )

  const handleMouseLeave = useCallback(() => {
    setCrosshairPos(null)
    setIsTracking(false)
  }, [])

  const handleSimModeToggle = useCallback(() => {
    setSimMode((prev) => !prev)
  }, [])

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
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        {simMode && (
          <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
            <context.WorldView
              ref={worldViewRef}
              showTargetSphere
              targetPosition={SIM_BALL_HIDDEN}
              targetSphereRadius={0.0075}
              cameraDistanceScale={0.6}
              trackLivePosition
              showCameraFrustum
              cameraCalibration={context.cameraCalibration}
            />
          </div>
        )}
        <context.ui.CameraView
          ref={cameraViewRef}
          className="flex-1 min-h-0"
          stream={selectedCamera?.stream}
          cursor={shiftHeld ? 'none' : 'default'}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          noCamera={
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">{t.noCamera}</p>
            </div>
          }
        >
          {shiftHeld && crosshairPos && <Crosshair x={crosshairPos.x} y={crosshairPos.y} />}
        </context.ui.CameraView>
      </div>

      <div className="space-y-5 lg:w-[260px] lg:max-w-[260px] lg:shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.simulationMode}</p>
          <button
            role="switch"
            aria-checked={simMode}
            onClick={handleSimModeToggle}
            style={{
              position: 'relative',
              width: 36,
              height: 20,
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.2s',
              background: simMode ? 'var(--primary)' : 'rgba(120,120,120,0.35)',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: 2,
                width: 16,
                height: 16,
                borderRadius: 8,
                background: 'var(--background)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                transition: 'transform 0.15s',
                transform: simMode ? 'translateX(16px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>

        {context.cameras.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.camera}</p>
            <select
              value={selectedCameraId ?? ''}
              onChange={(e) => setSelectedCameraId(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {context.cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2">
            <div className={`size-2 shrink-0 rounded-full ${isTracking ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
            <span>{isTracking ? t.tracking : t.holdShift}</span>
          </div>
          {statusMsg && <p className="text-xs text-destructive">{statusMsg}</p>}
          {!context.cameraCalibration && selectedCamera && <p className="text-xs text-muted-foreground">{t.noCalibration}</p>}
        </div>
      </div>
    </div>
  )
}
