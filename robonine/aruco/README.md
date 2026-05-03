# ArUco detector plugin

Detects [ArUco](https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html) fiducial markers in a camera feed using OpenCV. Runs both as an interactive tool and as a background service that other plugins can call.

**Requires:** the `robonine/opencv` plugin (listed automatically as a dependency).

---

## Using the plugin UI

Open the plugin from the tools menu. It requires at least one camera to be connected via the platform camera registry.

### Camera

If more than one camera is available, a dropdown lets you choose which one to use. When there is exactly one camera it is selected automatically.

### Dictionary

Choose the ArUco dictionary that matches the markers you printed. The most common ones are `DICT_4X4_50` (default) and `DICT_5X5_50`. The number after the underscore is the total marker count in the dictionary; larger dictionaries have more unique IDs. Make sure the dictionary you pick matches the one used when generating the markers.

### Marker size

Enter the physical side length of your printed marker in centimetres. This enables **pose estimation**: each detected marker gets a set of 3D axes drawn over it on the video — X (red), Y (green), Z (blue). The axes are computed from the marker's position relative to the camera, using the approximate camera intrinsics (see [Notes on accuracy](#notes-on-accuracy)).

Set the field to `0` or leave it empty to disable pose estimation and axis drawing.

### Detected markers panel

Lists the IDs of all markers currently visible in the frame, updated in real time.

---

## Using the plugin as a service

Install the plugin. Once installed, it runs as a background service under the name `"aruco"`. Other plugins can access it via `context.service("aruco")`.

```ts
import type { ArucoService } from '@robonine-plugins/aruco'

const aruco = context.service('aruco') as ArucoService
await aruco.ready  // wait for OpenCV to load
```

### Basic detection (corners only)

```ts
// imageData comes from a canvas or video frame
const detections = aruco.detectMarkers(imageData)

for (const { id, corners } of detections) {
  console.log(`Marker ${id} at`, corners)
  // corners: [[x,y], [x,y], [x,y], [x,y]]  — top-left, clockwise
}
```

### Pose estimation in camera frame

Pass `markerSize` (the physical side length in metres) to get `rvec` and `tvec` per detection. These describe the marker's orientation and position relative to the camera.

```ts
const detections = aruco.detectMarkers(imageData, { markerSize: 0.05 })  // 5 cm marker

for (const { id, pose } of detections) {
  if (!pose) continue
  console.log(`Marker ${id}`)
  console.log('  rvec (Rodrigues):', pose.rvec)   // [rx, ry, rz] rad
  console.log('  tvec (metres):', pose.tvec)       // [tx, ty, tz] — camera frame
}
```

`tvec[2]` is the distance from the camera to the marker in metres.

You can supply calibrated intrinsics for better accuracy (see [API reference](#apireference) below). When omitted, the focal length is approximated from the image dimensions.

### World-frame position

If a robot is connected, you can transform the camera-frame pose into the URDF world frame. The Robonine arm has a `camera_virtual` link at the camera's optical centre — running FK to that link gives you the camera's world-frame pose.

```ts
// 1. Read current joint angles (requires robot.read scope)
const rawPositions = await context.servo.readJointPositions()
const jointNames = context.robotConfig?.jointServoId
  ? Object.keys(context.robotConfig.jointServoId)
  : []
const jointAngles = Object.fromEntries(
  jointNames.map((name, i) => [name, rawPositions?.[i] ?? 0])
)

// 2. Get camera pose in world frame
const cameraPose = await context.kinematics.forwardKinematics(jointAngles, 'camera_virtual')

// 3. Detect markers with world-frame output
const detections = aruco.detectMarkers(imageData, {
  markerSize: 0.05,
  cameraPose,
})

for (const { id, pose } of detections) {
  if (!pose?.worldPosition) continue
  const [x, y, z] = pose.worldPosition
  console.log(`Marker ${id} at world position (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) m`)
}
```

`worldPosition` and `worldRotation` are `undefined` when `cameraPose` is not supplied or the robot is not connected.

---

## API reference

### `detectMarkers(imageData, options?)`

```ts
detectMarkers(imageData: ImageData, options?: ArucoDetectOptions): ArucoDetection[]
```

Synchronous. Returns immediately with whatever OpenCV has found in the current frame. Returns `[]` when OpenCV is not yet ready or an internal error occurs.

#### `ArucoDetectOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `dictId` | `number` | `0` (DICT_4X4_50) | OpenCV predefined dictionary ID. Use constants from `ARUCO_DICTS`. |
| `markerSize` | `number` | `undefined` | Physical side length in metres. Required to populate `pose`. |
| `cameraIntrinsics` | `CameraIntrinsics` | `undefined` | Calibrated camera parameters. When omitted, focal length is approximated (see below). |
| `cameraPose` | `FKResult` | `undefined` | Camera pose in URDF world frame (from `context.kinematics.forwardKinematics`). Required to populate `pose.worldPosition` / `pose.worldRotation`. |

#### `CameraIntrinsics`

```ts
interface CameraIntrinsics {
  fx: number                                          // focal length x (pixels)
  fy: number                                          // focal length y (pixels)
  cx: number                                          // principal point x (pixels)
  cy: number                                          // principal point y (pixels)
  distCoeffs?: [number, number, number, number, number]  // [k1, k2, p1, p2, k3]; defaults to zeros
}
```

### `ArucoDetection`

```ts
interface ArucoDetection {
  id: number
  corners: [[number,number], [number,number], [number,number], [number,number]]
  pose?: MarkerPose
}
```

`corners` are pixel coordinates of the four marker corners in the input `ImageData`, ordered top-left → top-right → bottom-right → bottom-left.

`pose` is present only when `markerSize` was supplied to `detectMarkers`.

### `MarkerPose`

```ts
interface MarkerPose {
  rvec: [number, number, number]   // Rodrigues rotation vector (camera frame)
  tvec: [number, number, number]   // marker centre translation in metres (camera frame)
  worldPosition?: [number, number, number]
  worldRotation?: [[number,number,number], [number,number,number], [number,number,number]]
}
```

`worldPosition` and `worldRotation` are present only when `cameraPose` was provided.

`worldRotation` is a row-major 3×3 rotation matrix that transforms vectors from the marker frame to the URDF world frame.

### `ARUCO_DICTS`

Named constants for all OpenCV predefined dictionaries:

```ts
ARUCO_DICTS['4X4_50']   // = 0  (default)
ARUCO_DICTS['4X4_100']  // = 1
ARUCO_DICTS['5X5_50']   // = 4
ARUCO_DICTS['6X6_50']   // = 8
// … and so on up to ORIGINAL = 16
```

Pass the value (a number) as `options.dictId`.

---

## Notes on accuracy

**Intrinsics approximation.** When `cameraIntrinsics` is not supplied, the focal length is estimated as `0.8 × max(imageWidth, imageHeight)` and the principal point is assumed to be the image centre. This is a rough approximation that works reasonably well for standard webcams at typical marker sizes and distances, but it will produce errors — especially for markers near the image edges or at steep angles. For precise measurements, calibrate your camera (e.g. using a chessboard pattern with `cv.calibrateCamera`) and pass the resulting values as `cameraIntrinsics`.

**Coordinate frame.** `tvec` and `worldPosition` are in metres. The marker frame follows OpenCV's ArUco convention: the marker lies in the Z=0 plane, X points right, Y points up (when facing the marker), and Z points toward the camera.

**Performance.** `detectMarkers` is synchronous and runs on the main thread. On slower devices, avoid calling it every frame — the demo UI skips every other frame. For heavy workloads, consider running detection in a Web Worker (not currently supported by the plugin).
