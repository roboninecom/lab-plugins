import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'force-sensor',
  name: {
    en: 'Force sensor',
    ru: 'Датчик силы',
  },
  description: {
    en: 'Read force measurements from connected force sensors.',
    ru: 'Считывание данных с подключённых датчиков силы.',
  },
  icon: 'activity',
  scopes: ['robot.read'],
}
