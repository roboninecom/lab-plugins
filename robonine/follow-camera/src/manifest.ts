import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'follow-camera',
  name: {
    en: 'Follow camera',
  },
  description: {
    en: 'Hold Shift and click on the camera feed to move the robot to that point using inverse kinematics.',
  },
  icon: 'Crosshair',
  scopes: ['robot.read', 'robot.control', 'camera.read'],
}
