import type { Zone } from './parts'

type T = {
  title: string
  subtitle: string
  model: string
  skins: string
  custom: string
  customDescription: string
  colours: string
  coloursHint: string
  zones: Record<Zone, string>
  shoppingList: string
  shoppingHint: string
  partsCount: (n: number) => string
  grams: (g: number) => string
  total: (g: number, spools: number) => string
  buy: string
  bought: string
  motors: (n: number) => string
  electronics: (n: number) => string
  rods: (n: number) => string
  estimateNote: string
  reset: string
}

export const translations: Record<string, T> = {
  en: {
    title: 'Robot skins',
    subtitle: 'Pick a skin, tweak the colours, then print the plastic parts in the listed Bambu Lab PLA.',
    model: 'Model',
    skins: 'Skins',
    custom: 'Custom',
    customDescription: 'Your own mix.',
    colours: 'Colours',
    coloursHint: 'Click a zone to choose its filament. Changes make a custom skin.',
    zones: {
      base: 'Base',
      shoulder: 'Shoulder',
      upperArm: 'Upper arm',
      forearm: 'Forearm',
      wrist: 'Wrist',
      gripper: 'Gripper',
    },
    shoppingList: 'Filament to buy',
    shoppingHint: 'Hover a row to see its parts on the robot.',
    partsCount: (n) => `${n} ${n === 1 ? 'part' : 'parts'}`,
    grams: (g) => `≈ ${Math.round(g)} g`,
    total: (g, spools) => `≈ ${Math.round(g)} g of PLA in total, ${spools} ${spools === 1 ? 'spool' : 'spools'} of 1 kg`,
    buy: 'Buy',
    bought: 'Not printed — keep as is',
    motors: (n) => `${n} × STS3215 servo`,
    electronics: (n) => `${n} × camera module`,
    rods: (n) => `${n} × steel guide rod`,
    estimateNote: 'Weights are estimates for one arm at ~15 % infill. Check your slicer before ordering.',
    reset: 'Reset',
  },
  ru: {
    title: 'Скины робота',
    subtitle: 'Выберите скин, настройте цвета и напечатайте пластиковые детали из указанного PLA Bambu Lab.',
    model: 'Модель',
    skins: 'Скины',
    custom: 'Свой',
    customDescription: 'Ваша комбинация.',
    colours: 'Цвета',
    coloursHint: 'Нажмите на зону, чтобы выбрать пластик. Изменения создают свой скин.',
    zones: {
      base: 'Основание',
      shoulder: 'Плечо',
      upperArm: 'Плечевое звено',
      forearm: 'Предплечье',
      wrist: 'Запястье',
      gripper: 'Захват',
    },
    shoppingList: 'Какой пластик купить',
    shoppingHint: 'Наведите на строку, чтобы увидеть детали на роботе.',
    partsCount: (n) => `${n} ${plural(n, 'деталь', 'детали', 'деталей')}`,
    grams: (g) => `≈ ${Math.round(g)} г`,
    total: (g, spools) => `Всего ≈ ${Math.round(g)} г PLA, ${spools} ${plural(spools, 'катушка', 'катушки', 'катушек')} по 1 кг`,
    buy: 'Купить',
    bought: 'Не печатается — остаётся как есть',
    motors: (n) => `${n} × сервопривод STS3215`,
    electronics: (n) => `${n} × модуль камеры`,
    rods: (n) => `${n} × стальная направляющая`,
    estimateNote: 'Вес — оценка для одной руки при заполнении ~15 %. Перед заказом проверьте в слайсере.',
    reset: 'Сбросить',
  },
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many
}
