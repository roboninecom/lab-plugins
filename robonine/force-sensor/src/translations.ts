type T = {
  title: string
  description: string
  beforeYouStart: string
  step1: string
  step2: string
  step3: string
  connectRobot: string
  scanning: string
  noSensors: string
  scanAgain: string
  sensorLabel: (id: number) => string
}

export const translations: Record<string, T> = {
  en: {
    title: 'Force sensor',
    description: 'Monitor force readings from attached sensors in real time.',
    beforeYouStart: 'Before you start',
    step1: 'Connect the force sensor to the robot controller.',
    step2: 'Make sure the sensor is powered on.',
    step3: 'Click "Connect robot".',
    connectRobot: 'Connect robot',
    scanning: 'Scanning for sensors…',
    noSensors: 'No force sensors were detected. Make sure a sensor is connected and try again.',
    scanAgain: 'Reconnect',
    sensorLabel: (id) => `Sensor #${id}`,
  },
  ru: {
    title: 'Датчик силы',
    description: 'Мониторинг показаний датчика силы в реальном времени.',
    beforeYouStart: 'Перед началом',
    step1: 'Подключите датчик силы к контроллеру робота.',
    step2: 'Убедитесь, что датчик включён.',
    step3: 'Нажмите «Подключить робота».',
    connectRobot: 'Подключить робота',
    scanning: 'Поиск датчиков…',
    noSensors: 'Датчики силы не обнаружены. Убедитесь, что датчик подключён, и попробуйте снова.',
    scanAgain: 'Переподключить',
    sensorLabel: (id) => `Датчик #${id}`,
  },
}
