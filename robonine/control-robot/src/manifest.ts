import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'control-robot',
  name: {
    en: 'Control robot',
    ru: 'Управление роботом',
  },
  description: {
    en: 'Manually move each joint of your robot arm using on-screen sliders.',
    ru: 'Управляйте каждым суставом руки-робота с помощью ползунков на экране.',
  },
  icon: 'Gamepad2',
  scopes: ['robot.control'],
}
