import type { PluginContext } from '@robonine/plugin-sdk'
import type { OpenCVService } from './service'
import { translations } from './translations'
import { useEffect, useState } from 'react'
import { OPENCV_VERSION } from './service'

type Status = 'loading' | 'ready' | 'error'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = translations[context.locale] ?? translations.en
  const [status, setStatus] = useState<Status>('loading')
  const opencv = context.service('opencv') as OpenCVService | null

  useEffect(() => {
    if (!opencv) {
      setStatus('error')

      return
    }

    opencv.ready.then(() => setStatus('ready')).catch(() => setStatus('error'))
  }, [opencv])

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold">OpenCV</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className={['w-2.5 h-2.5 rounded-full shrink-0', status === 'ready' ? 'bg-green-500' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground animate-pulse'].join(' ')} />
            <span className="text-sm font-medium">{status === 'ready' ? t.statusReady : status === 'error' ? t.statusError : t.statusLoading}</span>
          </div>
          {status === 'ready' && (
            <p className="text-xs text-muted-foreground">
              {t.version} {OPENCV_VERSION}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t.serviceNote}</p>
      </div>
    </div>
  )
}
