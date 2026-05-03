import { type ArucoDetection, ARUCO_DICTS, type ArucoService, type ArucoDictKey } from './service'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CameraHandle, PluginContext } from '@robonine/plugin-sdk'
import { translations } from './translations'

interface Props {
  context: PluginContext
}

function drawOverlay(ctx: CanvasRenderingContext2D, detections: ArucoDetection[]) {
  for (const { id, corners } of detections) {
    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4
    const text = String(id)
    const pad = 6
    const th = 28

    ctx.beginPath()
    ctx.moveTo(corners[0][0], corners[0][1])
    ctx.lineTo(corners[1][0], corners[1][1])
    ctx.lineTo(corners[2][0], corners[2][1])
    ctx.lineTo(corners[3][0], corners[3][1])
    ctx.closePath()
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.font = 'bold 18px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const metrics = ctx.measureText(text)
    const tw = metrics.width + pad * 2

    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.beginPath()
    ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, 4)
    ctx.fill()

    ctx.fillStyle = '#22c55e'
    ctx.fillText(text, cx, cy)
  }
}

const DICT_OPTIONS = Object.entries(ARUCO_DICTS) as Array<[ArucoDictKey, number]>

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const arucoService = useMemo(() => context.service('aruco') as ArucoService | null, [context])
  const [arucoReady, setArucoReady] = useState(false)
  const [arucoError, setArucoError] = useState(false)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [selectedDictId, setSelectedDictId] = useState<number>(ARUCO_DICTS['4X4_50'])
  const [detections, setDetections] = useState<ArucoDetection[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Refs so the rAF loop sees the latest values without restarting.
  const arucoReadyRef = useRef(arucoReady)
  const arucoErrorRef = useRef(arucoError)
  const arucoServiceRef = useRef(arucoService)
  const selectedDictIdRef = useRef(selectedDictId)
  const tRef = useRef(t)

  arucoReadyRef.current = arucoReady
  arucoErrorRef.current = arucoError
  arucoServiceRef.current = arucoService
  selectedDictIdRef.current = selectedDictId
  tRef.current = t

  const selectedCamera = useMemo<CameraHandle | null>(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  // Wait for the ArUco (and transitively OpenCV) service.
  useEffect(() => {
    if (!arucoService) {
      setArucoError(true)

      return
    }
    arucoService.ready.then(() => setArucoReady(true)).catch(() => setArucoError(true))
  }, [arucoService])

  // Auto-select when there is exactly one camera; clear when it disappears.
  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  // Bind camera stream to the hidden video element.
  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.srcObject = selectedCamera?.stream ?? null

    if (selectedCamera) {
      video.play().catch(() => {})
    }
  }, [selectedCamera])

  // Detection + rendering loop (restarts when the camera changes).
  const startLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    let animId: number
    let running = true
    let frameCount = 0
    let lastIds = ''
    let lastResult: ArucoDetection[] = []

    if (!video || !canvas) {
      return () => {}
    }

    const loop = () => {
      const ctx = canvas.getContext('2d')
      const service = arucoServiceRef.current

      if (!running) {
        return
      }
      animId = requestAnimationFrame(loop)

      if (video.readyState < 2 || video.videoWidth === 0) {
        return
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      if (!ctx) {
        return
      }

      ctx.drawImage(video, 0, 0)

      if (!arucoReadyRef.current) {
        // Overlay a status message on the raw video frame.
        const msg = arucoErrorRef.current ? tRef.current.statusError : tRef.current.statusLoading

        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(0, 0, canvas.width, 40)
        ctx.fillStyle = '#fff'
        ctx.font = '14px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(msg, 12, 20)

        return
      }

      // Detect every other frame to reduce CPU load.
      // getImageData runs before drawOverlay so detection sees clean video pixels.
      frameCount++
      if (frameCount % 2 === 0 && service) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const result = service.detectMarkers(imageData, selectedDictIdRef.current)

        lastResult = result

        const nextIds = result.map((d) => d.id).join(',')

        if (nextIds !== lastIds) {
          lastIds = nextIds
          setDetections([...result])
        }
      }

      // Always redraw the last known detections — drawImage clears the canvas
      // every frame, so skipping this on non-detection frames makes the overlay flicker.
      drawOverlay(ctx, lastResult)
    }

    animId = requestAnimationFrame(loop)

    return () => {
      running = false
      cancelAnimationFrame(animId)
    }
  }, [])

  useEffect(() => {
    if (!selectedCamera) {
      return
    }

    return startLoop()
  }, [selectedCamera, startLoop])

  // ─── No cameras ──────────────────────────────────────────────────────────────

  if (context.cameras.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <p className="text-sm text-muted-foreground">{t.noCameras}</p>
          </div>
          <p className="text-xs text-muted-foreground break-words">{t.serviceNote}</p>
        </div>
      </div>
    )
  }

  // ─── Main layout ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Off-screen video — display:none prevents frame delivery in Chrome's invisible-video optimization */}
      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }} />

      <div className="flex flex-col gap-4 flex-1 min-h-0 lg:flex-row">
        {/* Camera canvas */}
        <div className="relative flex-1 min-h-0 rounded-lg border bg-black overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
          </div>
        </div>

        {/* Controls + detections */}
        <div className="space-y-4 lg:w-64 lg:shrink-0">
          <h2 className="hidden lg:block text-lg font-semibold">{t.title}</h2>

          {/* Status */}
          <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
            <span className={['w-2.5 h-2.5 rounded-full shrink-0', arucoError ? 'bg-destructive' : arucoReady ? 'bg-green-500' : 'bg-muted-foreground animate-pulse'].join(' ')} />
            <span className="text-sm font-medium">{arucoError ? t.statusError : arucoReady ? t.statusReady : t.statusLoading}</span>
          </div>

          {/* Camera selector */}
          {context.cameras.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.camera}</p>
              <select
                value={selectedCameraId ?? ''}
                onChange={(e) => setSelectedCameraId(e.target.value || null)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {context.cameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.label} ({cam.source === 'local' ? t.local : t.remote})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dictionary selector */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.dictionary}</p>
            <select
              value={selectedDictId}
              onChange={(e) => setSelectedDictId(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {DICT_OPTIONS.map(([key, value]) => (
                <option key={key} value={value}>
                  DICT_{key}
                </option>
              ))}
            </select>
          </div>

          {/* Detected markers */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detectedMarkers}</p>
            {detections.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noMarkers}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {detections.map(({ id }) => (
                  <span key={id} className="rounded-md bg-green-500/15 border border-green-500/30 px-2 py-0.5 text-xs font-mono font-semibold text-green-600 dark:text-green-400">
                    {id}
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground break-words">{t.serviceNote}</p>
        </div>
      </div>
    </>
  )
}
