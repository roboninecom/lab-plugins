import { createCharucoBoard, destroyCharucoBoard, detectCharucoCorners, isCharucoSupported, objectPointsForIds } from './calibration'
import type { CameraHandle, CameraViewHandle, PluginContext } from '@robonine/plugin-sdk'
import type { CameraCalibration, CameraCalibrationService } from './service'
import type { CharucoBoardConfig, CharucoBoardHandle } from './calibration'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// ChArUco board: 8 squares × 5 squares with a nominal 35 mm square. The printed
// PDF includes a 50 mm reference bar; the user measures it after printing and
// we scale the nominal square size by the printer's actual scale factor.
const BOARD_GEOMETRY = { squaresX: 8, squaresY: 5 }
const NOMINAL_SQUARE_MM = 35
const NOMINAL_SAMPLE_MM = 50
// Marker length is always 0.7 × square length on this generator.
const MARKER_RATIO = 0.7
// OpenCV predefined dictionary id matching the printed board (DICT_ARUCO_MIP_36h12).
const DICT_ID = 21
const MIN_CORNERS_PER_VIEW = 8
const MIN_CAPTURES = 10
const SETTLE_MS = 2000

interface Props {
  context: PluginContext
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
  const [poseScale, setPoseScale] = useState(0.5)
  const [lensType, setLensType] = useState<'standard' | 'wide-angle'>('wide-angle')
  const [sampleMm, setSampleMm] = useState<number>(NOMINAL_SAMPLE_MM)

  const boardCfg = useMemo<CharucoBoardConfig>(() => {
    const squareMm = (NOMINAL_SQUARE_MM * sampleMm) / NOMINAL_SAMPLE_MM

    return {
      ...BOARD_GEOMETRY,
      squareLength: squareMm / 1000,
      markerLength: (squareMm * MARKER_RATIO) / 1000,
      dictId: DICT_ID,
    }
  }, [sampleMm])

  const [calibResult, setCalibResult] = useState<CameraCalibration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const cameraViewRef = useRef<CameraViewHandle>(null)
  const cancelRef = useRef(false)
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

