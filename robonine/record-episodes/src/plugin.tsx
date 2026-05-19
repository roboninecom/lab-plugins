import type { CameraViewHandle, PluginContext } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clapperboard, Download, Trash2, X } from 'lucide-react'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

type RecordingFrame = {
  seq: number
  ts: number
  joints: Record<string, number>
  sensors?: Record<string, number>
  image: string | null
  imageWidth: number | null
  imageHeight: number | null
}

type SavedEpisode = {
  id: string
  task: string
  success: boolean | null
  frameCount: number
  source: string
  robotModel: string
  recordedAt: number
  frames: RecordingFrame[]
}

type ViewState = 'idle' | 'recording' | 'labeling' | 'motor-error'

async function captureFrame(video: HTMLVideoElement): Promise<{ image: string; width: number; height: number } | null> {
  const w = 640
  const h = 480
  const canvas = document.createElement('canvas')

  if (video.readyState < 2) {
    return null
  }

  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        const reader = new FileReader()

        if (!blob) {
          return resolve(null)
        }
        reader.onload = () => {
          const data = reader.result as string

          resolve({ image: data.split(',')[1], width: w, height: h })
        }
        reader.readAsDataURL(blob)
      },
      'image/jpeg',
      0.85,
    )
  })
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)

  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function downloadAllJson(episodes: SavedEpisode[]): void {
  const blob = new Blob([JSON.stringify(episodes, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = `episodes_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadJson(episode: SavedEpisode): void {
  const blob = new Blob([JSON.stringify(episode, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = `episode_${episode.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function PluginRoot({ context }: Props) {
  const copies = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button, Checkbox, CameraView, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } = context.ui
  const robot = context.robot('default')
  const [view, setView] = useState<ViewState>('idle')
  const [task, setTask] = useState('')
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [frameCount, setFrameCount] = useState(0)
  const [startMs, setStartMs] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [episodes, setEpisodes] = useState<SavedEpisode[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const cameraViewRef = useRef<CameraViewHandle>(null)
  const framesRef = useRef<RecordingFrame[]>([])
  const stopLoopRef = useRef<(() => void) | null>(null)
  const pendingEpisodeRef = useRef<SavedEpisode | null>(null)
  const missingMotorsRef = useRef<string[]>([])
  const servoRef = useRef(robot.servo)
  const connectionRef = useRef(robot.connection)

  servoRef.current = robot.servo
  connectionRef.current = robot.connection

  const selectedCamera = useMemo(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  const jointNames = useMemo(
    () =>
      Object.entries(robot.robotConfig?.jointServoId ?? {})
        .sort(([, a], [, b]) => a - b)
        .map(([name]) => name),
    [robot.robotConfig],
  )

  const sensorDefs = useMemo(() => robot.robotConfig?.forceSensors ?? [], [robot.robotConfig])

  const toggleExcluded = useCallback((name: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)

      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }

      return next
    })
  }, [])

  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (view !== 'recording') {
      return
    }

    // eslint-disable-next-line local/decls-on-top
    const id = setInterval(() => setElapsed(Date.now() - startMs), 250)

    return () => clearInterval(id)
  }, [view, startMs])

  useEffect(() => {
    if (view === 'recording' && !robot.connection.connected) {
      stopLoopRef.current?.()
      stopLoopRef.current = null
      setView('idle')
    }
  }, [robot.connection.connected, view])

  useEffect(
    () => () => {
      stopLoopRef.current?.()
    },
    [],
  )

  const handleStart = useCallback(() => {
    const currentSensorDefs = sensorDefs
    const currentExcluded = excluded
    let seq = 0
    let running = true

    framesRef.current = []

    const loop = async () => {
      while (running) {
        const statuses = await servoRef.current.readJointPositionsStatus()

        if (statuses) {
          const missing = statuses.filter((s) => s.value === null && !currentExcluded.has(s.name)).map((s) => s.name)
          const joints: Record<string, number> = {}
          let image: string | null = null
          let imageWidth: number | null = null
          let imageHeight: number | null = null
          let sensors: Record<string, number> | undefined

          if (missing.length > 0) {
            running = false
            stopLoopRef.current = null
            missingMotorsRef.current = missing
            setView('motor-error')

            return
          }

          for (const { name, value } of statuses) {
            if (!currentExcluded.has(name)) {
              joints[name] = parseFloat(value!.toFixed(4))
            }
          }

          // eslint-disable-next-line local/decls-on-top
          const video = cameraViewRef.current?.video

          if (video) {
            const captured = await captureFrame(video)

            if (captured) {
              image = captured.image
              imageWidth = captured.width
              imageHeight = captured.height
            }
          }

          if (currentSensorDefs.length > 0) {
            const sensorData: Record<string, number> = {}

            for (const sensor of currentSensorDefs) {
              if (!currentExcluded.has(sensor.label)) {
                try {
                  sensorData[sensor.label] = await servoRef.current.readPosition(sensor.id)
                } catch {
                  /* skip unavailable sensor */
                }
              }
            }
            if (Object.keys(sensorData).length > 0) {
              sensors = sensorData
            }
          }

          framesRef.current.push({ seq: seq++, ts: Date.now(), joints, sensors, image, imageWidth, imageHeight })
          setFrameCount(seq)
        }

        await new Promise<void>((r) => setTimeout(r, 50))
      }
    }

    loop()
    stopLoopRef.current = () => {
      running = false
    }

    setStartMs(Date.now())
    setElapsed(0)
    setFrameCount(0)
    setView('recording')
  }, [robot.robotConfig, excluded, sensorDefs])

  const handleStop = useCallback(() => {
    const frames = framesRef.current

    stopLoopRef.current?.()
    stopLoopRef.current = null
    if (frames.length === 0) {
      setView('idle')

      return
    }

    const ep: SavedEpisode = {
      id: crypto.randomUUID(),
      task,
      success: null,
      frameCount: frames.length,
      source: connectionRef.current.remote ? 'webrtc' : 'local',
      robotModel: robot.robotConfig?.modelId ?? 'unknown',
      recordedAt: Date.now(),
      frames,
    }

    pendingEpisodeRef.current = ep
    setView('labeling')
  }, [task, robot.robotConfig])

  const handleLabel = useCallback((success: boolean) => {
    const ep = pendingEpisodeRef.current

    if (!ep) {
      return
    }
    ep.success = success
    pendingEpisodeRef.current = null
    setEpisodes((prev) => [ep, ...prev])
    setView('idle')
  }, [])

  const handleDelete = useCallback((id: string) => {
    setEpisodes((prev) => prev.filter((e) => e.id !== id))
  }, [])

  if (!robot.connection.connected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{copies.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{copies.connectFirst}</p>
          </div>
          <Button className="w-full" onClick={robot.openConnectDialog}>
            {copies.connectRobot}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'recording') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div className="flex items-center gap-3">
            <span className="inline-block size-3 rounded-full bg-red-500 animate-pulse shrink-0" />
            <h1 className="text-xl font-semibold">{copies.recording}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{task}</p>

          <CameraView ref={cameraViewRef} stream={selectedCamera?.stream} className="w-full" />

          <div className="rounded-lg border bg-card p-4 flex items-center justify-between text-sm">
            <span className="font-mono text-lg font-semibold">{formatDuration(elapsed)}</span>
            <span className="text-muted-foreground">
              {frameCount} {copies.frames}
            </span>
          </div>

          <Button variant="destructive" className="w-full" onClick={handleStop}>
            {copies.stopRecording}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'motor-error') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <h1 className="text-xl font-semibold">{copies.motorError}</h1>
          <p className="text-sm text-muted-foreground">{copies.motorErrorDetail}</p>
          <ul className="text-sm font-mono space-y-1">
            {missingMotorsRef.current.map((name) => (
              <li key={name} className="text-destructive">
                {name}
              </li>
            ))}
          </ul>
          <Button className="w-full" onClick={() => setView('idle')}>
            {copies.dismiss}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'labeling') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <h1 className="text-xl font-semibold">{copies.labelTitle}</h1>
          <div className="space-y-3">
            <Button className="w-full" onClick={() => handleLabel(true)}>
              <Check className="w-4 h-4 mr-2" />
              {copies.labelSuccess}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => handleLabel(false)}>
              <X className="w-4 h-4 mr-2" />
              {copies.labelFailed}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-xl w-full space-y-6 mx-auto">
          <div>
            <h1 className="text-xl font-semibold">{copies.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{copies.description}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{copies.task}</label>
            <input
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder={copies.taskPlaceholder}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <CameraView
            ref={cameraViewRef}
            stream={selectedCamera?.stream}
            className="w-full"
            noCamera={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{context.cameras.length === 0 ? copies.noCameraAvailable : copies.noCameraSelected}</div>}
          />

          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleStart} disabled={!task.trim() || !selectedCameraId}>
              <Clapperboard className="w-4 h-4 mr-2" />
              {copies.startRecording}
            </Button>

            {episodes.length > 1 && (
              <Button variant="outline" onClick={() => downloadAllJson(episodes)}>
                <Download className="w-4 h-4 mr-2" />
                {copies.downloadAll}
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{copies.episodes}</p>
            {episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copies.noEpisodes}</p>
            ) : (
              <div className="space-y-2">
                {episodes.map((ep) => (
                  <div key={ep.id} className="rounded-lg border bg-card px-4 py-3 flex items-start gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{ep.task}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ep.frameCount} {copies.frames} · {ep.robotModel}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${ep.success === true ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ep.success === false ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-muted text-muted-foreground'}`}
                    >
                      {ep.success === true ? copies.success : ep.success === false ? copies.failed : copies.unlabelled}
                    </span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => downloadJson(ep)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" aria-label={copies.download}>
                            <Download className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{copies.download}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => handleDelete(ep.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" aria-label={copies.deleteEpisode}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{copies.deleteEpisode}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(jointNames.length > 0 || sensorDefs.length > 0) && (
        <div className="w-52 shrink-0 border-l pl-6 overflow-y-auto space-y-5">
          <p className="text-sm font-medium">{copies.trainingData}</p>

          {jointNames.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{copies.motors}</p>
              {jointNames.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox checked={!excluded.has(name)} onCheckedChange={() => toggleExcluded(name)} />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          )}

          {sensorDefs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{copies.sensors}</p>
              {sensorDefs.map((sensor) => (
                <label key={sensor.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox checked={!excluded.has(sensor.label)} onCheckedChange={() => toggleExcluded(sensor.label)} />
                  <span className="truncate">{sensor.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
