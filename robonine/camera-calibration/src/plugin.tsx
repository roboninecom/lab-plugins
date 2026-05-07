import type { CameraCalibration, CameraCalibrationService } from './service'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CameraHandle, PluginContext } from '@robonine/plugin-sdk'
import { detectChessboardCorners } from './calibration'
import { generateCalibrationPoses } from './poses'
import { translations } from './translations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

interface OpenCVHandle {
  ready: Promise<void>
  getCv(): unknown
}

type WizardStep = 'idle' | 'setup' | 'confirm' | 'capturing' | 'computing' | 'result' | 'saved'
type PoseStatus = 'pending' | 'moving' | 'captured' | 'missed'

const BOARD_COLS = 7
const BOARD_ROWS = 9
const SQUARE_SIZE_M = 0.02
const MIN_CAPTURES = 15
const SETTLE_MS = 2000

interface Props {
  context: PluginContext
}

function buildObjectPoints(cv: CV, cols: number, rows: number) {
  const pts: number[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push(c * SQUARE_SIZE_M, r * SQUARE_SIZE_M, 0)
    }
  }

  return cv.matFromArray(cols * rows, 1, cv.CV_32FC3, pts)
}

function drawCorners(canvas: HTMLCanvasElement, corners: ArrayLike<number>, n: number, found: boolean) {
  const ctx = canvas.getContext('2d')
  const color = found ? '#22c55e' : '#f59e0b'

  if (!ctx) {
    return
  }

  ctx.strokeStyle = color
  ctx.lineWidth = 2

  for (let i = 0; i < n; i++) {
    const x = corners[i * 2]
    const y = corners[i * 2 + 1]

    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const opencvSvc = useMemo(() => context.service('opencv') as OpenCVHandle | null, [context])
  const [opencvReady, setOpencvReady] = useState(false)
  const [step, setStep] = useState<WizardStep>('idle')
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [detectResult, setDetectResult] = useState<'none' | 'found' | 'notfound'>('none')
  const [poseStatuses, setPoseStatuses] = useState<PoseStatus[]>([])
  const [poseScale, setPoseScale] = useState(1.0)
  const [calibResult, setCalibResult] = useState<CameraCalibration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const cancelRef = useRef(false)
  const animRef = useRef<number>(0)
  const selectedCamera = useMemo<CameraHandle | null>(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])
  const poses = useMemo(() => (context.robotConfig ? generateCalibrationPoses(context.robotConfig, poseScale) : null), [context.robotConfig, poseScale])
  const isConnected = context.connection.connected
  const calibration = context.robotConfig
  const robotId = context.connection.robotId

  const rmsColor = (rms: number) => {
    if (rms < 1.0) {
      return 'text-green-600 dark:text-green-400'
    }
    if (rms < 2.0) {
      return 'text-yellow-600 dark:text-yellow-400'
    }

    return 'text-red-600 dark:text-red-400'
  }

  const { Button } = context.ui

  // ── OpenCV readiness ──────────────────────────────────────────────────

  useEffect(() => {
    if (!opencvSvc) {
      return
    }
    opencvSvc.ready.then(() => setOpencvReady(true)).catch(() => {})
  }, [opencvSvc])

  // ── Auto-select single camera ─────────────────────────────────────────

  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  // ── Attach video stream ───────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.srcObject = selectedCamera?.stream ?? null

    if (selectedCamera) {
      // Request the highest resolution the camera supports. applyConstraints
      // modifies the existing track in-place — no second stream needed.
      const track = selectedCamera.stream.getVideoTracks()[0]

      track?.applyConstraints({ width: { ideal: 9999 }, height: { ideal: 9999 } }).catch(() => {})
      video.play().catch(() => {})
    }
  }, [selectedCamera, step])

  // ── Live preview loop ─────────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current
    const canvas = previewRef.current
    let running = true

    if (step !== 'setup' && step !== 'confirm' && step !== 'capturing') {
      return
    }
    if (!video || !canvas) {
      return
    }

    const ctx2d = canvas.getContext('2d')

    if (!ctx2d) {
      return
    }

    const loop = () => {
      if (!running) {
        return
      }
      animRef.current = requestAnimationFrame(loop)

      if (video.readyState < 2 || video.videoWidth === 0) {
        return
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      ctx2d.drawImage(video, 0, 0)
    }

    animRef.current = requestAnimationFrame(loop)

    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  }, [step, selectedCamera])

  // ── Helpers ───────────────────────────────────────────────────────────

  function getOffscreen(): HTMLCanvasElement {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }

    return offscreenRef.current
  }

  function captureFrame(): ImageData | null {
    const video = videoRef.current
    const canvas = getOffscreen()

    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return null
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    if (!ctx) {
      return null
    }

    ctx.drawImage(video, 0, 0)

    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }

  function toGray(cv: CV, imageData: ImageData): CV {
    const src = cv.matFromImageData(imageData)
    const gray = new cv.Mat()

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    src.delete()

    return gray
  }

  function findCorners(cv: CV, imageData: ImageData): { found: boolean; corners: Float32Array; cols: number; rows: number } {
    const gray = toGray(cv, imageData)

    try {
      const result = detectChessboardCorners(cv, gray, BOARD_COLS, BOARD_ROWS)

      return result ? { found: true, ...result } : { found: false, corners: new Float32Array(), cols: BOARD_COLS, rows: BOARD_ROWS }
    } finally {
      gray.delete()
    }
  }

  // ── Board detection test (setup step) ────────────────────────────────

  const handleDetect = useCallback(() => {
    const cv = opencvSvc?.getCv() as CV | undefined
    const imageData = captureFrame()

    if (!cv || !imageData) {
      setDetectResult('notfound')

      return
    }

    try {
      const { found, corners, cols, rows } = findCorners(cv, imageData)
      const canvas = previewRef.current

      setDetectResult(found ? 'found' : 'notfound')

      if (canvas && found) {
        drawCorners(canvas, corners, cols * rows, true)
      }
    } catch {
      setDetectResult('notfound')
    }
  }, [opencvSvc, selectedCamera])

  // ── Capture loop ──────────────────────────────────────────────────────

  const runCapture = useCallback(async () => {
    const cv = opencvSvc?.getCv() as CV | undefined
    const confirmed = await context.showSafetyWarning()
    const cleanup = context.servo.registerEmergencyStop()
    const imagePointsList: { corners: Float32Array; cols: number; rows: number }[] = []
    let capturedWidth = 0
    let capturedHeight = 0

    if (!poses || !cv) {
      return
    }

    if (!confirmed) {
      setStep('confirm')

      return
    }

    cancelRef.current = false
    setPoseStatuses(poses.map(() => 'pending' as PoseStatus))
    setStep('capturing')

    await context.servo.limitSpeed(300)

    for (let i = 0; i < poses.length; i++) {
      const imageData = captureFrame()

      if (cancelRef.current) {
        break
      }

      setPoseStatuses((prev) => {
        const next = [...prev]

        next[i] = 'moving'

        return next
      })

      try {
        await context.servo.setJointPositions(poses[i])
        await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))
      } catch {
        setPoseStatuses((prev) => {
          const next = [...prev]

          next[i] = 'missed'

          return next
        })
        continue
      }

      if (cancelRef.current) {
        break
      }

      if (!imageData) {
        setPoseStatuses((prev) => {
          const next = [...prev]

          next[i] = 'missed'

          return next
        })
        continue
      }

      try {
        const { found, corners, cols, rows } = findCorners(cv, imageData)

        if (found) {
          const canvas = previewRef.current

          imagePointsList.push({ corners, cols, rows })
          if (!capturedWidth) {
            capturedWidth = imageData.width
            capturedHeight = imageData.height
          }
          setPoseStatuses((prev) => {
            const next = [...prev]

            next[i] = 'captured'

            return next
          })

          if (canvas) {
            const ctx2d = canvas.getContext('2d')

            if (ctx2d) {
              if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
                canvas.width = imageData.width
                canvas.height = imageData.height
              }
              ctx2d.putImageData(imageData, 0, 0)
              drawCorners(canvas, corners, cols * rows, true)
            }
          }
        } else {
          setPoseStatuses((prev) => {
            const next = [...prev]

            next[i] = 'missed'

            return next
          })
        }
      } catch {
        setPoseStatuses((prev) => {
          const next = [...prev]

          next[i] = 'missed'

          return next
        })
      }
    }

    cleanup()

    if (cancelRef.current) {
      setStep('idle')

      return
    }

    if (imagePointsList.length < MIN_CAPTURES) {
      setErrorMsg(t.tooFewCaptures)
      setStep('idle')

      return
    }

    setStep('computing')

    const imageWidth = capturedWidth || 640
    const imageHeight = capturedHeight || 480

    try {
      const objPtsVec = new cv.MatVector()
      const imgPtsVec = new cv.MatVector()
      const cameraMatrix = cv.Mat.eye(3, 3, cv.CV_64F)

      // Initialise with a reasonable focal length guess and centred principal point.
      // Identity (fx=1, cx=0) is a terrible starting point and causes divergence.
      const distCoeffs = cv.Mat.zeros(5, 1, cv.CV_64F)
      const rvecs = new cv.MatVector()
      const tvecs = new cv.MatVector()
      const stdDevIntrinsics = new cv.Mat()
      const stdDevExtrinsics = new cv.Mat()
      const perViewErrors = new cv.Mat()
      const imageSize = new cv.Size(imageWidth, imageHeight)
      let rms = 0

      cameraMatrix.data64F[0] = imageWidth // fx ≈ image width
      cameraMatrix.data64F[4] = imageWidth // fy ≈ image width
      cameraMatrix.data64F[2] = imageWidth / 2
      cameraMatrix.data64F[5] = imageHeight / 2

      for (const { corners, cols, rows } of imagePointsList) {
        const objPt = buildObjectPoints(cv, cols, rows)
        const imgPt = cv.matFromArray(cols * rows, 1, cv.CV_32FC2, corners)

        objPtsVec.push_back(objPt)
        objPt.delete()
        imgPtsVec.push_back(imgPt)
        imgPt.delete()
      }

      console.log(`[calib] ${imagePointsList.length} captures, imageSize=${imageWidth}×${imageHeight}`)

      try {
        rms = cv.calibrateCameraExtended(objPtsVec, imgPtsVec, imageSize, cameraMatrix, distCoeffs, rvecs, tvecs, stdDevIntrinsics, stdDevExtrinsics, perViewErrors)
        console.log(
          `[calib] RMS=${rms.toFixed(3)} per-view errors: ${Array.from(perViewErrors.data64F as Float64Array)
            .map((v) => v.toFixed(1))
            .join(', ')}`,
        )
      } finally {
        objPtsVec.delete()
        imgPtsVec.delete()
        rvecs.delete()
        tvecs.delete()
        stdDevIntrinsics.delete()
        stdDevExtrinsics.delete()
        perViewErrors.delete()
        // imageSize is cv.Size — no .delete()
      }

      const d = cameraMatrix.data64F
      const k = distCoeffs.data64F

      cameraMatrix.delete()
      distCoeffs.delete()

      const result: CameraCalibration = {
        fx: d[0],
        fy: d[4],
        cx: d[2],
        cy: d[5],
        distCoeffs: [k[0], k[1], k[2], k[3], k[4]],
        imageWidth,
        imageHeight,
        reprojectionError: rms,
        capturedAt: new Date().toISOString(),
      }

      setCalibResult(result)
      setStep('result')
    } catch {
      setErrorMsg(t.calibrationFailed)
      setStep('idle')
    }
  }, [context, opencvSvc, poses, t])

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!calibResult || !robotId) {
      return
    }

    try {
      const listRes = await context.apiFetch('/api/robot/my')
      const { data: robots } = await listRes.json()
      const robot = (robots as Array<{ id: string; calibration: Record<string, unknown> }>).find((r) => r.id === robotId)
      const existing = robot?.calibration ?? { version: 1, motors: {} }
      const merged = { ...existing, camera: calibResult }
      const svc = context.service('camera-calibration') as CameraCalibrationService | null

      await context.apiFetch(`/api/robot/my/${robotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: merged }),
      })

      svc?.setCalibration(calibResult)
      setStep('saved')
    } catch {
      context.toast.error(t.saveFailed)
    }
  }, [calibResult, context, robotId, t])

  const rmsLabel = (rms: number) => {
    if (rms < 1.0) {
      return t.rmsGood
    }
    if (rms < 2.0) {
      return t.rmsWarning
    }

    return t.rmsError
  }

  // ── Idle step ─────────────────────────────────────────────────────────

  if (step === 'idle') {
    const canStart = isConnected && opencvReady && poses !== null && calibration !== null

    return (
      <div className="flex flex-1 items-start justify-center pt-12 px-4">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{errorMsg}</p>
            </div>
          )}

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <PrereqRow ok={isConnected} label={isConnected ? 'Robot connected' : t.notConnected} />
            <PrereqRow ok={opencvReady} label={opencvReady ? 'OpenCV ready' : t.opencvNotReady} />
            {isConnected && <PrereqRow ok={calibration !== null} label={calibration !== null ? 'Robot calibrated' : t.notCalibrated} />}
          </div>

          {!isConnected ? (
            <Button onClick={context.openConnectDialog}>{t.connectButton}</Button>
          ) : (
            <Button
              disabled={!canStart}
              onClick={() => {
                setErrorMsg(null)
                setStep('setup')
              }}
            >
              {t.startButton}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── Setup step ────────────────────────────────────────────────────────

  if (step === 'setup') {
    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0 lg:flex-row">
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }} />

        <div className="relative flex-1 min-h-[40vh] rounded-lg border bg-black overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas ref={previewRef} style={{ width: '100%', height: 'auto', maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
          </div>
        </div>

        <div className="space-y-4 lg:shrink-0" style={{ maxWidth: '260px' }}>
          <h2 className="text-lg font-semibold">{t.setupTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.setupDesc}</p>

          {context.cameras.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.selectCamera}</p>
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

          <Button variant="outline" onClick={handleDetect} disabled={!selectedCamera || !opencvReady}>
            {t.detectButton}
          </Button>

          {detectResult !== 'none' && (
            <p className={['text-sm font-medium', detectResult === 'found' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'].join(' ')}>
              {detectResult === 'found' ? t.boardFound : t.boardNotFound}
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.poseRange}</p>
              <span className="text-xs text-muted-foreground">{Math.round(poseScale * 100)}%</span>
            </div>
            <input type="range" min={0.2} max={1.0} step={0.1} value={poseScale} onChange={(e) => setPoseScale(Number(e.target.value))} className="w-full accent-primary" />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep('idle')}>
              {t.cancelButton}
            </Button>
            <Button disabled={!selectedCamera} onClick={() => setStep('confirm')}>
              {t.continueButton}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirm step ──────────────────────────────────────────────────────

  if (step === 'confirm') {
    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0 lg:flex-row">
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }} />

        <div className="relative flex-1 min-h-[40vh] rounded-lg border bg-black overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas ref={previewRef} style={{ width: '100%', height: 'auto', maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
          </div>
        </div>

        <div className="space-y-4 lg:shrink-0" style={{ maxWidth: '260px' }}>
          <h2 className="text-lg font-semibold">{t.confirmTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.confirmDesc}</p>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep('setup')}>
              {t.cancelButton}
            </Button>
            <Button onClick={runCapture}>{t.beginButton}</Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Capturing step ────────────────────────────────────────────────────

  if (step === 'capturing') {
    const captured = poseStatuses.filter((s) => s === 'captured').length
    const total = poseStatuses.length
    const pct = total > 0 ? Math.round((captured / total) * 100) : 0

    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0 lg:flex-row">
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }} />

        <div className="relative flex-1 min-h-[40vh] rounded-lg border bg-black overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <canvas ref={previewRef} style={{ width: '100%', height: 'auto', maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
          </div>
        </div>

        <div className="space-y-4 lg:shrink-0 overflow-y-auto" style={{ maxWidth: '260px', maxHeight: '80vh' }}>
          <h2 className="text-lg font-semibold">{t.capturingTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.capturingDesc}</p>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {captured} / {total}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="space-y-1">
            {poseStatuses.map((status, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <PoseStatusDot status={status} />
                <span className="text-muted-foreground">
                  {t.poseLabel} {i + 1}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{statusLabel(status, t)}</span>
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            onClick={() => {
              cancelRef.current = true
            }}
          >
            {t.cancelButton}
          </Button>
        </div>
      </div>
    )
  }

  // ── Computing step ────────────────────────────────────────────────────

  if (step === 'computing') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
          <h2 className="text-lg font-semibold">{t.computingTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.computingDesc}</p>
        </div>
      </div>
    )
  }

  // ── Result step ───────────────────────────────────────────────────────

  if (step === 'result' && calibResult) {
    const rms = calibResult.reprojectionError

    return (
      <div className="flex flex-1 items-start justify-center pt-12 px-4">
        <div className="w-full max-w-md space-y-6">
          <h2 className="text-xl font-semibold">{t.resultTitle}</h2>

          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{t.rmsLabel}:</span>
              <span className={['text-sm font-mono font-semibold', rmsColor(rms)].join(' ')}>{rms.toFixed(3)} px</span>
            </div>
            <p className={['text-xs', rmsColor(rms)].join(' ')}>{rmsLabel(rms)}</p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <table className="w-full text-sm font-mono">
              <tbody>
                <IntrinsicRow label={t.fxLabel} value={calibResult.fx.toFixed(2)} />
                <IntrinsicRow label={t.fyLabel} value={calibResult.fy.toFixed(2)} />
                <IntrinsicRow label={t.cxLabel} value={calibResult.cx.toFixed(2)} />
                <IntrinsicRow label={t.cyLabel} value={calibResult.cy.toFixed(2)} />
                <IntrinsicRow label={t.distLabel} value={calibResult.distCoeffs.map((v) => v.toFixed(4)).join(', ')} />
                <IntrinsicRow label={t.imageSizeLabel} value={`${calibResult.imageWidth} × ${calibResult.imageHeight}`} />
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('idle')}>
              {t.retakeButton}
            </Button>
            <Button onClick={handleSave}>{t.saveButton}</Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Saved step ────────────────────────────────────────────────────────

  if (step === 'saved') {
    return (
      <div className="flex flex-1 items-start justify-center pt-12 px-4">
        <div className="w-full max-w-md space-y-6">
          <h2 className="text-xl font-semibold">{t.savedTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.savedDesc}</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('idle')}>
              {t.retakeButton}
            </Button>
            <Button onClick={() => setStep('idle')}>{t.doneButton}</Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── Small helper components ───────────────────────────────────────────

function PrereqRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={['w-2.5 h-2.5 rounded-full shrink-0', ok ? 'bg-green-500' : 'bg-muted-foreground'].join(' ')} />
      <span className="text-sm">{label}</span>
    </div>
  )
}

function PoseStatusDot({ status }: { status: PoseStatus }) {
  const color = {
    pending: 'bg-muted-foreground',
    moving: 'bg-yellow-500 animate-pulse',
    captured: 'bg-green-500',
    missed: 'bg-red-500',
  }[status]

  return <span className={['w-2 h-2 rounded-full shrink-0', color].join(' ')} />
}

function IntrinsicRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 pr-4 text-muted-foreground text-xs">{label}</td>
      <td className="py-1.5 text-right">{value}</td>
    </tr>
  )
}

function statusLabel(s: PoseStatus, t: ReturnType<(typeof translations)['en'] extends infer T ? () => T : never>) {
  return ({ pending: t.posePending, moving: t.poseMoving, captured: t.poseCaptured, missed: t.poseMissed } as Record<PoseStatus, string>)[s]
}
