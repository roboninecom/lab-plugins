import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'policies',
  name: {
    en: 'Policies',
  },
  description: {
    en: 'Record robot demonstrations (joint states + camera) for policy training.',
  },
  icon: 'videotape',
  scopes: ['robot.read', 'robot.control', 'camera.read', 'user.auth'],
}
