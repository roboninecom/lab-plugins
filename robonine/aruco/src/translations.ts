interface Translations {
  title: string
  description: string
  statusLoading: string
  statusReady: string
  statusError: string
  serviceNote: string
  noCameras: string
  camera: string
  dictionary: string
  detectedMarkers: string
  noMarkers: string
  local: string
  remote: string
}

export const translations: Record<string, Translations> = {
  en: {
    title: 'ArUco detector',
    description: 'Detects ArUco markers in the camera feed using OpenCV.',
    statusLoading: 'Loading OpenCV…',
    statusReady: 'Ready',
    statusError: 'OpenCV unavailable',
    serviceNote: 'This plugin also runs as a background service. Other plugins can call context.service("aruco").detectMarkers(imageData).',
    noCameras: 'No cameras available. Connect a camera to start detection.',
    camera: 'Camera',
    dictionary: 'Dictionary',
    detectedMarkers: 'Detected markers',
    noMarkers: 'No markers in frame',
    local: 'local',
    remote: 'remote',
  },
  ru: {
    title: 'Детектор ArUco',
    description: 'Обнаруживает маркеры ArUco в видеопотоке с помощью OpenCV.',
    statusLoading: 'Загрузка OpenCV…',
    statusReady: 'Готово',
    statusError: 'OpenCV недоступен',
    serviceNote: 'Плагин также работает как фоновый сервис. Другие плагины могут вызвать context.service("aruco").detectMarkers(imageData).',
    noCameras: 'Камеры не найдены. Подключите камеру для запуска детекции.',
    camera: 'Камера',
    dictionary: 'Словарь',
    detectedMarkers: 'Обнаруженные маркеры',
    noMarkers: 'Маркеры в кадре отсутствуют',
    local: 'локальная',
    remote: 'удалённая',
  },
}
