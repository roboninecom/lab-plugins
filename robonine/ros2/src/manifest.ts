import type { PluginManifest } from '@robonine/plugin-sdk'

// collapseMenu is understood by the current host but not yet published in the
// installed SDK types — extend locally until the SDK release catches up.
const manifestWithMenu: PluginManifest & { collapseMenu?: boolean } = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'ros2',
  name: {
    en: 'ROS2 lab',
    ru: 'Лаборатория ROS2',
  },
  description: {
    en: 'Run ROS2 nodes in Python or C++ right in the browser, no install needed.',
    ru: 'Запускайте ноды ROS2 на Python или C++ прямо в браузере, без установки.',
  },
  icon: 'grip',
  scopes: ['robot.read', 'robot.control'],
  collapseMenu: true,
}

export const manifest: PluginManifest = manifestWithMenu
