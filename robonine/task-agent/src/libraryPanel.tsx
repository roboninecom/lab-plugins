import type { TaskAgentContext, TaskProgramSummary } from './sdkExtras'
import { SessionLog, type useSession } from './sessionLog'
import { useCallback, useEffect, useState } from 'react'
import type { Texts } from './translations'

/**
 * The Library tab: my programs and shared programs; run without the model, share, copy, read code.
 *
 * @param props - Context, texts, whether the robot is linked, and the session.
 * @returns The tab.
 */
export function LibraryPanel({ ctx, t, linked, session }: { ctx: TaskAgentContext; t: Texts; linked: boolean; session: ReturnType<typeof useSession> }) {
  const { Button, Card, Input, Tabs, TabsList, TabsTrigger } = ctx.ui
  const [scope, setScope] = useState<'mine' | 'public'>('mine')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<TaskProgramSummary[]>([])
  const [code, setCode] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const me = ctx.user?.id
  const load = useCallback(() => void ctx.taskAgent.listPrograms(scope, q).then(setItems).catch((e: Error) => setError(e.message)), [ctx.taskAgent, scope, q])

  useEffect(() => {
    const timer = setTimeout(load, 250)

    return () => clearTimeout(timer)
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={scope} onValueChange={(v: string) => setScope(v as 'mine' | 'public')}>
          <TabsList>
            <TabsTrigger value="mine">{t.mine}</TabsTrigger>
            <TabsTrigger value="public">{t.public}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input className="ml-auto w-56" type="search" placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
      {
        items.map((p) => (
          <Card key={p.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.title}</span>
              <span className="text-xs text-muted-foreground">v{p.currentVersion} · {p.runs.ok}/{p.runs.total} {t.runs}</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" disabled={!linked || session.running} onClick={() => void act(async () => session.follow((await ctx.taskAgent.runProgram(p.id)).id))}>{t.run}</Button>
                {p.authorId === me && <Button size="sm" variant="outline" onClick={() => void act(() => ctx.taskAgent.setVisibility(p.id, p.visibility === 'public' ? 'private' : 'public'))}>{p.visibility === 'public' ? t.unpublish : t.publish}</Button>}
                {p.authorId !== me && <Button size="sm" variant="outline" onClick={() => void act(() => ctx.taskAgent.fork(p.id))}>{t.fork}</Button>}
                <Button size="sm" variant="ghost" onClick={() => void act(async () => setCode(code?.id === p.id ? null : { id: p.id, text: (await ctx.taskAgent.getProgram(p.id)).version.code }))}>{t.code}</Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{p.taskText}</p>
            {code?.id === p.id && <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 text-xs">{code.text}</pre>}
          </Card>
        ))
      }
      {session.id && <SessionLog t={t} session={session} />}
    </div>
  )
}
