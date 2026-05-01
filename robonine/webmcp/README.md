# robonine/mcp — MCP Bridge

Exposes RoboNine robot and workspace data to AI assistants via the [WebMCP API](https://github.com/mcp-b/webmcp) (`navigator.modelContext`).

## Requirements

- A browser with native WebMCP support (Chromium early preview), or the WebMCP browser extension which injects `navigator.modelContext` into the page.
- The `@mcp-b/webmcp-polyfill` package is bundled and installs `navigator.modelContext` automatically when native support is absent.

## Availability

The plugin is **installable** — it loads on app start and registers all tools immediately. All tools are always available regardless of which page is open.

| Tool | Description |
|---|---|
| `robonine` | Server info and tool discovery |
| `user_robot_list` | List the user's registered robots |
| `path_list` | List the user's motion paths |
| `path_read` | Read a motion path by ID |
| `robot_list` | List currently connected robot arms |
| `robot_get_position` | Get joint angles and end-effector position |

---

## Tools

### `robonine`

Server info and tool discovery. Call this to identify the Robonine WebMCP server and get the list of available tools.

**Input:** none

**Output:**

```json
{
  "server": "Robonine WebMCP",
  "tools": ["user_robot_list", "path_list", "path_read", "robot_list", "robot_get_position"]
}
```

---

### `user_robot_list`

List all robots registered to the current user account.

**Input:** none

**Output:** JSON array of robot objects.

```json
[
  {
    "id": "abc123",
    "name": "My SO-ARM100",
    "model": "so-arm100",
    "calibration": { },
    "createdAt": "2025-11-01T12:00:00.000Z"
  }
]
```

---

### `path_list`

List all motion paths belonging to the current user.

**Input:** none

**Output:** JSON array of path summary objects (without waypoints).

```json
[
  {
    "id": "path_001",
    "name": "Pick and place cycle",
    "description": "Picks from tray A and places on conveyor",
    "robotModel": "so-arm100",
    "isPublic": false,
    "createdAt": "2025-12-01T09:30:00.000Z",
    "updatedAt": "2025-12-10T14:00:00.000Z"
  }
]
```

---

### `path_read`

Read a motion path by ID, including all waypoints.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `id` | string | ✓ | Path ID |

**Output:** Full path object with `points` array. Each point is a record mapping joint names to URDF-unit values.

```json
{
  "id": "path_001",
  "name": "Pick and place cycle",
  "robotModel": "so-arm100",
  "isPublic": false,
  "points": [
    { "joint1": 0.0, "joint2": -0.52, "joint3": 1.04, "joint4": 0.0, "joint5": 0.0, "joint6": 0.0 },
    { "joint1": 0.3, "joint2": -0.8, "joint3": 1.2, "joint4": 0.1, "joint5": -0.2, "joint6": 0.0 }
  ]
}
```

---

### `robot_list`

List currently connected robot arms with their connection state.

**Input:** none

**Output:** JSON array of connection objects.

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

Fields:
- `role` — `"default"` (primary/follower arm) or `"leader"`.
- `virtual` — `true` when connected to the software-only simulation service (no hardware).
- `remote` — `true` when connected via WebRTC to a robot on another machine.

---

### `robot_get_position`

Get the current joint angles and end-effector XYZ position of a connected robot arm.

**Input:**

| Field | Type | Required | Description |
|---|---|:---:|---|
| `role` | `"default"` \| `"leader"` | | Connection role. Defaults to `"default"`. |

**Output:** Position object.

```json
{
  "joints": {
    "joint1": 0.0,
    "joint2": -0.524,
    "joint3": 1.047,
    "joint4": 0.0,
    "joint5": 0.0,
    "joint6": 0.0
  },
  "position": [0.152, 0.0, 0.341],
  "rotation": [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0]
  ]
}
```

Fields:
- `joints` — map of URDF joint names to current values. Revolute joints in radians, prismatic joints in metres.
- `position` — end-effector XYZ in metres (URDF world frame), computed via forward kinematics.
- `rotation` — end-effector orientation as a 3×3 row-major rotation matrix.

Returns an error string if no robot is connected for the requested role.
