import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'camera-calibration',
  name: {
    en: 'Camera calibration',
  },
  description: {
    en: 'Calibrates the gripper camera using a printed checkerboard pattern.',
  },
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" fill="none"><g style="fill:var(--muted-foreground)"><rect width="45" height="45"/><rect x="90" width="45" height="45"/><rect x="45" y="45" width="45" height="45"/><rect x="135" y="45" width="45" height="45"/><rect width="45" height="45" x="0" y="90"/><rect x="90" y="90" width="45" height="45"/><rect x="45" y="135" width="45" height="45"/><rect x="135" y="135" width="45" height="45"/></g></svg>',
  scopes: ['camera.read', 'robot.read', 'robot.control', 'robot.calibration', 'robot.saved', 'user.auth'],
  dependencies: [{ vendor: 'robonine', slug: 'opencv' }],
}
