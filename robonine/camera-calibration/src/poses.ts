import type { PluginRobotConfig } from '@robonine/plugin-sdk'

const GRIPPER_RE = /gripper|finger|hand/i

/**
 * Generate calibration poses from the robot config — no per-model tables needed.
 *
 * The camera intrinsics estimation needs the checkerboard to appear at diverse
 * positions and orientations across the image set. Four groups achieve this:
 *
 *  1. Roll sweep  — 7 poses varying wrist roll across ±57°.
 *     In-plane rotation is the most critical factor: it decouples fx/fy and
 *     fully constrains radial/tangential distortion coefficients.
 *
 *  2. Tilt combos — 6 poses combining wrist flex with roll.
 *     Out-of-plane tilt is essential for constraining the principal point (cx, cy);
 *     a board always viewed head-on produces a poorly conditioned system.
 *
 *  3. Lateral shift — 4 poses varying base pan by ±17°.
 *     Moves the board projection to different horizontal image regions, ensuring
 *     all four quadrants are covered when combined with the roll sweep.
 *
 *  4. Reach variation — 3 poses extending/retracting shoulder+elbow by ±0.2 rad.
 *     Changes camera-to-board distance, improving focal-length estimation.
 *
 * All offsets are conservative (well within typical revolute joint limits) so
 * the function works for any serial arm robot without model-specific tuning.
 *
 * Returns joint position arrays ordered by servo ID ascending, matching the
 * order expected by context.servo.setJointPositions().
 */
export function generateCalibrationPoses(robotConfig: PluginRobotConfig, scale = 1.0): number[][] {
  const sortedServos = Object.entries(robotConfig.jointServoId)
    .sort(([, a], [, b]) => a - b)
    .map(([name, id]) => ({ name, id }))

  // Arm joints are all non-gripper joints — their indices in the sorted array
  const armIndices = sortedServos
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !GRIPPER_RE.test(s.name))
    .map((s) => s.i)

  const n = armIndices.length
  const BASE = 0
  const poses: number[][] = []

  if (n < 2) {
    return []
  }

  // Neutral angle for every servo slot (gripper slots → 0)
  const neutral = sortedServos.map(({ name, id }) => (GRIPPER_RE.test(name) ? 0 : robotConfig.neutralJointValue(id)))

  // Build one pose by applying arm-joint offsets on top of neutral.
  // Offsets are [armIdx, deltaRad] pairs; armIdx indexes into armIndices.
  const makePose = (offsets: Array<[number, number]>): number[] => {
    const p = [...neutral]

    for (const [ai, delta] of offsets) {
      const gi = armIndices[ai]

      if (gi !== undefined) {
        p[gi] += delta * scale
      }
    }

    return p
  }

  const WFLEX = n - 2 // wrist flex / pitch (second-to-last arm joint)
  const WROLL = n - 1 // wrist roll (last arm joint)

  // ── Group 1: Roll sweep (7 poses) ────────────────────────────────────────
  // Each roll step is paired with a flex that spans the full vertical image
  // range. Positive flex → board lower in frame; negative flex → board higher.
  for (const [roll, flex] of [
    [0, 0.5],
    [-0.35, 0.3],
    [0.35, 0.3],
    [-0.7, -0.1],
    [0.7, -0.1],
    [-0.7, -0.4],
    [0.7, -0.4],
  ] as Array<[number, number]>) {
    poses.push(
      makePose([
        [WROLL, roll],
        [WFLEX, flex],
      ]),
    )
  }

  // ── Group 2: Tilt + roll combos (6 poses) ────────────────────────────────
  // Three flex levels spanning bottom→top image regions, each paired with
  // two opposite rolls for cx/cy constraint.
  for (const [flex, roll] of [
    [0.6, -0.5],
    [0.6, 0.5],
    [0.2, -0.7],
    [0.2, 0.7],
    [-0.3, -0.5],
    [-0.3, 0.5],
  ] as Array<[number, number]>) {
    poses.push(
      makePose([
        [WFLEX, flex],
        [WROLL, roll],
      ]),
    )
  }

  // ── Group 3: Lateral shift (4 poses) ─────────────────────────────────────
  // Vary base pan so the board appears in different image columns; alternate
  // flex between lower and upper image regions for vertical coverage.
  for (const [pan, flex] of [
    [-0.3, 0.5],
    [-0.15, -0.2],
    [0.15, -0.2],
    [0.3, 0.5],
  ] as Array<[number, number]>) {
    poses.push(
      makePose([
        [BASE, pan],
        [WFLEX, flex],
      ]),
    )
  }

  // ── Group 4: Reach variation (3 poses) ───────────────────────────────────
  // Extend/retract via shoulder + elbow to change camera-to-board distance.
  if (n >= 3) {
    const SHOULDER = 1
    const ELBOW = 2

    poses.push(
      makePose([
        [SHOULDER, -0.2],
        [ELBOW, -0.2],
        [WROLL, 0.4],
      ]),
    )
    poses.push(
      makePose([
        [SHOULDER, -0.2],
        [ELBOW, -0.2],
        [WROLL, -0.4],
      ]),
    )
    poses.push(
      makePose([
        [SHOULDER, 0.2],
        [ELBOW, 0.2],
        [WROLL, 0.0],
      ]),
    )

    // ── Group 5: Lateral + roll combos (4 poses) ─────────────────────────
    // Board in different image quadrants while also rotated — strongest
    // constraint on principal point (cx, cy). Alternate flex for vertical spread.
    for (const [pan, roll, flex] of [
      [-0.25, 0.6, 0.5],
      [-0.25, -0.6, 0.5],
      [0.25, 0.6, -0.3],
      [0.25, -0.6, -0.3],
    ] as Array<[number, number, number]>) {
      poses.push(
        makePose([
          [BASE, pan],
          [WROLL, roll],
          [WFLEX, flex],
        ]),
      )
    }

    // ── Group 6: Reach + roll (3 poses) ──────────────────────────────────
    // Combines distance change with in-plane rotation for better focal-length
    // vs distortion decoupling.
    poses.push(
      makePose([
        [SHOULDER, -0.3],
        [ELBOW, -0.3],
        [WFLEX, -0.25],
      ]),
    )
    poses.push(
      makePose([
        [SHOULDER, 0.15],
        [ELBOW, 0.15],
        [WROLL, 0.6],
      ]),
    )
    poses.push(
      makePose([
        [SHOULDER, 0.15],
        [ELBOW, 0.15],
        [WROLL, -0.6],
      ]),
    )

    // ── Group 7: Bottom coverage (3 poses) ───────────────────────────────
    // Positive flex pushes the board into the lower image region; combined
    // with pan/roll for quadrant diversity.
    poses.push(
      makePose([
        [WFLEX, 0.7],
        [WROLL, 0.0],
      ]),
    )
    poses.push(
      makePose([
        [BASE, -0.2],
        [WFLEX, 0.6],
        [WROLL, 0.4],
      ]),
    )
    poses.push(
      makePose([
        [BASE, 0.2],
        [WFLEX, 0.6],
        [WROLL, -0.4],
      ]),
    )
  }

  // Prepend a warmup pose (neutral, no offsets) so the first real capture is
  // never the very first robot movement. The warmup is hidden from the UI and
  // its frame is not used for calibration.
  poses.unshift([...neutral])

  return poses
}
