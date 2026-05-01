import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'
import type { PluginServiceFactory } from '@robonine/plugin-sdk'

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
}

interface McpTool {
  name: string
  description: string
  inputSchema?: { type: string; properties?: Record<string, unknown>; required?: string[] }
  annotations?: { readOnlyHint?: boolean }
  execute: (args: Record<string, unknown>) => Promise<McpToolResult>
}

interface McpApi {
  registerTool(tool: McpTool): void
  unregisterTool(name: string): void
}

function getModelContext(): McpApi | null {
  return ((navigator as unknown as Record<string, unknown>)['modelContext'] as McpApi | undefined) ?? null
}

export interface McpService {
  readonly isActive: boolean
  readonly registeredTools: string[]
}

export const PluginService: PluginServiceFactory = (ctx) => {
  const registeredTools: string[] = []

  function text(data: unknown): McpToolResult {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
  }

  function registerAll(): void {
    const mc = getModelContext()

    const tools: McpTool[] = [
      {
        name: 'robonine',
        description: 'Robonine WebMCP server. Returns information about this server and the tools it provides for controlling and monitoring Robonine robot arms.',
        annotations: { readOnlyHint: true },
        execute: async () =>
          text({
            server: 'Robonine WebMCP',
            tools: ['user_robot_list', 'path_list', 'path_read', 'robot_list', 'robot_get_position'],
          }),
      },
      {
        name: 'user_robot_list',
        description: 'List all robots belonging to the current user — name, model, and calibration data.',
        annotations: { readOnlyHint: true },
        execute: async () => text(await ctx.listUserRobots()),
      },
      {
        name: 'path_list',
        description: 'List all motion paths belonging to the current user — id, name, robot model, and creation date.',
        annotations: { readOnlyHint: true },
        execute: async () => text(await ctx.listUserPaths()),
      },
      {
        name: 'path_read',
        description: 'Read a motion path by ID, returning its waypoints and metadata. Private paths require ownership.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Path ID' } },
          required: ['id'],
        },
        annotations: { readOnlyHint: true },
        execute: async (args) => {
          const path = await ctx.readPath(String(args['id']))

          return path ? text(path) : text('Path not found.')
        },
      },
      {
        name: 'robot_list',
        description: 'List currently connected robot arms with their role, model, and connection mode (virtual / remote).',
        annotations: { readOnlyHint: true },
        execute: async () => text(ctx.listConnectedRobots()),
      },
      {
        name: 'robot_get_position',
        description: 'Get the current joint angles (radians for revolute joints, metres for prismatic) and end-effector XYZ position (metres, URDF frame) of a connected robot arm.',
        inputSchema: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Connection role: "default" (follower) or "leader". Defaults to "default".' },
          },
        },
        annotations: { readOnlyHint: true },
        execute: async (args) => {
          const role = args['role'] === 'leader' ? 'leader' : ('default' as const)
          const pos = await ctx.getRobotPosition(role)

          return pos ? text(pos) : text(`No robot connected for role "${role}".`)
        },
      },
    ]

    if (!mc) {
      return
    }

    for (const tool of tools) {
      mc.registerTool(tool)
      registeredTools.push(tool.name)
    }
  }

  // Defer by one tick so the extension's content script can inject
  // navigator.modelContext first. Only fall back to the polyfill if the
  // extension is not present.
  setTimeout(() => {
    if (!getModelContext()) {
      initializeWebMCPPolyfill()
    }
    registerAll()
  }, 0)

  const service: McpService = {
    get isActive() {
      return getModelContext() !== null
    },
    get registeredTools() {
      return [...registeredTools]
    },
  }

  return service
}
