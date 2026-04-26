import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'teleoperate',
  name: {
    en: 'Teleoperate',
    ru: 'Телеуправление',
  },
  description: {
    en: 'Mirror a leader arm to a follower arm in real time. Add a camera feed for a first-person view.',
    ru: 'Синхронизируйте ведущую руку с ведомой в реальном времени. Добавьте камеру для вида от первого лица.',
  },
  icon: 'satellite-dish',
  scopes: ['robot.read', 'robot.control', 'robot.leader', 'camera.read'],
}
