import type { PluginServiceFactory } from '@robonine/plugin-sdk'

export interface CameraCalibration {
  /** Explicit calibration model. Absent on records saved before this field was added. */
  model?: 'standard' | 'wide-angle' | 'fisheye'
  /** Legacy flag kept for backward compat; prefer `model`. */
  fisheye: boolean
  fx: number
  fy: number
  cx: number
  cy: number
  /** Fisheye: [k1, k2, k3, k4]. Standard: [k1, k2, p1, p2, k3]. */
  distCoeffs: number[]
  imageWidth: number
  imageHeight: number
  /** RMS reprojection error in pixels */
  reprojectionError: number
  capturedAt: string
}

export interface CameraCalibrationService {
  ready: Promise<void>
  calibration: CameraCalibration | null
  setCalibration(data: CameraCalibration): void
}

export const PluginService: PluginServiceFactory = () => {
  const service: CameraCalibrationService = {
    ready: Promise.resolve(),
    calibration: null,
    setCalibration(data) {
      this.calibration = data
    },
  }

  return service
}
