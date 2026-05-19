import { Check, Clapperboard, Download, Play, Square, Trash2, Upload, X } from 'lucide-react'
import type { CameraViewHandle, PluginContext } from '@robonine/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
type Tab = 'record' | 'inference'
type InferState = 'idle' | 'running'

interface FeatureSchema {
  version: number
  joint_names: string[]
  sensor_names: string[]
  use_image: boolean
  image_size: number
  image_feature_dim: number
  input_dim: number
  output_dim: number
  hidden_dim: number
  num_layers: number
}

interface ConsoleEntry {
  time: string
  line: string
  isError?: boolean
}

// ── Safetensors parser ────────────────────────────────────────────────────────

function parseSafetensors(buffer: ArrayBuffer): Map<string, Float32Array> {
  const view = new DataView(buffer)
  const headerSize = Number(view.getBigUint64(0, true))
  const headerJson = new TextDecoder().decode(new Uint8Array(buffer, 8, headerSize))
  const header = JSON.parse(headerJson) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>
  const dataStart = 8 + headerSize
  const tensors = new Map<string, Float32Array>()

  for (const [name, meta] of Object.entries(header)) {
    const [start, end] = meta.data_offsets

    if (name === '__metadata__') {
      continue
    }

    const byteOffset = dataStart + start
    const len = (end - start) / 4

    tensors.set(name, byteOffset % 4 === 0 ? new Float32Array(buffer, byteOffset, len) : new Float32Array(buffer.slice(byteOffset, byteOffset + (end - start))))
  }

  return tensors
}

// ── Neural net primitives ─────────────────────────────────────────────────────

function relu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length)

  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] > 0 ? x[i] : 0
  }

  return out
}

function linearForward(x: Float32Array, weight: Float32Array, bias: Float32Array): Float32Array {
  const outDim = bias.length
  const inDim = x.length
  const out = new Float32Array(outDim)

  for (let i = 0; i < outDim; i++) {
    let s = bias[i]

    for (let j = 0; j < inDim; j++) {
      s += weight[i * inDim + j] * x[j]
    }
    out[i] = s
  }

  return out
}

function conv2dForward(
  input: Float32Array,
  weight: Float32Array,
  bias: Float32Array,
  cin: number,
  hin: number,
  win: number,
  cout: number,
  kSize: number,
  stride: number,
  padding: number,
): Float32Array {
  const hout = Math.floor((hin + 2 * padding - kSize) / stride) + 1
  const wout = Math.floor((win + 2 * padding - kSize) / stride) + 1
  const out = new Float32Array(cout * hout * wout)

  for (let co = 0; co < cout; co++) {
    for (let ho = 0; ho < hout; ho++) {
      for (let wo = 0; wo < wout; wo++) {
        let s = bias[co]

        for (let ci = 0; ci < cin; ci++) {
          for (let kh = 0; kh < kSize; kh++) {
            const hi = ho * stride - padding + kh

            if (hi < 0 || hi >= hin) {
              continue
            }
            for (let kw = 0; kw < kSize; kw++) {
              const wi = wo * stride - padding + kw

              if (wi < 0 || wi >= win) {
                continue
              }
              s += input[ci * hin * win + hi * win + wi] * weight[co * cin * kSize * kSize + ci * kSize * kSize + kh * kSize + kw]
            }
          }
        }
        out[co * hout * wout + ho * wout + wo] = s
      }
    }
  }

  return out
}

// ── Image capture → CHW float32 ───────────────────────────────────────────────

function captureImageChw(video: HTMLVideoElement, size: number): Float32Array | null {
  const canvas = document.createElement('canvas')
  const out = new Float32Array(3 * size * size)

  if (video.readyState < 2) {
    return null
  }

  canvas.width = size
  canvas.height = size
  canvas.getContext('2d')!.drawImage(video, 0, 0, size, size)

  const pixels = canvas.getContext('2d')!.getImageData(0, 0, size, size).data

  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < size * size; i++) {
      out[c * size * size + i] = pixels[i * 4 + c] / 255.0
    }
  }

  return out
}

// ── Full forward pass ─────────────────────────────────────────────────────────

