import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'calibrate-motors',
  name: {
    en: 'Calibrate motors',
    ru: 'Калибровка моторов',
  },
  description: {
    en: 'Place all joints in the home position and save the offsets to each motor.',
    ru: 'Установите все суставы в начальное положение и сохраните смещения в каждый мотор.',
  },
  icon: 'Settings2',
  scopes: ['robot.control', 'robot.calibration'],
}
