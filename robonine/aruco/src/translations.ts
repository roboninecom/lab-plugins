interface Translations {
  title: string
  description: string
  statusLoading: string
  statusReady: string
  statusError: string
  connectRobotNote: string
  serviceNote: string
  noCameras: string
  camera: string
  dictionary: string
  markerSize: string
  markerSizeUnit: string
  detectedMarkers: string
  noMarkers: string
  local: string
  remote: string
  worldFrame: string
  cameraFrame: string
  intrinsicsCalibrated: string
  intrinsicsEstimated: string
}

export const translations: Record<string, Translations> = {
  en: {
    title: 'ArUco detector',
    description: 'Detects ArUco markers in the camera feed using OpenCV.',
    statusLoading: 'Loading OpenCV…',
    statusReady: 'Ready',
    statusError: 'OpenCV unavailable',
    connectRobotNote: "Connect a robot to see each marker's position in the robot's coordinate frame.",
    serviceNote: 'This plugin also runs as a background service. Other plugins can call context.service("aruco").detectMarkers(imageData, options).',
    noCameras: 'No cameras available. Connect a camera to start detection.',
    camera: 'Camera',
    dictionary: 'Dictionary',
    markerSize: 'Marker size',
    markerSizeUnit: 'cm',
    detectedMarkers: 'Detected markers',
    noMarkers: 'No markers in frame',
    local: 'local',
    remote: 'remote',
    worldFrame: 'relative to base',
    cameraFrame: 'relative to cam.',
    intrinsicsCalibrated: 'Camera calibrated',
    intrinsicsEstimated: 'No calibration (depth inaccurate)',
  },
  ru: {
    title: 'Детектор ArUco',
    description: 'Обнаруживает маркеры ArUco в видеопотоке с помощью OpenCV.',
    statusLoading: 'Загрузка OpenCV…',
    statusReady: 'Готово',
    statusError: 'OpenCV недоступен',
    connectRobotNote: 'Подключите робота, чтобы видеть позицию каждого маркера в системе координат робота.',
    serviceNote: 'Плагин также работает как фоновый сервис. Другие плагины могут вызвать context.service("aruco").detectMarkers(imageData, options).',
    noCameras: 'Камеры не найдены. Подключите камеру для запуска детекции.',
    camera: 'Камера',
    dictionary: 'Словарь',
    markerSize: 'Размер маркера',
    markerSizeUnit: 'см',
    detectedMarkers: 'Обнаруженные маркеры',
    noMarkers: 'Маркеры в кадре отсутствуют',
    local: 'локальная',
    remote: 'удалённая',
    worldFrame: 'отн. базы',
    cameraFrame: 'отн. камеры',
    intrinsicsCalibrated: 'Камера откалибрована',
    intrinsicsEstimated: 'Нет калибровки (глубина неточная)',
  },
}
