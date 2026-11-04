export interface Copies {
  title: string
  experimental: string
  warning: string
  notConnected: string
  connect: string
  notUsb: string
  reconnectUsb: string
  noBaudSwitch: string
  scan: string
  scanning: string
  colId: string
  colModel: string
  colFirmware: string
  colStatus: string
  noReply: string
  untested: string
  step1: string
  step1Hint: string
  downloadBackup: string
  step2: string
  step2Hint: string
  chooseBackup: string
  backupConfirmed: string
  backupMismatch: string
  step3: string
  step3Hint: string
  typeFlash: string
  installAll: string
  install: string
  rollback: string
  recover: string
  alreadyInstalled: string
  phasePreflight: string
  phaseTransfer: string
  phaseVerify: string
  phaseRestore: string
  done: string
  failed: string
  downloadReport: string
  isolateTitle: string
  isolateRollback: string
  isolateRecover: string
  checkBus: string
  isolated: string
  notIsolated: string
  powerCycleNow: string
  startRecovery: string
  reconnectOthers: string
  cancel: string
  close: string
  baudSwitch: string
  releaseLabel: string
  needBackupHint: string
  busyHint: string
  modelUnsupported: string
  motionTitle: string
  motionHint: string
  motionUnavailable: string
  motionStandard: string
  motionV9: string
  motionFallback: string
  gravityTitle: string
  gravityHint: string
  gravityNeedsV9: string
  gravityCalibrate: string
  gravityRecalibrate: string
  gravityProgress: string
  gravityFitted: string
  gravityOn: string
  gravityOff: string
  gravityDone: string
  gravityStopped: string
}

