import { loadRoles, saveRoles, snapshotProvider, type CameraRoles } from './snapshot'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RigSummary, TaskAgentContext } from './sdkExtras'
import type { Texts } from './translations'

const NONE = '__none__'

/**
 * Camera roles and the robot's link to the server. The link follows the robot connection:
 * it opens as soon as a robot is connected and closes when it goes away or the tool closes.
 *
 * @param ctx - Plugin context.
 * @returns Roles, setter and link state.
 */
export function useRobotLink(ctx: TaskAgentContext) {
  const [roles, setRolesState] = useState<CameraRoles>(loadRoles)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rig, setRig] = useState<RigSummary | null>(null)
  const effective = rolesFromRig(rig, ctx.cameras, roles)
  const rolesRef = useRef(roles)
  const camerasRef = useRef(ctx.cameras)
  const connected = ctx.connection.connected
  const motion = ctx.motion

  rolesRef.current = effective
  camerasRef.current = ctx.cameras

  const refreshRig = useCallback(async () => {
    const next = await ctx.taskAgent.rig().catch(() => null)

    setRig(next)
    // the rig names its devices: open them at the right size without asking
    if (next?.cameras.some((c) => c.deviceLabel)) {
      await ctx.taskAgent.openRigCameras().catch(() => undefined)
    }
  }, [ctx.taskAgent])
  const setupRig = useCallback(async () => {
    await ctx.taskAgent.openRigSetup()
    await refreshRig()
  }, [ctx.taskAgent, refreshRig])

  useEffect(() => {
    if (connected) {
      void refreshRig()
    }
  }, [connected, refreshRig])

  const setRoles = useCallback((next: CameraRoles) => {
    saveRoles(next)
    setRolesState(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    let handle: { close: () => Promise<void> } | null = null

    if (!connected) {
      return undefined
    }

    setError(null)
    motion.openSession({ snapshot: snapshotProvider(() => camerasRef.current, () => rolesRef.current, motion) }).then(
      (h) => {
        if (cancelled) {
          void h.close()
        } else {
          handle = h
          setLinked(true)
        }
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    )

    return () => {
      cancelled = true
      setLinked(false)
      void handle?.close()
    }
  }, [connected, motion])

  return { roles: effective, setRoles, linked, connected, error, rig, setupRig }
}

/**
 * Camera roles from the robot's rig: a rig camera with a device label takes the connected camera
 * of that label; roles the rig leaves open keep the operator's choice.
 *
 * @param rig - The rig summary.
 * @param cameras - Connected cameras.
 * @param manual - Roles chosen in this browser.
 * @returns The roles to use.
 */
function rolesFromRig(rig: RigSummary | null, cameras: TaskAgentContext['cameras'], manual: CameraRoles): CameraRoles {
  const byRig = (id: 'stereo' | 'wrist') => {
    const label = rig?.cameras.find((c) => c.id === id)?.deviceLabel

    return label ? (cameras.find((c) => c.label === label)?.id ?? null) : undefined
  }

  return { stereo: byRig('stereo') === undefined ? manual.stereo : byRig('stereo')!, wrist: byRig('wrist') === undefined ? manual.wrist : byRig('wrist')! }
}

/**
 * One camera role: a selector and, once chosen, a small live preview.
 *
 * @param props - Context, label, chosen camera id, setter, and whether the robot camera's flip applies.
 * @returns The selector with its preview.
 */
function CameraPick({ ctx, t, label, value, onChange, flip }: { ctx: TaskAgentContext; t: Texts; label: string; value: string | null; onChange: (v: string | null) => void; flip: boolean }) {
  const { CameraView, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = ctx.ui
  const camera = ctx.cameras.find((c) => c.id === value) ?? null

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={camera ? camera.id : NONE} onValueChange={(v: string) => onChange(v === NONE ? null : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t.none}</SelectItem>
          {ctx.cameras.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {camera && <CameraView stream={camera.stream} flip={flip} className="h-32 w-full overflow-hidden rounded-md bg-muted" />}
    </div>
  )
}

/**
 * Camera role selectors with live previews, and the robot's rig: its status and the host's setup
 * and calibration dialog. Cameras the rig assigns by device are picked from it. The wrist
 * preview's flip buttons set how the wrist image is turned; the stereo frame is always used as
 * it comes (a flip would swap its eyes).
 *
 * @param props - Context, texts and the link state.
 * @returns The card.
 */
export function CamerasCard({ ctx, t, link }: { ctx: TaskAgentContext; t: Texts; link: ReturnType<typeof useRobotLink> }) {
  const { Button, Card } = ctx.ui
  const status = !link.rig ? t.rigNone : link.rig.calibrated ? t.rigCalibrated.replace('{{date}}', link.rig.calibrationDate ?? '') : t.rigNotCalibrated

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{t.cameras}</p>
        <Button variant="outline" size="sm" disabled={!link.connected} onClick={() => void link.setupRig()}>{t.rigSetup}</Button>
      </div>
      {link.connected && <p className={`text-sm ${link.rig?.calibrated ? 'text-muted-foreground' : 'text-amber-600'}`}>{status}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <CameraPick ctx={ctx} t={t} label={t.stereoCamera} value={link.roles.stereo} flip={false} onChange={(stereo) => link.setRoles({ ...link.roles, stereo })} />
        <CameraPick ctx={ctx} t={t} label={t.wristCamera} value={link.roles.wrist} flip onChange={(wrist) => link.setRoles({ ...link.roles, wrist })} />
      </div>
    </Card>
  )
}
