# robonine/mcp — MCP Bridge

Exposes RoboNine robot and workspace data to AI assistants via two transports:

- **WebMCP** (`navigator.modelContext`) — for web-based AI assistants like Claude.ai
- **Local relay** — for Claude Code and other stdio MCP clients, via the [`robonine-mcp`](../../mcp/README.md) local server

## Requirements

- A browser with native WebMCP support (Chromium 146+ with the `WebMCP Testing` flag), or the [WebMCP extension](https://chromewebstore.google.com/detail/webmcp/angbjhnglmgbaoknfnifedallkocldah).
- The `@mcp-b/webmcp-polyfill` package is bundled and installs `navigator.modelContext` automatically when native support is absent.
- For Claude Code: the `robonine-mcp` local server must be running (`npx robonine-mcp`).

## Availability

The plugin is **installable** — it loads on app start and registers all tools immediately.

| Tool | Description |
|---|---|
| `robonine` | Server info and tool discovery |
| `robot_list` | List currently connected robot arms |
| `robot_get_position` | Get joint angles and end-effector position |
| `robot_set_joints` | Move the arm to specified joint positions |
| `robot_stop` | Disable torque on all servos |
| `user_robot_list` | List the user's registered robots |
| `path_list` | List the user's motion paths |
| `path_read` | Read a motion path by ID |

---

## Tools

### `robonine`

Server info and tool discovery.

**Input:** none

**Output:**

```json
{
  "server": "Robonine WebMCP",
  "tools": ["robot_list", "robot_get_position", "robot_set_joints", "robot_stop", "user_robot_list", "path_list", "path_read"]
}
```

---

### `robot_list`

List currently connected robot arms with their connection state.

**Input:** none

**Output:**

```json
[
  {
    "role": "default",
    "robotId": "abc123",
    "robotModel": "so-arm100",
    "virtual": false,
    "remote": false
  }
]
```

---

### `robot_get_position`

Get the current joint angles and end-effector XYZ position of a connected robot arm.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

**Output:**

```json
{
  "joints": { "joint1": 0.0, "joint2": -0.524, "joint3": 1.047 },
  "position": [0.152, 0.0, 0.341],
  "rotation": [[1,0,0],[0,1,0],[0,0,1]]
}
```

---

### `robot_set_joints`

Move a connected robot arm to specified joint positions. Call `robot_get_position` first to learn joint names.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `joints` | `Record<string, number>` | ✓ | URDF joint name → value. Revolute joints in radians, prismatic in metres. |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

**Output:** `"OK"` on success, or an error string.

---

### `robot_stop`

Disable torque on all servos. The arm goes limp and holds no position.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

**Output:** `"OK"` on success.

---

### `user_robot_list`

List all robots registered to the current user account.

**Output:** JSON array of robot objects.

---

### `path_list`

List all motion paths belonging to the current user.

**Output:** JSON array of path summary objects (without waypoints).

---

### `path_read`

Read a motion path by ID, including all waypoints.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `id` | string | ✓ | Path ID |

**Output:** Full path object with `points` array.

---

## Action atoms

High-level manipulation primitives layered on top of the low-level move/servo tools.
Each atom is one self-contained step of a pick-and-place sequence:
`pregrip` → `grip` → `lift` → `move` → `release`. All require a connected robot
with the `robot.control` scope; `pregrip`/`move` additionally need an IK model.

### `pregrip`

Open the gripper and move the end-effector to a standoff pose near a target object.

| Field | Type | Required | Description |
|---|---|:---:|---|
| `x`, `y`, `z` | number | ✓ | Target object position, metres (URDF world frame). |
| `approach` | `"auto"` \| `"top"` \| `"side"` | | Approach direction. Defaults to `"auto"`. |
| `clearance` | number | | Standoff distance from the object, metres. Defaults to `0.05`. |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

### `grip`

Close the gripper onto an object, stopping early when the force sensor detects contact.

| Field | Type | Required | Description |
|---|---|:---:|---|
| `force` | number | | Target close amount, `0`–`1` (soft upper bound). Defaults to `1`. |
| `contactThreshold` | number | | Raw force reading that counts as contact. Defaults to `500`. |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

**Output:** `{ "gripped": true, "force": 812, "position": 0.74 }`

### `lift`

Raise the end-effector straight up to clear the surface, keeping XY fixed.

| Field | Type | Required | Description |
|---|---|:---:|---|
| `height` | number | | Vertical distance to raise, metres. Defaults to `0.05`. |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

### `move`

Move the end-effector to an XYZ position via inverse kinematics, carrying any held object.

| Field | Type | Required | Description |
|---|---|:---:|---|
| `x`, `y`, `z` | number | ✓ | Target position, metres (URDF world frame). |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

### `release`

Open the gripper to release the held object.

| Field | Type | Required | Description |
|---|---|:---:|---|
| `open` | number | | Open amount, `0`–`1`. Defaults to `1` (fully open). |
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |
