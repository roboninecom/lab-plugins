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
  // Uniform step across ±1.0 rad of wrist roll; slight downward flex keeps
  // the board visible throughout.
  for (const roll of [-1.0, -0.7, -0.35, 0, 0.35, 0.7, 1.0]) {
    poses.push(
      makePose([
        [WROLL, roll],
        [WFLEX, -0.1],
      ]),
    )
  }

  // ── Group 2: Tilt + roll combos (6 poses) ────────────────────────────────
  // Three flex levels (strong forward tilt, mild tilt, slight back-tilt),
  // each paired with two opposite rolls so no two poses are mirror-symmetric.
  for (const [flex, roll] of [
    [-0.4, -0.5],
    [-0.4, 0.5],
    [-0.2, -0.7],
    [-0.2, 0.7],
    [0.2, -0.5],
    [0.2, 0.5],
  ] as Array<[number, number]>) {
    poses.push(
      makePose([
        [WFLEX, flex],
        [WROLL, roll],
      ]),
    )
  }

  // ── Group 3: Lateral shift (4 poses) ─────────────────────────────────────
  // Vary base pan so the board appears in different image columns.
  for (const pan of [-0.3, -0.15, 0.15, 0.3]) {
    poses.push(
      makePose([
        [BASE, pan],
        [WFLEX, -0.1],
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
    // constraint on principal point (cx, cy).
    for (const [pan, roll] of [
      [-0.25, 0.6],
      [-0.25, -0.6],
      [0.25, 0.6],
      [0.25, -0.6],
    ] as Array<[number, number]>) {
      poses.push(
        makePose([
          [BASE, pan],
          [WROLL, roll],
          [WFLEX, -0.1],
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
        [WFLEX, -0.15],
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

    // ── Group 7: Strong tilt (3 poses) ───────────────────────────────────
    // Steep out-of-plane tilt constrains cx/cy better than mild tilt.
    poses.push(
      makePose([
        [WFLEX, -0.5],
        [WROLL, 0.0],
      ]),
    )
    poses.push(
      makePose([
        [BASE, -0.2],
        [WFLEX, -0.35],
        [WROLL, 0.4],
      ]),
    )
    poses.push(
      makePose([
        [BASE, 0.2],
        [WFLEX, -0.35],
        [WROLL, -0.4],
      ]),
    )
  }

  return poses
}
