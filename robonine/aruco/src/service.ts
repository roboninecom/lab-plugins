import type { FKResult, PluginServiceContext, PluginServiceFactory } from '@robonine/plugin-sdk'

export interface ArucoDetection {
  id: number
  /** Four corners in image-pixel space, top-left going clockwise: [[x,y], …] */
  corners: [[number, number], [number, number], [number, number], [number, number]]
  /** Populated when `markerSize` is provided in the detect options. */
  pose?: MarkerPose
}

export interface MarkerPose {
  /** Rodrigues rotation vector of the marker in camera frame. */
  rvec: [number, number, number]
  /** Translation of the marker centre in camera frame (metres). */
  tvec: [number, number, number]
  /**
   * Marker centre in URDF world frame (metres).
   * Only present when `cameraPose` was supplied in the detect options.
   */
  worldPosition?: [number, number, number]
  /**
   * 3×3 rotation matrix (row-major) of the marker in URDF world frame.
   * Only present when `cameraPose` was supplied in the detect options.
   */
  worldRotation?: [[number, number, number], [number, number, number], [number, number, number]]
}

export interface CameraIntrinsics {
  fx: number
  fy: number
  /** Principal point x (pixels). */
  cx: number
  /** Principal point y (pixels). */
  cy: number
  /** Distortion coefficients [k1, k2, p1, p2, k3]. Defaults to zeros. */
  distCoeffs?: [number, number, number, number, number]
}

export interface ArucoDetectOptions {
  /** OpenCV predefined dictionary integer (default: DICT_4X4_50 = 0). */
  dictId?: number
  /**
   * Physical side length of the marker in metres.
   * Required to populate the `pose` field on each detection.
   */
  markerSize?: number
  /**
   * Camera intrinsic parameters. When omitted alongside `markerSize`, focal
   * length is approximated as `0.8 * max(imageWidth, imageHeight)` and the
   * principal point is the image centre.
   */
  cameraIntrinsics?: CameraIntrinsics
  /**
   * Camera pose in the URDF world frame.
   * Obtain via `context.kinematics.forwardKinematics(jointAngles, 'camera_virtual')`.
   * When present, `pose.worldPosition` and `pose.worldRotation` are populated.
   */
  cameraPose?: FKResult
}

export interface ArucoService {
  /** Resolves when OpenCV and the ArUco module are ready. */
  ready: Promise<void>
  /**
   * Detect ArUco markers in an ImageData frame.
   * Pass `options.markerSize` (metres) to also compute per-marker pose.
   * Pass `options.cameraPose` (from `context.kinematics.forwardKinematics`) to
   * additionally get world-frame position and rotation for each marker.
   * Returns an empty array when OpenCV is not yet ready or detection fails.
   */
  detectMarkers(imageData: ImageData, options?: ArucoDetectOptions): ArucoDetection[]
}

/** OpenCV predefined dictionary IDs. Values match cv::aruco::PREDEFINED_DICTIONARY_NAME. */
export const ARUCO_DICTS = {
  '4X4_50': 0,
  '4X4_100': 1,
  '4X4_250': 2,
  '4X4_1000': 3,
  '5X5_50': 4,
  '5X5_100': 5,
  '5X5_250': 6,
  '5X5_1000': 7,
  '6X6_50': 8,
  '6X6_100': 9,
  '6X6_250': 10,
  '6X6_1000': 11,
  '7X7_50': 12,
  '7X7_100': 13,
  '7X7_250': 14,
  '7X7_1000': 15,
  ORIGINAL: 16,
  ARUCO_MIP_36h12: 21,
} as const

export type ArucoDictKey = keyof typeof ARUCO_DICTS

