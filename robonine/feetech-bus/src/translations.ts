export interface Copies {
  title: string
  description: string
  servoId: string
  scan: string
  scanning: string
  readAll: string
  reading: string
  connect: string
  notConnected: string
  notConnectedHint: string
  tabMap: string
  tabCustom: string
  colAddr: string
  colName: string
  colBytes: string
  colAccess: string
  colDefault: string
  colRange: string
  colValue: string
  colDescription: string
  sectionEeprom: string
  sectionRam: string
  eepromNote: string
  noData: string
  writeSuccess: string
  writeError: string
  readError: string
  scanFound: string
  scanNone: string
  customReadTitle: string
  customWriteTitle: string
  address: string
  addressHint: string
  length: string
  data: string
  dataHint: string
  read: string
  write: string
  result: string
  lockUnlockNote: string
  cancel: string
  confirm: string
  filterPlaceholder: string
  clickToEdit: string
}

export const translations: Record<string, Copies> = {
  en: {
    title: 'Feetech bus',
    description: 'Inspect and edit raw Feetech STS servo registers',
    servoId: 'Servo ID',
    scan: 'Scan bus',
    scanning: 'Scanning…',
    readAll: 'Read all',
    reading: 'Reading…',
    connect: 'Connect robot',
    notConnected: 'No robot connected',
    notConnectedHint: 'Connect a robot to read and write servo registers.',
    tabMap: 'Register map',
    tabCustom: 'Custom R/W',
    colAddr: 'Addr',
    colName: 'Name',
    colBytes: 'B',
    colAccess: 'R/W',
    colDefault: 'Default',
    colRange: 'Range',
    colValue: 'Value',
    colDescription: 'Description',
    sectionEeprom: 'EEPROM — non-volatile',
    sectionRam: 'RAM — volatile',
    eepromNote: 'EEPROM writes are automatically wrapped in a Lock/Unlock cycle.',
    noData: '—',
    writeSuccess: 'Register written',
    writeError: 'Write failed',
    readError: 'Read failed',
    scanFound: 'Found IDs on bus',
    scanNone: 'No servos responded',
    customReadTitle: 'Read registers',
    customWriteTitle: 'Write registers',
    address: 'Address',
    addressHint: 'Decimal or 0x hex',
    length: 'Length (bytes)',
    data: 'Data bytes',
    dataHint: 'Space-separated decimal values, e.g. 1 0 255',
    read: 'Read',
    write: 'Write',
    result: 'Result',
    lockUnlockNote: 'Writing EEPROM registers (addr < 40) auto-unlocks the Lock register and re-locks it afterwards.',
    cancel: 'Cancel',
    confirm: 'Write',
    filterPlaceholder: 'Search register…',
    clickToEdit: 'click to edit',
  },
  ru: {
    title: 'Feetech bus',
    description: 'Просмотр и редактирование регистров сервоприводов Feetech STS',
    servoId: 'ID сервопривода',
    scan: 'Сканировать шину',
    scanning: 'Сканирование…',
    readAll: 'Прочитать все',
    reading: 'Чтение…',
    connect: 'Подключить робота',
    notConnected: 'Робот не подключён',
    notConnectedHint: 'Подключите робота для чтения и записи регистров сервоприводов.',
    tabMap: 'Карта регистров',
    tabCustom: 'Произвольный R/W',
    colAddr: 'Адрес',
    colName: 'Название',
    colBytes: 'Б',
    colAccess: 'Д/З',
    colDefault: 'По умолч.',
    colRange: 'Диапазон',
    colValue: 'Значение',
    colDescription: 'Описание',
    sectionEeprom: 'EEPROM — энергонезависимая память',
    sectionRam: 'RAM — оперативная память',
    eepromNote: 'Запись в EEPROM автоматически выполняется с разблокировкой и повторной блокировкой регистра Lock.',
    noData: '—',
    writeSuccess: 'Регистр записан',
    writeError: 'Ошибка записи',
    readError: 'Ошибка чтения',
    scanFound: 'Найдены ID на шине',
    scanNone: 'Сервоприводы не отвечают',
    customReadTitle: 'Чтение регистров',
    customWriteTitle: 'Запись регистров',
    address: 'Адрес',
    addressHint: 'Десятичный или 0x hex',
    length: 'Длина (байт)',
    data: 'Байты данных',
    dataHint: 'Десятичные значения через пробел, напр. 1 0 255',
    read: 'Прочитать',
    write: 'Записать',
    result: 'Результат',
    lockUnlockNote: 'Запись в регистры EEPROM (адрес < 40) автоматически разблокирует регистр Lock и повторно блокирует его после записи.',
    cancel: 'Отмена',
    confirm: 'Записать',
    filterPlaceholder: 'Поиск регистра…',
    clickToEdit: 'нажмите для изменения',
  },
}
