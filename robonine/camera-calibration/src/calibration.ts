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
export function detectChessboardCorners(cv: CV, gray: CV, cols: number, rows: number): { corners: Float32Array; cols: number; rows: number } | null {
  for (const [c, r] of [
    [cols, rows],
    [rows, cols],
  ] as [number, number][]) {
    const corners = detectContour(cv, gray, c, r) ?? detectGFTT(cv, gray, c, r)

    console.log(`[chess] detect ${c}×${r} on ${gray.cols}×${gray.rows} image`)

    if (corners) {
      const nRows = corners.length / (c * 2)

      console.log(`[chess] SUCCESS: ${c}×${nRows}` + (nRows < r ? ` (partial, needed ${r})` : ''))

      return { corners, cols: c, rows: nRows }
    }

    console.log(`[chess] ${c}×${r} — both contour and GFTT returned null`)
  }

  console.log('[chess] FAILED — all orientations failed')

  return null
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
    // 0.08 × avg-spacing ≈ 10 px at 1280×720; adjacent far corners are ~10 px.
    const CLUSTER_PX = Math.max(4, Math.round(Math.sqrt(imgArea / n) * 0.08))
    const clusters: { x: number; y: number; count: number }[] = []
    let totalContours = 0
    let quadCount = 0

    console.log(`[contour] imgArea=${imgArea} n=${n} CLUSTER_PX=${CLUSTER_PX}`)

    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1, 1)
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 21, 5)
    cv.bitwise_not(binary, inv)

    // Very permissive: accept squares from ~4×4 px up to 10 % of the image.
    // The far end of a perspective-tilted board may have very small squares.
    const minArea = Math.max(16, imgArea * 0.00005)
    const maxArea = imgArea * 0.1

    console.log(`[contour] minArea=${minArea.toFixed(0)} maxArea=${maxArea.toFixed(0)}`)

    for (const src of [binary, inv]) {
      cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
      totalContours += contours.size()

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
            quadCount++

            for (let j = 0; j < 4; j++) {
              allPts.push([poly.data32S[j * 2], poly.data32S[j * 2 + 1]])
            }
          }
          poly.delete()
        }

        contour.delete()
      }
    }

    console.log(`[contour] totalContours=${totalContours} quads=${quadCount} allPts=${allPts.length} (need ≥${n * 2})`)

    if (allPts.length < n * 2) {
      console.log(`[contour] FAIL: not enough quad corners`)

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

    const countDist = clusters.reduce(
      (acc, c) => {
        acc[c.count] = (acc[c.count] ?? 0) + 1

        return acc
      },
      {} as Record<number, number>,
    )

    console.log(`[contour] clusters=${clusters.length} count≥2: ${candidates.length} (need ≥${n}) distribution: ${JSON.stringify(countDist)}`)

    if (candidates.length < n) {
      console.log(`[contour] FAIL: not enough high-count clusters`)

      return null
    }

    // Try progressively looser count thresholds to keep the candidate cloud clean.
    // True inner corners appear in 4 squares (count=4); noise clusters at count=2.
    // Fewer candidates → more reliable PCA axis → better gap-based grouping.
    for (const minCount of [4, 3, 2] as const) {
      const tier = clusters.filter((c) => c.count >= minCount).sort((a, b) => b.count - a.count)

      if (tier.length >= n) {
        const result = orderIntoGrid(tier, cols, rows)

        console.log(`[contour] trying count≥${minCount}: ${tier.length} candidates`)

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
    // Keep minDist small so compressed far-row corners (as close as 8 px at steep
    // perspective) are not suppressed by NMS.  Cap at 8 to avoid over-detection.
    const minDist = Math.max(4, Math.min(8, Math.sqrt((gray.cols * gray.rows) / (n * 100))))
    const pts: { x: number; y: number }[] = []

    console.log(`[gftt] maxCorners=${maxCorners} minDist=${minDist.toFixed(1)}`)

    cv.goodFeaturesToTrack(gray, cornersMat, maxCorners, 0.005, minDist)

    console.log(`[gftt] detected=${cornersMat.rows} (need ≥${n})`)

    if (cornersMat.rows < n) {
      console.log(`[gftt] FAIL: too few corners detected`)

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

/**
 * Arrange unordered detected corners into a row-major cols×rows grid.
 *
 * Uses PCA to find the board's principal axes so that corners are grouped
 * correctly even when the board is rotated in the image (e.g. ±57° from wrist
 * roll poses). Six gap-based attempts are made in order:
 *
 * 1–2. PCA axes on top-n (fast, low-noise candidates)
 * 3.   Image y-axis on top-n
 * 4–5. PCA axes on ALL candidates (correct when top-n is unevenly distributed)
 * 6.   Image y-axis gap-based on ALL candidates (most robust fallback — inter-row
 *      gaps always dominate intra-row gaps regardless of board angle or noise)
 */
function orderIntoGrid(corners: Pt[], cols: number, rows: number): Float32Array | null {
  const n = cols * rows
  const allByY = [...corners].sort((a, b) => a.y - b.y)
  let Sxx = 0
  let Syy = 0
  let Sxy = 0

  if (corners.length < n) {
    console.log(`[order] FAIL: corners.length=${corners.length} < n=${n}`)

    return null
  }

  if (allByY[allByY.length - 1].y - allByY[0].y < 5) {
    console.log(`[order] FAIL: yRange too small`)

    return null
  }

  // top-n candidates (caller sorts by detection quality descending)
  const pts = corners.slice(0, n)

  // ── PCA on the top-n corner cloud ───────────────────────────────────────────
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
    // PCA axes on top-n
    axisGrid(projSrc(pts, ax, ay, bx, by), cols, rows, 'pca-a') ??
    axisGrid(projSrc(pts, bx, by, ax, ay), cols, rows, 'pca-b') ??
    // y-axis on top-n
    axisGrid(
      pts.map((p) => ({ p, u: p.y, v: p.x })),
      cols,
      rows,
      'y-top',
    ) ??
    // PCA axes on all candidates (top-n may be unevenly distributed across rows)
    axisGrid(projSrc(corners, ax, ay, bx, by), cols, rows, 'pca-a-all') ??
    axisGrid(projSrc(corners, bx, by, ax, ay), cols, rows, 'pca-b-all') ??
    // Gap-based y-axis on ALL candidates: inter-row gaps always dominate intra-row gaps
    axisGrid(
      allByY.map((p) => ({ p, u: p.y, v: p.x })),
      cols,
      rows,
      'y-all',
    )

  if (result) {
    console.log(`[order] SUCCESS: ${result.length / (cols * 2)}/${rows} rows`)
  } else {
    console.log(`[order] FAIL: all methods returned null`)
  }

  return result
}

/**
 * Gap-based grouping along the u-axis of projected points.
 * Selects the (rows-1) largest u-gaps as row boundaries; sorts within each
 * group by v.
 *
 * Oversized groups (≥ 2×cols) are iteratively split at their largest internal
 * gap — these are rows merged by perspective compression.  Accepts partial
 * results (≥ 67 % of rows) so fisheye views where one board row is missing
 * still contribute to calibration.
 */
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

    console.log(`[axisGrid ${label}] extra=${extra} groups=[${groups.map((g) => g.length).join(',')}] valid≥${cols}: ${valid.length} (need ${minRows}..${rows})`)

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

    return result
  }

  return null
}
