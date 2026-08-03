import { COMMAND_TOPIC, JOINT_STATES_TOPIC, type RosCore, type RosMessage } from '../core/rosCore'
import { type MoveItHostApi, planJointTrajectory } from '../core/moveit'
import { createMessage } from '../core/messages'

// Runtime backing the JavaScript emitted by the transpiler. Mirrors the
// rclcpp API surface the curated subset uses; every entity is wired to the
// shared RosCore so C++ and Python nodes see the same topics. MoveIt support
// (moveit::planning_interface::MoveGroupInterface) is available when the
// MoveIt 2 library is enabled — the host answers IK and named targets.

const STOP_MESSAGE = '__ros2_stop__'
const YIELD_INTERVAL_MS = 10
const SPIN_TICK_MS = 5
const MOVEIT_STATE_TIMEOUT_MS = 3000
const MOVEIT_SUCCESS = 1
const MOVEIT_FAILURE = 0

export interface RuntimeHooks {
  onLog(level: string, text: string): void
  /** Null when the MoveIt 2 library is disabled in the Libraries panel. */
  moveitHost?: MoveItHostApi | null
}

export interface RclcppRuntime {
  rt: Record<string, unknown>
  stop(): void
  isStopError(err: unknown): boolean
}

interface RuntimeTimer {
  periodMs: number
  callback: () => unknown
  nextDue: number
  active: boolean
}

function sprintf(format: string, args: unknown[]): string {
  let index = 0

  return format.replace(/%(?:\.(\d+))?(l*[difsu]|zu|%)/g, (match, precision: string | undefined, spec: string) => {
    const value = args[index++]

    if (spec === '%') {
      return '%'
    }

    if (spec.endsWith('f') || spec.endsWith('i')) {
      const num = Number(value)

      return precision !== undefined ? num.toFixed(Number(precision)) : spec.endsWith('f') ? String(num) : String(Math.trunc(num))
    }
    if (spec.endsWith('d') || spec === 'zu' || spec.endsWith('u')) {
      return String(Math.trunc(Number(value)))
    }

    return String(value)
  })
}

