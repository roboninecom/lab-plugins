// In-browser stand-in for the ROS2 graph: named topics carrying plain JS
// objects shaped like ROS messages. Both language runtimes and the robot
// bridge publish/subscribe here; QoS is accepted by the runtimes but ignored.

export type RosMessage = Record<string, unknown>

export type SubscriberCallback = (msg: RosMessage) => void

export interface TopicInfo {
  name: string
  type: string
}

export const JOINT_STATES_TOPIC = '/joint_states'
export const COMMAND_TOPIC = '/forward_position_controller/commands'

export class RosCore {
  private subscribers = new Map<string, Set<SubscriberCallback>>()
  private topicTypes = new Map<string, string>()

  publish(topic: string, type: string, msg: RosMessage): void {
    const subs = this.subscribers.get(topic)

    this.topicTypes.set(topic, type)
    if (!subs || subs.size === 0) {
      return
    }
    // Deliver asynchronously so a publish inside a callback cannot recurse
    // into other callbacks mid-flight, mirroring executor semantics.
    queueMicrotask(() => {
      for (const cb of subs) {
        try {
          cb(msg)
        } catch {
          // Subscriber errors are surfaced by the runtime that owns the callback.
        }
      }
    })
  }

  subscribe(topic: string, cb: SubscriberCallback): () => void {
    let subs = this.subscribers.get(topic)

    if (!subs) {
      subs = new Set()
      this.subscribers.set(topic, subs)
    }
    subs.add(cb)

    return () => {
      subs.delete(cb)
    }
  }

  topics(): TopicInfo[] {
    return [...this.topicTypes.entries()].map(([name, type]) => ({ name, type }))
  }

  reset(): void {
    this.subscribers.clear()
    this.topicTypes.clear()
  }
}

// ── Message helpers ───────────────────────────────────────────────────────────

export interface JointStateMsg extends RosMessage {
  header: { stamp: { sec: number; nanosec: number }; frame_id: string }
  name: string[]
  position: number[]
  velocity: number[]
  effort: number[]
}

export function makeJointState(names: string[], positions: number[]): JointStateMsg {
  const nowMs = Date.now()

  return {
    header: {
      stamp: { sec: Math.floor(nowMs / 1000), nanosec: (nowMs % 1000) * 1e6 },
      frame_id: '',
    },
    name: names,
    position: positions,
    velocity: names.map(() => 0),
    effort: names.map(() => 0),
  }
}

export function commandValues(msg: RosMessage): number[] | null {
  const data = (msg as { data?: unknown }).data

  if (!Array.isArray(data)) {
    return null
  }

  const values = data.map((v) => Number(v))

  if (values.some((v) => !Number.isFinite(v))) {
    return null
  }

  return values
}
