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
    en: 'Dress your arm up for Halloween, Christmas and more: preview a colour scheme in 3D and get the PLA filament list to print it.',
    ru: 'Нарядите руку к Хэллоуину, Новому году и не только: примерьте раскраску в 3D и получите список PLA-пластика для печати.',
  },
  icon: 'palette',
  scopes: [],
  collapseMenu: true,
}

export const manifest: PluginManifest = manifestWithMenu
