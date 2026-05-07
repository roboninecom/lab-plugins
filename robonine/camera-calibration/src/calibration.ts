// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

/**
 * Detect inner checkerboard corners using available OpenCV 4.13.0 functions.
 *
 * Two approaches are tried in order:
 *
 * 1. Contour-based: adaptiveThreshold → findContours → approxPolyDP → cluster quad corners.
 *    Inner corners appear in ≥3 square quads, so they cluster with high count.
 *
 * 2. goodFeaturesToTrack fallback: Shi-Tomasi detects strong corners; checkerboard inner
 *    corners score highly and get found first when the board fills a reasonable portion of
 *    the image.
 *
 * Returns Float32Array of [x0,y0, x1,y1, ...] in row-major order (top row first,
 * left-to-right within each row), or null when detection fails.
 */
export function detectChessboardCorners(cv: CV, gray: CV, cols: number, rows: number): Float32Array | null {
  return detectContour(cv, gray, cols, rows) ?? detectGFTT(cv, gray, cols, rows)
}

// ── Approach 1: contour-based ─────────────────────────────────────────────────

function detectContour(cv: CV, gray: CV, cols: number, rows: number): Float32Array | null {
  const n = cols * rows
  const blurred = new cv.Mat()
  const binary = new cv.Mat()
  const inv = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  try {
    const imgArea = gray.cols * gray.rows
    const allPts: [number, number][] = []
    const CLUSTER_PX = 10
    const clusters: { x: number; y: number; count: number }[] = []

    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1, 1)
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 21, 5)
    cv.bitwise_not(binary, inv)

    // Very permissive: accept squares from ~4×4 px up to 10 % of the image.
    // The far end of a perspective-tilted board may have very small squares.
    const minArea = Math.max(16, imgArea * 0.00005)
    const maxArea = imgArea * 0.1

    for (const src of [binary, inv]) {
      cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i)
        const area = cv.contourArea(contour)

        if (area >= minArea && area <= maxArea) {
          const peri = cv.arcLength(contour, true)
          const poly = new cv.Mat()

          // Slightly larger epsilon to keep quads convex under heavy perspective.
          cv.approxPolyDP(contour, poly, peri * 0.06, true)

          // Accept 4-vertex polygons; skip the strict convexity check because
          // heavily foreshortened squares can appear slightly non-convex after
          // pixel-level rounding in approxPolyDP.
          if (poly.rows === 4) {
            for (let j = 0; j < 4; j++) {
              allPts.push([poly.data32S[j * 2], poly.data32S[j * 2 + 1]])
            }
          }
          poly.delete()
        }

        contour.delete()
      }
    }

    if (allPts.length < n * 2) {
      return null
    }

    const thresh2 = CLUSTER_PX ** 2

    for (const [px, py] of allPts) {
      let merged = false

      for (const c of clusters) {
        if ((c.x - px) ** 2 + (c.y - py) ** 2 < thresh2) {
          c.x = (c.x * c.count + px) / (c.count + 1)
          c.y = (c.y * c.count + py) / (c.count + 1)
          c.count++
          merged = true
          break
        }
      }

      if (!merged) {
        clusters.push({ x: px, y: py, count: 1 })
      }
    }

    // True inner corners are shared by 4 squares; allow ≥ 2 for partial detection
    // at the board boundary or for cameras at extreme angles.
    const candidates = clusters.filter((c) => c.count >= 2).sort((a, b) => b.count - a.count)

    if (candidates.length < n) {
      return null
    }

    return orderIntoGrid(candidates, cols, rows)
  } finally {
    blurred.delete()
    binary.delete()
    inv.delete()
    contours.delete()
    hierarchy.delete()
  }
}

// ── Approach 2: goodFeaturesToTrack ──────────────────────────────────────────

function detectGFTT(cv: CV, gray: CV, cols: number, rows: number): Float32Array | null {
  const n = cols * rows
  const cornersMat = new cv.Mat()

  try {
    // Request a few extra corners to handle background noise.
    const maxCorners = n + Math.ceil(n * 0.3)
    // minDistance: keep corners well-separated (checkerboard corners are one square apart).
    const minDist = Math.sqrt((gray.cols * gray.rows) / (n * 9))
    const pts: { x: number; y: number }[] = []

    cv.goodFeaturesToTrack(gray, cornersMat, maxCorners, 0.005, minDist)

    if (cornersMat.rows < n) {
      return null
    }

    for (let i = 0; i < cornersMat.rows; i++) {
      pts.push({ x: cornersMat.data32F[i * 2], y: cornersMat.data32F[i * 2 + 1] })
    }

    return orderIntoGrid(pts, cols, rows)
  } finally {
    cornersMat.delete()
  }
}

// ── Grid ordering ─────────────────────────────────────────────────────────────

/** Arrange unordered detected corners into a row-major cols×rows grid. */
function orderIntoGrid(corners: { x: number; y: number }[], cols: number, rows: number): Float32Array | null {
  const pts = [...corners].sort((a, b) => a.y - b.y)
  const groups: { x: number; y: number }[][] = []
  const result = new Float32Array(cols * rows * 2)
  let idx = 0

  if (corners.length < cols * rows) {
    return null
  }

  const yRange = pts[pts.length - 1].y - pts[0].y

  if (yRange < 5) {
    return null
  }

  // Adaptive row-grouping threshold: 60 % of the estimated inter-row spacing.
  const rowThresh = (yRange / (rows - 1)) * 0.6
  let cur: { x: number; y: number }[] = [pts[0]]

  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y - cur[0].y < rowThresh) {
      cur.push(pts[i])
    } else {
      if (cur.length >= cols) {
        groups.push(cur.sort((a, b) => a.x - b.x))
      }
      cur = [pts[i]]
    }
  }
  if (cur.length >= cols) {
    groups.push(cur.sort((a, b) => a.x - b.x))
  }

  if (groups.length < rows) {
    return null
  }

  // Sort groups by mean y, keep the first `rows`.
  groups.sort((a, b) => {
    const ay = a.reduce((s, p) => s + p.y, 0) / a.length
    const by_ = b.reduce((s, p) => s + p.y, 0) / b.length

    return ay - by_
  })

  for (let r = 0; r < rows; r++) {
    const row = groups[r].sort((a, b) => a.x - b.x).slice(0, cols)

    if (r >= groups.length) {
      return null
    }

    if (row.length !== cols) {
      return null
    }

    for (const p of row) {
      result[idx++] = p.x
      result[idx++] = p.y
    }
  }

  return result
}
