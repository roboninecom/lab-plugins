import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'servo-firmware',
  name: {
    en: 'Servo firmware',
    ru: 'Прошивка сервоприводов',
  },
  description: {
    // Kept to three lines on the narrowest /tools card (768 px viewport); measured in Chrome.
    en: 'Install or roll back Robonine v9 firmware.',
    ru: 'Установка и откат прошивки Robonine v9.',
  },
  icon: 'cpu',
  // robot.firmware: raw bus + USB-only connect. robot.local: needs hands on the arm.
  scopes: ['robot.read', 'robot.calibration', 'robot.firmware', 'robot.local'],
}