export const translations: Record<string, Copies> = {
  en: {
    title: 'Servo firmware',
    experimental: 'Experimental',
    warning:
      'Robonine v9 is experimental research firmware. Flashing can leave a servo unusable and recovery is not guaranteed. Support the arm so it cannot fall, use a stable power supply, and do not unplug anything during a transfer.',
    notConnected: 'Only USB is supported for managing firmware: the upload switches the servo bus to another speed mid-transfer, which Bluetooth, virtual and remote connections cannot do.',
    connect: 'Connect over USB',
    notUsb: 'Only USB is supported for managing firmware: the upload switches the servo bus to another speed mid-transfer, which Bluetooth, virtual and remote connections cannot do.',
    reconnectUsb: 'Disconnect the robot and connect it again over USB.',
    noBaudSwitch:
      'This adapter (ESP32-C3 USB port) cannot change the servo baud rate, which installing firmware needs. Use a USB-to-serial servo adapter (CH343).',
    scan: 'Read servos',
    scanning: 'Reading…',
    colId: 'ID',
    colModel: 'Model',
    colFirmware: 'Firmware',
    colStatus: 'Status',
    noReply: 'no reply',
    untested: 'untested version',
    step1: '1. Download the settings backup',
    step1Hint:
      'The old firmware cannot be read back from a servo. What makes each servo yours (ID, calibration, limits) is in this file. Keep it: rolling back needs it, and we do not store it.',
    downloadBackup: 'Download backup',
    step2: '2. Confirm you saved it',
    step2Hint: 'Choose the file you just saved. Installing unlocks once it matches the servos.',
    chooseBackup: 'Choose backup file…',
    backupConfirmed: 'Backup matches all servos.',
    backupMismatch: 'This file does not match the connected servos',
    step3: '3. Install',
    step3Hint: 'Servos are flashed one at a time; the others stay connected and untouched. About 10 seconds each.',
    typeFlash: 'Type FLASH to confirm',
    installAll: 'Install Robonine v9 on all servos',
    install: 'Install v9',
    rollback: 'Roll back to factory',
    recover: 'Recover…',
    alreadyInstalled: 'installed',
    phasePreflight: 'Checking…',
    phaseTransfer: 'Uploading',
    phaseVerify: 'Verifying…',
    phaseRestore: 'Restoring settings…',
    done: 'Done',
    failed: 'Failed',
    downloadReport: 'Report',
    isolateTitle: 'Only this servo on the bus',
    isolateRollback:
      'Factory firmware may restart this servo as ID 1, which would collide with another servo. Unplug every other servo so only servo {id} stays connected, then check the bus.',
    isolateRecover:
      'Recovery talks to whichever servo is in its bootloader, without an ID. Leave only the servo to recover connected (the USB adapter stays plugged in), then check the bus.',
    checkBus: 'Check the bus',
    isolated: 'Only one servo is connected.',
    notIsolated: 'Other servos still answer: {ids}',
    powerCycleNow: 'Now unplug the servo’s power and plug it back in. Waiting up to 60 seconds…',
    startRecovery: 'Start recovery',
    reconnectOthers: 'Servo {id} is done. You can plug the other servos back in.',
    cancel: 'Cancel',
    close: 'Close',
    baudSwitch: 'baud switch {ms} ms',
    releaseLabel: 'Firmware to install',
    needBackupHint: 'Download the settings backup and confirm it first (steps 1 and 2).',
    busyHint: 'Wait for the current operation to finish.',
    modelUnsupported: 'Model {model} is not supported by this firmware: skipped.',
    motionTitle: '4. Motion protocol',
    motionHint: 'Robonine v9 lets each servo plan smooth movements itself. The gripper keeps the standard protocol. The choice is remembered for this robot.',
    motionUnavailable: 'Robonine v9 motion becomes available once every arm servo runs Robonine v9.',
    motionStandard: 'Standard',
    motionV9: 'Robonine v9 (experimental)',
    motionFallback: 'Servos {ids} could not start v9 and run on the standard protocol.',
    gravityTitle: '5. Gravity compensation',
    gravityHint: 'The servos help hold the arm up against its own weight, so it sags less and lands closer to its targets. Calibration moves the arm one joint at a time through 24 working poses (about three minutes), keeping the gripper's jaws clear of the table, and saves the result to this robot. Keep the space around the arm clear.',
    gravityNeedsV9: 'Switch the arm to Robonine v9 motion first.',
    gravityCalibrate: 'Calibrate',
    gravityRecalibrate: 'Calibrate again',
    gravityProgress: 'Calibrating: pose {done} of {total}…',
    gravityFitted: 'Calibrated {date}. Fit error (effort units): {rms}.',
    gravityOn: 'On',
    gravityOff: 'Off',
    gravityDone: 'Gravity compensation calibrated.',
    gravityStopped: 'Calibration stopped: {error}',
  },
  ru: {
    title: 'Прошивка сервоприводов',
    experimental: 'Экспериментально',
    warning:
      'Robonine v9 — экспериментальная исследовательская прошивка. Прошивка может вывести сервопривод из строя, восстановление не гарантировано. Закрепите руку, чтобы она не упала, используйте стабильное питание и ничего не отключайте во время передачи.',
    notConnected: 'Управлять прошивкой можно только по USB: во время загрузки шина сервоприводов переключается на другую скорость, а Bluetooth, виртуальное и удалённое подключение этого не умеют.',
    connect: 'Подключить по USB',
    notUsb: 'Управлять прошивкой можно только по USB: во время загрузки шина сервоприводов переключается на другую скорость, а Bluetooth, виртуальное и удалённое подключение этого не умеют.',
    reconnectUsb: 'Отключите робота и подключите его снова по USB.',
    noBaudSwitch:
      'Этот адаптер (USB-порт ESP32-C3) не может менять скорость шины сервоприводов, а для прошивки это нужно. Используйте USB-адаптер для сервоприводов (CH343).',
    scan: 'Прочитать сервоприводы',
    scanning: 'Чтение…',
    colId: 'ID',
    colModel: 'Модель',
    colFirmware: 'Прошивка',
    colStatus: 'Статус',
    noReply: 'нет ответа',
    untested: 'непроверенная версия',
    step1: '1. Скачайте резервную копию настроек',
    step1Hint:
      'Старую прошивку нельзя прочитать из сервопривода. Всё, что делает каждый сервопривод вашим (ID, калибровка, пределы), — в этом файле. Сохраните его: он нужен для отката, мы его не храним.',
    downloadBackup: 'Скачать копию',
    step2: '2. Подтвердите, что сохранили её',
    step2Hint: 'Выберите только что сохранённый файл. Установка станет доступна, когда он совпадёт с сервоприводами.',
    chooseBackup: 'Выбрать файл копии…',
    backupConfirmed: 'Копия совпадает со всеми сервоприводами.',
    backupMismatch: 'Этот файл не совпадает с подключёнными сервоприводами',
    step3: '3. Установка',
    step3Hint: 'Сервоприводы прошиваются по одному; остальные остаются подключёнными и не затрагиваются. Около 10 секунд на каждый.',
    typeFlash: 'Введите FLASH для подтверждения',
    installAll: 'Установить Robonine v9 на все сервоприводы',
    install: 'Установить v9',
    rollback: 'Вернуть заводскую',
    recover: 'Восстановить…',
    alreadyInstalled: 'установлена',
    phasePreflight: 'Проверка…',
    phaseTransfer: 'Загрузка',
    phaseVerify: 'Проверка прошивки…',
    phaseRestore: 'Восстановление настроек…',
    done: 'Готово',
    failed: 'Ошибка',
    downloadReport: 'Отчёт',
    isolateTitle: 'Только этот сервопривод на шине',
    isolateRollback:
      'Заводская прошивка может перезапустить сервопривод с ID 1 и вызвать конфликт с другим сервоприводом. Отключите все остальные сервоприводы, оставьте только сервопривод {id} и проверьте шину.',
    isolateRecover:
      'Восстановление обращается к сервоприводу в загрузчике без ID. Оставьте подключённым только восстанавливаемый сервопривод (USB-адаптер не отключайте) и проверьте шину.',
    checkBus: 'Проверить шину',
    isolated: 'Подключён только один сервопривод.',
    notIsolated: 'Отвечают другие сервоприводы: {ids}',
    powerCycleNow: 'Теперь отключите питание сервопривода и включите снова. Ожидание до 60 секунд…',
    startRecovery: 'Начать восстановление',
    reconnectOthers: 'Сервопривод {id} готов. Можно снова подключить остальные.',
    cancel: 'Отмена',
    close: 'Закрыть',
    baudSwitch: 'переключение скорости {ms} мс',
    releaseLabel: 'Устанавливаемая прошивка',
    needBackupHint: 'Сначала скачайте резервную копию настроек и подтвердите её (шаги 1 и 2).',
    busyHint: 'Дождитесь окончания текущей операции.',
    modelUnsupported: 'Модель {model} не поддерживается этой прошивкой: пропущен.',
    motionTitle: '4. Протокол движения',
    motionHint: 'В Robonine v9 каждый сервопривод сам планирует плавное движение. Захват остаётся на стандартном протоколе. Выбор запоминается для этого робота.',
    motionUnavailable: 'Движение Robonine v9 станет доступно, когда на всех сервоприводах руки будет Robonine v9.',
    motionStandard: 'Стандартный',
    motionV9: 'Robonine v9 (экспериментально)',
    motionFallback: 'Сервоприводы {ids} не смогли запустить v9 и работают по стандартному протоколу.',
    gravityTitle: '5. Компенсация гравитации',
    gravityHint: 'Сервоприводы помогают удерживать руку против её собственного веса: она меньше провисает и точнее приходит в цель. Калибровка по одному суставу проводит руку через 24 рабочие позы (около трёх минут), не касаясь губками захвата стола, и сохраняет результат для этого робота. Освободите место вокруг руки.',
    gravityNeedsV9: 'Сначала переключите руку на движение Robonine v9.',
    gravityCalibrate: 'Откалибровать',
    gravityRecalibrate: 'Откалибровать заново',
    gravityProgress: 'Калибровка: поза {done} из {total}…',
    gravityFitted: 'Откалибровано {date}. Ошибка модели (единицы усилия): {rms}.',
    gravityOn: 'Вкл',
    gravityOff: 'Выкл',
    gravityDone: 'Компенсация гравитации откалибрована.',
    gravityStopped: 'Калибровка остановлена: {error}',
  },
}
