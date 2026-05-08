import type { PluginServiceFactory } from '@robonine/plugin-sdk'

export interface CameraCalibration {
  model: 'standard' | 'wide-angle'
  fx: number
  fy: number
  cx: number
  cy: number
  /** Wide-angle: [k1, k2, p1, p2, k3, k4, k5, k6]. Standard: [k1, k2, p1, p2, k3]. */
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
