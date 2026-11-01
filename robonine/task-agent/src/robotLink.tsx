import { loadRoles, saveRoles, snapshotProvider, type CameraRoles } from './snapshot'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskAgentContext } from './sdkExtras'
import type { Texts } from './translations'

/**
 * Camera roles and the robot's link to the server, kept for the lifetime of the tool.
 *
 * @param ctx - Plugin context.
 * @returns Roles, setter, link state and connect/disconnect.
 */
export function useRobotLink(ctx: TaskAgentContext) {
  const [roles, setRolesState] = useState<CameraRoles>(loadRoles)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<{ close: () => Promise<void> } | null>(null)
  const rolesRef = useRef(roles)
  const camerasRef = useRef(ctx.cameras)

  rolesRef.current = roles
  camerasRef.current = ctx.cameras

  const setRoles = useCallback((next: CameraRoles) => {
    saveRoles(next)
    setRolesState(next)
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    try {
      handle.current = await ctx.motion.openSession({ snapshot: snapshotProvider(() => camerasRef.current, () => rolesRef.current, ctx.motion) })
      setLinked(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [ctx.motion])

  const disconnect = useCallback(async () => {
    await handle.current?.close()
    handle.current = null
    setLinked(false)
  }, [])

  useEffect(() => () => {
    void handle.current?.close()
  }, [])

  return { roles, setRoles, linked, error, connect, disconnect }
}

/**
 * Camera role selectors and the connect button.
 *
 * @param props - Context, texts and the link state.
 * @returns The card.
 */
export function RobotLinkCard({ ctx, t, link }: { ctx: TaskAgentContext; t: Texts; link: ReturnType<typeof useRobotLink> }) {
  const { Button, Card } = ctx.ui
  const select = (label: string, value: string | null, onChange: (v: string | null) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select className="rounded-md border bg-background px-2 py-1" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t.none}</option>
        {ctx.cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </label>
  )

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-medium">{t.cameras}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {select(t.stereoCamera, link.roles.stereo, (stereo) => link.setRoles({ ...link.roles, stereo }))}
        {select(t.wristCamera, link.roles.wrist, (wrist) => link.setRoles({ ...link.roles, wrist }))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={link.roles.wristRotate180} onChange={(e) => link.setRoles({ ...link.roles, wristRotate180: e.target.checked })} />
        {t.wristRotate}
      </label>
      <div className="flex items-center gap-3">
        <span className={`text-sm ${link.linked ? 'text-green-600' : 'text-muted-foreground'}`}>{t.link}: {link.linked ? t.linkOn : t.linkOff}</span>
        <Button size="sm" variant={link.linked ? 'outline' : 'default'} onClick={() => void (link.linked ? link.disconnect() : link.connect())}>{link.linked ? t.disconnect : t.connect}</Button>
      </div>
      {link.error && <p className="text-sm text-destructive">{link.error}</p>}
    </Card>
  )
}
