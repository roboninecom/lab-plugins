import { usd, type TaskAgentContext, type TaskAgentEvent } from './sdkExtras'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Texts } from './translations'

type Outcome = Extract<TaskAgentEvent, { type: 'outcome' }>['outcome']

/**
 * Follows one running session (agent or program run): its events, cost and outcome.
 * Picks up a session that is already running when the tool opens.
 *
 * @param ctx - Plugin context.
 * @returns Session state and a way to follow a new session.
 */
export function useSession(ctx: TaskAgentContext) {
  const [id, setId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [spent, setSpent] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  const follow = useCallback((sessionId: string) => {
    unsubscribe.current?.()
    setId(sessionId)
    setLines([])
    setSpent(0)
    setOutcome(null)
    unsubscribe.current = ctx.taskAgent.events(sessionId, (e) => {
      if (e.type === 'cost') {
        setSpent(e.spentMicroUsd)
      } else if (e.type === 'outcome') {
        setOutcome(e.outcome)
        setSpent(e.outcome.spentMicroUsd)
      } else {
        setLines((prev) => [...prev.slice(-300), describe(e)])
      }
    })
  }, [ctx.taskAgent])

  useEffect(() => {
    void ctx.taskAgent.current().then((s) => s && follow(s.id)).catch(() => undefined)

    return () => unsubscribe.current?.()
  }, [ctx.taskAgent, follow])

  return { id, lines, spent, outcome, running: id !== null && outcome === null, follow }
}

/**
 * One log line for an event.
 *
 * @param e - The event.
 * @returns Text.
 */
function describe(e: Exclude<TaskAgentEvent, { type: 'cost' | 'outcome' }>): string {
  if (e.type === 'text') {
    return e.text
  }
  if (e.type === 'tool') {
    return `→ ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`
  }

  return `${e.ok ? '✓' : '✗'} ${e.name}: ${e.summary}`
}

/**
 * The live log of a session.
 *
 * @param props - Texts and session state.
 * @returns The log panel.
 */
export function SessionLog({ t, session }: { t: Texts; session: ReturnType<typeof useSession> }) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [session.lines.length])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{t.log}</span>
        <span className="text-muted-foreground tabular-nums">{t.spent}: {usd(session.spent)}</span>
      </div>
      <div className="h-72 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">
        {session.lines.map((line, i) => <div key={i}>{line}</div>)}
        <div ref={end} />
      </div>
      {
        session.outcome?.status === 'no_credits' && <p className="text-sm font-medium text-destructive">{t.outOfCredits}</p>
      }
      {
        session.outcome && session.outcome.status !== 'no_credits' && (
          <p className={`text-sm font-medium ${session.outcome.success ? 'text-green-600' : 'text-amber-600'}`}>
            {session.outcome.success ? t.success : t.failure}: {session.outcome.summary}
            {session.outcome.saved ? ` — ${t.saved}` : ''}
          </p>
        )
      }
    </div>
  )
}
