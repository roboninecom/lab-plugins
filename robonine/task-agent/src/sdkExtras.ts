import type { PluginContext } from '@robonine/plugin-sdk'
import type React from 'react'

/*
 * Host APIs this plugin uses that the published @robonine/plugin-sdk does not declare yet
 * (scopes robot.motion and task.agent, added on the host in student-lab feat/task-agent).
 * Mirrors src/frontend/src/plugin/pluginSdkTypes.ts there; drop once the public SDK has them.
 */

export interface RobotSnapshot {
  camera: string
  jpeg: string
  width: number
  height: number
  capturedAt: number
  joints: number[]
}

export interface MotionApi {
  available: () => Promise<{ ok: true } | { ok: false; reason: string }>
  state: () => Promise<{ joints: string[]; q: number[]; qCmd: number[] | null; armed: boolean; busy: boolean }>
  hold: () => Promise<void>
  park: () => Promise<{ held: boolean }>
  openSession: (options: { snapshot: (cameras: string[] | undefined, width: number) => Promise<RobotSnapshot[]> }) => Promise<{ close: () => Promise<void> }>
}

export type TaskAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string }
  | { type: 'cost'; spentMicroUsd: number }
  | { type: 'outcome'; outcome: { status: string; success: boolean; summary: string; spentMicroUsd: number; saved?: { id: string; version: number } } }

export interface TaskProgramSummary {
  id: string
  title: string
  taskText: string
  visibility: 'private' | 'public'
  authorId: string | null
  robotModels: string[]
  currentVersion: number
  forkedFromId: string | null
  runs: { ok: number; total: number }
  updatedAt: number
}

export interface TaskAgentApi {
  credits: () => Promise<{ balanceMicroUsd: number; spentMicroUsd: number; addedMicroUsd: number }>
  start: (task: string, options?: { capUsd?: number; model?: 'agent' | 'light' }) => Promise<{ id: string; model: string }>
  runProgram: (programId: string, version?: number) => Promise<{ id: string }>
  current: () => Promise<{ id: string; task: string; startedAt: number } | null>
  stop: (id: string) => Promise<void>
  events: (id: string, onEvent: (event: TaskAgentEvent) => void) => () => void
  listPrograms: (scope: 'mine' | 'public', q?: string) => Promise<TaskProgramSummary[]>
  getProgram: (id: string, version?: number) => Promise<{ program: TaskProgramSummary; version: { version: number; code: string; meta: Record<string, unknown>; notes: string | null; createdAt: number } }>
  setVisibility: (id: string, visibility: 'private' | 'public') => Promise<void>
  fork: (id: string) => Promise<{ id: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = React.ComponentType<any>

/** Host UI components newer than the published SDK. */
export interface UiExtras {
  Textarea: React.ComponentType<React.TextareaHTMLAttributes<HTMLTextAreaElement>>
  Label: React.ComponentType<React.LabelHTMLAttributes<HTMLLabelElement>>
  Select: AnyComponent
  SelectTrigger: AnyComponent
  SelectValue: AnyComponent
  SelectContent: AnyComponent
  SelectItem: AnyComponent
  CameraView: React.ComponentType<{ stream?: MediaStream | null; className?: string; flip?: boolean }>
  Checkbox: React.ComponentType<{ id?: string; checked?: boolean; onCheckedChange?: (checked: boolean) => void; disabled?: boolean; className?: string }>
  Tabs: AnyComponent
  TabsList: AnyComponent
  TabsTrigger: AnyComponent
}

/** The robot camera's flip from the camera views' flip buttons. */
export interface CameraOrientation {
  mirrorH: boolean
  mirrorV: boolean
}

/** The plugin context with the task agent extras. */
export type TaskAgentContext = Omit<PluginContext, 'ui'> & { ui: PluginContext['ui'] & UiExtras; taskAgent: TaskAgentApi; motion: MotionApi; cameraOrientation: CameraOrientation }

/**
 * Views the plugin context with the APIs above.
 *
 * @param context - The host's plugin context.
 * @returns The same object, typed.
 */
export function withExtras(context: PluginContext): TaskAgentContext {
  return context as unknown as TaskAgentContext
}

/**
 * Formats micro-dollars as dollars.
 *
 * @param micro - Amount in micro-dollars.
 * @returns e.g. "$1.23" (four decimals under a cent).
 */
export function usd(micro: number): string {
  const v = micro / 1e6

  return `$${v !== 0 && Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2)}`
}
