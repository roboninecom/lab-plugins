import type { PluginServiceContext, PluginServiceFactory } from '@robonine/plugin-sdk'

export interface ArucoDetection {
  id: number
  /** Four corners in image-pixel space, top-left going clockwise: [[x,y], …] */
  corners: [[number, number], [number, number], [number, number], [number, number]]
}

export interface ArucoService {
  /** Resolves when OpenCV and the ArUco module are ready. */
  ready: Promise<void>
  /**
   * Detect ArUco markers in an ImageData frame.
   * `dictId` is the OpenCV predefined dictionary integer (default: DICT_4X4_50 = 0).
   * Returns an empty array when OpenCV is not yet ready or detection fails.
   */
  detectMarkers(imageData: ImageData, dictId?: number): ArucoDetection[]
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

function runDetection(cv: CV, imageData: ImageData, dictId: number): ArucoDetection[] {
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

      detector.detectMarkers(gray, corners, ids, rejected)

      for (let i = 0; i < ids.rows; i++) {
        const id = ids.data32S[i]
        const corner = corners.get(i)

        result.push({
          id,
          corners: [
            [corner.data32F[0], corner.data32F[1]],
            [corner.data32F[2], corner.data32F[3]],
            [corner.data32F[4], corner.data32F[5]],
            [corner.data32F[6], corner.data32F[7]],
          ],
        })

        corner.delete()
      }

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
    detectMarkers(imageData: ImageData, dictId = ARUCO_DICTS['4X4_50']): ArucoDetection[] {
      const cv = opencv?.getCv() as CV | undefined

      if (!cv) {
        return []
      }

      try {
        return runDetection(cv, imageData, dictId)
      } catch (e) {
        console.error('[aruco] detection error:', e)

        return []
      }
    },
  }

  return service
}
