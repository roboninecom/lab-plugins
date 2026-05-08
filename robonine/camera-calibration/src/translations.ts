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
  lensTypeLabel: string
  lensStandard: string
  lensWideAngle: string
  squareSizeLabel: string
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
  distWideAngleLabel: string
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
  charucoNotSupported: string
  saveFailed: string
}

export const translations: Record<string, Translations> = {
  en: {
    title: 'Camera calibration',
    description: 'Calibrate the gripper camera using a printed ChArUco board (8×5 squares, 35 mm).',
    notConnected: 'Connect a robot to start calibration.',
    notCalibrated: 'The robot must be calibrated before camera calibration. Run "Calibrate robot" first.',
    opencvNotReady: 'OpenCV is loading…',
    connectButton: 'Connect robot',
    startButton: 'Start calibration',
    setupTitle: 'Select camera',
    setupDesc: 'Choose the gripper camera and verify the ChArUco board is visible.',
    selectCamera: 'Camera',
    local: 'local',
    remote: 'remote',
    lensTypeLabel: 'Lens type',
    lensStandard: 'Standard',
    lensWideAngle: 'Wide-angle (up to ~120°)',
    squareSizeLabel: 'Size of the 50mm sample',
    detectButton: 'Detect board',
    boardFound: 'Board detected',
    boardNotFound: 'Board not found — ensure markers are visible and the board is flat',
    continueButton: 'Continue',
    confirmTitle: 'Place the checkerboard',
    confirmDesc: 'Do not move the board or the robot during calibration, and keep the camera view unobstructed. The robot will move automatically.',
    beginButton: 'Begin capture',
    capturingTitle: 'Capturing',
    capturingDesc: 'The robot is moving through poses. Keep the board in place.',
    poseLabel: 'Pose',
    posePending: 'Pending',
    poseMoving: 'Moving…',
    poseCaptured: 'Captured',
    poseMissed: 'Missed',
    cancelButton: 'Cancel',
    resultTitle: 'Calibration result',
    rmsLabel: 'Reprojection error',
    rmsGood: 'Good',
    rmsWarning: 'Acceptable — consider retaking for better accuracy',
    rmsError: 'High error — retaking is recommended',
    fxLabel: 'fx',
    fyLabel: 'fy',
    cxLabel: 'cx',
    cyLabel: 'cy',
    distLabel: 'Distortion (k1, k2, p1, p2, k3)',
    distWideAngleLabel: 'Distortion (k1, k2, p1, p2, k3, k4, k5, k6)',
    imageSizeLabel: 'Image size',
    saveButton: 'Save',
    retakeButton: 'Retake',
    savedTitle: 'Calibration saved',
    savedDesc: 'The camera intrinsics have been saved to the robot.',
    doneButton: 'Done',
    poseRange: 'Pose deviation',
    tooFewCaptures: 'Not enough captures. At least 10 successful poses are required.',
    calibrationFailed: 'Calibration failed. Try again with better lighting or a flatter board.',
    charucoNotSupported: 'ChArUco detection is not available in the loaded OpenCV build.',
    saveFailed: 'Failed to save calibration.',
  },
}