interface OpenCVHandle {
  ready: Promise<void>
  getCv(): unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

function ensureArucoSupport(): Promise<void> {
  const cv = (window as Record<string, unknown>)['cv'] as Record<string, unknown> | undefined

  if (cv && typeof cv['getPredefinedDictionary'] === 'function') {
    return Promise.resolve()
  }

  return Promise.reject(new Error('ArUco is not available in the loaded OpenCV build'))
}

function buildMarkerPose(cv: CV, rvec: CV, tvec: CV, cameraPose: FKResult | undefined): MarkerPose {
  const rv: [number, number, number] = [rvec.data64F[0], rvec.data64F[1], rvec.data64F[2]]
  const tv: [number, number, number] = [tvec.data64F[0], tvec.data64F[1], tvec.data64F[2]]
  const pose: MarkerPose = { rvec: rv, tvec: tv }

  if (cameraPose) {
    const R = cameraPose.rotation
    const P = cameraPose.position
    const [tx, ty, tz] = tv
    const rmat = new cv.Mat()

    pose.worldPosition = [R[0][0] * tx + R[0][1] * ty + R[0][2] * tz + P[0], R[1][0] * tx + R[1][1] * ty + R[1][2] * tz + P[1], R[2][0] * tx + R[2][1] * ty + R[2][2] * tz + P[2]]

    try {
      cv.Rodrigues(rvec, rmat)

      // rmat is row-major 3×3 float64; read after Rodrigues fills the buffer
      pose.worldRotation = [
        [
          R[0][0] * rmat.data64F[0] + R[0][1] * rmat.data64F[3] + R[0][2] * rmat.data64F[6],
          R[0][0] * rmat.data64F[1] + R[0][1] * rmat.data64F[4] + R[0][2] * rmat.data64F[7],
          R[0][0] * rmat.data64F[2] + R[0][1] * rmat.data64F[5] + R[0][2] * rmat.data64F[8],
        ],
        [
          R[1][0] * rmat.data64F[0] + R[1][1] * rmat.data64F[3] + R[1][2] * rmat.data64F[6],
          R[1][0] * rmat.data64F[1] + R[1][1] * rmat.data64F[4] + R[1][2] * rmat.data64F[7],
          R[1][0] * rmat.data64F[2] + R[1][1] * rmat.data64F[5] + R[1][2] * rmat.data64F[8],
        ],
        [
          R[2][0] * rmat.data64F[0] + R[2][1] * rmat.data64F[3] + R[2][2] * rmat.data64F[6],
          R[2][0] * rmat.data64F[1] + R[2][1] * rmat.data64F[4] + R[2][2] * rmat.data64F[7],
          R[2][0] * rmat.data64F[2] + R[2][1] * rmat.data64F[5] + R[2][2] * rmat.data64F[8],
        ],
      ]
    } finally {
      rmat.delete()
    }
  }

  return pose
}

function runDetection(cv: CV, imageData: ImageData, options: ArucoDetectOptions): ArucoDetection[] {
  const dictId = options.dictId ?? ARUCO_DICTS['4X4_50']
  const mat = cv.matFromImageData(imageData)
  const gray = new cv.Mat()

  try {
    const corners = new cv.MatVector()
    const ids = new cv.Mat()
    const rejected = new cv.MatVector()

    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY)

    try {
      const dict = cv.getPredefinedDictionary(dictId)
      const params = new cv.aruco_DetectorParameters()
      const refine = new cv.aruco_RefineParameters(10.0, 3.0, true)
      const detector = new cv.aruco_ArucoDetector(dict, params, refine)
      const result: ArucoDetection[] = []
      const { markerSize, cameraIntrinsics, cameraPose } = options
      let camMat: CV | null = null
      let distMat: CV | null = null

      detector.detectMarkers(gray, corners, ids, rejected)

      const doPose = markerSize !== undefined

      if (doPose) {
        const w = imageData.width
        const h = imageData.height
        const fx = cameraIntrinsics?.fx ?? 0.8 * Math.max(w, h)
        const fy = cameraIntrinsics?.fy ?? fx
        const ppx = cameraIntrinsics?.cx ?? w / 2
        const ppy = cameraIntrinsics?.cy ?? h / 2
        const dist = cameraIntrinsics?.distCoeffs ?? [0, 0, 0, 0, 0]

        camMat = cv.matFromArray(3, 3, cv.CV_64F, [fx, 0, ppx, 0, fy, ppy, 0, 0, 1])
        distMat = cv.matFromArray(5, 1, cv.CV_64F, dist)
      }

      for (let i = 0; i < ids.rows; i++) {
        const id = ids.data32S[i]
        const corner = corners.get(i)
        const c = corner.data32F

        const detection: ArucoDetection = {
          id,
          corners: [
            [c[0], c[1]],
            [c[2], c[3]],
            [c[4], c[5]],
            [c[6], c[7]],
          ],
        }

        if (doPose && camMat && distMat && markerSize !== undefined) {
          const half = markerSize / 2
          // Object points: marker corners in marker frame (z=0 plane), top-left clockwise.
          const objPts = cv.matFromArray(4, 1, cv.CV_64FC3, [-half, half, 0, half, half, 0, half, -half, 0, -half, -half, 0])
          const imgPts = cv.matFromArray(4, 1, cv.CV_64FC2, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])
          const rvec = new cv.Mat()
          const tvec = new cv.Mat()

          try {
            cv.solvePnP(objPts, imgPts, camMat, distMat, rvec, tvec)
            detection.pose = buildMarkerPose(cv, rvec, tvec, cameraPose)
          } catch {
            // solvePnP can fail for degenerate (near-collinear) corners
          } finally {
            objPts.delete()
            imgPts.delete()
            rvec.delete()
            tvec.delete()
          }
        }

        result.push(detection)
        corner.delete()
      }

      camMat?.delete()
      distMat?.delete()

      detector.delete()
      refine.delete()
      dict.delete()
      params.delete()

      return result
    } finally {
      corners.delete()
      ids.delete()
      rejected.delete()
    }
  } finally {
    mat.delete()
    gray.delete()
  }
}

export const PluginService: PluginServiceFactory = (context: PluginServiceContext) => {
  const opencv = context.service('opencv') as OpenCVHandle | null
  const ready: Promise<void> = opencv ? opencv.ready.then(() => ensureArucoSupport()) : Promise.reject(new Error('opencv service unavailable'))

  // Prevent unhandled-rejection noise when the caller checks .ready themselves.
  ready.catch(() => {})

  const service: ArucoService = {
    ready,
    detectMarkers(imageData: ImageData, options: ArucoDetectOptions = {}): ArucoDetection[] {
      const cv = opencv?.getCv() as CV | undefined

      if (!cv) {
        return []
      }

      try {
        return runDetection(cv, imageData, options)
      } catch (e) {
        console.error('[aruco] detection error:', e)

        return []
      }
    },
  }

  return service
}
