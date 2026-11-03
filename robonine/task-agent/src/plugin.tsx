import type { PluginContext } from '@robonine/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { usd, withExtras } from './sdkExtras'
import { LibraryPanel } from './libraryPanel'
import { translations } from './translations'
import { useRobotLink } from './robotLink'
import { useSession } from './sessionLog'
import { TaskPanel } from './taskPanel'
import { AiHealthDots, downText, useAiHealth } from './aiHealth'
import { RunView } from './runView'
import { useArmed } from './armed'

/**
 * Task agent tool: describe a job, let the AI do it with the arm and cameras, keep the program.
 *
 * @param props - The host's plugin context.
 * @returns The tool.
 */
export function PluginRoot({ context }: { context: PluginContext }) {
  const ctx = withExtras(context)
  const t = useMemo(() => translations[ctx.locale as keyof typeof translations] ?? translations.en, [ctx.locale])
  const link = useRobotLink(ctx)
  const session = useSession(ctx)
  const [balance, setBalance] = useState<number | null>(null)
  const [tab, setTab] = useState<'task' | 'library'>('task')
  // a run gets the whole tool until the user goes back (after it ends): the program list and the
  // task form are no use while it moves the arm
  const [dismissed, setDismissed] = useState<string | null>(null)
  const inRun = session.id !== null && session.id !== dismissed
  const ai = useAiHealth(ctx, session.outcome)
  const armed = useArmed(ctx, session.running)
  const { Tabs, TabsList, TabsTrigger } = ctx.ui

  useEffect(() => {
    void ctx.taskAgent.credits().then((c) => setBalance(c.balanceMicroUsd)).catch(() => setBalance(null))
  }, [ctx.taskAgent, session.outcome])

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ctx.locale === 'ru' ? 'Агент задач' : 'Task agent'}</h1>
        <div className="flex flex-wrap items-center gap-4">
          <AiHealthDots health={ai.health} t={t} recheck={ai.recheck} />
          {balance !== null && <span className={`text-sm tabular-nums ${balance > 0 ? 'text-muted-foreground' : 'text-destructive'}`}>{t.credits}: {usd(balance)}</span>}
        </div>
      </div>
      {balance !== null && balance <= 0 && <p className="text-sm text-destructive">{t.noCredits}</p>}
      {inRun && <RunView ctx={ctx} t={t} link={link} session={session} onBack={() => setDismissed(session.id)} />}
      {
        !inRun && (
          <>
            <Tabs value={tab} onValueChange={(v: string) => setTab(v as 'task' | 'library')}>
              <TabsList>
                <TabsTrigger value="task">{t.tabTask}</TabsTrigger>
                <TabsTrigger value="library">{t.tabLibrary}</TabsTrigger>
              </TabsList>
            </Tabs>
            {tab === 'task' ? <TaskPanel ctx={ctx} t={t} link={link} session={session} armed={armed} outOfCredits={balance !== null && balance <= 0} aiDown={downText(ai.health, t)} /> : <LibraryPanel ctx={ctx} t={t} linked={link.linked} armed={armed} session={session} aiDown={downText(ai.health, t, ['fastVision', 'slowVision'])} />}
          </>
        )
      }
    </div>
  )
}
