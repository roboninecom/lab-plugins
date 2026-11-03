import type { AiHealth, AiService, TaskAgentContext } from './sdkExtras'
import type { Texts } from './translations'
import { useEffect, useState } from 'react'

/** How often the tool asks (the server reuses a check for 3 minutes and learns from every real call). */
const POLL_MS = 60_000
const SERVICES: AiService[] = ['orchestrator', 'fastVision', 'slowVision']

/**
 * The AI services' health, from the server (no AI call ever leaves the browser).
 *
 * @param ctx - Plugin context.
 * @param refreshKey - Changes when a run ended (ask again right away).
 * @returns The health (null until the first answer), and a recheck.
 */
export function useAiHealth(ctx: TaskAgentContext, refreshKey: unknown): { health: AiHealth | null; recheck: () => void } {
  const [health, setHealth] = useState<AiHealth | null>(null)

  useEffect(() => {
    let live = true
    const load = () => void ctx.taskAgent.health().then((h) => live && setHealth(h)).catch(() => undefined)
    const timer = setInterval(load, POLL_MS)

    load()

    return () => {
      live = false
      clearInterval(timer)
    }
  }, [ctx.taskAgent, refreshKey])

  // only a click asks the server to check again now (the fast-vision check is a paid call)
  return { health, recheck: () => void ctx.taskAgent.health(true).then(setHealth).catch(() => undefined) }
}

/**
 * A down reason in the user's language.
 *
 * @param reason - The server's reason code.
 * @param t - Texts.
 * @returns The words.
 */
function reasonText(reason: string | undefined, t: Texts): string {
  return (reason && t.aiReason[reason]) || t.aiUnavailable
}

/**
 * Which services are down, by their user-facing names.
 *
 * @param health - Health.
 * @param t - Texts.
 * @param needed - The services the action needs.
 * @returns A sentence, or null when everything needed is up.
 */
export function downText(health: AiHealth | null, t: Texts, needed: AiService[] = SERVICES): string | null {
  const down = needed.filter((s) => health?.[s].state === 'down')

  return down.length ? t.aiDown.replace('{{services}}', down.map((s) => `${t.ai[s]} (${reasonText(health![s].reason, t)})`).join(', ')) : null
}

/**
 * Green, red or grey dots for the three AI services.
 *
 * @param props - Health, texts and a recheck.
 * @returns The indicator.
 */
export function AiHealthDots({ health, t, recheck }: { health: AiHealth | null; t: Texts; recheck: () => void }) {
  return (
    <button type="button" className="flex items-center gap-3 text-xs text-muted-foreground" title={t.aiRecheck} onClick={recheck} data-testid="ai-health">
      {
        SERVICES.map((s) => {
          const state = health?.[s].state ?? 'unknown'
          const colour = state === 'up' ? 'bg-green-500' : state === 'down' ? 'bg-red-500' : 'bg-gray-400'

          return (
            <span key={s} className="flex items-center gap-1" title={state === 'down' ? `${t.ai[s]}: ${reasonText(health?.[s].reason, t)}` : `${t.ai[s]}: ${t.aiState[state]}`}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${colour}`} />
              {t.ai[s]}
            </span>
          )
        })
      }
    </button>
  )
}
