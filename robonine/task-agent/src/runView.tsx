import { SessionLog, type useSession } from './sessionLog'
import type { useRobotLink } from './robotLink'
import type { TaskAgentContext } from './sdkExtras'
import type { Texts } from './translations'

/**
 * One camera, large and live, for watching a run (no role picker: the run uses the cameras as set).
 *
 * @param props - Context, its label, its camera id, and whether its view offers the flip buttons.
 * @param props.ctx - Plugin context.
 * @param props.label - Caption.
 * @param props.id - Camera id, or null when none is set.
 * @param props.flip - Show the flip buttons (the wrist camera; the stereo frame is used as it comes).
 * @returns The view, or a note when the camera is not set.
 */
function LiveCamera({ ctx, label, id, flip }: { ctx: TaskAgentContext; label: string; id: string | null; flip: boolean }) {
  const { CameraView } = ctx.ui
  const camera = ctx.cameras.find((c) => c.id === id) ?? null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {camera ? <CameraView stream={camera.stream} flip={flip} className="aspect-video w-full overflow-hidden rounded-md bg-muted" /> : <div className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">—</div>}
    </div>
  )
}

/**
 * The run screen, while a job runs and until the user goes back: what runs, Stop, both cameras
 * live and the log. Nothing else - the program list is no use while a program moves the arm.
 *
 * @param props - Context, texts, robot link, the session and the way back.
 * @param props.ctx - Plugin context.
 * @param props.t - Texts.
 * @param props.link - Robot link (camera roles).
 * @param props.session - The session being followed.
 * @param props.onBack - Back to the task and the library (after the run).
 * @returns The screen.
 */
export function RunView({ ctx, t, link, session, onBack }: { ctx: TaskAgentContext; t: Texts; link: ReturnType<typeof useRobotLink>; session: ReturnType<typeof useSession>; onBack: () => void }) {
  const { Button, Card } = ctx.ui
  const status = session.running ? t.running : session.outcome?.success ? t.success : t.failure

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{session.title ?? t.run}</span>
          <span className={`text-sm ${session.running ? 'text-muted-foreground' : session.outcome?.success ? 'text-green-600' : 'text-amber-600'}`}>{status}</span>
        </div>
        {
          session.running ?
            <Button variant="outline" onClick={() => session.id && void ctx.taskAgent.stop(session.id)}>{t.stop}</Button>
            : <Button onClick={onBack}>{t.back}</Button>
        }
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <LiveCamera ctx={ctx} label={t.stereoCamera} id={link.roles.stereo} flip={false} />
        <LiveCamera ctx={ctx} label={t.wristCamera} id={link.roles.wrist} flip />
      </div>
      <SessionLog t={t} session={session} />
    </div>
  )
}
