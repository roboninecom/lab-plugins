import type { PluginManifest } from '@robonine/plugin-sdk'

// Cast: scopes robot.motion / task.agent and collapseMenu are newer than the published SDK types.
export const manifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'task-agent',
  name: {
    en: 'Task agent',
    ru: 'Агент задач',
  },
  description: {
    en: 'Describe a job in plain words; the AI looks with the cameras, writes a program for the arm, runs it until the job is verifiably done, and keeps it in your library.',
    ru: 'Опишите задачу словами: ИИ осмотрится камерами, напишет программу для руки, выполнит её до проверенного результата и сохранит в вашей библиотеке.',
  },
  icon: 'Sparkles',
  scopes: ['robot.read', 'robot.motion', 'robot.saved', 'camera.read', 'task.agent', 'user.auth'],
  collapseMenu: true,
} as unknown as PluginManifest
