type T = {
  title: string
  description: string
  connectHardware: string
  motorLabels: Record<number, string>
  progressOf: (step: number, total: number) => string
  progressDone: (done: number) => string
  assignCardTitle: (step: number, label: string) => string
  assignCardStep1: string
  assignCardStep2: (label: string) => string
  assignCardStep3: (step: number) => string
  assigning: string
  assignId: (step: number) => string
  allConfiguredTitle: string
  allConfiguredDescription: (total: number) => string
  finish: string
  doneTitle: string
  doneDescription: string
  startOver: string
  skip: string
  error: string
}

export const translations: Record<string, T> = {
  en: {
    title: 'Set motor IDs',
    description: 'Assign sequential IDs to each motor in your robot arm.',
    connectHardware: 'Connect hardware',
    motorLabels: {
      1: 'Shoulder pan',
      2: 'Shoulder lift',
      3: 'Elbow flex',
      4: 'Wrist flex',
      5: 'Wrist roll',
      6: 'Gripper',
    },
    progressOf: (step, total) => `${step} of ${total}`,
    progressDone: (done) => `${done} done`,
    assignCardTitle: (step, label) => `Assign ID ${step} to the "${label}" motor`,
    assignCardStep1: 'Disconnect all motors from the control board.',
    assignCardStep2: (label) => `Connect only the "${label}" motor to the control board.`,
    assignCardStep3: (step) => `Click "Assign ID ${step}" below.`,
    assigning: 'Assigning…',
    assignId: (step) => `Assign ID ${step}`,
    allConfiguredTitle: 'All motors configured!',
    allConfiguredDescription: (total) => `Each motor has been assigned a unique ID (1–${total}).`,
    finish: 'Disconnect & finish',
    doneTitle: 'Done!',
    doneDescription: 'All motor IDs have been set.',
    startOver: 'Start over',
    skip: 'Skip',
    error: 'Something went wrong. Please try again.',
  },
  ru: {
    title: 'Назначить ID моторов',
    description: 'Назначьте последовательные ID каждому мотору руки-робота.',
    connectHardware: 'Подключить устройство',
    motorLabels: {
      1: 'Плечо (поворот)',
      2: 'Плечо (подъём)',
      3: 'Локоть',
      4: 'Запястье (сгиб)',
      5: 'Запястье (вращение)',
      6: 'Захват',
    },
    progressOf: (step, total) => `${step} из ${total}`,
    progressDone: (done) => `${done} выполнено`,
    assignCardTitle: (step, label) => `Назначить ID ${step} мотору «${label}»`,
    assignCardStep1: 'Отключите все моторы от платы управления.',
    assignCardStep2: (label) => `Подключите к плате управления только мотор «${label}».`,
    assignCardStep3: (step) => `Нажмите «Назначить ID ${step}» ниже.`,
    assigning: 'Назначаю…',
    assignId: (step) => `Назначить ID ${step}`,
    allConfiguredTitle: 'Все моторы настроены!',
    allConfiguredDescription: (total) => `Каждому мотору назначен уникальный ID (1–${total}).`,
    finish: 'Отключить и завершить',
    doneTitle: 'Готово!',
    doneDescription: 'Все ID моторов установлены.',
    startOver: 'Начать заново',
    skip: 'Пропустить',
    error: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
}
