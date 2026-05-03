import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'aruco',
  name: {
    en: 'ArUco detector',
    ru: 'Детектор ArUco',
  },
  description: {
    en: 'Detects ArUco markers in a camera feed and exposes detection to other plugins.',
    ru: 'Обнаруживает маркеры ArUco в видеопотоке с камеры и предоставляет детекцию другим плагинам.',
  },
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" fill="none"><g style="fill:var(--muted-foreground)"><path fill-rule="evenodd" d="M0 0h180v180H0zM30 30h120v120H30z"/><rect x="30" y="30" width="30" height="30"/><rect x="90" y="30" width="30" height="30"/><rect x="60" y="60" width="30" height="30"/><rect x="90" y="60" width="30" height="30"/><rect x="30" y="90" width="30" height="30"/><rect x="120" y="90" width="30" height="30"/><rect x="60" y="120" width="30" height="30"/><rect x="120" y="120" width="30" height="30"/></g></svg>',
  scopes: ['install', 'camera.read'],
  provides: 'aruco',
  dependencies: [{ vendor: 'robonine', slug: 'opencv' }],
}
