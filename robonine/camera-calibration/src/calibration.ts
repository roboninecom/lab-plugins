// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

/**
 * Detect inner checkerboard corners.
 *
 * Two strategies in order:
 *
 * 1. Contour-based: adaptiveThreshold → findContours → approxPolyDP → cluster
 *    quad corners. Uses count ≥ 4 then count ≥ 3 tiers only — count ≥ 2 is
 *    excluded because it produces 150+ noisy candidates that send the calibration
 *    solver to a degenerate minimum (RMS > 100 px, fx/fy ratio > 8).
 *
 * 2. goodFeaturesToTrack fallback.
 *
 * Positions are refined with cornerSubPix after detection (when available).
 * Accepts partial boards (≥ 67 % of rows) so fisheye views where one board row
 * is outside the frame still contribute to calibration.
 *
 * Returns Float32Array of [x0,y0, x1,y1, …] in row-major order (top row first,
 * left-to-right within each row), or null when detection fails.
 */
export function detectChessboardCorners(cv: CV, gray: CV, cols: number, rows: number): { corners: Float32Array; cols: number; rows: number } | null {
  const raw = detectContour(cv, gray, cols, rows) ?? detectGFTT(cv, gray, cols, rows)

  console.log(`[chess] detect ${cols}×${rows} on ${gray.cols}×${gray.rows} image`)

  if (!raw) {
    console.log('[chess] FAILED')

    return null
  }

  const corners = refineSubPix(cv, gray, raw)
  const nRows = corners.length / (cols * 2)

  console.log(`[chess] SUCCESS: ${cols}×${nRows}` + (nRows < rows ? ` (partial, needed ${rows})` : ''))

  return { corners, cols, rows: nRows }
}

// ── Sub-pixel refinement ──────────────────────────────────────────────────────

function refineSubPix(cv: CV, gray: CV, corners: Float32Array): Float32Array {
  const n = corners.length / 2

  if (typeof cv.cornerSubPix !== 'function') {
    return corners
  }

  const mat = cv.matFromArray(n, 1, cv.CV_32FC2, Array.from(corners))

  try {
    const result = new Float32Array(n * 2)

    cv.cornerSubPix(gray, mat, new cv.Size(11, 11), new cv.Size(-1, -1), new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_MAX_ITER, 30, 0.001))

    for (let i = 0; i < n; i++) {
      result[i * 2] = mat.data32F[i * 2]
      result[i * 2 + 1] = mat.data32F[i * 2 + 1]
    }

    return result
  } finally {
    mat.delete()
  }
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
    // Cluster radius: large enough to merge the 4 same-corner detections (which
    // are typically 1–5 px apart after approxPolyDP on straight-sided quads) but
    // small enough to NOT merge adjacent inner corners at the compressed end of a
    // perspective-foreshortened board (which can be as close as 8–10 px).
    const CLUSTER_PX = Math.max(4, Math.round(Math.sqrt(imgArea / n) * 0.08))
    const clusters: { x: number; y: number; count: number }[] = []

    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1, 1)
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 21, 5)
    cv.bitwise_not(binary, inv)

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

          cv.approxPolyDP(contour, poly, peri * 0.06, true)

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
      console.log(`[contour] FAIL: allPts=${allPts.length} < ${n * 2}`)

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

    const countDist = clusters.reduce(
      (acc, c) => {
        acc[c.count] = (acc[c.count] ?? 0) + 1

        return acc
      },
      {} as Record<number, number>,
    )

    console.log(`[contour] clusters=${clusters.length} distribution: ${JSON.stringify(countDist)}`)

    // count ≥ 4 then ≥ 3 only.
    // count ≥ 2 is deliberately skipped: it yields 150–230 noisy candidates that
    // produce false grid detections with reprojection errors of 50–250 px.
    for (const minCount of [4, 3] as const) {
      const tier = clusters.filter((c) => c.count >= minCount).sort((a, b) => b.count - a.count)

      console.log(`[contour] trying count≥${minCount}: ${tier.length} candidates (need ≥${n})`)

      if (tier.length >= n) {
        const result = orderIntoGrid(tier, cols, rows)

        if (result) {
          return result
        }
      }
    }

    return null
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
    const maxCorners = n + cols
    const minDist = Math.max(4, Math.min(8, Math.sqrt((gray.cols * gray.rows) / (n * 100))))
    const pts: { x: number; y: number }[] = []

    cv.goodFeaturesToTrack(gray, cornersMat, maxCorners, 0.005, minDist)

    console.log(`[gftt] detected=${cornersMat.rows} (need ≥${n})`)

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

type Pt = { x: number; y: number }

