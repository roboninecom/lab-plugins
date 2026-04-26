import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'set-motor-ids',
  name: {
    en: 'Set motor IDs',
    ru: 'Настройка ID моторов',
  },
  description: {
    en: 'Assign sequential IDs to each motor one at a time.',
    ru: 'Последовательно назначьте ID каждому мотору.',
  },
  icon: 'hash',
  scopes: ['robot.config'],
}
