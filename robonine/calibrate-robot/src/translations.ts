type T = {
  title: string
  description: string
  beforeYouStart: string
  step1: string
  step2: string
  step3: string
  connectRobot: string
  calibratingDescription: string
  jointsMoved: (moved: number, total: number) => string
  imDone: string
  saving: string
  success: string
  calibrateAgain: string
}

export const translations: Record<string, T> = {
  en: {
    title: 'Calibrate Robot',
    description: 'Record the full range of motion for each joint.',
    beforeYouStart: 'Before you start',
    step1: 'Make sure all motors are connected to the control board.',
    step2: 'Have enough space around the arm for it to move freely.',
    step3: 'Click "Connect robot".',
    connectRobot: 'Connect robot',
    calibratingDescription: 'Move every joint of your robotic arm. For each motor, push it to its maximum position, then pull it back to its minimum. The sliders below will reflect the arm\'s motor angles.',
    jointsMoved: (moved, total) => `Joints moved: ${moved}/${total}`,
    imDone: "I'm done",
    saving: 'Saving…',
    success: 'Calibration saved successfully.',
    calibrateAgain: 'Done',
  },
  ru: {
    title: 'Калибровка робота',
    description: 'Запишите полный диапазон движения каждого сустава.',
    beforeYouStart: 'Перед началом',
    step1: 'Убедитесь, что все моторы подключены к плате управления.',
    step2: 'Убедитесь, что вокруг руки достаточно места для свободного движения.',
    step3: 'Нажмите «Подключить робота».',
    connectRobot: 'Подключить робота',
    calibratingDescription: 'Переместите каждый сустав руки-робота. Для каждого мотора доведите его до максимального положения, затем верните к минимальному. Ползунки ниже отразят углы моторов руки.',
    jointsMoved: (moved, total) => `Суставы пройдены: ${moved}/${total}`,
    imDone: 'Готово',
    saving: 'Сохранение…',
    success: 'Калибровка успешно сохранена.',
    calibrateAgain: 'Готово',
  },
}
