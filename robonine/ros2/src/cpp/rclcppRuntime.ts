import type { RosCore, RosMessage } from '../core/rosCore'
import { createMessage } from '../core/messages'

// Runtime backing the JavaScript emitted by the transpiler. Mirrors the
// rclcpp API surface the curated subset uses; every entity is wired to the
// shared RosCore so C++ and Python nodes see the same topics.

const STOP_MESSAGE = '__ros2_stop__'
const YIELD_INTERVAL_MS = 10
const SPIN_TICK_MS = 5

export interface RuntimeHooks {
  onLog(level: string, text: string): void
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
