import type { LocaleText } from './filaments'
import type { Zone } from './parts'

/**
 * A skin is a filament per body zone, plus optional per-mesh exceptions (e.g.
 * glowing jaws). Filament ids come from `FILAMENTS`, so every colour on screen
 * is a spool you can buy.
 */
export interface Skin {
  id: string
  name: LocaleText
  description: LocaleText
  zones: Record<Zone, string>
  /** Mesh name → filament id, for parts that differ from their zone. */
  parts?: Record<string, string>
}

export const CUSTOM_SKIN_ID = 'custom'

export const SKINS: Skin[] = [
  {
    id: 'classic',
    name: { en: 'Classic', ru: 'Классика' },
    description: { en: 'The robonine yellow the kit ships in.', ru: 'Фирменный жёлтый robonine, как в наборе.' },
    zones: {
      base: 'basic-sunflower-yellow',
      shoulder: 'basic-sunflower-yellow',
      upperArm: 'basic-sunflower-yellow',
      forearm: 'basic-sunflower-yellow',
      wrist: 'basic-sunflower-yellow',
      gripper: 'basic-sunflower-yellow',
    },
  },
  {
    id: 'halloween',
    name: { en: 'Halloween', ru: 'Хэллоуин' },
    description: { en: 'Pumpkin orange and black, with jaws that glow in the dark.', ru: 'Тыквенный оранжевый и чёрный, губки светятся в темноте.' },
    zones: {
      base: 'basic-black',
      shoulder: 'basic-pumpkin-orange',
      upperArm: 'basic-pumpkin-orange',
      forearm: 'basic-black',
      wrist: 'basic-purple',
      gripper: 'glow-green',
    },
  },
  {
    id: 'christmas',
    name: { en: 'Christmas', ru: 'Новый год' },
    description: { en: 'Candy-cane red and white, a green gripper and a gold wrist.', ru: 'Красно-белый, как леденец, зелёный захват и золотое запястье.' },
    zones: {
      base: 'basic-red',
      shoulder: 'basic-jade-white',
      upperArm: 'basic-red',
      forearm: 'basic-jade-white',
      wrist: 'silk-gold',
      gripper: 'basic-mistletoe-green',
    },
  },
  {
    id: 'winter',
    name: { en: 'Ice', ru: 'Лёд' },
    description: { en: 'Matte white and icy blues, with a see-through gripper.', ru: 'Матовый белый и ледяные оттенки синего, полупрозрачный захват.' },
    zones: {
      base: 'matte-ivory-white',
      shoulder: 'matte-ice-blue',
      upperArm: 'matte-ivory-white',
      forearm: 'matte-ice-blue',
      wrist: 'matte-ivory-white',
      gripper: 'translucent-ice-blue',
    },
  },
  {
    id: 'neon',
    name: { en: 'Neon', ru: 'Неон' },
    description: { en: 'Black with hot magenta and cyan accents.', ru: 'Чёрный с яркими пурпурными и бирюзовыми акцентами.' },
    zones: {
      base: 'matte-charcoal',
      shoulder: 'basic-magenta',
      upperArm: 'matte-charcoal',
      forearm: 'basic-cyan',
      wrist: 'matte-charcoal',
      gripper: 'basic-magenta',
    },
  },
  {
    id: 'spring',
    name: { en: 'Spring', ru: 'Весна' },
    description: { en: 'Soft matte pastels.', ru: 'Нежные матовые пастельные тона.' },
    zones: {
      base: 'matte-ivory-white',
      shoulder: 'matte-sakura-pink',
      upperArm: 'matte-lilac-purple',
      forearm: 'matte-sakura-pink',
      wrist: 'matte-mandarin-orange',
      gripper: 'matte-grass-green',
    },
  },
]
