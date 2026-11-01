import { CamerasCard, type useRobotLink } from './robotLink'
import { SessionLog, type useSession } from './sessionLog'
import type { TaskAgentContext } from './sdkExtras'
import type { Texts } from './translations'
import { useState } from 'react'

/**
 * The Task tab: cameras, the job in plain words, spending limit, model, start/stop, live log.
 *
 * @param props - Context, texts, robot link and session.
 * @returns The tab.
 */
export function TaskPanel({ ctx, t, link, session }: { ctx: TaskAgentContext; t: Texts; link: ReturnType<typeof useRobotLink>; session: ReturnType<typeof useSession> }) {
  const { Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } = ctx.ui
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
      <CamerasCard ctx={ctx} t={t} link={link} />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-agent-task">{t.taskLabel}</Label>
          <Textarea id="task-agent-task" className="min-h-40" placeholder={t.taskPlaceholder} value={task} onChange={(e) => setTask(e.target.value)} disabled={session.running} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-agent-cap">{t.cap}</Label>
            <Input id="task-agent-cap" className="w-28" type="number" min="0.1" max="50" step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.model}</Label>
            <Select value={model} onValueChange={(v: string) => setModel(v as 'agent' | 'light')}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">{t.modelAgent}</SelectItem>
                <SelectItem value="light">{t.modelLight}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {
            session.running ?
              <Button variant="outline" onClick={() => session.id && void ctx.taskAgent.stop(session.id)}>{t.stop}</Button>
              : <Button disabled={!link.linked || task.trim().length < 3} onClick={() => void start()}>{t.start}</Button>
          }
        </div>
        <p className="text-xs text-muted-foreground">{link.connected && !link.linked && !link.error ? t.linking : t.armHint}</p>
        {link.error && <p className="text-sm text-destructive">{link.error}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
      {session.id && <SessionLog t={t} session={session} />}
    </div>
  )
}
