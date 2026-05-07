interface Translations {
  title: string
  description: string
  notConnected: string
  notCalibrated: string
  opencvNotReady: string
  connectButton: string
  startButton: string
  // setup step
  setupTitle: string
  setupDesc: string
  selectCamera: string
  local: string
  remote: string
  detectButton: string
  boardFound: string
  boardNotFound: string
  continueButton: string
  // confirm step
  confirmTitle: string
  confirmDesc: string
  beginButton: string
  // capturing step
  capturingTitle: string
  capturingDesc: string
  poseLabel: string
  posePending: string
  poseMoving: string
  poseCaptured: string
  poseMissed: string
  cancelButton: string
  // computing step
  computingTitle: string
  computingDesc: string
  // result step
  resultTitle: string
  rmsLabel: string
  rmsGood: string
  rmsWarning: string
  rmsError: string
  fxLabel: string
  fyLabel: string
  cxLabel: string
  cyLabel: string
  distLabel: string
  imageSizeLabel: string
  saveButton: string
  retakeButton: string
  // saved step
  savedTitle: string
  savedDesc: string
  doneButton: string
  poseRange: string
  // errors
  tooFewCaptures: string
  calibrationFailed: string
  saveFailed: string
}

export const translations: Record<string, Translations> = {
  en: {
    title: 'Camera calibration',
    description: 'Calibrate the gripper camera using a printed 7×9 checkerboard.',
    notConnected: 'Connect a robot to start calibration.',
    notCalibrated: 'The robot must be calibrated before camera calibration. Run "Calibrate robot" first.',
    opencvNotReady: 'OpenCV is loading…',
    connectButton: 'Connect robot',
    startButton: 'Start calibration',
    setupTitle: 'Select camera',
    setupDesc: 'Choose the gripper camera and verify the checkerboard is visible.',
    selectCamera: 'Camera',
    local: 'local',
    remote: 'remote',
    detectButton: 'Detect board',
    boardFound: 'Board detected',
    boardNotFound: 'Board not found — ensure all squares are visible and the board is flat',
    continueButton: 'Continue',
    confirmTitle: 'Place the checkerboard',
    confirmDesc:
      'Print the 7×9 checkerboard (A4, 20 mm squares) and lay it flat on the surface in front of the robot. Keep it stationary during the entire capture process. The robot will move automatically.',
    beginButton: 'Begin capture',
    capturingTitle: 'Capturing',
    capturingDesc: 'The robot is moving through poses. Keep the checkerboard in place.',
    poseLabel: 'Pose',
    posePending: 'Pending',
    poseMoving: 'Moving…',
    poseCaptured: 'Captured',
    poseMissed: 'Missed',
    cancelButton: 'Cancel',
    computingTitle: 'Computing calibration',
    computingDesc: 'Calculating camera parameters…',
    resultTitle: 'Calibration result',
    rmsLabel: 'Reprojection error',
    rmsGood: 'Good',
    rmsWarning: 'Acceptable — consider retaking for better accuracy',
    rmsError: 'High error — retaking is recommended',
    fxLabel: 'fx',
    fyLabel: 'fy',
    cxLabel: 'cx',
    cyLabel: 'cy',
    distLabel: 'Distortion',
    imageSizeLabel: 'Image size',
    saveButton: 'Save',
    retakeButton: 'Retake',
    savedTitle: 'Calibration saved',
    savedDesc: 'The camera intrinsics have been saved to the robot.',
    doneButton: 'Done',
    poseRange: 'Pose deviation',
    tooFewCaptures: 'Not enough captures. At least 15 successful poses are required.',
    calibrationFailed: 'Calibration failed. Try again with better lighting or a flatter board.',
    saveFailed: 'Failed to save calibration.',
  },
}
