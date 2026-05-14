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
  setupDownload: string
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
  computingTitle: string
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
  cameraNameLabel: string
  mirrorHLabel: string
  mirrorVLabel: string
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
    setupDesc: 'Choose the gripper camera and verify the calibration board is visible.',
    setupDownload: 'Download A4 print here',
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
    computingTitle: 'Calculating calibration…',
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
    cameraNameLabel: 'Camera',
    mirrorHLabel: 'Mirror H',
    mirrorVLabel: 'Mirror V',
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
  ru: {
    title: 'Калибровка камеры',
    description: 'Калибровка камеры захвата с помощью распечатанной доски ChArUco (8×5 клеток, 35 мм).',
    notConnected: 'Подключите робота для начала калибровки.',
    notCalibrated: 'Перед калибровкой камеры необходимо откалибровать робота. Сначала выполните «Калибровку робота».',
    opencvNotReady: 'OpenCV загружается…',
    connectButton: 'Подключить робота',
    startButton: 'Начать калибровку',
    setupTitle: 'Выбор камеры',
    setupDesc: 'Выберите камеру захвата и убедитесь, что калибровочная доска видна.',
    setupDownload: 'Скачать распечатку А4',
    selectCamera: 'Камера',
    local: 'локальная',
    remote: 'удалённая',
    lensTypeLabel: 'Тип объектива',
    lensStandard: 'Стандартный',
    lensWideAngle: 'Широкоугольный (до ~120°)',
    squareSizeLabel: 'Размер образца 50 мм',
    detectButton: 'Определить доску',
    boardFound: 'Доска обнаружена',
    boardNotFound: 'Доска не найдена — убедитесь, что маркеры видны и доска плоская',
    continueButton: 'Продолжить',
    confirmTitle: 'Разместите шахматную доску',
    confirmDesc: 'Не двигайте доску или робота во время калибровки, держите поле зрения камеры свободным. Робот будет двигаться автоматически.',
    beginButton: 'Начать захват',
    capturingTitle: 'Захват',
    capturingDesc: 'Робот перемещается по позам. Держите доску на месте.',
    poseLabel: 'Поза',
    posePending: 'Ожидание',
    poseMoving: 'Движение…',
    poseCaptured: 'Захвачена',
    poseMissed: 'Пропущена',
    cancelButton: 'Отмена',
    computingTitle: 'Вычисление калибровки…',
    resultTitle: 'Результат калибровки',
    rmsLabel: 'Ошибка перепроецирования',
    rmsGood: 'Хорошо',
    rmsWarning: 'Приемлемо — рассмотрите повторный захват для большей точности',
    rmsError: 'Высокая ошибка — рекомендуется повторить',
    fxLabel: 'fx',
    fyLabel: 'fy',
    cxLabel: 'cx',
    cyLabel: 'cy',
    distLabel: 'Дисторсия (k1, k2, p1, p2, k3)',
    distWideAngleLabel: 'Дисторсия (k1, k2, p1, p2, k3, k4, k5, k6)',
    imageSizeLabel: 'Размер изображения',
    cameraNameLabel: 'Камера',
    mirrorHLabel: 'Отражение H',
    mirrorVLabel: 'Отражение V',
    saveButton: 'Сохранить',
    retakeButton: 'Повторить',
    savedTitle: 'Калибровка сохранена',
    savedDesc: 'Внутренние параметры камеры сохранены в роботе.',
    doneButton: 'Готово',
    poseRange: 'Отклонение позы',
    tooFewCaptures: 'Недостаточно захватов. Требуется не менее 10 успешных поз.',
    calibrationFailed: 'Калибровка не удалась. Попробуйте снова при лучшем освещении или с более плоской доской.',
    charucoNotSupported: 'Определение ChArUco недоступно в загруженной сборке OpenCV.',
    saveFailed: 'Не удалось сохранить калибровку.',
  },
}
