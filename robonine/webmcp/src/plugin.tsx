import type { PluginContext } from '@robonine/plugin-sdk'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { translations } from './translations'
import type { McpService } from './service'

interface Props {
  context: PluginContext
}

const ALL_TOOLS = ['robonine', 'robot_list', 'robot_get_position', 'robot_stop', 'user_robot_list', 'path_list', 'path_read']
const CONSENT_KEY = 'webmcp:relay:consented'

function StatusRow({ ok, label, note, onAction, actionLabel }: { ok: boolean; label: string; note?: string; onAction?: () => void; actionLabel?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        {ok ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
        <span className="font-medium text-sm flex-1">{label}</span>
        {!ok && onAction && actionLabel && (
          <button onClick={onAction} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0">
            {actionLabel}
          </button>
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
  const [showConsent, setShowConsent] = useState(false)
  const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } = context.ui

  useEffect(() => {
    if (!service) {
      return
    }
    if (localStorage.getItem(CONSENT_KEY) === '1') {
      if (!service.started) {
        service.connect()
      }
    } else {
      setShowConsent(true)
    }
  }, [service])

  const handleAllow = () => {
    localStorage.setItem(CONSENT_KEY, '1')
    setShowConsent(false)
    service?.connect()
  }

  useEffect(() => {
    const id = setInterval(() => {
      setRelayConnected(service?.relayConnected ?? false)
      setIsActive(service?.isActive ?? false)
    }, 500)

    return () => clearInterval(id)
  }, [service])

  return (
    <>
      <Dialog open={showConsent} onOpenChange={() => {}}>
        <DialogContent onInteractOutside={(e: Event) => e.preventDefault()} onEscapeKeyDown={(e: KeyboardEvent) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t.consentTitle}</DialogTitle>
            <DialogDescription>{t.consentBody}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t.consentNote}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConsent(false)}>
              {t.consentSkip}
            </Button>
            <Button onClick={handleAllow}>{t.consentAllow}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h1 className="text-xl font-semibold">{t.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </div>

          <div className="rounded-lg border bg-card p-5 space-y-4">
            <StatusRow
              ok={relayConnected}
              label={relayConnected ? t.relayConnected : t.relayDisconnected}
              note={t.relayNote}
              onAction={service ? () => service.connect() : undefined}
              actionLabel={t.relayReconnect}
            />
            {!relayConnected && (
              <a
                href="https://github.com/roboninecom/robonine-mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pl-8 block"
              >
                {t.relayHowTo}
              </a>
            )}
            <StatusRow ok={isActive} label={isActive ? t.statusActive : t.statusInactive} note={t.statusNote} />
          </div>

          <div className="rounded-lg border bg-card p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.toolsSectionTitle}</p>
            <div className="space-y-2">
              {ALL_TOOLS.map((name) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <code className="font-mono">{name}</code>
                  <span className="text-xs text-muted-foreground">{t.toolAlwaysOn}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
