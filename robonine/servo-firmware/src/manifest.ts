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
    en: 'Install the experimental Robonine v9 firmware on STS3215 servos, or roll back to Feetech factory firmware. USB only.',
    ru: 'Установка экспериментальной прошивки Robonine v9 на сервоприводы STS3215 или возврат к заводской прошивке Feetech. Только USB.',
  },
  icon: 'cpu',
  // robot.firmware: raw bus + USB-only connect. robot.local: needs hands on the arm.
  scopes: ['robot.read', 'robot.calibration', 'robot.firmware', 'robot.local'],
}
