// Pure-Python rclpy shim installed into Pyodide's sys.modules. Student code
// imports rclpy / std_msgs / sensor_msgs / geometry_msgs exactly as on a real
// ROS2 system; underneath, every call is routed to the _robonine_ros JS bridge
// registered by the worker. Kept as String.raw so Python escape sequences
// survive the template literal.

export const RCLPY_SHIM_SOURCE = String.raw`
import json
import sys
import time
import types

import _robonine_ros as _bridge

try:
    from pyodide.ffi import can_run_sync, run_sync
    _HAS_RUN_SYNC = True
except ImportError:
    _HAS_RUN_SYNC = False

_SPIN_TICK_MS = 5


# ── Message base ──────────────────────────────────────────────────────────────

def _to_plain(value):
    if isinstance(value, _Msg):
        return value.to_dict()
    if hasattr(value, 'tolist'):
        return _to_plain(value.tolist())
    if isinstance(value, (list, tuple)):
        return [_to_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_plain(v) for k, v in value.items()}
    if isinstance(value, (bytes, bytearray)):
        return list(value)
    return value


class _Msg:
    _TYPE = ''
    _SPEC = {}          # field name -> default factory
    _NESTED = {}        # field name -> message class
    _LIST_NESTED = {}   # field name -> element message class

    def __init__(self, **kwargs):
        for field, factory in self._SPEC.items():
            setattr(self, field, factory())
        for key, value in kwargs.items():
            if key not in self._SPEC:
                raise AttributeError("%s has no field '%s'" % (type(self).__name__, key))
            setattr(self, key, value)

    def to_dict(self):
        return {field: _to_plain(getattr(self, field)) for field in self._SPEC}

    @classmethod
    def from_dict(cls, data):
        msg = cls()
        if not isinstance(data, dict):
            return msg
        for field in cls._SPEC:
            if field not in data:
                continue
            raw = data[field]
            if field in cls._NESTED:
                setattr(msg, field, cls._NESTED[field].from_dict(raw))
            elif field in cls._LIST_NESTED and isinstance(raw, list):
                element = cls._LIST_NESTED[field]
                setattr(msg, field, [element.from_dict(v) for v in raw])
            else:
                setattr(msg, field, raw)
        return msg

    def __repr__(self):
        fields = ', '.join('%s=%r' % (f, getattr(self, f)) for f in self._SPEC)
        return '%s(%s)' % (type(self).__name__, fields)


def _msg_class(name, type_name, spec, nested=None, list_nested=None):
    return type(name, (_Msg,), {
        '_TYPE': type_name,
        '_SPEC': spec,
        '_NESTED': nested or {},
        '_LIST_NESTED': list_nested or {},
    })


# ── builtin_interfaces ────────────────────────────────────────────────────────

TimeMsg = _msg_class('Time', 'builtin_interfaces/msg/Time', {'sec': int, 'nanosec': int})
DurationMsg = _msg_class('Duration', 'builtin_interfaces/msg/Duration', {'sec': int, 'nanosec': int})


# ── std_msgs ──────────────────────────────────────────────────────────────────

Header = _msg_class('Header', 'std_msgs/msg/Header', {'stamp': TimeMsg, 'frame_id': str}, nested={'stamp': TimeMsg})
String = _msg_class('String', 'std_msgs/msg/String', {'data': str})
Bool = _msg_class('Bool', 'std_msgs/msg/Bool', {'data': bool})
Int32 = _msg_class('Int32', 'std_msgs/msg/Int32', {'data': int})
Int64 = _msg_class('Int64', 'std_msgs/msg/Int64', {'data': int})
Float32 = _msg_class('Float32', 'std_msgs/msg/Float32', {'data': float})
Float64 = _msg_class('Float64', 'std_msgs/msg/Float64', {'data': float})
MultiArrayDimension = _msg_class('MultiArrayDimension', 'std_msgs/msg/MultiArrayDimension', {'label': str, 'size': int, 'stride': int})
MultiArrayLayout = _msg_class(
    'MultiArrayLayout', 'std_msgs/msg/MultiArrayLayout',
    {'dim': list, 'data_offset': int},
    list_nested={'dim': MultiArrayDimension},
)
Float64MultiArray = _msg_class(
    'Float64MultiArray', 'std_msgs/msg/Float64MultiArray',
    {'layout': MultiArrayLayout, 'data': list},
    nested={'layout': MultiArrayLayout},
)
Float32MultiArray = _msg_class(
    'Float32MultiArray', 'std_msgs/msg/Float32MultiArray',
    {'layout': MultiArrayLayout, 'data': list},
    nested={'layout': MultiArrayLayout},
)


# ── sensor_msgs ───────────────────────────────────────────────────────────────

JointState = _msg_class(
    'JointState', 'sensor_msgs/msg/JointState',
    {'header': Header, 'name': list, 'position': list, 'velocity': list, 'effort': list},
    nested={'header': Header},
)
Image = _msg_class(
    'Image', 'sensor_msgs/msg/Image',
    {'header': Header, 'height': int, 'width': int, 'encoding': str, 'is_bigendian': int, 'step': int, 'data': list},
    nested={'header': Header},
)


# ── geometry_msgs ─────────────────────────────────────────────────────────────

Vector3 = _msg_class('Vector3', 'geometry_msgs/msg/Vector3', {'x': float, 'y': float, 'z': float})
Point = _msg_class('Point', 'geometry_msgs/msg/Point', {'x': float, 'y': float, 'z': float})


def _unit_quaternion_w():
    return 1.0


Quaternion = _msg_class('Quaternion', 'geometry_msgs/msg/Quaternion', {'x': float, 'y': float, 'z': float, 'w': _unit_quaternion_w})
Pose = _msg_class('Pose', 'geometry_msgs/msg/Pose', {'position': Point, 'orientation': Quaternion}, nested={'position': Point, 'orientation': Quaternion})
PoseStamped = _msg_class('PoseStamped', 'geometry_msgs/msg/PoseStamped', {'header': Header, 'pose': Pose}, nested={'header': Header, 'pose': Pose})
Twist = _msg_class('Twist', 'geometry_msgs/msg/Twist', {'linear': Vector3, 'angular': Vector3}, nested={'linear': Vector3, 'angular': Vector3})
Transform = _msg_class('Transform', 'geometry_msgs/msg/Transform', {'translation': Vector3, 'rotation': Quaternion}, nested={'translation': Vector3, 'rotation': Quaternion})
TransformStamped = _msg_class(
    'TransformStamped', 'geometry_msgs/msg/TransformStamped',
    {'header': Header, 'child_frame_id': str, 'transform': Transform},
    nested={'header': Header, 'transform': Transform},
)


# ── QoS ───────────────────────────────────────────────────────────────────────

class ReliabilityPolicy:
    SYSTEM_DEFAULT = 0
    RELIABLE = 1
    BEST_EFFORT = 2


class HistoryPolicy:
    SYSTEM_DEFAULT = 0
    KEEP_LAST = 1
    KEEP_ALL = 2


class DurabilityPolicy:
    SYSTEM_DEFAULT = 0
    TRANSIENT_LOCAL = 1
    VOLATILE = 2


class LivelinessPolicy:
    SYSTEM_DEFAULT = 0
    AUTOMATIC = 1
    MANUAL_BY_TOPIC = 3


class QoSProfile:
    def __init__(self, **kwargs):
        self.depth = kwargs.get('depth', 10)
        self.reliability = kwargs.get('reliability', ReliabilityPolicy.RELIABLE)
        self.history = kwargs.get('history', HistoryPolicy.KEEP_LAST)
        self.durability = kwargs.get('durability', DurabilityPolicy.VOLATILE)
        self.liveliness = kwargs.get('liveliness', LivelinessPolicy.SYSTEM_DEFAULT)


qos_profile_sensor_data = QoSProfile(depth=5, reliability=ReliabilityPolicy.BEST_EFFORT)
qos_profile_system_default = QoSProfile()


# ── Logging ───────────────────────────────────────────────────────────────────

class Logger:
    def __init__(self, name):
        self.name = name

    def _log(self, level, message):
        _bridge.log(level, '[%s] %s' % (self.name, message))

    def debug(self, message, **kwargs):
        self._log('debug', message)

    def info(self, message, **kwargs):
        self._log('info', message)

    def warn(self, message, **kwargs):
        self._log('warn', message)

    def warning(self, message, **kwargs):
        self._log('warn', message)

    def error(self, message, **kwargs):
        self._log('error', message)

    def fatal(self, message, **kwargs):
        self._log('error', message)

    def get_child(self, name):
        return Logger('%s.%s' % (self.name, name))


# ── Clock / Time ──────────────────────────────────────────────────────────────

class RosTime:
    def __init__(self, nanoseconds=0):
        self.nanoseconds = int(nanoseconds)

    def to_msg(self):
        return TimeMsg(sec=self.nanoseconds // 1_000_000_000, nanosec=self.nanoseconds % 1_000_000_000)

    def seconds_nanoseconds(self):
        return (self.nanoseconds // 1_000_000_000, self.nanoseconds % 1_000_000_000)


class Clock:
    def now(self):
        return RosTime(int(time.time() * 1e9))


# ── Graph state ───────────────────────────────────────────────────────────────

class _Context:
    def __init__(self):
        self.initialized = False
        self.nodes = []
        self.subscriptions = {}


_ctx = _Context()


class Publisher:
    def __init__(self, msg_type, topic):
        self.msg_type = msg_type
        self.topic = topic
        self._destroyed = False

    def publish(self, msg):
        if self._destroyed:
            return
        if not isinstance(msg, self.msg_type):
            raise TypeError('publish() expected %s, got %s' % (self.msg_type.__name__, type(msg).__name__))
        _bridge.publish(self.topic, msg._TYPE, json.dumps(msg.to_dict()))

    def get_subscription_count(self):
        return 1


class Subscription:
    def __init__(self, msg_type, topic, callback):
        self.msg_type = msg_type
        self.topic = topic
        self.callback = callback
        self.active = True


class Timer:
    def __init__(self, period_sec, callback):
        self.period_ms = max(1.0, float(period_sec) * 1000.0)
        self.callback = callback
        self.next_due = time.monotonic() * 1000.0 + self.period_ms
        self.active = True

    def cancel(self):
        self.active = False

    def reset(self):
        self.next_due = time.monotonic() * 1000.0 + self.period_ms
        self.active = True

    def is_canceled(self):
        return not self.active


class Parameter:
    def __init__(self, name, value):
        self.name = name
        self.value = value

    def get_parameter_value(self):
        return self

    @property
    def double_value(self):
        return float(self.value)

    @property
    def integer_value(self):
        return int(self.value)

    @property
    def string_value(self):
        return str(self.value)

    @property
    def bool_value(self):
        return bool(self.value)


class Node:
    def __init__(self, node_name, **kwargs):
        self._node_name = node_name
        self._parameters = {}
        self._publishers = []
        self._subscriptions = []
        self._timers = []
        self._logger = Logger(node_name)
        self._clock = Clock()
        self._destroyed = False
        _ctx.nodes.append(self)

    def get_name(self):
        return self._node_name

    def get_logger(self):
        return self._logger

    def get_clock(self):
        return self._clock

    def declare_parameter(self, name, value=None, descriptor=None):
        if name not in self._parameters:
            self._parameters[name] = Parameter(name, value)
        return self._parameters[name]

    def declare_parameters(self, namespace, parameters):
        result = []
        for entry in parameters:
            name = entry[0]
            value = entry[1] if len(entry) > 1 else None
            prefixed = '%s.%s' % (namespace, name) if namespace else name
            result.append(self.declare_parameter(prefixed, value))
        return result

    def get_parameter(self, name):
        if name not in self._parameters:
            raise KeyError("parameter '%s' was not declared" % name)
        return self._parameters[name]

    def has_parameter(self, name):
        return name in self._parameters

    def set_parameters(self, parameters):
        for param in parameters:
            self._parameters[param.name] = param
        return parameters

    def create_publisher(self, msg_type, topic, qos_profile=10):
        publisher = Publisher(msg_type, topic)
        self._publishers.append(publisher)
        return publisher

    def create_subscription(self, msg_type, topic, callback, qos_profile=10):
        subscription = Subscription(msg_type, topic, callback)
        self._subscriptions.append(subscription)
        _ctx.subscriptions.setdefault(topic, []).append(subscription)
        _bridge.subscribe(topic)
        return subscription

    def create_timer(self, timer_period_sec, callback):
        timer = Timer(timer_period_sec, callback)
        self._timers.append(timer)
        return timer

    def destroy_timer(self, timer):
        timer.cancel()
        if timer in self._timers:
            self._timers.remove(timer)

    def destroy_publisher(self, publisher):
        publisher._destroyed = True
        if publisher in self._publishers:
            self._publishers.remove(publisher)

    def destroy_subscription(self, subscription):
        subscription.active = False
        if subscription in self._subscriptions:
            self._subscriptions.remove(subscription)

    def count_publishers(self, topic):
        return 1

    def count_subscribers(self, topic):
        return 1

    def destroy_node(self):
        if self._destroyed:
            return
        self._destroyed = True
        for timer in self._timers:
            timer.cancel()
        for subscription in self._subscriptions:
            subscription.active = False
        for publisher in self._publishers:
            publisher._destroyed = True
        if self in _ctx.nodes:
            _ctx.nodes.remove(self)


# ── Executor ──────────────────────────────────────────────────────────────────

def _dispatch_incoming():
    raw = _bridge.drain()
    if raw == '[]':
        return
    for entry in json.loads(raw):
        subscriptions = _ctx.subscriptions.get(entry['topic'], [])
        for subscription in subscriptions:
            if subscription.active:
                subscription.callback(subscription.msg_type.from_dict(entry['data']))


def _fire_timers():
    now_ms = time.monotonic() * 1000.0
    for node in list(_ctx.nodes):
        for timer in list(node._timers):
            if timer.active and now_ms >= timer.next_due:
                timer.next_due = max(timer.next_due + timer.period_ms, now_ms - timer.period_ms)
                timer.callback()


def _process_once():
    _dispatch_incoming()
    _fire_timers()


def _sleep_ms(ms):
    if _HAS_RUN_SYNC and can_run_sync():
        run_sync(_bridge.sleep(ms))
    else:
        deadline = time.monotonic() + ms / 1000.0
        while time.monotonic() < deadline:
            pass


# ── rclpy top-level API ───────────────────────────────────────────────────────

def init(args=None, context=None):
    _ctx.initialized = True


def ok(context=None):
    return bool(_bridge.ok())


def shutdown(context=None):
    _ctx.initialized = False


def try_shutdown(context=None):
    _ctx.initialized = False


def spin(node, executor=None):
    while _bridge.ok():
        _process_once()
        _sleep_ms(_SPIN_TICK_MS)
    # The platform Stop button behaves like Ctrl+C on a real ROS2 system.
    raise KeyboardInterrupt()


def spin_once(node, executor=None, timeout_sec=None):
    if not _bridge.ok():
        raise KeyboardInterrupt()
    _process_once()
    _sleep_ms(min(_SPIN_TICK_MS, (timeout_sec or 0.005) * 1000.0))


def spin_until_future_complete(node, future, executor=None, timeout_sec=None):
    deadline = None if timeout_sec is None else time.monotonic() + timeout_sec
    while _bridge.ok() and not future.done():
        _process_once()
        _sleep_ms(_SPIN_TICK_MS)
        if deadline is not None and time.monotonic() >= deadline:
            break


def _robonine_reset():
    _ctx.initialized = False
    _ctx.nodes = []
    _ctx.subscriptions = {}


# ── Module registration ───────────────────────────────────────────────────────

def _module(name, **attrs):
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


_rclpy = _module(
    'rclpy',
    init=init, ok=ok, shutdown=shutdown, try_shutdown=try_shutdown,
    spin=spin, spin_once=spin_once, spin_until_future_complete=spin_until_future_complete,
    _robonine_reset=_robonine_reset,
)
_rclpy.node = _module('rclpy.node', Node=Node, Publisher=Publisher, Subscription=Subscription, Timer=Timer, Parameter=Parameter)
_rclpy.qos = _module(
    'rclpy.qos',
    QoSProfile=QoSProfile, ReliabilityPolicy=ReliabilityPolicy, HistoryPolicy=HistoryPolicy,
    DurabilityPolicy=DurabilityPolicy, LivelinessPolicy=LivelinessPolicy,
    qos_profile_sensor_data=qos_profile_sensor_data, qos_profile_system_default=qos_profile_system_default,
)
_rclpy.logging = _module('rclpy.logging', get_logger=lambda name: Logger(name))
_rclpy.timer = _module('rclpy.timer', Timer=Timer)
_rclpy.publisher = _module('rclpy.publisher', Publisher=Publisher)
_rclpy.subscription = _module('rclpy.subscription', Subscription=Subscription)
_rclpy.parameter = _module('rclpy.parameter', Parameter=Parameter)
_rclpy.clock = _module('rclpy.clock', Clock=Clock)
_rclpy.time = _module('rclpy.time', Time=RosTime)
_rclpy.duration = _module('rclpy.duration', Duration=DurationMsg)

_builtin_interfaces = _module('builtin_interfaces')
_builtin_interfaces.msg = _module('builtin_interfaces.msg', Time=TimeMsg, Duration=DurationMsg)

_std_msgs = _module('std_msgs')
_std_msgs.msg = _module(
    'std_msgs.msg',
    Header=Header, String=String, Bool=Bool, Int32=Int32, Int64=Int64, Float32=Float32, Float64=Float64,
    Float32MultiArray=Float32MultiArray, Float64MultiArray=Float64MultiArray,
    MultiArrayLayout=MultiArrayLayout, MultiArrayDimension=MultiArrayDimension,
)

_sensor_msgs = _module('sensor_msgs')
_sensor_msgs.msg = _module('sensor_msgs.msg', JointState=JointState, Image=Image)

_geometry_msgs = _module('geometry_msgs')
_geometry_msgs.msg = _module(
    'geometry_msgs.msg',
    Vector3=Vector3, Point=Point, Quaternion=Quaternion, Pose=Pose, PoseStamped=PoseStamped,
    Twist=Twist, Transform=Transform, TransformStamped=TransformStamped,
)
`
