import { RobotLinkCard, type useRobotLink } from './robotLink'
import type { TaskAgentContext } from './sdkExtras'
import { SessionLog, type useSession } from './sessionLog'
import type { Texts } from './translations'
import { useState } from 'react'

/**
 * The Task tab: cameras and link, the job in plain words, spending limit, start/stop, live log.
 *
 * @param props - Context, texts, robot link and session.
 * @returns The tab.
 */
export function TaskPanel({ ctx, t, link, session }: { ctx: TaskAgentContext; t: Texts; link: ReturnType<typeof useRobotLink>; session: ReturnType<typeof useSession> }) {
  const { Button, Card } = ctx.ui
  const [task, setTask] = useState('')
  const [cap, setCap] = useState('2')
  const [model, setModel] = useState<'agent' | 'light'>('agent')
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    try {
      session.follow((await ctx.taskAgent.start(task.trim(), { capUsd: Number(cap), model })).id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <RobotLinkCard ctx={ctx} t={t} link={link} />
      <Card className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t.taskLabel}</span>
          <textarea className="min-h-20 rounded-md border bg-background p-2" placeholder={t.taskPlaceholder} value={task} onChange={(e) => setTask(e.target.value)} disabled={session.running} />
        </label>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t.cap}</span>
            <input className="w-28 rounded-md border bg-background px-2 py-1" type="number" min="0.1" max="50" step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t.model}</span>
            <select className="rounded-md border bg-background px-2 py-1" value={model} onChange={(e) => setModel(e.target.value as 'agent' | 'light')}>
              <option value="agent">{t.modelAgent}</option>
              <option value="light">{t.modelLight}</option>
            </select>
          </label>
          {
            session.running ?
              <Button variant="outline" onClick={() => session.id && void ctx.taskAgent.stop(session.id)}>{t.stop}</Button>
              : <Button disabled={!link.linked || task.trim().length < 3} onClick={() => void start()}>{t.start}</Button>
          }
        </div>
        <p className="text-xs text-muted-foreground">{t.armHint}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
      {session.id && <SessionLog t={t} session={session} />}
    </div>
  )
}
