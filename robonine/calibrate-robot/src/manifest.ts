import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'calibrate-robot',
  name: {
    en: 'Calibrate robot',
    ru: 'Калибровка робота',
  },
  description: {
    en: 'Move each joint through its full range of motion to calibrate encoder limits.',
    ru: 'Проведите каждый сустав через весь диапазон движения для калибровки пределов энкодера.',
  },
  icon: 'crosshair',
  scopes: ['robot.read', 'robot.calibration'],
}
