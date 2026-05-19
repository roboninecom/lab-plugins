import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'feetech-bus',
  name: {
    en: 'Feetech bus',
  },
  description: {
    en: 'Inspect and edit raw Feetech STS servo registers over the live bus connection.',
  },
  icon: 'chevrons-left-right-ellipsis',
  scopes: ['robot.read', 'robot.calibration'],
}