export function createRclcppRuntime(core: RosCore, hooks: RuntimeHooks): RclcppRuntime {
  let alive = true
  let initialized = false
  let spinning = false
  let lastYield = 0
  const timers: RuntimeTimer[] = []
  const unsubscribers: Array<() => void> = []
  const pendingRejects = new Set<(err: Error) => void>()

  function stopError(): Error {
    return new Error(STOP_MESSAGE)
  }

  function assertAlive(): void {
    if (!alive) {
      throw stopError()
    }
  }

  function sleep(ms: number): Promise<void> {
    assertAlive()

    return new Promise<void>((resolve, reject) => {
      const cancel = (err: Error) => {
        clearTimeout(handle)
        reject(err)
      }

      const handle = setTimeout(() => {
        pendingRejects.delete(cancel)
        if (alive) {
          resolve()
        } else {
          reject(stopError())
        }
      }, ms)

      pendingRejects.add(cancel)
    })
  }

  function loggerName(logger: unknown): string {
    if (logger && typeof logger === 'object' && 'name' in logger) {
      return String((logger as { name: unknown }).name)
    }

    return 'node'
  }

  class Node {
    private nodeName: string
    private parameters = new Map<string, unknown>()

    constructor(name?: string) {
      this.nodeName = name ?? 'node'
    }

    get_name(): string {
      return this.nodeName
    }

    get_logger(): { name: string } {
      return { name: this.nodeName }
    }

    get_clock(): { now: () => { seconds: () => number; nanoseconds: () => number } } {
      return {
        now: () => {
          const nowMs = Date.now()

          return { seconds: () => nowMs / 1000, nanoseconds: () => nowMs * 1e6 }
        },
      }
    }

    now(): { seconds: () => number; nanoseconds: () => number } {
      return this.get_clock().now()
    }

    declare_parameter(name: string, value?: unknown): void {
      if (!this.parameters.has(name)) {
        this.parameters.set(name, value)
      }
    }

    get_parameter(name: string): Record<string, unknown> {
      const value = this.parameters.get(name)

      return {
        value,
        as_double: () => Number(value),
        as_int: () => Math.trunc(Number(value)),
        as_string: () => String(value),
        as_bool: () => Boolean(value),
      }
    }

    create_publisher(msgType: string, topic: string, _qos?: unknown): { publish: (msg: RosMessage) => void } {
      return {
        publish: (msg: RosMessage) => {
          assertAlive()
          core.publish(topic, msgType, structuredClone(msg))
        },
      }
    }

    create_subscription(msgType: string, topic: string, _qos: unknown, callback: (msg: RosMessage) => unknown): void {
      unsubscribers.push(
        core.subscribe(topic, (msg) => {
          if (!alive || !spinning) {
            return
          }
          void (async () => {
            try {
              await callback(structuredClone(msg))
            } catch (err) {
              if (!(err instanceof Error && err.message === STOP_MESSAGE)) {
                hooks.onLog('error', err instanceof Error ? err.message : String(err))
              }
            }
          })()
        }),
      )
    }

    create_wall_timer(periodMs: number, callback: () => unknown): RuntimeTimer {
      const timer: RuntimeTimer = {
        periodMs: Math.max(1, Number(periodMs)),
        callback,
        nextDue: performance.now() + Math.max(1, Number(periodMs)),
        active: true,
      }

      timers.push(timer)

      return timer
    }

    create_timer(periodMs: number, callback: () => unknown): RuntimeTimer {
      return this.create_wall_timer(periodMs, callback)
    }

    destroy_node(): void {
      for (const timer of timers) {
        timer.active = false
      }
    }
  }

  class Rate {
    private periodMs: number

    constructor(hz: number) {
      this.periodMs = 1000 / Math.max(0.001, Number(hz))
    }

    async sleep(): Promise<void> {
      await sleep(this.periodMs)
    }
  }

  type JointTarget = { kind: 'joints'; values: number[] | Record<string, number> } | { kind: 'named'; name: string } | { kind: 'pose'; position: [number, number, number] }

  interface MoveItPlan {
    trajectory_?: { joint_names: string[]; points: Array<{ positions: number[]; dtMs: number }> } | null
    planning_time_?: number
  }

  class MoveGroupInterface {
    private groupName: string
    private latestNames: string[] | null = null
    private latestPositions: number[] | null = null
    private target: JointTarget | null = null
    private velocityScaling = 1
    private lastPlan: MoveItPlan['trajectory_'] = null

    constructor(_node?: unknown, groupName?: unknown) {
      if (!hooks.moveitHost) {
        throw new Error('MoveIt 2 is disabled — enable it in the Libraries panel.')
      }
      this.groupName = String(groupName ?? 'arm')
      unsubscribers.push(
        core.subscribe(JOINT_STATES_TOPIC, (msg) => {
          const typed = msg as { name?: unknown; position?: unknown }

          if (Array.isArray(typed.name) && Array.isArray(typed.position)) {
            this.latestNames = typed.name.map((name) => String(name))
            this.latestPositions = typed.position.map((value) => Number(value))
          }
        }),
      )
    }

    getName(): string {
      return this.groupName
    }

    setMaxVelocityScalingFactor(value: number): void {
      this.velocityScaling = Math.min(1, Math.max(0.01, Number(value)))
    }

    setMaxAccelerationScalingFactor(_value: number): void {
      // Acceleration shaping is folded into the smoothstep time-parametrization.
    }

    setPoseTarget(pose: RosMessage): void {
      const inner = (pose as { pose?: { position?: unknown } }).pose ?? pose
      const position = (inner as { position?: { x?: unknown; y?: unknown; z?: unknown } }).position

      this.target = { kind: 'pose', position: [Number(position?.x ?? 0), Number(position?.y ?? 0), Number(position?.z ?? 0)] }
    }

    setPositionTarget(x: number, y: number, z: number): void {
      this.target = { kind: 'pose', position: [Number(x), Number(y), Number(z)] }
    }

    setNamedTarget(name: string): void {
      this.target = { kind: 'named', name: String(name) }
    }

    setJointValueTarget(values: number[] | Record<string, number>): void {
      this.target = { kind: 'joints', values }
    }

    async getCurrentJointValues(): Promise<number[]> {
      await this.waitForState()

      return [...(this.latestPositions ?? [])]
    }

    private async waitForState(): Promise<void> {
      const deadline = performance.now() + MOVEIT_STATE_TIMEOUT_MS

      while (!this.latestPositions) {
        if (performance.now() >= deadline) {
          throw new Error('No /joint_states received — is a robot connected?')
        }
        await sleep(20)
      }
    }

    private async resolveGoal(currentByName: Record<string, number>): Promise<Record<string, number> | null> {
      const moveitHost = hooks.moveitHost
      const names = this.latestNames ?? []

      if (!this.target || !moveitHost) {
        throw new Error('No target set — call setPoseTarget(), setNamedTarget() or setJointValueTarget() first.')
      }
      if (this.target.kind === 'pose') {
        const solution = await moveitHost.solveIk(this.target.position, currentByName)

        if (!solution) {
          hooks.onLog('warn', `[moveit] No IK solution for pose goal (${this.target.position.map((v) => v.toFixed(3)).join(', ')})`)
        }

        return solution
      }
      if (this.target.kind === 'named') {
        const named = moveitHost.namedTarget(this.target.name)

        if (!named) {
          hooks.onLog('warn', `[moveit] Unknown named target '${this.target.name}' (try 'home')`)
        }

        return named
      }
      if (Array.isArray(this.target.values)) {
        const byName: Record<string, number> = {}

        this.target.values.forEach((value, i) => {
          if (i < names.length) {
            byName[names[i]] = Number(value)
          }
        })

        return byName
      }

      return this.target.values
    }

    async plan(planOut?: MoveItPlan): Promise<number> {
      try {
        const names = this.latestNames ?? []
        const positions = this.latestPositions ?? []
        const currentByName: Record<string, number> = {}

        await this.waitForState()

        names.forEach((name, i) => {
          currentByName[name] = positions[i] ?? 0
        })

        const goal = await this.resolveGoal(currentByName)

        if (!goal) {
          return MOVEIT_FAILURE
        }

        const start = names.map((name) => currentByName[name] ?? 0)
        const end = names.map((name) => Number(goal[name] ?? currentByName[name] ?? 0))
        const trajectory = { joint_names: [...names], points: planJointTrajectory(start, end, this.velocityScaling) }

        this.lastPlan = trajectory
        if (planOut && typeof planOut === 'object') {
          planOut.trajectory_ = trajectory
          planOut.planning_time_ = 0
        }

        return MOVEIT_SUCCESS
      } catch (err) {
        if (err instanceof Error && err.message === STOP_MESSAGE) {
          throw err
        }
        hooks.onLog('error', `[moveit] ${err instanceof Error ? err.message : String(err)}`)

        return MOVEIT_FAILURE
      }
    }

    async execute(planIn?: MoveItPlan): Promise<number> {
      const trajectory = planIn?.trajectory_ ?? this.lastPlan

      if (!trajectory || trajectory.points.length === 0) {
        throw new Error('execute() needs a planned trajectory — call plan() first.')
      }
      for (const point of trajectory.points) {
        assertAlive()
        core.publish(COMMAND_TOPIC, 'std_msgs/msg/Float64MultiArray', { layout: { dim: [], data_offset: 0 }, data: [...point.positions] })
        await sleep(point.dtMs)
      }

      return MOVEIT_SUCCESS
    }

    async move(): Promise<number> {
      const plan: MoveItPlan = {}

      if ((await this.plan(plan)) !== MOVEIT_SUCCESS) {
        return MOVEIT_FAILURE
      }

      return this.execute(plan)
    }
  }

  async function spin(_node: Node): Promise<void> {
    spinning = true
    try {
      while (alive) {
        const now = performance.now()

        for (const timer of timers) {
          if (timer.active && now >= timer.nextDue) {
            timer.nextDue = Math.max(timer.nextDue + timer.periodMs, now - timer.periodMs)
            await timer.callback()
          }
        }
        await sleep(SPIN_TICK_MS)
      }
    } finally {
      spinning = false
    }
    throw stopError()
  }

  async function spinSome(_node: Node): Promise<void> {
    spinning = true
    try {
      const now = performance.now()

      for (const timer of timers) {
        if (timer.active && now >= timer.nextDue) {
          timer.nextDue = Math.max(timer.nextDue + timer.periodMs, now - timer.periodMs)
          await timer.callback()
        }
      }
      await sleep(1)
    } finally {
      spinning = false
    }
  }

  async function tick(): Promise<void> {
    const now = performance.now()

    assertAlive()

    if (now - lastYield >= YIELD_INTERVAL_MS) {
      lastYield = now
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      assertAlive()
    }
  }

  const rt = {
    Node,
    Rate,
    MoveGroupInterface,
    newPlan: () => ({ trajectory_: null, planning_time_: 0 }),
    getLogger: (name: unknown) => ({ name: String(name ?? 'node') }),
    init: () => {
      initialized = true
    },
    shutdown: () => {
      initialized = false
    },
    ok: () => alive && initialized,
    spin,
    spinSome,
    sleep,
    tick,
    newMsg: (token: string) => createMessage(token),
    msgClass: (token: string) => () => createMessage(token),
    logf: (logger: unknown, level: string, format: unknown, ...args: unknown[]) => {
      hooks.onLog(level, `[${loggerName(logger)}] ${sprintf(String(format), args)}`)
    },
    logStream: (logger: unknown, level: string, parts: unknown[]) => {
      hooks.onLog(level, `[${loggerName(logger)}] ${parts.map((part) => String(part)).join('')}`)
    },
    cout: (parts: unknown[]) => {
      hooks.onLog(
        'stdout',
        parts
          .map((part) => String(part))
          .join('')
          .replace(/\n$/, ''),
      )
    },
    printf: (format: unknown, ...args: unknown[]) => {
      hooks.onLog('stdout', sprintf(String(format), args).replace(/\n$/, ''))
    },
  }

  return {
    rt,

    stop() {
      const rejects = [...pendingRejects]

      alive = false
      pendingRejects.clear()
      for (const timer of timers) {
        timer.active = false
      }
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
      for (const rejectPending of rejects) {
        rejectPending(stopError())
      }
    },

    isStopError(err: unknown): boolean {
      return err instanceof Error && err.message === STOP_MESSAGE
    },
  }
}
