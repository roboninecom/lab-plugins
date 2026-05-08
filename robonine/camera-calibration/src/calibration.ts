// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

export interface CharucoBoardConfig {
  /** Number of squares horizontally. */
  squaresX: number
  /** Number of squares vertically. */
  squaresY: number
  /** Side length of one chessboard square in metres. */
  squareLength: number
  /** Side length of one ArUco marker in metres (typically ≤ squareLength). */
  markerLength: number
  /** OpenCV predefined dictionary id (e.g. 0 = DICT_4X4_50). */
  dictId: number
  /**
   * Use the legacy (pre-OpenCV-4.6) ChArUco marker placement. Most third-party
   * generators (calib.io, chev.me) still emit the legacy layout. When set, the
   * detector will swap the marker→corner id mapping accordingly.
   */
  legacyPattern?: boolean
}

export interface CharucoBoardHandle {
  board: CV
  dict: CV
  ids: CV
  arucoParams: CV
  refineParams: CV
  charucoParams: CV
  detector: CV
  cfg: CharucoBoardConfig
}

export function isCharucoSupported(cv: CV): boolean {
  return typeof cv?.aruco_CharucoBoard === 'function' && typeof cv?.aruco_CharucoDetector === 'function'
}

export function createCharucoBoard(cv: CV, cfg: CharucoBoardConfig): CharucoBoardHandle {
  const dict = cv.getPredefinedDictionary(cfg.dictId)
  // OpenCV.js binds the 5-arg constructor; the 5th param is an InputArray of
  // marker ids to use. An empty Mat selects ids 0..N-1 (default behaviour).
  const ids = new cv.Mat()
  const board = new cv.aruco_CharucoBoard(new cv.Size(cfg.squaresX, cfg.squaresY), cfg.squareLength, cfg.markerLength, dict, ids)
  const arucoParams = new cv.aruco_DetectorParameters()
  const refineParams = new cv.aruco_RefineParameters(10.0, 3.0, true)
  const charucoParams = new cv.aruco_CharucoParameters()

  if (cfg.legacyPattern && typeof board.setLegacyPattern === 'function') {
    board.setLegacyPattern(true)
  }

  arucoParams.polygonalApproxAccuracyRate = 0.08
  // Allow a wider marker-size range (default min 0.03 of image; markers
  // far from the camera or near image edges fall below).
  arucoParams.minMarkerPerimeterRate = 0.01
  arucoParams.maxMarkerPerimeterRate = 4.0
  // Be slightly more permissive about marker rejection due to perspective.
  arucoParams.minCornerDistanceRate = 0.03

  const detector = new cv.aruco_CharucoDetector(board, charucoParams, arucoParams, refineParams)

  return { board, dict, ids, arucoParams, refineParams, charucoParams, detector, cfg }
}

export function destroyCharucoBoard(handle: CharucoBoardHandle) {
  handle.detector.delete()
  handle.charucoParams.delete()
  handle.refineParams.delete()
  handle.arucoParams.delete()
  handle.board.delete()
  handle.ids.delete()
  handle.dict.delete()
}

function detectOnce(cv: CV, gray: CV, handle: CharucoBoardHandle): { corners: Float32Array; ids: Int32Array; markers: number; markerIds: number[] } {
  const charucoCorners = new cv.Mat()
  const charucoIds = new cv.Mat()
  const markerCorners = new cv.MatVector()
  const markerIds = new cv.Mat()

  try {
    const detectedMarkerIds: number[] = []

    handle.detector.detectBoard(gray, charucoCorners, charucoIds, markerCorners, markerIds)

    // eslint-disable-next-line local/decls-on-top
    const n = charucoIds.rows
    // eslint-disable-next-line local/decls-on-top
    const markers = markerIds.rows
    const corners = new Float32Array(n * 2)
    const ids = new Int32Array(n)

    for (let i = 0; i < n; i++) {
      corners[i * 2] = charucoCorners.data32F[i * 2]
      corners[i * 2 + 1] = charucoCorners.data32F[i * 2 + 1]
      ids[i] = charucoIds.data32S[i]
    }

    for (let i = 0; i < markers; i++) {
      detectedMarkerIds.push(markerIds.data32S[i])
    }

    return { corners, ids, markers, markerIds: detectedMarkerIds }
  } finally {
    charucoCorners.delete()
    charucoIds.delete()
    markerCorners.delete()
    markerIds.delete()
  }
}

/**
 * Detect ChArUco interior corners. Each corner has a stable id, so partial
 * detections are still safe — id → 3D position is unambiguous.
 *
 * Tries both polarities (markers on white and markers on black) and keeps
 * whichever found more corners. Boards printed with inverted colours (light
 * markers on dark squares) only register on the bitwise-not pass.
 *
 * Returns Float32Array of [x0,y0, x1,y1, …] and Int32Array of ids, or null.
 */
export function detectCharucoCorners(cv: CV, gray: CV, handle: CharucoBoardHandle, minCorners = 6): { corners: Float32Array; ids: Int32Array } | null {
  const direct = detectOnce(cv, gray, handle)
  const inv = new cv.Mat()
  let inverted: { corners: Float32Array; ids: Int32Array }

  try {
    cv.bitwise_not(gray, inv)
    inverted = detectOnce(cv, inv, handle)
  } finally {
    inv.delete()
  }

  const best = inverted.ids.length > direct.ids.length ? inverted : direct
  const polarity = inverted.ids.length > direct.ids.length ? 'inverted' : 'direct'

  console.log(`[charuco] markers: direct=${direct.markers} inverted=${inverted.markers} | corners: direct=${direct.ids.length} inverted=${inverted.ids.length}`)
  if (direct.markers > 0) {
    console.log(`[charuco] marker ids (direct): [${direct.markerIds.sort((a, b) => a - b).join(', ')}]`)
  }

  if (best.ids.length < minCorners) {
    return null
  }

  console.log(`[charuco] SUCCESS: ${best.ids.length} corners (${polarity})`)

  return { corners: best.corners, ids: best.ids }
}

/**
 * Map ChArUco corner ids to 3D object points on the board (Z=0 plane).
 * Layout: id = row * (squaresX - 1) + col, row-major from top-left.
 */
export function objectPointsForIds(cv: CV, ids: Int32Array, cfg: CharucoBoardConfig): CV {
  const innerCols = cfg.squaresX - 1
  const pts: number[] = []

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const col = id % innerCols
    const row = Math.floor(id / innerCols)

    pts.push(col * cfg.squareLength, row * cfg.squareLength, 0)
  }

  return cv.matFromArray(ids.length, 1, cv.CV_32FC3, pts)
}
