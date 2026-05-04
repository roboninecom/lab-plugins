# Robonine plugins

Official plugins for the [Robonine](https://robonine.com) educational robotics platform, maintained by Robonine. Licensed under MIT.

## Included plugins

| Plugin | Slug | Description |
|--------|------|-------------|
| ArUco detector | `robonine/aruco` | Detects ArUco fiducial markers in a camera feed; exposes detections to other plugins |
| Calibrate motors | `robonine/calibrate-motors` | Place joints in home position and save servo offsets |
| Calibrate robot | `robonine/calibrate-robot` | Move joints through their full range to set encoder limits |
| Control robot | `robonine/control-robot` | Manually move each joint using on-screen sliders |
| Force sensor | `robonine/force-sensor` | Read and display force sensor measurements |
| OpenCV | `robonine/opencv` | Loads OpenCV.js and exposes it as a background service |
| Set motor IDs | `robonine/set-motor-ids` | Sequentially assign IDs to servos |
| Teleoperate | `robonine/teleoperate` | Mirror a leader arm to a follower arm with live camera feed |
| WebMCP | `robonine/webmcp` | Exposes robot state and control to AI assistants via the Model Context Protocol |

## Building

```sh
npm install
npm run build
```

Output is written to `dist/` as one `.robo9` file per plugin — a gzip-compressed ESM bundle ready to be served by the platform.

To build a single plugin, pass its slug:

```sh
node --import tsx/esm scripts/buildPlugins.ts aruco
```

**What gets bundled:** everything except React. React is not bundled — plugins share the host app's React instance via `window.__ROBONINE__`. Plugin-local `node_modules` (e.g. `@mcp-b/webmcp-polyfill` in `webmcp/`) are bundled into that plugin's output.

## Developing plugins

See the [Plugin SDK](https://github.com/roboninecom/plugin-sdk) for the full getting-started guide. This section documents the complete API surface.

### Type-checking

```sh
npm install
npm run typecheck
```

### Plugin structure

```
my-plugin/
  src/
    index.ts        # re-exports manifest, PluginRoot, and optionally PluginService
    manifest.ts     # plugin metadata
    plugin.tsx      # React UI component (PluginRoot)
    service.ts      # optional background service (PluginService)
    translations.ts # i18n strings
```

**`src/index.ts`**

```ts
export { manifest } from './manifest'
export { PluginRoot } from './plugin'
export { PluginService } from './service' // omit if no service
export { manifest as default } from './manifest'
```

### Manifest

```ts
import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'your-name',        // lowercase, URL-safe namespace
  slug: 'my-plugin',          // lowercase, URL-safe identifier
  name: { en: 'My plugin', ru: 'Мой плагин' },
  description: { en: 'What it does.', ru: 'Что делает.' },
  icon: 'Wrench',             // Lucide icon name, or inline SVG string
  scopes: ['robot.control'],

  // Optional — if this plugin exposes a service to others:
  provides: 'my-service',

  // Optional — other plugins this one depends on:
  dependencies: [{ vendor: 'robonine', slug: 'opencv' }],
}
```

### Scopes

Declare every capability your plugin needs. The platform enforces these at install and runtime.

| Scope | Grants |
|-------|--------|
| _(none)_ | UI only, no hardware access |
| `robot.read` | Read servo positions and register values |
| `robot.control` | Send position commands |
| `robot.calibration` | Write calibration data to EEPROM |
| `robot.config` | Write servo configuration |
| `robot.leader` | Second independent robot connection (leader role) |
| `robot.local` | Requires physical local presence |
| `camera.read` | Access camera feed |
| `install` | Register a background service (`PluginService`) |
| `user.auth` | Require user sign-in |
| `user.read` | Read user name and email |

### PluginContext

The `context` prop passed to `PluginRoot`.

```ts
interface PluginContext {
  locale: string

  // Robot access — pass 'default' for the main arm, 'leader' for the second arm.
  // Requires the robot.leader scope to use 'leader'.
  robot(role: 'default' | 'leader'): RobotHandle

  // Access a service provided by another installed plugin (requires install scope on that plugin).
  // Returns null if the plugin is not installed or its service hasn't started.
  service(slug: string): unknown | null

  // Camera feeds available in the current session.
  cameras: CameraHandle[]

  // 3D robot visualisation component.
  WorldView: React.ForwardRefExoticComponent<WorldViewProps & React.RefAttributes<WorldViewApi>>

  // Pre-styled UI primitives matching the platform theme.
  ui: {
    Button: React.ComponentType<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; className?: string }>
  }
}
```

#### RobotHandle

```ts
interface RobotHandle {
  connection: { connected: boolean }
  openConnectDialog(): void

  // Prompts the user to confirm before starting motion. Returns true if confirmed.
  showSafetyWarning(): Promise<boolean>

  // Joint-to-servo mapping for the connected model. Null until a robot is connected.
  robotConfig: RobotConfig | null

  servo: ServoHandle
}

interface RobotConfig {
  modelId: string
  jointServoId: Record<string, number>
}

interface ServoHandle {
  readJointPositions(): Promise<number[] | null>
  setJointPositions(positions: number[]): Promise<void>
  // Registers a hardware emergency stop. Returns a cleanup function to unregister.
  registerEmergencyStop(): () => void
}
```

#### CameraHandle

```ts
interface CameraHandle {
  id: string
  label: string
  source: 'local' | 'remote'
  stream: MediaStream
}
```

#### WorldView

```ts
interface WorldViewProps {
  motionMode?: 'instant'
  onLoad?: (joints: JointInfo[]) => void
}

interface WorldViewApi {
  setJoint(name: string, value: number): void
}

interface JointInfo {
  name: string
}
```

### PluginService

A background service runs for the lifetime of the plugin and can be accessed by other plugins via `context.service(slug)`. Export a `PluginService` factory and declare `provides` and `install` in the manifest.

```ts
import type { PluginServiceFactory } from '@robonine/plugin-sdk'

export const PluginService: PluginServiceFactory = (ctx) => {
  // ctx is PluginServiceContext (see below).
  // Return any object — other plugins receive it from context.service(slug).
  return {
    doSomething() { /* … */ },
  }
}
```

#### PluginServiceContext

The `ctx` argument passed to a `PluginServiceFactory`.

```ts
interface PluginServiceContext {
  // Access services from other installed plugins.
  service(slug: string): unknown | null

  // High-level platform APIs available to services:
  getRobotPosition(role: ConnectionRole): Promise<RobotPosition | null>
  listConnectedRobots(): Promise<ConnectedRobot[]>
  listUserRobots(): Promise<UserRobot[]>
  listUserPaths(): Promise<MotionPath[]>
  readPath(id: string): Promise<MotionPath | null>
  stopRobot(role: ConnectionRole): Promise<void>
  moveToPosition(x: number, y: number, z: number, role: ConnectionRole): Promise<void>
  goHome(role: ConnectionRole): Promise<void>
  executePath(id: string, role: ConnectionRole): Promise<void>
}

type ConnectionRole = 'default' | 'leader'
```

### Localization

English (`en`) is the only required locale. Additional languages are optional.

```ts
// translations.ts
export const translations = {
  en: { title: 'My plugin', connectPrompt: 'Connect your robot to get started.' },
  ru: { title: 'Мой плагин', connectPrompt: 'Подключите робота, чтобы начать.' },
} satisfies Record<string, Record<string, string>>
```

```tsx
// plugin.tsx
const t = useMemo(
  () => translations[context.locale as keyof typeof translations] ?? translations.en,
  [context.locale],
)
```
