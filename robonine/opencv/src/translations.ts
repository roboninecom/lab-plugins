interface Translations {
  description: string
  statusLoading: string
  statusReady: string
  statusError: string
  version: string
  serviceNote: string
}

export const translations: Record<string, Translations> = {
  en: {
    description: 'Loads OpenCV.js and exposes computer vision capabilities to other plugins.',
    statusLoading: 'Loading OpenCV…',
    statusReady: 'OpenCV ready',
    statusError: 'Failed to load OpenCV',
    version: 'Version',
    serviceNote: 'This plugin runs as a background service. Other plugins can access it via context.service("opencv").',
  },
  ru: {
    description: 'Загружает OpenCV.js и предоставляет возможности компьютерного зрения другим плагинам.',
    statusLoading: 'Загрузка OpenCV…',
    statusReady: 'OpenCV готов',
    statusError: 'Ошибка загрузки OpenCV',
    version: 'Версия',
    serviceNote: 'Этот плагин работает как фоновый сервис. Другие плагины могут получить доступ через context.service("opencv").',
  },
}
