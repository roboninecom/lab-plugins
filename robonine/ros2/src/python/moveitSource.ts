// Pure-Python moveit_py shim, installed into Pyodide only when the MoveIt 2
// library is enabled in the Libraries panel. It mirrors the moveit.planning
// API surface used in the official ROS2 tutorials: MoveItPy owns an internal
// rclpy node that tracks /joint_states, PlanningComponent turns pose / named /
// joint goals into smooth joint-space trajectories (IK is solved by the host
// platform through the _robonine_ros bridge), and execute() replays the
// trajectory on /forward_position_controller/commands.

export const MOVEIT_SHIM_SOURCE = String.raw`
import json
import sys
import time
import types

import _robonine_ros as _bridge
import rclpy
from rclpy.node import Node as _RclpyNode
from sensor_msgs.msg import JointState as _JointState
from std_msgs.msg import Float64MultiArray as _Float64MultiArray

try:
    from pyodide.ffi import can_run_sync, run_sync
    _HAS_RUN_SYNC = True
except ImportError:
    _HAS_RUN_SYNC = False

_COMMAND_TOPIC = '/forward_position_controller/commands'
_MAX_JOINT_VELOCITY = 1.5
_STEP_SEC = 0.05
_MIN_DURATION_SEC = 0.2
_MAX_DURATION_SEC = 20.0
_STATE_TIMEOUT_SEC = 3.0


class MoveItError(RuntimeError):
    pass


def _moveit_config():
    try:
        return json.loads(_bridge.moveitConfig())
    except Exception:
        return {}


def _smoothstep(t):
    return t * t * (3.0 - 2.0 * t)


def _interpolate(start, goal, velocity_scaling):
    scaling = min(1.0, max(0.01, float(velocity_scaling)))
    max_delta = max((abs(g - s) for s, g in zip(start, goal)), default=0.0)
    if max_delta < 1e-4:
        return [{'positions': list(goal), 'dt': _STEP_SEC}]
    duration = min(_MAX_DURATION_SEC, max(_MIN_DURATION_SEC, max_delta / (_MAX_JOINT_VELOCITY * scaling)))
    steps = max(2, int(round(duration / _STEP_SEC)))
    points = []
    for step in range(1, steps + 1):
        blend = _smoothstep(step / steps)
        points.append({
            'positions': [s + (g - s) * blend for s, g in zip(start, goal)],
            'dt': duration / steps,
        })
    return points


# ── moveit.core ───────────────────────────────────────────────────────────────

class MoveItErrorCodes:
    SUCCESS = 1
    FAILURE = 99999
    PLANNING_FAILED = -1
    NO_IK_SOLUTION = -31


class RobotState:
    """Minimal RobotState: a mutable joint_positions dict."""

    def __init__(self, robot_model=None):
        self.joint_positions = {}


class RobotTrajectory:
    def __init__(self, joint_names, points):
        self.joint_names = list(joint_names)
        self.points = list(points)

    def get_robot_trajectory_msg(self):
        return {'joint_names': self.joint_names, 'points': self.points}

    def __len__(self):
        return len(self.points)


class MotionPlanResponse:
    def __init__(self, trajectory=None, error_code=MoveItErrorCodes.SUCCESS, planning_time=0.0):
        self.trajectory = trajectory
        self.error_code = error_code
        self.planning_time = planning_time

    def __bool__(self):
        return self.error_code == MoveItErrorCodes.SUCCESS


# ── moveit.planning ───────────────────────────────────────────────────────────

class PlanningComponent:
    def __init__(self, name, moveit):
        self._name = name
        self._moveit = moveit
        self._start = None
        self._goal = None

    @property
    def planning_group_name(self):
        return self._name

    def set_start_state_to_current_state(self):
        self._start = None

    def set_start_state(self, configuration_name=None, robot_state=None):
        if robot_state is not None:
            self._start = dict(robot_state.joint_positions)
        elif configuration_name is not None:
            named = self._moveit._named_target(configuration_name)
            if named is None:
                raise MoveItError("Unknown named configuration '%s'" % configuration_name)
            self._start = named
        else:
            self._start = None

    def set_goal_state(self, configuration_name=None, robot_state=None, pose_stamped_msg=None, pose_link=None):
        if pose_stamped_msg is not None:
            pose = getattr(pose_stamped_msg, 'pose', pose_stamped_msg)
            position = pose.position
            self._goal = ('pose', (float(position.x), float(position.y), float(position.z)))
        elif configuration_name is not None:
            self._goal = ('named', configuration_name)
        elif robot_state is not None:
            self._goal = ('joints', dict(robot_state.joint_positions))
        else:
            raise MoveItError('set_goal_state() needs pose_stamped_msg, configuration_name or robot_state')

    def plan(self, *args, **kwargs):
        started = time.monotonic()
        if self._goal is None:
            raise MoveItError('No goal set - call set_goal_state() first')
        current = self._moveit._current_state()
        start = dict(current)
        if self._start:
            start.update(self._start)
        kind, value = self._goal
        if kind == 'pose':
            solution = self._moveit._solve_ik(value, start)
            if solution is None:
                _bridge.log('warn', '[moveit] No IK solution for pose goal (%.3f, %.3f, %.3f)' % value)
                return MotionPlanResponse(None, MoveItErrorCodes.NO_IK_SOLUTION)
            goal = solution
        elif kind == 'named':
            goal = self._moveit._named_target(value)
            if goal is None:
                raise MoveItError("Unknown named configuration '%s' (try 'home')" % value)
        else:
            goal = value
        names = list(self._moveit._joint_names())
        start_vec = [float(start.get(name, 0.0)) for name in names]
        goal_vec = [float(goal.get(name, start.get(name, 0.0))) for name in names]
        points = _interpolate(start_vec, goal_vec, self._moveit._velocity_scaling)
        trajectory = RobotTrajectory(names, points)
        return MotionPlanResponse(trajectory, MoveItErrorCodes.SUCCESS, time.monotonic() - started)


class MoveItPy:
    def __init__(self, node_name='moveit_py', config_dict=None, provide_planning_service=True):
        rclpy.init()
        self._node = _RclpyNode(node_name)
        self._names = None
        self._positions = None
        self._node.create_subscription(_JointState, '/joint_states', self._on_joint_state, 10)
        self._publisher = self._node.create_publisher(_Float64MultiArray, _COMMAND_TOPIC, 10)
        self._velocity_scaling = 1.0

    def _on_joint_state(self, msg):
        self._names = list(msg.name)
        self._positions = [float(value) for value in msg.position]

    def _wait_for_state(self):
        deadline = time.monotonic() + _STATE_TIMEOUT_SEC
        while self._positions is None:
            if not _bridge.ok():
                raise KeyboardInterrupt()
            rclpy._robonine_process_once()
            rclpy._robonine_sleep_ms(20)
            if time.monotonic() >= deadline:
                raise MoveItError('No /joint_states received - is a robot connected?')

    def _current_state(self):
        self._wait_for_state()
        return dict(zip(self._names, self._positions))

    def _joint_names(self):
        self._wait_for_state()
        return self._names

    def _named_target(self, name):
        target = _moveit_config().get('namedTargets', {}).get(name)
        if target is None:
            return None
        return {key: float(value) for key, value in target.items()}

    def _solve_ik(self, target, seed):
        if not _HAS_RUN_SYNC or not can_run_sync():
            raise MoveItError('MoveIt IK needs WebAssembly JSPI - use a recent Chrome')
        raw = run_sync(_bridge.solveIk(json.dumps({'target': list(target), 'seed': seed})))
        solution = json.loads(str(raw))
        if not isinstance(solution, dict):
            return None
        return {key: float(value) for key, value in solution.items()}

    def get_planning_component(self, name):
        return PlanningComponent(name, self)

    def set_max_velocity_scaling_factor(self, value):
        self._velocity_scaling = min(1.0, max(0.01, float(value)))

    def execute(self, robot_trajectory, controllers=None, blocking=True):
        if robot_trajectory is None or len(robot_trajectory.points) == 0:
            raise MoveItError('execute() needs a planned trajectory')
        for point in robot_trajectory.points:
            if not _bridge.ok():
                raise KeyboardInterrupt()
            msg = _Float64MultiArray()
            msg.data = list(point['positions'])
            self._publisher.publish(msg)
            rclpy._robonine_process_once()
            rclpy._robonine_sleep_ms(int(point['dt'] * 1000))
        return True

    def shutdown(self):
        self._node.destroy_node()


# ── Module registration ───────────────────────────────────────────────────────

def _module(name, **attrs):
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


_moveit = _module('moveit', MoveItError=MoveItError)
_moveit.planning = _module('moveit.planning', MoveItPy=MoveItPy, PlanningComponent=PlanningComponent)
_moveit.core = _module('moveit.core')
_moveit.core.robot_state = _module('moveit.core.robot_state', RobotState=RobotState)
_moveit.core.robot_trajectory = _module('moveit.core.robot_trajectory', RobotTrajectory=RobotTrajectory)
_moveit.core.planning_interface = _module(
    'moveit.core.planning_interface',
    MotionPlanResponse=MotionPlanResponse, MoveItErrorCodes=MoveItErrorCodes,
)
`
