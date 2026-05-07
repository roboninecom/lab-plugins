import type { PluginServiceFactory } from '@robonine/plugin-sdk'

export interface CameraCalibration {
  fx: number
  fy: number
  cx: number
  cy: number
  /** Distortion coefficients [k1, k2, p1, p2, k3] */
  distCoeffs: [number, number, number, number, number]
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
