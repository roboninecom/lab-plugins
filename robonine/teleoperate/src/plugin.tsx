import type { CameraHandle, JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Radio, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button } = context.ui
  const follower = context.robot('default')
  const leader = context.robot('leader')
  const [isRunning, setIsRunning] = useState(false)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [cameraVisible, setCameraVisible] = useState(true)
  const viewRef = useRef<WorldViewApi>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopLoopRef = useRef<(() => void) | null>(null)
  const cleanupEmergencyStopRef = useRef<(() => void) | null>(null)
  const sortedJointNamesRef = useRef<string[]>([])

  // Keep servo/connection refs current for stable loop closures.
  const leaderServoRef = useRef(leader.servo)
  const followerServoRef = useRef(follower.servo)
  const followerConnectionRef = useRef(follower.connection)

  leaderServoRef.current = leader.servo
  followerServoRef.current = follower.servo
  followerConnectionRef.current = follower.connection

  const selectedCamera = useMemo<CameraHandle | null>(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  // Keep selection in sync: auto-select when there's exactly one camera and nothing is
  // selected; clear selection when the selected camera disappears.
  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  // Bind camera stream to video element.
  useEffect(() => {
    if (videoRef.current && selectedCamera?.stream) {
      videoRef.current.srcObject = selectedCamera.stream
    }
  }, [selectedCamera, isRunning, cameraVisible])

  // Stop the loop if either arm disconnects while running.
  useEffect(() => {
    if (!follower.connection.connected || !leader.connection.connected) {
      if (stopLoopRef.current) {
        stopLoopRef.current()
        stopLoopRef.current = null
        cleanupEmergencyStopRef.current?.()
        cleanupEmergencyStopRef.current = null
        setIsRunning(false)
      }
    }
  }, [follower.connection.connected, leader.connection.connected])

  // Full cleanup on unmount.
  useEffect(
    () => () => {
      stopLoopRef.current?.()
      cleanupEmergencyStopRef.current?.()
    },
    [],
  )

  const handleWorldViewLoad = useCallback((joints: JointInfo[]) => {
    if (sortedJointNamesRef.current.length === 0) {
      sortedJointNamesRef.current = joints.map((j) => j.name)
    }
  }, [])

  const handleStart = useCallback(async () => {
    const confirmed = await follower.showSafetyWarning()
    const cfg = follower.robotConfig
    let running = true

    if (!confirmed) {
      return
    }

    if (cfg) {
      sortedJointNamesRef.current = Object.entries(cfg.jointServoId)
        .sort(([, a], [, b]) => a - b)
        .map(([name]) => name)
    }

    cleanupEmergencyStopRef.current?.()
    cleanupEmergencyStopRef.current = followerServoRef.current.registerEmergencyStop()

    const loop = async () => {
      while (running) {
        try {
          const positions = await leaderServoRef.current.readJointPositions()

          if (positions) {
            const names = sortedJointNamesRef.current

            for (let i = 0; i < names.length && i < positions.length; i++) {
              viewRef.current?.setJoint(names[i], positions[i])
            }

            if (followerConnectionRef.current.connected) {
              await followerServoRef.current.setJointPositions(positions)
            }
          }
        } catch {
          // ignore transient read/write errors
        }
        await new Promise<void>((r) => setTimeout(r, 20))
      }
    }

    loop()
    stopLoopRef.current = () => {
      running = false
    }

    setIsRunning(true)
  }, [follower])

  const handleStop = useCallback(() => {
    stopLoopRef.current?.()
    stopLoopRef.current = null
    cleanupEmergencyStopRef.current?.()
    cleanupEmergencyStopRef.current = null
    setIsRunning(false)
  }, [])

  const followerConnected = follower.connection.connected
  const leaderConnected = leader.connection.connected
  const followerConfig = follower.robotConfig
  const leaderConfig = leader.robotConfig
  const bothConfigured = followerConfig !== null && leaderConfig !== null
  const modelMismatch = followerConfig !== null && leaderConfig !== null && followerConfig.modelId !== leaderConfig.modelId

  if (!followerConnected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-5 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">1</div>
              <span className="font-medium">{t.connectFollower}</span>
            </div>
            <div className="flex items-center gap-3 opacity-40">
              <div className="size-5 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">2</div>
              <span>{t.connectLeader}</span>
            </div>
          </div>
          <Button className="w-full" onClick={follower.openConnectDialog}>
            {t.connectFollower}
          </Button>
        </div>
      </div>
    )
  }

  if (!leaderConnected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              <span className="text-muted-foreground">{t.followerConnected}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="size-5 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">2</div>
              <span className="font-medium">{t.connectLeader}</span>
            </div>
          </div>
          <Button className="w-full" onClick={leader.openConnectDialog}>
            {t.connectLeader}
          </Button>
        </div>
      </div>
    )
  }

  if (isRunning) {
    return (
      <div className="flex flex-col gap-6 flex-1 min-h-0 lg:flex-row">
        <div className="overflow-hidden rounded-lg border flex-1 min-h-0">
          <context.WorldView ref={viewRef} motionMode="instant" onLoad={handleWorldViewLoad} />
        </div>

        <div className="space-y-4 lg:w-64 lg:shrink-0">
          <h2 className="hidden lg:block text-lg font-semibold">{t.title}</h2>

          <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.status}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {followerConnected ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <span>{t.follower}</span>
              </div>
              <div className="flex items-center gap-2">
                {leaderConnected ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <span>{t.leader}</span>
              </div>
            </div>
          </div>

          {selectedCamera && (
            <>
              {cameraVisible && (
                <div className="rounded-lg overflow-hidden border bg-black">
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '240px', height: 'auto', display: 'block' }} />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{selectedCamera.label}</span>
                <span className="rounded px-1.5 py-0.5 bg-muted">{selectedCamera.source === 'local' ? t.local : t.remote}</span>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setCameraVisible((v) => !v)}>
                {cameraVisible ? (
                  <>
                    <CameraOff className="w-4 h-4 mr-2" />
                    {t.hideCamera}
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 mr-2" />
                    {t.showCamera}
                  </>
                )}
              </Button>
            </>
          )}

          <Button variant="destructive" className="w-full" onClick={handleStop}>
            {t.stop}
          </Button>
        </div>
      </div>
    )
  }

  // Both connected, not running — ready screen.
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <p className="font-semibold text-sm">{t.status}</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span>{t.followerConnected}</span>
              {followerConfig && <span className="text-muted-foreground ml-auto font-mono text-xs">{followerConfig.modelId}</span>}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span>{t.leaderConnected}</span>
              {leaderConfig && <span className="text-muted-foreground ml-auto font-mono text-xs">{leaderConfig.modelId}</span>}
            </div>
          </div>
        </div>

        {!bothConfigured && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t.calibrationWarning}</span>
          </div>
        )}

        {modelMismatch && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t.modelMismatch}</span>
          </div>
        )}

        {context.cameras.length > 0 && (
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="font-semibold text-sm">{t.cameraTitle}</p>
            <div className="space-y-1.5">
              {context.cameras.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setSelectedCameraId(cam.id === selectedCameraId ? null : cam.id)}
                  className={`w-full flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${cam.id === selectedCameraId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                >
                  <Camera className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{cam.label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${cam.source === 'local' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}
                  >
                    {cam.source === 'local' ? t.local : t.remote}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Button className="w-full" onClick={() => void handleStart()}>
          <Radio className="w-4 h-4 mr-2" />
          {t.startTeleoperation}
        </Button>
      </div>
    </div>
  )
}
