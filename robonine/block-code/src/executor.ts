import type { PluginContext, WorldViewApi } from '@robonine/plugin-sdk'

export type RunMode = 'simulation' | 'real'

export interface Executor {
  run(code: string): void
  stop(): void
}

export interface ExecutorOptions {
  context: PluginContext
  worldView: WorldViewApi | null
  mode: RunMode
  onPrint: (line: string) => void
  onError: (msg: string) => void
  onDone: () => void
}

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const MM = 1 / 1000
const GRIPPER_JOINT = 'l_hand001__to__l_left_finger001'
const GRIPPER_OPEN_M = 0.042

export function createExecutor(opts: ExecutorOptions): Executor {
  const { context, worldView, mode, onPrint, onError, onDone } = opts
  let alive = true

  // Sensor cache — value blocks read synchronously from here.
  // Keys for revolute joints store radians; effector stores mm.
  const cache: {
    joints: Record<string, number>
    effector: [number, number, number]
    pressure: number
  } = { joints: {}, effector: [0, 0, 0], pressure: 0 }

  const pendingRejects = new Set<(e: Error) => void>()

  function stopErr() {
    return new Error('__stop__')
  }

  async function updateCache() {
    const cfg = context.robotConfig

    if (!cfg) {
      return
    }

    try {
      // Derive pressure from gripper opening.
      const g = cache.joints[GRIPPER_JOINT] ?? GRIPPER_OPEN_M

      // FK for end effector position.
      const angles: Record<string, number> = {}

      if (mode === 'real' && context.connection.connected && !context.connection.virtual) {
        const raw = await context.servo.readJointPositions()

        if (raw) {
          const names = Object.entries(cfg.jointServoId)
            .sort(([, a], [, b]) => a - b)
            .map(([n]) => n)

          for (let i = 0; i < names.length && i < raw.length; i++) {
            cache.joints[names[i]] = raw[i]
          }
        }
      } else if (worldView) {
        for (const j of worldView.getJoints()) {
          const v = worldView.getJointValue(j.name)

          if (v !== null) {
            cache.joints[j.name] = v
          }
        }
      }
      cache.pressure = Math.max(0, Math.min(10, (1 - g / GRIPPER_OPEN_M) * 10))

      for (const [name, val] of Object.entries(cache.joints)) {
        if (name !== GRIPPER_JOINT) {
          angles[name] = val
        }
      }
      if (Object.keys(angles).length > 0) {
        try {
          const fk = await context.kinematics.forwardKinematics(angles)

          cache.effector = [fk.position[0] * 1000, fk.position[1] * 1000, fk.position[2] * 1000]
        } catch {
          // leave effector cache as-is
        }
      }
    } catch {
      // ignore transient errors during cache update
    }
  }

  // ── Robot API exposed to generated code ──────────────────────────────────────

  const robot = {
    async moveJoint(joint: string, degrees: number): Promise<void> {
      const rad = degrees * DEG

      if (!alive) {
        throw stopErr()
      }
      worldView?.setJoint(joint, rad)
      cache.joints[joint] = rad
      if (mode === 'real' && context.connection.connected && context.robotConfig) {
        const id = context.robotConfig.jointServoId[joint]

        if (id !== undefined) {
          const raw = context.robotConfig.jointToEncoder(id, rad)

          await context.servo.setPosition(id, Math.max(0, Math.min(4095, raw)))
        }
      }
      if (!alive) {
        throw stopErr()
      }
    },

    getJoint(joint: string): number {
      return (cache.joints[joint] ?? 0) * RAD
    },

    async gripper(action: 'open' | 'close'): Promise<void> {
      const val = action === 'open' ? GRIPPER_OPEN_M : 0

      if (!alive) {
        throw stopErr()
      }
      worldView?.setJoint(GRIPPER_JOINT, val)
      cache.joints[GRIPPER_JOINT] = val
      cache.pressure = action === 'open' ? 0 : 10
      if (mode === 'real' && context.connection.connected && context.robotConfig) {
        const id = context.robotConfig.jointServoId[GRIPPER_JOINT]

        if (id !== undefined) {
          const raw = context.robotConfig.jointToEncoder(id, val)

          await context.servo.setPosition(id, Math.max(0, Math.min(4095, raw)))
        }
      }
      if (!alive) {
        throw stopErr()
      }
    },

    async moveToXYZ(xMm: number, yMm: number, zMm: number): Promise<void> {
      const target: [number, number, number] = [xMm * MM, yMm * MM, zMm * MM]
      const seedAngles: Record<string, number> = {}

      if (!alive) {
        throw stopErr()
      }

      if (worldView) {
        for (const j of worldView.getJoints()) {
          const v = worldView.getJointValue(j.name)

          if (v !== null && j.name !== GRIPPER_JOINT) {
            seedAngles[j.name] = v
          }
        }
      }

      const solution = await context.kinematics.inverseKinematics(target, seedAngles)

      if (!solution) {
        throw new Error('__ik_failed__')
      }

      for (const [name, val] of Object.entries(solution)) {
        worldView?.setJoint(name, val)
        cache.joints[name] = val
      }
      cache.effector = [xMm, yMm, zMm]

      if (mode === 'real' && context.connection.connected && context.robotConfig) {
        const positions: Array<{ id: number; position: number }> = []

        for (const [name, val] of Object.entries(solution)) {
          const id = context.robotConfig.jointServoId[name]

          if (id !== undefined) {
            positions.push({ id, position: Math.max(0, Math.min(4095, context.robotConfig.jointToEncoder(id, val))) })
          }
        }
        await context.servo.syncSetPositions(positions)
      }
      if (!alive) {
        throw stopErr()
      }
    },

    getEffector(axis: 'X' | 'Y' | 'Z'): number {
      if (axis === 'X') {
        return cache.effector[0]
      }
      if (axis === 'Y') {
        return cache.effector[1]
      }

      return cache.effector[2]
    },

    getPressure(): number {
      return cache.pressure
    },

    async goHome(): Promise<void> {
      const cfg = context.robotConfig

      if (!alive) {
        throw stopErr()
      }

      // resetJoints(true) triggers the smooth WorldView animation.
      // Without this all setJoint calls happen in one frame and appear instant.
      worldView?.resetJoints(true)
      cache.pressure = 0

      if (cfg) {
        const positions: Array<{ id: number; position: number }> = []

        for (const [name, id] of Object.entries(cfg.jointServoId)) {
          cache.joints[name] = cfg.neutralJointValue(id)
          positions.push({ id, position: Math.max(0, Math.min(4095, cfg.servoNeutral[id] ?? 2048)) })
        }
        if (mode === 'real' && context.connection.connected) {
          await context.servo.syncSetPositions(positions)
        }
      } else {
        cache.joints = {}
      }

      await robot.wait(800)
    },

    async wait(ms: number): Promise<void> {
      if (!alive) {
        throw stopErr()
      }
      await new Promise<void>((resolve, reject) => {
        const cancel = (e: Error) => {
          clearTimeout(timer)
          reject(e)
        }

        const timer = setTimeout(() => {
          pendingRejects.delete(cancel)
          if (alive) {
            resolve()
          } else {
            reject(stopErr())
          }
        }, ms)

        pendingRejects.add(cancel)
      })
    },

    print(msg: string): void {
      onPrint(String(msg))
    },
  }

  return {
    run(code: string) {
      void (async () => {
        try {
          const fn = new Function('robot', `return (async()=>{\n${code}\n})()`)

          await updateCache()
          if (!alive) {
            return
          }
          await (fn(robot) as Promise<unknown>)
          if (alive) {
            onDone()
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)

          if (!alive) {
            onDone()

            return
          }
          if (msg === '__stop__') {
            onDone()
          } else if (msg === '__ik_failed__') {
            onError('ik_failed')
            onDone()
          } else {
            onError(msg)
            onDone()
          }
        }
      })()
    },

    stop() {
      const rejects = [...pendingRejects]

      alive = false
      pendingRejects.clear()
      for (const r of rejects) {
        r(stopErr())
      }
    },
  }
}
