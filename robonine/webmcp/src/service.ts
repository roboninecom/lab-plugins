import type { ConnectionRole, PluginServiceFactory } from '@robonine/plugin-sdk'
import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'

const RELAY_PORT = 60808
const RELAY_RECONNECT_MS = 3_000

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

// Browser ↔ local MCP server protocol
type RelayMessage = { type: 'call'; id: string; tool: string; args: Record<string, unknown> } | { type: 'list_tools'; id: string }

type RelayResultMessage = { type: 'result'; id: string; value: unknown } | { type: 'error'; id: string; message: string } | { type: 'tools'; id: string; tools: BrowserToolDef[] }

interface BrowserToolDef {
  name: string
  description: string
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  readOnly?: boolean
}

function getModelContext(): McpApi | null {
  return ((navigator as unknown as Record<string, unknown>)['modelContext'] as McpApi | undefined) ?? null
}

export interface McpService {
  readonly isActive: boolean
  readonly registeredTools: string[]
  readonly relayConnected: boolean
  reconnect: () => void
}

const ALL_TOOL_NAMES = ['robonine', 'robot_list', 'robot_get_position', 'robot_stop', 'user_robot_list', 'path_list', 'path_read']

export const PluginService: PluginServiceFactory = (ctx) => {
  const registeredTools: string[] = []
  let relayConnected = false

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    path_list: async () => ctx.listUserPaths(),
    path_read: async (args) => {
      const path = await ctx.readPath(String(args['id']))

      return path ?? 'Path not found.'
    },
    robot_get_position: async (args) => {
      const pos = await ctx.getRobotPosition(roleArg(args))

      return pos ?? `No robot connected for role "${roleArg(args)}".`
    },
    robot_list: async () => ctx.listConnectedRobots(),
    robot_stop: async (args) => {
      await ctx.stopRobot(roleArg(args))

      return 'OK'
    },
    robonine: async () => ({ server: 'Robonine WebMCP', tools: ALL_TOOL_NAMES.filter((n) => n !== 'robonine') }),
    user_robot_list: async () => ctx.listUserRobots(),
  }

  let reconnect: () => void = () => {}

  function text(data: unknown): McpToolResult {
    return { content: [{ text: typeof data === 'string' ? data : JSON.stringify(data, null, 2), type: 'text' }] }
  }

  function roleArg(args: Record<string, unknown>): ConnectionRole {
    return args['role'] === 'leader' ? 'leader' : 'default'
  }

  // WebMCP tool definitions (schema + execute wrapping the shared handler)
  const webmcpTools: McpTool[] = [
    {
      annotations: { readOnlyHint: true },
      description: 'Robonine WebMCP server. Returns information about this server and the tools it provides.',
      execute: async () => text(await handlers['robonine']!({})),
      name: 'robonine',
    },
    {
      annotations: { readOnlyHint: true },
      description: 'List all robots belonging to the current user — name, model, and calibration data.',
      execute: async () => text(await handlers['user_robot_list']!({})),
      name: 'user_robot_list',
    },
    {
      annotations: { readOnlyHint: true },
      description: 'List all motion paths belonging to the current user — id, name, robot model, and creation date.',
      execute: async () => text(await handlers['path_list']!({})),
      name: 'path_list',
    },
    {
      annotations: { readOnlyHint: true },
      description: 'Read a motion path by ID, returning its waypoints and metadata.',
      execute: async (args) => text(await handlers['path_read']!(args)),
      inputSchema: { properties: { id: { description: 'Path ID', type: 'string' } }, required: ['id'], type: 'object' },
      name: 'path_read',
    },
    {
      annotations: { readOnlyHint: true },
      description: 'List currently connected robot arms with their role, model, and connection mode (virtual / remote).',
      execute: async () => text(await handlers['robot_list']!({})),
      name: 'robot_list',
    },
    {
      annotations: { readOnlyHint: true },
      description: 'Get the current joint angles (radians for revolute joints, metres for prismatic) and end-effector XYZ position (metres, URDF frame) of a connected robot arm.',
      execute: async (args) => text(await handlers['robot_get_position']!(args)),
      inputSchema: {
        properties: { role: { description: 'Connection role: "default" (follower) or "leader". Defaults to "default".', type: 'string' } },
        type: 'object',
      },
      name: 'robot_get_position',
    },
    {
      description: 'Disable torque on all servos of a connected robot arm. The arm will go limp.',
      execute: async (args) => text(await handlers['robot_stop']!(args)),
      inputSchema: {
        properties: { role: { description: 'Connection role: "default" (follower) or "leader". Defaults to "default".', type: 'string' } },
        type: 'object',
      },
      name: 'robot_stop',
    },
  ]

  function registerWebMcp(): void {
    const mc = getModelContext()

    if (!mc) {
      return
    }
    for (const tool of webmcpTools) {
      mc.registerTool(tool)
      registeredTools.push(tool.name)
    }
  }

  function connectRelay(): () => void {
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let activeWs: WebSocket | null = null

    function attempt(): void {
      const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`)

      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      activeWs?.close()

      activeWs = ws

      ws.onopen = () => {
        relayConnected = true
      }

      ws.onmessage = async (event: MessageEvent) => {
        let msg: RelayMessage

        try {
          msg = JSON.parse(event.data as string) as RelayMessage
        } catch {
          return
        }

        console.log('[WebMCP relay ←]', msg.type, 'tool' in msg ? msg.tool : '', 'args' in msg ? msg.args : '')

        if (msg.type === 'list_tools') {
          const tools: BrowserToolDef[] = webmcpTools.map((t) => ({
            description: t.description,
            ...(t.inputSchema ? { inputSchema: t.inputSchema as BrowserToolDef['inputSchema'] } : {}),
            name: t.name,
            readOnly: t.annotations?.readOnlyHint ?? false,
          }))

          const reply: RelayResultMessage = { id: msg.id, tools, type: 'tools' }

          ws.send(JSON.stringify(reply))

          return
        }

        if (msg.type !== 'call') {
          return
        }

        const handler = handlers[msg.tool]

        if (!handler) {
          const reply: RelayResultMessage = { id: msg.id, message: `Unknown tool: ${msg.tool}`, type: 'error' }

          ws.send(JSON.stringify(reply))

          return
        }

        try {
          const value = await handler(msg.args)
          const reply: RelayResultMessage = { id: msg.id, type: 'result', value }

          console.log('[WebMCP relay →]', 'result', msg.tool, value)
          ws.send(JSON.stringify(reply))
        } catch (err) {
          const reply: RelayResultMessage = { id: msg.id, message: err instanceof Error ? err.message : String(err), type: 'error' }

          console.warn('[WebMCP relay →]', 'error', msg.tool, err)
          ws.send(JSON.stringify(reply))
        }
      }

      ws.onclose = () => {
        if (activeWs === ws) {
          relayConnected = false
          retryTimer = setTimeout(attempt, RELAY_RECONNECT_MS)
        }
      }

      ws.onerror = () => {
        // onclose fires after onerror, handles reconnect
      }
    }

    attempt()

    return attempt
  }

  // Initialize polyfill if extension has not already provided navigator.modelContext,
  // then register tools synchronously so the extension can list them immediately.
  if (!getModelContext()) {
    initializeWebMCPPolyfill()
  }
  registerWebMcp()
  reconnect = connectRelay()

  const service: McpService = {
    get isActive() {
      return getModelContext() !== null
    },
    get reconnect() {
      return reconnect
    },
    get registeredTools() {
      return [...registeredTools]
    },
    get relayConnected() {
      return relayConnected
    },
  }

  return service
}