  const { Button, CameraView } = context.ui

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
    if (!selectedCamera) {
      return
    }
    // Request the highest resolution the camera supports. applyConstraints
    // modifies the existing track in-place — no second stream needed.
    selectedCamera.stream
      .getVideoTracks()[0]
      ?.applyConstraints({ width: { ideal: 9999 }, height: { ideal: 9999 } })
      .catch(() => {})
  }, [selectedCamera])

  // ── Helpers ───────────────────────────────────────────────────────────

  function toGray(cv: CV, imageData: ImageData): CV {
    const src = cv.matFromImageData(imageData)
    const gray = new cv.Mat()

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    src.delete()

    return gray
  }

  function findCorners(cv: CV, imageData: ImageData, board: CharucoBoardHandle): { found: boolean; corners: Float32Array; ids: Int32Array } {
    const gray = toGray(cv, imageData)

    try {
      const result = detectCharucoCorners(cv, gray, board, MIN_CORNERS_PER_VIEW)

      if (!result) {
        return { found: false, corners: new Float32Array(), ids: new Int32Array() }
      }

      return { found: true, ...result }
    } finally {
      gray.delete()
    }
  }

  // ── Board detection test (setup step) ────────────────────────────────

  const handleDetect = useCallback(() => {
    const cv = opencvSvc?.getCv() as CV | undefined
    const imageData = cameraViewRef.current?.captureFrame() ?? null

    if (!cv) {
      console.error('[camera-calib] handleDetect: OpenCV not ready')
      setDetectResult('notfound')

      return
    }

    if (!imageData) {
      console.error('[camera-calib] handleDetect: captureFrame returned null — video not streaming?')
      setDetectResult('notfound')

      return
    }

    if (!isCharucoSupported(cv)) {
      console.error('[camera-calib] handleDetect: isCharucoSupported=false — aruco_CharucoBoard:', typeof cv.aruco_CharucoBoard, 'aruco_CharucoDetector:', typeof cv.aruco_CharucoDetector)
      setDetectResult('notfound')

      return
    }

    const board = createCharucoBoard(cv, boardCfg)

    try {
      const { found, corners, ids } = findCorners(cv, imageData, board)
      const canvas = cameraViewRef.current?.canvas ?? null

      setDetectResult(found ? 'found' : 'notfound')

      if (canvas && found) {
        drawCorners(canvas, corners, ids.length, true)
      }
    } catch (err) {
      console.error('[camera-calib] handleDetect: detection threw', err)
      setDetectResult('notfound')
    } finally {
      destroyCharucoBoard(board)
    }
  }, [boardCfg, opencvSvc])

  // ── Capture loop ──────────────────────────────────────────────────────

  const runCapture = useCallback(async () => {
    const cv = opencvSvc?.getCv() as CV | undefined
    const confirmed = await context.showSafetyWarning()
    const cleanup = context.servo.registerEmergencyStop()
    const imagePointsList: { corners: Float32Array; ids: Int32Array }[] = []
    const capturedMirrorH = cameraViewRef.current?.mirrorH ?? false
    const capturedMirrorV = cameraViewRef.current?.mirrorV ?? false
    const capturedCameraName = selectedCamera?.label
    let capturedWidth = 0
    let capturedHeight = 0

    if (!poses || !cv) {
      return
    }

    if (!isCharucoSupported(cv)) {
      cleanup()
      setErrorMsg(t.charucoNotSupported)
      setStep('idle')

      return
    }

    if (!confirmed) {
      setStep('confirm')

      return
    }

    const board = createCharucoBoard(cv, boardCfg)

    cancelRef.current = false
    setPoseStatuses(poses.map(() => 'pending' as PoseStatus))
    setStep('capturing')

    await context.servo.limitSpeed(300)

    for (let i = 0; i < poses.length; i++) {
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
        // First pose moves from neutral — potentially a large travel; allow extra settle time.
        await new Promise<void>((resolve) => setTimeout(resolve, i === 0 ? SETTLE_MS * 2 : SETTLE_MS))
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

      // Pose 0 is a hidden warmup — just move and settle, no capture or detection.
      if (i === 0) {
        continue
      }

      // eslint-disable-next-line local/decls-on-top
      const imageData = cameraViewRef.current?.captureFrame() ?? null

      if (!imageData) {
        setPoseStatuses((prev) => {
          const next = [...prev]

          next[i] = 'missed'

          return next
        })
        continue
      }

      try {
        let result = findCorners(cv, imageData, board)
        let finalData = imageData

        if (!result.found) {
          // Extra settle then retry with a fresh frame
          await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))

          // eslint-disable-next-line local/decls-on-top
          const retryData = cameraViewRef.current?.captureFrame() ?? null

          if (retryData) {
            const retryResult = findCorners(cv, retryData, board)

            if (retryResult.found) {
              result = retryResult
              finalData = retryData
            }
          }
        }

        const { found, corners, ids } = result

        if (found) {
          const canvas = cameraViewRef.current?.canvas ?? null

          console.log(`[capture ${imagePointsList.length}] pose=${i} corners=${ids.length}`)
          imagePointsList.push({ corners, ids })
          if (!capturedWidth) {
            capturedWidth = finalData.width
            capturedHeight = finalData.height
          }
          setPoseStatuses((prev) => {
            const next = [...prev]

            next[i] = 'captured'

            return next
          })

          if (canvas) {
            const ctx2d = canvas.getContext('2d')

            if (ctx2d) {
              if (canvas.width !== finalData.width || canvas.height !== finalData.height) {
                canvas.width = finalData.width
                canvas.height = finalData.height
              }
              ctx2d.putImageData(finalData, 0, 0)
              drawCorners(canvas, corners, ids.length, true)
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
    destroyCharucoBoard(board)

    if (cancelRef.current) {
      setStep('idle')

      return
    }

    if (imagePointsList.length < MIN_CAPTURES) {
      setErrorMsg(t.tooFewCaptures)
      setStep('idle')

      return
    }

    const imageWidth = capturedWidth || 640
    const imageHeight = capturedHeight || 480

    setStep('computing')
    // Yield so React can paint the computing screen before WASM blocks the thread
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    try {
      const imageSize = new cv.Size(imageWidth, imageHeight)

      console.log(`[calib] ${imagePointsList.length} captures, imageSize=${imageWidth}×${imageHeight}, mode=${lensType}`)

      if (lensType === 'wide-angle') {
        // Rational model — adds k4, k5, k6 to the standard polynomial.
        // Suitable for cameras with FOV up to ~120°.
        // CALIB_RATIONAL_MODEL = 16384
        const CALIB_FLAGS = 16384
        const objPtsVec = new cv.MatVector()
        const imgPtsVec = new cv.MatVector()
        const cam = cv.Mat.eye(3, 3, cv.CV_64F)
        const dist = cv.Mat.zeros(8, 1, cv.CV_64F)
        const rvecs = new cv.MatVector()
        const tvecs = new cv.MatVector()
        const stdI = new cv.Mat()
        const stdE = new cv.Mat()
        const pve = new cv.Mat()

        cam.data64F[0] = imageWidth
        cam.data64F[4] = imageWidth
        cam.data64F[2] = imageWidth / 2
        cam.data64F[5] = imageHeight / 2

        for (const { corners, ids } of imagePointsList) {
          const op = objectPointsForIds(cv, ids, boardCfg)
          const ip = cv.matFromArray(ids.length, 1, cv.CV_32FC2, corners)

          objPtsVec.push_back(op)
          op.delete()
          imgPtsVec.push_back(ip)
          ip.delete()
        }

        try {
          const rms = cv.calibrateCameraExtended(objPtsVec, imgPtsVec, imageSize, cam, dist, rvecs, tvecs, stdI, stdE, pve, CALIB_FLAGS)
          const fx = cam.data64F[0]
          const fy = cam.data64F[4]
          const cx = cam.data64F[2]
          const cy = cam.data64F[5]
          const distCoeffs = Array.from(dist.data64F.slice(0, 8))

          console.log(`[calib] wide-angle RMS=${rms.toFixed(3)}`)
          setCalibResult({
            model: 'wide-angle',
            fx,
            fy,
            cx,
            cy,
            distCoeffs,
            imageWidth,
            imageHeight,
            reprojectionError: rms,
            capturedAt: new Date().toISOString(),
            cameraName: capturedCameraName,
            mirrorH: capturedMirrorH,
            mirrorV: capturedMirrorV,
          })
          setStep('result')
        } finally {
          objPtsVec.delete()
          imgPtsVec.delete()
          cam.delete()
          dist.delete()
          rvecs.delete()
          tvecs.delete()
          stdI.delete()
          stdE.delete()
          pve.delete()
        }
      } else {
        // Standard pinhole — two-pass with outlier rejection.
        const CALIB_FLAGS = 0

        const runCalib = (list: typeof imagePointsList) => {
          const objPtsVec = new cv.MatVector()
          const imgPtsVec = new cv.MatVector()
          const cam = cv.Mat.eye(3, 3, cv.CV_64F)
          const dist = cv.Mat.zeros(5, 1, cv.CV_64F)
          const rvecs = new cv.MatVector()
          const tvecs = new cv.MatVector()
          const stdI = new cv.Mat()
          const stdE = new cv.Mat()
          const pve = new cv.Mat()

          cam.data64F[0] = imageWidth
          cam.data64F[4] = imageWidth
          cam.data64F[2] = imageWidth / 2
          cam.data64F[5] = imageHeight / 2

          for (const { corners, ids } of list) {
            const op = objectPointsForIds(cv, ids, boardCfg)
            const ip = cv.matFromArray(ids.length, 1, cv.CV_32FC2, corners)

            objPtsVec.push_back(op)
            op.delete()
            imgPtsVec.push_back(ip)
            ip.delete()
          }

          try {
            const rms = cv.calibrateCameraExtended(objPtsVec, imgPtsVec, imageSize, cam, dist, rvecs, tvecs, stdI, stdE, pve, CALIB_FLAGS)
            const errors = Array.from(pve.data64F as Float64Array)

            return { rms, cam, dist, errors }
          } finally {
            objPtsVec.delete()
            imgPtsVec.delete()
            rvecs.delete()
            tvecs.delete()
            stdI.delete()
            stdE.delete()
            pve.delete()
          }
        }

        const pass1 = runCalib(imagePointsList)

        console.log(`[calib] pass1 RMS=${pass1.rms.toFixed(3)} per-view: ${pass1.errors.map((v) => v.toFixed(1)).join(', ')}`)
        pass1.cam.delete()
        pass1.dist.delete()

        if (pass1.rms > 20) {
          console.log(`[calib] pass1 did not converge (RMS=${pass1.rms.toFixed(1)}px > 20px), giving up`)
          setErrorMsg(t.calibrationFailed)
          setStep('idle')

          return
        }

        const sorted = [...pass1.errors].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const threshold = Math.max(median * 3, 2)
        const inliers = imagePointsList.filter((_, i) => pass1.errors[i] <= threshold)

        console.log(`[calib] outlier filter median=${median.toFixed(1)}px threshold=${threshold.toFixed(1)}px → ${inliers.length}/${pass1.errors.length} inliers`)

        if (inliers.length < MIN_CAPTURES) {
          setErrorMsg(t.calibrationFailed)
          setStep('idle')

          return
        }

        const pass2 = runCalib(inliers)

        console.log(`[calib] pass2 RMS=${pass2.rms.toFixed(3)} per-view: ${pass2.errors.map((v) => v.toFixed(1)).join(', ')}`)

        // Extract before delete() — TypedArray view into WASM memory is invalidated after free.
        const fx = pass2.cam.data64F[0]
        const fy = pass2.cam.data64F[4]
        const cx = pass2.cam.data64F[2]
        const cy = pass2.cam.data64F[5]
        const distCoeffs = Array.from(pass2.dist.data64F.slice(0, 5))

        pass2.cam.delete()
        pass2.dist.delete()

        setCalibResult({
          model: 'standard',
          fx,
          fy,
          cx,
          cy,
          distCoeffs,
          imageWidth,
          imageHeight,
          reprojectionError: pass2.rms,
          capturedAt: new Date().toISOString(),
          cameraName: capturedCameraName,
          mirrorH: capturedMirrorH,
          mirrorV: capturedMirrorV,
        })
        setStep('result')
      }
    } catch (err) {
      console.error('[camera-calib] calibration threw', err)
      setErrorMsg(t.calibrationFailed)
      setStep('idle')
    }
  }, [boardCfg, context, lensType, opencvSvc, poses, selectedCamera, t])

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!calibResult || !robotId) {
      return
    }

    try {
      const svc = context.service('camera-calibration') as CameraCalibrationService | null

      await context.saveCameraCalibration(calibResult)

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
        <CameraView canvasMode stream={selectedCamera?.stream} ref={cameraViewRef} className="flex-1 min-h-[40vh]" />

        <div className="space-y-4 lg:shrink-0" style={{ maxWidth: '260px' }}>
          <h2 className="text-lg font-semibold">{t.setupTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {t.setupDesc}{' '}
            <a
              href="https://github.com/roboninecom/lab-plugins/blob/master/robonine/camera-calibration/charuco_8x5_35mm_a4.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {t.setupDownload}
            </a>
          </p>
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

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.lensTypeLabel}</p>
            <div className="flex flex-col gap-1.5">
              {(['standard', 'wide-angle'] as const).map((type) => (
                <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="lensType" value={type} checked={lensType === type} onChange={() => setLensType(type)} className="accent-primary" />
                  <span className="text-sm">{type === 'standard' ? t.lensStandard : t.lensWideAngle}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.squareSizeLabel}</p>
            <input
              type="number"
              min={1}
              max={200}
              step={0.5}
              value={sampleMm}
              onChange={(e) => setSampleMm(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

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
        <CameraView canvasMode stream={selectedCamera?.stream} ref={cameraViewRef} className="flex-1 min-h-[40vh]" />

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
    const visibleStatuses = poseStatuses.slice(1)
    const captured = visibleStatuses.filter((s) => s === 'captured').length
    const total = visibleStatuses.length
    const pct = total > 0 ? Math.round((captured / total) * 100) : 0

    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0 lg:flex-row">
        <CameraView canvasMode stream={selectedCamera?.stream} ref={cameraViewRef} className="flex-1 min-h-[40vh]" />

        <div className="flex flex-col gap-4 lg:shrink-0 min-h-0" style={{ maxWidth: '260px' }}>
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

          <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
            {visibleStatuses.map((status, i) => (
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

  // ── Computing step ───────────────────────────────────────────────────

  if (step === 'computing') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
          <h2 className="text-lg font-semibold">{t.computingTitle}</h2>
        </div>
      </div>
    )
  }

  // ── Result step ───────────────────────────────────────────────────────

  if (step === 'result' && !calibResult) {
    console.error('[camera-calib] step=result but calibResult is null — reverting to idle')
    setStep('idle')

    return null
  }

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
                <IntrinsicRow label={calibResult.model === 'wide-angle' ? t.distWideAngleLabel : t.distLabel} value={calibResult.distCoeffs.map((v) => v.toFixed(4)).join(', ')} />
                <IntrinsicRow label={t.imageSizeLabel} value={`${calibResult.imageWidth} × ${calibResult.imageHeight}`} />
                {calibResult.cameraName && <IntrinsicRow label={t.cameraNameLabel} value={calibResult.cameraName} />}
                <IntrinsicRow label={t.mirrorHLabel} value={calibResult.mirrorH ? 'Yes' : 'No'} />
                <IntrinsicRow label={t.mirrorVLabel} value={calibResult.mirrorV ? 'Yes' : 'No'} />
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
