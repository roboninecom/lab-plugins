import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'webmcp',
  name: {
    en: 'MCP Bridge',
    ru: 'MCP Мост',
  },
  description: {
    en: 'Exposes robot and workspace data to AI assistants via WebMCP and a local MCP server relay.',
    ru: 'Предоставляет данные о роботе и рабочем пространстве AI-ассистентам через WebMCP и локальный MCP-сервер.',
  },
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" fill="none"><g stroke="#000" stroke-linecap="round" stroke-width="12" clip-path="url(#a)"><path d="m18 85 68-68c9-9 24-9 34 0v0c9 9 9 25 0 34l-51 51"/><path d="m69 101 51-50c9-9 24-9 34 0h0c9 10 9 25 0 34l-61 62q-5 5 0 11l12 13"/><path d="M103 34 53 84c-10 10-10 25 0 34v0c9 9 24 9 34 0l50-50"/></g><defs><clipPath id="a"><path fill="#fff" d="M0 0h180v180H0z"/></clipPath></defs></svg>',
  scopes: ['install', 'robot.read', 'robot.control', 'user.auth', 'user.read', 'camera.read'],
  provides: 'webmcp',
}
