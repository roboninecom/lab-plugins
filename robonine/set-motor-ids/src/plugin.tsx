import type { PluginContext } from '@robonine/plugin-sdk'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { translations } from './translations'

const TOTAL_MOTORS = 6

type PagePhase = 'idle' | 'assigning' | 'complete'
type AssignPhase = 'idle' | 'assigning'

interface Props {
  context: PluginContext
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale] ?? translations.en, [context.locale])
  const [pagePhase, setPagePhase] = useState<PagePhase>('idle')
  const [currentStep, setCurrentStep] = useState(1)
  const [assignPhase, setAssignPhase] = useState<AssignPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const allDone = currentStep > TOTAL_MOTORS
  const { Button } = context.ui

  useEffect(() => {
    if (context.connection.connected && pagePhase === 'idle') {
      setPagePhase('assigning')
    }
    if (!context.connection.connected && pagePhase === 'assigning') {
      setPagePhase('idle')
    }
  }, [context.connection.connected, pagePhase])

  const handleAssign = useCallback(async () => {
    setAssignPhase('assigning')
    setError(null)
    try {
      await context.servo.setId(currentStep)
      setCurrentStep((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error)
    } finally {
      setAssignPhase('idle')
    }
  }, [context.servo, currentStep, t.error])

  const handleSkip = useCallback(() => {
    setCurrentStep((n) => n + 1)
    setError(null)
  }, [])

  const handleReset = useCallback(() => {
    setCurrentStep(1)
    setError(null)
    setPagePhase(context.connection.connected ? 'assigning' : 'idle')
  }, [context.connection.connected])

  const currentLabel = t.motorLabels[currentStep] ?? `Motor ${currentStep}`

  if (pagePhase === 'idle') {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='max-w-md w-full space-y-6'>
          <div>
            <h1 className='text-xl font-semibold'>{ t.title }</h1>
            <p className='text-sm text-muted-foreground mt-1'>{ t.description }</p>
          </div>
          <Button onClick={ context.openConnectDialog }>{ t.connectHardware }</Button>
        </div>
      </div>
    )
  }

  if (pagePhase === 'complete') {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='max-w-md w-full space-y-6'>
          <div>
            <h1 className='text-xl font-semibold'>{ t.title }</h1>
            <p className='text-sm text-muted-foreground mt-1'>{ t.description }</p>
          </div>
          <div className='flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm text-green-600'>
            <CheckCircle2 className='w-4 h-4 shrink-0' />
            { t.doneTitle }
          </div>
          <p className='text-sm text-muted-foreground'>{ t.doneDescription }</p>
          <Button variant='outline' onClick={ handleReset }>{ t.startOver }</Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-1 items-center justify-center'>
      <div className='max-w-md w-full space-y-6'>
        <div>
          <h1 className='text-xl font-semibold'>{ t.title }</h1>
          <p className='text-sm text-muted-foreground mt-1'>{ t.description }</p>
        </div>
        {
          !allDone ?
            <div className='flex flex-col gap-6'>
              <div className='space-y-2'>
                <div className='flex justify-between text-xs text-muted-foreground'>
                  <span>{ currentLabel } ({ t.progressOf(currentStep, TOTAL_MOTORS) })</span>
                  <span>{ t.progressDone(currentStep - 1) }</span>
                </div>
                <div className='flex gap-1.5'>
                  {
                    Array.from({ length: TOTAL_MOTORS }, (_, i) => i + 1).map((id) =>
                      <div key={ id } className={ `flex-1 h-1.5 rounded-full transition-colors ${id < currentStep ? 'bg-green-500' : id === currentStep ? 'bg-primary' : 'bg-muted'}` } />
                    )
                  }
                </div>
              </div>

              <div className='rounded-lg border bg-card p-5 space-y-3'>
                <p className='font-semibold'>{ t.assignCardTitle(currentStep, currentLabel) }</p>
                <ol className='space-y-1.5 text-sm text-muted-foreground list-decimal list-inside'>
                  <li>{ t.assignCardStep1 }</li>
                  <li>{ t.assignCardStep2(currentLabel) }</li>
                  <li>{ t.assignCardStep3(currentStep) }</li>
                </ol>
              </div>

              {
                error &&
                  <div className='flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
                    <XCircle className='w-4 h-4 shrink-0' />
                    { error }
                  </div>
              }

              <div className='flex gap-2'>
                <Button variant='outline' disabled={ assignPhase === 'assigning' } onClick={ handleSkip }>{ t.skip }</Button>
                <Button className='flex-1' disabled={ assignPhase === 'assigning' } onClick={ handleAssign }>
                  {
                    assignPhase === 'assigning' ?
                      <>
                        <Loader2 className='w-4 h-4 mr-2 animate-spin' />
                        { t.assigning }
                      </>
                    :
                      t.assignId(currentStep)
                  }
                </Button>
              </div>
            </div>
          :
            <div className='flex flex-col items-center gap-4 py-8'>
              <CheckCircle2 className='w-14 h-14 text-green-500' />
              <div className='text-center space-y-1'>
                <p className='font-semibold text-lg'>{ t.allConfiguredTitle }</p>
                <p className='text-sm text-muted-foreground'>{ t.allConfiguredDescription(TOTAL_MOTORS) }</p>
              </div>
              <Button onClick={ () => setPagePhase('complete') }>{ t.finish }</Button>
            </div>
        }
      </div>
    </div>
  )
}
