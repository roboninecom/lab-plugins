import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'opencv',
  name: {
    en: 'OpenCV',
    ru: 'OpenCV',
  },
  description: {
    en: 'Loads OpenCV and exposes computer vision capabilities to other plugins.',
    ru: 'Загружает OpenCV и предоставляет возможности компьютерного зрения другим плагинам.',
  },
  icon: 'eye',
  scopes: ['install', 'camera.read'],
  provides: 'opencv',
}
