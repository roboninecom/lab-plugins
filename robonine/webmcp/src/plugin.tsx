import type { CameraHandle, CameraViewHandle, PluginContext } from '@robonine/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { translations } from './translations'
import type { McpService } from './service'

interface Props {
  context: PluginContext
}

const ALL_TOOLS = [
  'robonine',
  'list_robots',
  'get_robot_position',
  'stop_robot',
  'list_user_robots',
  'list_paths',
  'read_path',
  'move_to',
  'go_home',
  'execute_path',
  'extract_scene',
  'pregrip',
  'grip',
  'lift',
  'move',
  'release',
] as const

const ACTION_ATOM_TOOLS = ['pregrip', 'grip', 'lift', 'move', 'release'] as const

type ActionAtomTool = (typeof ACTION_ATOM_TOOLS)[number]

const BASE_TOOLS = ALL_TOOLS.filter((name): name is Exclude<(typeof ALL_TOOLS)[number], ActionAtomTool> => !ACTION_ATOM_TOOLS.includes(name as ActionAtomTool))

type T = (typeof translations)[keyof typeof translations]

function toolDesc(name: (typeof ALL_TOOLS)[number], t: T): string {
  const map: Record<(typeof ALL_TOOLS)[number], string> = {
    robonine: t.toolDescRobonine,
    list_robots: t.toolDescListRobots,
    get_robot_position: t.toolDescGetRobotPosition,
    stop_robot: t.toolDescStopRobot,
    list_user_robots: t.toolDescListUserRobots,
    list_paths: t.toolDescListPaths,
    read_path: t.toolDescReadPath,
    move_to: t.toolDescMoveTo,
    go_home: t.toolDescGoHome,
    execute_path: t.toolDescExecutePath,
    extract_scene: t.toolDescExtractScene,
    pregrip: t.toolDescPregrip,
    grip: t.toolDescGrip,
    lift: t.toolDescLift,
    move: t.toolDescMove,
    release: t.toolDescRelease,
  }

  return map[name]
}

function StatusRow({ ok, label, note, actionHref, actionLabel }: { ok: boolean; label: string; note?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        {ok ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
        <span className="font-medium text-sm flex-1">{label}</span>
        {!ok && actionHref && actionLabel && (
          <a href={actionHref} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0">
            {actionLabel}
          </a>
        )}
      </div>
      {!ok && note && <p className="text-xs text-muted-foreground pl-8">{note}</p>}
    </div>
  )
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const service = context.service('webmcp') as McpService | null
  const [relayConnected, setRelayConnected] = useState(service?.relayConnected ?? false)
  const [isActive, setIsActive] = useState(service?.isActive ?? false)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(() => context.cameras[0]?.id ?? null)
  const cameraViewRef = useRef<CameraViewHandle>(null)
  const { CameraView } = context.ui
  const selectedCamera = useMemo<CameraHandle | null>(() => context.cameras.find((c) => c.id === selectedCameraId) ?? null, [context.cameras, selectedCameraId])

  useEffect(() => {
    if (!service) {
      return
    }
    service.connect()
  }, [service])

  useEffect(() => {
    const id = setInterval(() => {
      setRelayConnected(service?.relayConnected ?? false)
      setIsActive(service?.isActive ?? false)
    }, 500)

    return () => clearInterval(id)
  }, [service])

  // Auto-select single camera; clear when the selected one disappears.
  useEffect(() => {
    if (!selectedCameraId && context.cameras.length === 1) {
      setSelectedCameraId(context.cameras[0].id)
    } else if (selectedCameraId && !context.cameras.find((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(null)
    }
  }, [context.cameras, selectedCameraId])

  // Wire frame capture to the service whenever the camera or ref changes.
  useEffect(() => {
    if (!service) {
      return
    }
    if (!selectedCamera) {
      service.setFrameCapture(null)

      return
    }
    service.setFrameCapture(() => cameraViewRef.current?.captureFrame() ?? null)

    return () => service.setFrameCapture(null)
  }, [service, selectedCamera])

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-4">
          <StatusRow ok={relayConnected} label={relayConnected ? t.relayConnected : t.relayDisconnected} actionHref="https://github.com/roboninecom/robonine-mcp" actionLabel={t.relayHowTo} />
          <StatusRow ok={isActive} label={isActive ? t.statusActive : t.statusInactive} note={t.statusNote} />
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.cameraSectionTitle}</p>
          {context.cameras.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noCameras}</p>
          ) : (
            <div className="space-y-3">
              {context.cameras.length > 1 && (
                <select
                  value={selectedCameraId ?? ''}
                  onChange={(e) => setSelectedCameraId(e.target.value || null)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {context.cameras.map((cam) => (
                    <option key={cam.id} value={cam.id}>
                      {cam.label}
                    </option>
                  ))}
                </select>
              )}
              <CameraView stream={selectedCamera?.stream ?? null} ref={cameraViewRef} className="w-full rounded-md overflow-hidden aspect-video" />
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.toolsSectionTitle}</p>
          <div className="space-y-2">
            {BASE_TOOLS.map((name) => (
              <div key={name} className="flex items-center justify-between gap-4 text-sm">
                <code className="font-mono shrink-0">{name}</code>
                <span className="text-xs text-muted-foreground text-right">{toolDesc(name, t)}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.actionAtomsSectionTitle}</p>
            {ACTION_ATOM_TOOLS.map((name) => (
              <div key={name} className="flex items-center justify-between gap-4 text-sm">
                <code className="font-mono shrink-0">{name}</code>
                <span className="text-xs text-muted-foreground text-right">{toolDesc(name, t)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