function runInference(schema: FeatureSchema, weights: Map<string, Float32Array>, joints: Record<string, number>, video: HTMLVideoElement | null): Record<string, number> | null {
  const jointVec = new Float32Array(schema.joint_names.length)
  const result: Record<string, number> = {}

  for (let i = 0; i < schema.joint_names.length; i++) {
    const v = joints[schema.joint_names[i]]

    if (v === undefined) {
      return null
    }
    jointVec[i] = v
  }

  let input: Float32Array = jointVec

  if (schema.use_image) {
    const imageChw = video ? captureImageChw(video, schema.image_size) : null
    const s = schema.image_size

    if (!imageChw) {
      return null
    }
    let x = conv2dForward(imageChw, weights.get('cnn.conv1.weight')!, weights.get('cnn.conv1.bias')!, 3, s, s, 16, 3, 2, 1)

    x = relu(x)

    const s1 = Math.floor(s / 2)

    x = conv2dForward(x, weights.get('cnn.conv2.weight')!, weights.get('cnn.conv2.bias')!, 16, s1, s1, 32, 3, 2, 1)
    x = relu(x)

    const s2 = Math.floor(s1 / 2)

    x = conv2dForward(x, weights.get('cnn.conv3.weight')!, weights.get('cnn.conv3.bias')!, 32, s2, s2, 32, 3, 2, 1)
    x = relu(x)

    const imgFeatures = linearForward(x, weights.get('cnn.fc.weight')!, weights.get('cnn.fc.bias')!)

    // model concatenates [img_features, joints]
    input = new Float32Array(schema.input_dim)
    input.set(imgFeatures, 0)
    input.set(jointVec, imgFeatures.length)
  }

  let h = input

  for (let i = 0; i < schema.num_layers; i++) {
    h = linearForward(h, weights.get(`h${i}.weight`)!, weights.get(`h${i}.bias`)!)
    h = relu(h)
  }

  const out = linearForward(h, weights.get('out.weight')!, weights.get('out.bias')!)

  for (let i = 0; i < schema.output_dim; i++) {
    result[schema.joint_names[i]] = parseFloat(out[i].toFixed(4))
  }

  return result
}

// ── Recording helpers ─────────────────────────────────────────────────────────

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

function nowTimestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')

  return `${hh}:${mm}:${ss}.${ms}`
}

