import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'block-code',
  name: {
    en: 'Block code',
    ru: 'Блок-код',
  },
  description: {
    en: 'Program your robot with visual blocks. Move joints, control the end effector with inverse kinematics, read sensors, and build logic with loops and conditions.',
    ru: 'Программируйте робота с помощью визуальных блоков. Управляйте суставами, перемещайте манипулятор с помощью обратной кинематики, считывайте датчики и стройте логику с циклами и условиями.',
  },
  icon: 'turtle',
  scopes: ['robot.control'],
}
