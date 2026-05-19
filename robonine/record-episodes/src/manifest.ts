import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'record-episodes',
  name: {
    en: 'Record episodes',
  },
  description: {
    en: 'Record robot demonstrations (joint states + camera) for VLA model training.',
  },
  icon: 'videotape',
  scopes: ['robot.read', 'robot.control', 'camera.read', 'user.auth'],
}
