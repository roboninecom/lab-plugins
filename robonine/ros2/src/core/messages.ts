import type { RosMessage } from './rosCore'

// Default-constructed ROS message shapes used by the C++ runtime. The Python
// side builds equivalent dicts in the rclpy shim; both produce the same plain
// JSON structure on the wire.

type MessageFactory = () => RosMessage

function stamp(): RosMessage {
  return { sec: 0, nanosec: 0 }
}

function header(): RosMessage {
  return { stamp: stamp(), frame_id: '' }
}

function multiArrayLayout(): RosMessage {
  return { dim: [], data_offset: 0 }
}

export const MESSAGE_FACTORIES: Record<string, MessageFactory> = {
  'builtin_interfaces/msg/Time': stamp,
  'builtin_interfaces/msg/Duration': stamp,
  'std_msgs/msg/Header': header,
  'std_msgs/msg/String': () => ({ data: '' }),
  'std_msgs/msg/Bool': () => ({ data: false }),
  'std_msgs/msg/Int32': () => ({ data: 0 }),
  'std_msgs/msg/Int64': () => ({ data: 0 }),
  'std_msgs/msg/Float32': () => ({ data: 0 }),
  'std_msgs/msg/Float64': () => ({ data: 0 }),
  'std_msgs/msg/MultiArrayDimension': () => ({ label: '', size: 0, stride: 0 }),
  'std_msgs/msg/MultiArrayLayout': multiArrayLayout,
  'std_msgs/msg/Float32MultiArray': () => ({ layout: multiArrayLayout(), data: [] }),
  'std_msgs/msg/Float64MultiArray': () => ({ layout: multiArrayLayout(), data: [] }),
  'sensor_msgs/msg/JointState': () => ({ header: header(), name: [], position: [], velocity: [], effort: [] }),
  'sensor_msgs/msg/Image': () => ({ header: header(), height: 0, width: 0, encoding: '', is_bigendian: 0, step: 0, data: [] }),
  'geometry_msgs/msg/Vector3': () => ({ x: 0, y: 0, z: 0 }),
  'geometry_msgs/msg/Point': () => ({ x: 0, y: 0, z: 0 }),
  'geometry_msgs/msg/Quaternion': () => ({ x: 0, y: 0, z: 0, w: 1 }),
  'geometry_msgs/msg/Pose': () => ({ position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }),
  'geometry_msgs/msg/Twist': () => ({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }),
  'geometry_msgs/msg/Transform': () => ({ translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }),
  'geometry_msgs/msg/TransformStamped': () => ({
    header: header(),
    child_frame_id: '',
    transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  }),
}

export function createMessage(typeName: string): RosMessage {
  const factory = MESSAGE_FACTORIES[typeName]

  if (!factory) {
    throw new Error(`Unknown message type: ${typeName}`)
  }

  return factory()
}
