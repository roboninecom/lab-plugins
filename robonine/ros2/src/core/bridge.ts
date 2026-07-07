import { COMMAND_TOPIC, JOINT_STATES_TOPIC, type RosCore, commandValues, makeJointState } from './rosCore'
import type { PluginContext, WorldViewApi } from '@robonine/plugin-sdk'

// The robot side of the simulated ROS graph. While a program runs, the bridge
// publishes the arm state on /joint_states (read from the robot connection —
// virtual or real — via the servo API) and applies commands received on
// /forward_position_controller/commands to the robot, mirroring them into the
// WorldView so the 3D view follows. A connection is required to run.

const JOINT_STATES_PERIOD_MS = 100
const ENCODER_MAX = 4095

export interface RobotBridge {
  start(): void
  stop(): void
}

export interface BridgeOptions {
  // The host rebuilds the plugin context object whenever connection state
  // changes, so the bridge must re-read it on every use instead of capturing
  // a snapshot at mount time.
  getContext: () => PluginContext
  core: RosCore
  getWorldView: () => WorldViewApi | null
  onError: (message: string) => void
}

function configJointNames(jointServoId: Record<string, number>): string[] {
  return Object.entries(jointServoId)
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name)
}

export function createRobotBridge(opts: BridgeOptions): RobotBridge {
  const { getContext, core, getWorldView, onError } = opts
  let timer: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  let reading = false
  let writing = false
  let pendingCommand: number[] | null = null
  // Joint order of the latest published /joint_states; incoming command
  // arrays are interpreted in this same order.
  let names: string[] = []

  async function publishJointStates(): Promise<void> {
    const context = getContext()

    if (reading || !context.connection.connected || !context.robotConfig) {
      return
    }
    reading = true
    try {
      const positions = await context.servo.readJointPositions()

      if (positions) {
        names = configJointNames(context.robotConfig.jointServoId)
        core.publish(JOINT_STATES_TOPIC, 'sensor_msgs/msg/JointState', makeJointState(names.slice(0, positions.length), positions))
      }
    } catch {
      // Transient read errors are expected while (dis)connecting; skip the tick.
    } finally {
      reading = false
    }
  }

  async function flushCommands(): Promise<void> {
    if (writing) {
      return
    }
    writing = true
    try {
      while (pendingCommand) {
        const values = pendingCommand
        const context = getContext()

        pendingCommand = null
        applyToWorldView(values)
        if (context.connection.connected && context.robotConfig) {
          await applyToRobot(values)
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      writing = false
    }
  }

  function applyToWorldView(values: number[]): void {
    const worldView = getWorldView()

    if (!worldView) {
      return
    }
    for (let i = 0; i < values.length && i < names.length; i++) {
      worldView.setJoint(names[i], values[i])
    }
  }

  async function applyToRobot(values: number[]): Promise<void> {
    const context = getContext()
    const config = context.robotConfig
    const positions: Array<{ id: number; position: number }> = []

    if (!config) {
      return
    }

    for (let i = 0; i < values.length && i < names.length; i++) {
      const id = config.jointServoId[names[i]]

      if (id !== undefined) {
        const raw = config.jointToEncoder(id, values[i])

        positions.push({ id, position: Math.max(0, Math.min(ENCODER_MAX, raw)) })
      }
    }
    if (positions.length > 0) {
      await context.servo.syncSetPositions(positions)
    }
  }

  return {
    start() {
      if (timer) {
        return
      }
      void publishJointStates()
      timer = setInterval(() => void publishJointStates(), JOINT_STATES_PERIOD_MS)
      unsubscribe = core.subscribe(COMMAND_TOPIC, (msg) => {
        const values = commandValues(msg)

        if (values) {
          pendingCommand = values
          void flushCommands()
        }
      })
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      unsubscribe?.()
      unsubscribe = null
      pendingCommand = null
    },
  }
}
