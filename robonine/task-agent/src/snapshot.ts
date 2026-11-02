import type { MotionApi, RobotSnapshot } from './sdkExtras'
import type { CameraHandle } from '@robonine/plugin-sdk'

/** How a connected camera is used (chosen by the operator; remembered in this browser). */
export interface CameraRoles {
  /** Side-by-side stereo camera: its frame is split into stereo_left and stereo_right, never flipped. */
  stereo: string | null
  /** Wrist camera: its raw frame (a viewer's flip is for people; mirrored frames break the vision). */
  wrist: string | null
}

const ROLES_KEY = 'robonine.task-agent.camera-roles'

/** The remembered camera roles, or none. */
export function loadRoles(): CameraRoles {
  try {
    const saved = JSON.parse(localStorage.getItem(ROLES_KEY) ?? '{}') as Partial<CameraRoles>

    return { stereo: saved.stereo ?? null, wrist: saved.wrist ?? null }
  } catch {
    return { stereo: null, wrist: null }
  }
}

/** Remembers camera roles in this browser. */
export function saveRoles(roles: CameraRoles): void {
  try {
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles))
  } catch {
    // private mode: roles are asked again next time
  }
}

/**
 * The current frame of a camera stream as an image bitmap.
 *
 * @param stream - The camera stream.
 * @returns The frame.
 */
async function grab(stream: MediaStream): Promise<ImageBitmap> {
  const video = document.createElement('video')

  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()

  const frame = await createImageBitmap(video)

  video.pause()
  video.srcObject = null

  return frame
}

/**
 * Draws part of a frame scaled to `width` and encodes it as JPEG (base64).
 *
 * @param frame - The frame.
 * @param src - Source rectangle [x, y, w, h].
 * @param width - Output width.
 * @returns JPEG base64 and the output size.
 */
async function encode(frame: ImageBitmap, src: [number, number, number, number], width: number): Promise<{ jpeg: string; width: number; height: number }> {
  const height = Math.round((src[3] / src[2]) * width)
  const canvas = new OffscreenCanvas(width, height)
  const g = canvas.getContext('2d')!

  g.drawImage(frame, src[0], src[1], src[2], src[3], 0, 0, width, height)

  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return { jpeg: btoa(binary), width, height }
}

/**
 * Builds the snapshot provider for the robot session: stereo eyes and wrist view,
 * each `width` pixels wide, with the joints read right after capture.
 *
 * @param cameras - Connected cameras.
 * @param roles - Which camera is which.
 * @param motion - For the joints at capture.
 * @returns The provider.
 */
export function snapshotProvider(cameras: () => CameraHandle[], roles: () => CameraRoles, motion: MotionApi) {
  return async (wanted: string[] | undefined, width: number): Promise<RobotSnapshot[]> => {
    const r = roles()
    const byId = (id: string | null) => cameras().find((c) => c.id === id)
    const out: RobotSnapshot[] = []
    const stereo = byId(r.stereo)
    const wrist = byId(r.wrist)
    const want = (name: string) => !wanted || wanted.length === 0 || wanted.some((w) => name.startsWith(w))
    const stereoFrame = stereo && (want('stereo_left') || want('stereo_right')) ? await grab(stereo.stream) : null
    const wristFrame = wrist && want('wrist') ? await grab(wrist.stream) : null
    const { q } = await motion.state()
    const capturedAt = Date.now()

    if (stereoFrame) {
      const half = stereoFrame.width / 2

      for (const [name, x] of [['stereo_left', 0], ['stereo_right', half]] as const) {
        if (want(name)) {
          out.push({ camera: name, capturedAt, joints: q, ...(await encode(stereoFrame, [x, 0, half, stereoFrame.height], width)) })
        }
      }
    }
    if (wristFrame) {
      out.push({ camera: 'wrist', capturedAt, joints: q, ...(await encode(wristFrame, [0, 0, wristFrame.width, wristFrame.height], width)) })
    }

    return out
  }
}
