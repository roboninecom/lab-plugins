import { useEffect, useState } from 'react'
import type { TaskAgentContext } from './sdkExtras'

/** How often the arming is read while nothing runs (ms). */
const ARMED_POLL_MS = 1000

/**
 * Whether the operator has armed the robot (the arming bar at the bottom of the screen), read from
 * the arm while it is connected and nothing runs: a job may only start armed - a program started
 * disarmed had every motion refused and retried them (2026-11-03).
 *
 * @param ctx - Plugin context.
 * @param running - A job runs (no polling then: the run screen does not start anything).
 * @returns True when armed; false when disarmed or not connected.
 */
export function useArmed(ctx: TaskAgentContext, running: boolean): boolean {
  const [armed, setArmed] = useState(false)
  const connected = ctx.connection.connected

  useEffect(() => {
    if (!connected || running) {
      return undefined
    }

    let stop = false
    const read = () => void ctx.motion.state().then((s) => !stop && setArmed(s.armed), () => !stop && setArmed(false))
    const timer = setInterval(read, ARMED_POLL_MS)

    read()

    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [connected, running, ctx.motion])

  return connected && armed
}