function orderIntoGrid(corners: Pt[], cols: number, rows: number): Float32Array | null {
  const n = cols * rows
  const allByY = [...corners].sort((a, b) => a.y - b.y)
  let Sxx = 0
  let Syy = 0
  let Sxy = 0
  const partialMin = Math.ceil(rows * 0.67)

  if (corners.length < n) {
    return null
  }

  if (allByY[allByY.length - 1].y - allByY[0].y < 5) {
    return null
  }

  const pts = corners.slice(0, n)
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length

  for (const { x, y } of pts) {
    const dx = x - mx
    const dy = y - my

    Sxx += dx * dx
    Syy += dy * dy
    Sxy += dx * dy
  }

  const disc = Math.sqrt(Math.max(0, ((Sxx - Syy) / 2) ** 2 + Sxy ** 2))
  const lam1 = (Sxx + Syy) / 2 + disc
  let ax = Sxy
  let ay = lam1 - Sxx
  const alen = Math.sqrt(ax * ax + ay * ay)

  if (alen > 1e-10) {
    ax /= alen
    ay /= alen
  } else {
    ax = 1
    ay = 0
  }

  const bx = -ay
  const by = ax

  console.log(`[order] PCA angle=${(Math.atan2(ay, ax) * (180 / Math.PI)).toFixed(1)}° corners=${corners.length}`)

  const projSrc = (src: Pt[], rx: number, ry: number, cx2: number, cy2: number) =>
    src.map((p) => ({
      p,
      u: (p.x - mx) * rx + (p.y - my) * ry,
      v: (p.x - mx) * cx2 + (p.y - my) * cy2,
    }))

  const result =
    axisGrid(projSrc(pts, ax, ay, bx, by), cols, rows, rows, 'pca-a') ??
    axisGrid(projSrc(pts, bx, by, ax, ay), cols, rows, rows, 'pca-b') ??
    axisGrid(
      pts.map((p) => ({ p, u: p.y, v: p.x })),
      cols,
      rows,
      rows,
      'y-top',
    ) ??
    axisGrid(projSrc(corners, ax, ay, bx, by), cols, rows, partialMin, 'pca-a-all') ??
    axisGrid(projSrc(corners, bx, by, ax, ay), cols, rows, partialMin, 'pca-b-all') ??
    axisGrid(
      allByY.map((p) => ({ p, u: p.y, v: p.x })),
      cols,
      rows,
      partialMin,
      'y-all',
    )

  if (result) {
    console.log(`[order] SUCCESS: ${result.length / (cols * 2)}/${rows} rows`)
  } else {
    console.log('[order] FAIL: all methods returned null')
  }

  return result
}

function axisGrid(projected: { p: Pt; u: number; v: number }[], cols: number, rows: number, label: string): Float32Array | null {
  const sorted = [...projected].sort((a, b) => a.u - b.u)
  const minRows = Math.ceil(rows * 0.67)

  if (sorted.length < minRows * cols) {
    return null
  }

  const gaps = sorted.slice(1).map((p, i) => ({ gap: p.u - sorted[i].u, idx: i + 1 }))

  gaps.sort((a, b) => b.gap - a.gap)

  for (let extra = 0; extra <= 3; extra++) {
    const nBounds = Math.min(sorted.length - 1, rows - 1 + extra)
    const boundaries = new Set(gaps.slice(0, nBounds).map((g) => g.idx))
    const groups: (typeof sorted)[] = []
    let cur: typeof sorted = [sorted[0]]
    let changed = true
    let idx = 0

    for (let i = 1; i < sorted.length; i++) {
      if (boundaries.has(i)) {
        groups.push(cur)
        cur = [sorted[i]]
      } else {
        cur.push(sorted[i])
      }
    }
    groups.push(cur)

    while (changed) {
      changed = false

      for (let gi = groups.length - 1; gi >= 0; gi--) {
        if (groups[gi].length >= 2 * cols) {
          const g = [...groups[gi]].sort((a, b) => a.u - b.u)
          let maxGapIdx = 1
          let maxGap = -Infinity

          for (let k = 1; k < g.length; k++) {
            const gap = g[k].u - g[k - 1].u

            if (gap > maxGap) {
              maxGap = gap
              maxGapIdx = k
            }
          }

          groups.splice(gi, 1, g.slice(0, maxGapIdx), g.slice(maxGapIdx))
          changed = true
          break
        }
      }
    }

    const valid = groups.filter((g) => g.length >= cols)

    console.log(`[axisGrid ${label}] extra=${extra} valid≥${cols}: ${valid.length} (need ${minRows}..${rows})`)

    if (valid.length < minRows) {
      continue
    }

    valid.sort((a, b) => a.reduce((s, p) => s + p.u, 0) / a.length - b.reduce((s, p) => s + p.u, 0) / b.length)

    const nRows = Math.min(valid.length, rows)
    const result = new Float32Array(nRows * cols * 2)

    for (let r = 0; r < nRows; r++) {
      const row = [...valid[r]].sort((a, b) => a.v - b.v).slice(0, cols)

      for (const { p } of row) {
        result[idx++] = p.x
        result[idx++] = p.y
      }
    }

    // Normalize: rows top→bottom, columns left→right in image.
    // PCA eigenvector sign is arbitrary — without this, row/column order flips
    // between views and gives calibrateCameraExtended contradictory 2D↔3D pairs.
    if (nRows > 1) {
      let firstY = 0
      let lastY = 0

      for (let c = 0; c < cols; c++) {
        firstY += result[c * 2 + 1]
        lastY += result[(nRows - 1) * cols * 2 + c * 2 + 1]
      }

      if (firstY > lastY) {
        for (let r = 0; r < Math.floor(nRows / 2); r++) {
          const a = r * cols * 2
          const b = (nRows - 1 - r) * cols * 2
          const tmp = result.slice(a, a + cols * 2)

          result.copyWithin(a, b, b + cols * 2)
          result.set(tmp, b)
        }
      }
    }

    if (cols > 1 && result[0] > result[(cols - 1) * 2]) {
      for (let r = 0; r < nRows; r++) {
        const base = r * cols * 2

        for (let c = 0; c < Math.floor(cols / 2); c++) {
          const ai = base + c * 2
          const bi = base + (cols - 1 - c) * 2
          const tx = result[ai]
          const ty = result[ai + 1]

          result[ai] = result[bi]
          result[ai + 1] = result[bi + 1]
          result[bi] = tx
          result[bi + 1] = ty
        }
      }
    }

    return result
  }

  return null
}
