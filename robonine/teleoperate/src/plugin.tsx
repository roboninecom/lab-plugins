import { AlertTriangle, Camera, CameraOff, CheckCircle2, Radio, XCircle } from 'lucide-react'
import type { JointInfo, PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
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
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraVisible, setCameraVisible] = useState(true)
  const viewRef = useRef<WorldViewApi>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopLoopRef = useRef<(() => void) | null>(null)
  const cleanupEmergencyStopRef = useRef<(() => void) | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const sortedJointNamesRef = useRef<string[]>([])

  // Keep servo/connection refs current for stable loop closures.
  const leaderServoRef = useRef(leader.servo)
  const followerServoRef = useRef(follower.servo)
  const followerConnectionRef = useRef(follower.connection)

  leaderServoRef.current = leader.servo
  followerServoRef.current = follower.servo
  followerConnectionRef.current = follower.connection

  // Keep camera stream accessible for stable cleanup.
  useEffect(() => {
    cameraStreamRef.current = cameraStream
  }, [cameraStream])

  // Re-bind stream to video element whenever it mounts or the stream changes.
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream
    }
  }, [cameraStream, isRunning, cameraVisible])

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
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  const handleWorldViewLoad = useCallback((joints: JointInfo[]) => {
    if (sortedJointNamesRef.current.length === 0) {
      sortedJointNamesRef.current = joints.map((j) => j.name)
    }
  }, [])

  const handleConnectCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })

      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = stream
      setCameraStream(stream)
    } catch {
      // user denied or no camera available
    }
  }, [])

  const handleDisconnectCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    setCameraStream(null)
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
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t.remoteNote}</div>
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

          {cameraStream && (
            <>
              {cameraVisible && (
                <div className="rounded-lg overflow-hidden border bg-black">
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '240px', height: 'auto', display: 'block' }} />
                </div>
              )}
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

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <p className="font-semibold text-sm">{t.cameraTitle}</p>
          <p className="text-sm text-muted-foreground">{t.cameraDescription}</p>
          {cameraStream ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-600 flex items-center gap-2">
                <Camera className="w-4 h-4" />
                {t.cameraConnected}
              </span>
              <Button variant="ghost" size="sm" onClick={handleDisconnectCamera}>
                {t.disconnectCamera}
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => void handleConnectCamera()}>
              <Camera className="w-4 h-4 mr-2" />
              {t.connectCamera}
            </Button>
          )}
        </div>

        <Button className="w-full" onClick={() => void handleStart()}>
          <Radio className="w-4 h-4 mr-2" />
          {t.startTeleoperation}
        </Button>
      </div>
    </div>
  )
}