function formatAction(action: Record<string, number>): string {
  return Object.entries(action)
    .map(([k, v]) => `${k}: ${v.toFixed(4)}`)
    .join('  ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PluginRoot({ context }: Props) {
  const copies = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button, Checkbox, CameraView, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } = context.ui
  const robot = context.robot('default')
  const [activeTab, setActiveTab] = useState<Tab>('record')
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

  // Inference state
  const [inferState, setInferState] = useState<InferState>('idle')
  const [schemaText, setSchemaText] = useState('')
  const [weightsBuffer, setWeightsBuffer] = useState<ArrayBuffer | null>(null)
  const [weightsName, setWeightsName] = useState('')
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([])
  const inferStopRef = useRef<(() => void) | null>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)
  const weightsInputRef = useRef<HTMLInputElement>(null)

  // Joint order for setJointPositions (sorted by servo ID ascending)
  const jointOrder = useMemo(
    () =>
      Object.entries(robot.robotConfig?.jointServoId ?? {})
        .sort(([, a], [, b]) => a - b)
        .map(([name]) => name),
    [robot.robotConfig],
  )

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

  useEffect(() => {
    const cleanup = robot.servo.registerEmergencyStop()

    return () => {
      stopLoopRef.current?.()
      inferStopRef.current?.()
      cleanup()
    }
  }, [])

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLog])

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

  const handleWeightsFile = useCallback((file: File) => {
    const reader = new FileReader()

    reader.onload = () => {
      setWeightsBuffer(reader.result as ArrayBuffer)
      setWeightsName(file.name)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const inferReady = schemaText.trim() !== '' && weightsBuffer !== null

  const handleInferStart = useCallback(async () => {
    let schema: FeatureSchema
    const confirmed = await robot.showSafetyWarning()
    let weights: Map<string, Float32Array>
    let running = true

    const addEntry = (line: string, isError?: boolean) => {
      setConsoleLog((prev) => [...prev, { time: nowTimestamp(), line, isError }])
    }

    try {
      schema = JSON.parse(schemaText) as FeatureSchema
    } catch {
      context.toast.error(copies.inferSchemaInvalid)

      return
    }

    if (!weightsBuffer) {
      return
    }

    if (!confirmed) {
      return
    }

    try {
      weights = parseSafetensors(weightsBuffer)
    } catch {
      context.toast.error(copies.inferWeightsInvalid)

      return
    }

    setConsoleLog([])
    setInferState('running')

    const loop = async () => {
      while (running) {
        const statuses = await servoRef.current.readJointPositionsStatus()
        const joints: Record<string, number> = {}
        const video = cameraViewRef.current?.video ?? null

        if (!statuses) {
          await new Promise<void>((r) => setTimeout(r, 200))
          continue
        }

        for (const { name, value } of statuses) {
          if (value !== null) {
            joints[name] = parseFloat(value.toFixed(4))
          }
        }

        const result = runInference(schema, weights, joints, video)

        if (!result) {
          addEntry('missing joints or image — check schema matches robot', true)
        } else {
          // Merge predicted joints over current positions, then send in servo-ID order
          const merged = { ...joints, ...result }

          addEntry(formatAction(result))

          const positions = jointOrder.map((name) => merged[name] ?? 0)

          await servoRef.current.setJointPositions(positions)
        }

        await new Promise<void>((r) => setTimeout(r, 200))
      }
    }

    inferStopRef.current = () => {
      running = false
    }
    loop()
  }, [schemaText, weightsBuffer, jointOrder, robot, copies.inferSchemaInvalid, copies.inferWeightsInvalid, context.toast])

  const handleInferStop = useCallback(() => {
    inferStopRef.current?.()
    inferStopRef.current = null
    setInferState('idle')
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
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex border-b shrink-0">
        <button
          className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${activeTab === 'record' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('record')}
        >
          {copies.tabRecord}
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${activeTab === 'inference' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('inference')}
        >
          {copies.tabInference}
        </button>
      </div>

      {activeTab === 'record' && (
        <div className="flex flex-1 min-h-0 overflow-hidden pt-6">
          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="w-full space-y-6 pr-6">
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
                className="w-full min-h-[50dvh]"
                noCamera={
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    {context.cameras.length === 0 ? copies.noCameraAvailable : copies.noCameraSelected}
                  </div>
                }
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
            <div className="w-64 shrink-0 border-l pl-6 pb-6 overflow-y-auto space-y-5">
              <p className="text-sm font-medium">{copies.trainingData}</p>

              {jointNames.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{copies.motors}</p>
                  {jointNames.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <Checkbox checked={!excluded.has(name)} onCheckedChange={() => toggleExcluded(name)} />
                      <span className="truncate min-w-0">{name}</span>
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
                      <span className="truncate min-w-0">{sensor.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'inference' && (
        <div className="flex flex-1 min-h-0 overflow-hidden pt-6">
          {/* Main area — video + console, fixed 50/50 split */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-4 pb-6">
            <div className="flex-1 min-h-0">
              <CameraView
                ref={cameraViewRef}
                stream={selectedCamera?.stream}
                className="w-full h-full"
                noCamera={
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    {context.cameras.length === 0 ? copies.noCameraAvailable : copies.noCameraSelected}
                  </div>
                }
              />
            </div>

            <div className="flex-1 min-h-0 flex flex-col rounded-md overflow-hidden border border-neutral-800">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 shrink-0">
                {inferState === 'running' && <span className="inline-block size-2 rounded-full bg-green-500 animate-pulse" />}
                <span className="text-xs text-neutral-400 font-mono">{inferState === 'running' ? copies.inferRunning : 'console'}</span>
              </div>
              <div className="bg-neutral-950 flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
                {consoleLog.length === 0 ? (
                  <p className="text-xs text-neutral-600 font-mono">{copies.inferConsoleEmpty}</p>
                ) : (
                  consoleLog.map((entry, i) => (
                    <div key={i} className="flex gap-2 font-mono text-xs leading-tight">
                      <span className="text-neutral-600 shrink-0">[{entry.time}]</span>
                      <span className={entry.isError ? 'text-red-400' : 'text-green-400'}>{entry.line}</span>
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>

          {/* Right panel — model config + controls */}
          <div className="w-64 shrink-0 border-l pl-6 overflow-y-auto space-y-5 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">{copies.inferSchema}</label>
              <textarea
                value={schemaText}
                onChange={(e) => setSchemaText(e.target.value)}
                placeholder={copies.inferSchemaPlaceholder}
                disabled={inferState === 'running'}
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{copies.inferWeights}</label>
              <input
                ref={weightsInputRef}
                type="file"
                accept=".safetensors"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]

                  if (file) {
                    handleWeightsFile(file)
                  }
                  e.target.value = ''
                }}
              />
              <Button variant="outline" size="sm" className="w-full" disabled={inferState === 'running'} onClick={() => weightsInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-1.5" />
                {copies.inferLoadWeights}
              </Button>
              {weightsName && <p className="text-xs text-muted-foreground truncate">{weightsName}</p>}
            </div>

            {inferState === 'idle' ? (
              <Button className="w-full" onClick={handleInferStart} disabled={!inferReady}>
                <Play className="w-4 h-4 mr-2" />
                {copies.inferStart}
              </Button>
            ) : (
              <Button variant="destructive" className="w-full" onClick={handleInferStop}>
                <Square className="w-4 h-4 mr-2" />
                {copies.inferStop}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
