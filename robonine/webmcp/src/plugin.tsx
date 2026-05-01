import type { PluginContext } from '@robonine/plugin-sdk'
import { CheckCircle2, XCircle } from 'lucide-react'
import { translations } from './translations'
import type { McpService } from './service'
import { useMemo } from 'react'

interface Props {
  context: PluginContext
}

const ALL_TOOLS = ['robonine', 'user_robot_list', 'path_list', 'path_read', 'robot_list', 'robot_get_position']

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const service = context.service('webmcp') as McpService | null
  const isActive = service?.isActive ?? false

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            {isActive ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
            <span className="font-medium text-sm">{isActive ? t.statusActive : t.statusInactive}</span>
          </div>
          {!isActive && <p className="text-xs text-muted-foreground">{t.statusNote}</p>}
        </div>

        {isActive && (
          <>
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

            <div className="rounded-lg border bg-card p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.connectTitle}</p>
              <ol className="space-y-2 text-sm list-decimal list-inside">
                <li>{t.connectStep1}</li>
                <li>{t.connectStep2}</li>
                <li>{t.connectStep3}</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                {(([before, after]) => (
                  <>
                    {before}
                    <a href="https://chromewebstore.google.com/detail/webmcp/angbjhnglmgbaoknfnifedallkocldah" target="_blank" rel="noreferrer nofollow" className="underline underline-offset-2">
                      WebMCP
                    </a>
                    {after}
                  </>
                ))(t.connectAlt.split('{link}'))}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
