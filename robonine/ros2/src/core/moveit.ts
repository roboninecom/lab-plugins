// Shared MoveIt 2 plumbing: the host-side services the shims need (IK comes
// from the platform kinematics, named targets from the robot config) and the
// joint-space trajectory generator used by the C++ runtime. The Python shim
// implements the same interpolation in pure Python inside Pyodide.

export interface MoveItHostApi {
  /** Solve IK for a world-frame position, seeded with the current joint map. Null when unsolvable. */
  solveIk(target: [number, number, number], seed: Record<string, number>): Promise<Record<string, number> | null>
  /** Resolve a named configuration ('home') to a joint map. Null when unknown. */
  namedTarget(name: string): Record<string, number> | null
}

export interface TrajectoryPoint {
  positions: number[]
  dtMs: number
}

const MAX_JOINT_VELOCITY = 1.5 // rad/s at velocity scaling 1.0
const STEP_MS = 50
const MIN_DURATION_MS = 200
const MAX_DURATION_MS = 20000

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Time-parametrize a straight joint-space move with smooth acceleration.
 * Both vectors must follow the /joint_states joint order.
 */
export function planJointTrajectory(start: number[], goal: number[], velocityScaling: number): TrajectoryPoint[] {
  const scaling = Math.min(1, Math.max(0.01, velocityScaling))
  let maxDelta = 0
  const points: TrajectoryPoint[] = []

  for (let i = 0; i < goal.length; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(goal[i] - (start[i] ?? 0)))
  }
  if (maxDelta < 1e-4) {
    return [{ positions: [...goal], dtMs: STEP_MS }]
  }

  const durationMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, (maxDelta / (MAX_JOINT_VELOCITY * scaling)) * 1000))
  const steps = Math.max(2, Math.round(durationMs / STEP_MS))

  for (let step = 1; step <= steps; step++) {
    const blend = smoothstep(step / steps)

    points.push({
      positions: goal.map((value, i) => (start[i] ?? 0) + (value - (start[i] ?? 0)) * blend),
      dtMs: durationMs / steps,
    })
  }

  return points
}
