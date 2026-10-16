import type { PluginManifest } from '@robonine/plugin-sdk'

// collapseMenu is understood by the current host but not yet published in the
// installed SDK types — extend locally until the SDK release catches up.
const manifestWithMenu: PluginManifest & { collapseMenu?: boolean } = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'skins',
  name: {
    en: 'Robot skins',
    ru: 'Скины робота',
  },
  description: {
    en: 'Dress your arm up for Halloween or Christmas and get the PLA to print it.',
    ru: 'Нарядите руку к Хэллоуину или Новому году и получите список PLA для печати.',
  },
  icon: 'palette',
  scopes: [],
  collapseMenu: true,
}

export const manifest: PluginManifest = manifestWithMenu
