import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FKResult, PluginContext } from '@robonine/plugin-sdk'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

const MIN_DEPTH = 0.05

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null)
  // true = camera aims at cursor; false = gripper tip aims at cursor
  const [aimWithCamera, setAimWithCamera] = useState(true)
  const [isTracking, setIsTracking] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const ikPendingRef = useRef(false)
  const lastPositionsRef = useRef<number[] | null>(null)
  const safetyShownRef = useRef(false)
  const aimWithCameraRef = useRef(aimWithCamera)
  const cameraLinkRef = useRef('camera_virtual')
  const sortedJointNamesRef = useRef<string[]>([])

  aimWithCameraRef.current = aimWithCamera

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

    const fkNodes = (config as Record<string, unknown>).fkNodes as Array<{ linkName: string }> | undefined
    const camNode = fkNodes?.find((n) => n.linkName.toLowerCase().includes('camera'))

    if (camNode) {
      cameraLinkRef.current = camNode.linkName
    }
  }, [context.robotConfig, t.noRobotConfig])

  const selectedCamera = useMemo(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = selectedCamera?.stream ?? null
    }
  }, [selectedCamera, context.connection.connected])

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
        const vid = videoRef.current
        const config = context.robotConfig
        let fkCam: FKResult
        let ikTarget: [number, number, number]
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
        const [cx, cy, cz] = fkCam.position
        const [ex, ey, ez] = fkEff.position
        const R = fkCam.rotation
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
        const rdx = R[0][0] * nc[0] + R[0][1] * nc[1] + R[0][2] * nc[2]
        const rdy = R[1][0] * nc[0] + R[1][1] * nc[1] + R[1][2] * nc[2]
        const rdz = R[2][0] * nc[0] + R[2][1] * nc[1] + R[2][2] * nc[2]

        // Depth = euclidean distance camera→end-effector (always positive, never tiny)
        const toEx = ex - cx
        const toEy = ey - cy
        const toEz = ez - cz
        const depth = Math.max(MIN_DEPTH, Math.sqrt(toEx * toEx + toEy * toEy + toEz * toEz))

        if (aimWithCameraRef.current) {
          // Camera mode: camera goes to foot → gripper overshoots by (eff-cam)
          ikTarget = [ex + depth * rdx, ey + depth * rdy, ez + depth * rdz]
        } else {
          // Gripper mode: gripper goes to foot on the ray
          ikTarget = [cx + depth * rdx, cy + depth * rdy, cz + depth * rdz]
        }

        console.log(
          '[follow-camera] link:',
          camLinkUsed,
          'cam:',
          [cx, cy, cz].map((v) => v.toFixed(3)),
          'opt-axis:',
          [R[0][2], R[1][2], R[2][2]].map((v) => v.toFixed(3)),
          'depth:',
          depth.toFixed(3),
          'ray:',
          [rdx, rdy, rdz].map((v) => v.toFixed(3)),
          'target:',
          ikTarget.map((v) => v.toFixed(3)),
        )

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
      const vid = videoRef.current

      if (!shiftHeld) {
        return
      }

      if (!vid || vid.videoWidth === 0) {
        return
      }

      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      const pixelU = (relX / rect.width) * vid.videoWidth
      const pixelV = (relY / rect.height) * vid.videoHeight

      void computeAndMove(pixelU, pixelV)
    },
    [shiftHeld, computeAndMove],
  )

  const handleMouseLeave = useCallback(() => {
    setCrosshairPos(null)
    setIsTracking(false)
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
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-lg border bg-black">
        {selectedCamera ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            <div className="absolute inset-0" style={{ cursor: shiftHeld ? 'none' : 'default' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}>
              {shiftHeld && crosshairPos && <Crosshair x={crosshairPos.x} y={crosshairPos.y} />}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">{t.noCamera}</p>
          </div>
        )}
      </div>

      <div className="space-y-5 lg:w-[260px] lg:max-w-[260px] lg:shrink-0">
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

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.aimWith}</p>
          <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
            <button onClick={() => setAimWithCamera(true)} className={`rounded py-1.5 text-sm transition-colors ${aimWithCamera ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {t.cameraNode}
            </button>
            <button onClick={() => setAimWithCamera(false)} className={`rounded py-1.5 text-sm transition-colors ${!aimWithCamera ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {t.gripperTip}
            </button>
          </div>
        </div>

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
