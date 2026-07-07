import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { ChevronDown, Loader2, Play, Square } from 'lucide-react'
import { CodeEditor, type EditorLanguage } from './editor'
import { createPythonRuntime } from './python/pyRunner'
import { CPP_SAMPLE, PYTHON_SAMPLE } from './samples'
import { createCppRuntime } from './cpp/cppRunner'
import { createRobotBridge } from './core/bridge'
import { translations } from './translations'
import { RosCore } from './core/rosCore'

interface Props {
  context: PluginContext
}

type Tab = 'code' | 'world'

interface OutputLine {
  kind: 'info' | 'stdout' | 'warn' | 'error'
  text: string
}

interface LoaderState {
  active: boolean
  label: string
  error: boolean
}

const IDLE_LOADER: LoaderState = { active: false, label: '', error: false }

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button } = context.ui
  const [tab, setTab] = useState<Tab>('code')
  const [language, setLanguage] = useState<EditorLanguage>('python')
  const [isRunning, setIsRunning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [loader, setLoader] = useState<LoaderState>(IDLE_LOADER)
  const [output, setOutput] = useState<OutputLine[]>([])
  const worldViewRef = useRef<WorldViewApi>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<Record<EditorLanguage, string>>({ python: PYTHON_SAMPLE, cpp: CPP_SAMPLE })
  const contextRef = useRef(context)
  const core = useMemo(() => new RosCore(), [])

  // ── UI ──────────────────────────────────────────────────────────────────────
  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`

  const lineCls = (kind: OutputLine['kind']) =>
    kind === 'error'
      ? 'text-destructive whitespace-pre-wrap'
      : kind === 'warn'
        ? 'text-amber-600 whitespace-pre-wrap'
        : kind === 'info'
          ? 'text-muted-foreground'
          : 'text-foreground whitespace-pre-wrap'

  contextRef.current = context

  const pythonRuntime = useMemo(() => createPythonRuntime(core), [core])
  const cppRuntime = useMemo(() => createCppRuntime(core), [core])

  const bridge = useMemo(
    () =>
      createRobotBridge({
        getContext: () => contextRef.current,
        core,
        getWorldView: () => worldViewRef.current,
        onError: (message) => appendLine('error', message),
      }),
    [core],
  )

  function appendLine(kind: OutputLine['kind'], text: string): void {
    setOutput((prev) => [...prev.slice(-499), { kind, text }])
  }

  const appendLog = useCallback((level: string, text: string) => {
    const kind: OutputLine['kind'] = level === 'error' || level === 'stderr' ? 'error' : level === 'warn' ? 'warn' : level === 'info' ? 'stdout' : 'stdout'

    setOutput((prev) => [...prev.slice(-499), { kind, text }])
  }, [])

  // ── Runtime loading ─────────────────────────────────────────────────────────

  const ensureRuntime = useCallback(
    async (lang: EditorLanguage): Promise<boolean> => {
      const loadedAlready = lang === 'python' ? pythonRuntime.isLoaded() : cppRuntime.isLoaded()

      if (loadedAlready) {
        return true
      }
      setLoader({ active: true, label: lang === 'python' ? t.loadingPython : t.loadingParser, error: false })
      try {
        if (lang === 'python') {
          await pythonRuntime.load((progress) => {
            const label = progress.step === 'pyodide' ? t.loadingPython : progress.step === 'package' ? `${t.loadingPackage}: ${progress.name ?? ''}` : t.loadingRclpy

            setLoader({ active: true, label, error: false })
          })
          if (!pythonRuntime.hasJspi()) {
            appendLine('warn', t.noJspiWarning)
          }
        } else {
          await cppRuntime.load((step) => {
            setLoader({ active: true, label: step === 'parser' ? t.loadingParser : t.loadingGrammar, error: false })
          })
        }
        setLoader(IDLE_LOADER)

        return true
      } catch {
        setLoader({ active: true, label: t.loadingError, error: true })

        return false
      }
    },
    [pythonRuntime, cppRuntime, t],
  )

  useEffect(() => {
    void ensureRuntime(language)
  }, [language, ensureRuntime])

  useEffect(() => {
    appendLine('info', t.topicsHint)

    return () => {
      bridge.stop()
      pythonRuntime.dispose()
      cppRuntime.dispose()
      core.reset()
    }
  }, [])

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  // ── Run / stop ──────────────────────────────────────────────────────────────

  const finishRun = useCallback(() => {
    bridge.stop()
    setIsRunning(false)
    setIsStopping(false)
  }, [bridge])

  const handleRun = useCallback(async () => {
    const code = codeRef.current[language]
    const ready = await ensureRuntime(language)

    const hooks = {
      onLog: appendLog,
      onDone: () => {
        finishRun()
      },
      onError: (text: string) => {
        appendLine('error', `${language === 'cpp' ? t.transpileError : t.programError}:\n${text}`)
        finishRun()
      },
    }

    if (!code.trim()) {
      appendLine('info', t.emptyProgram)

      return
    }
    if (!context.connection.connected) {
      appendLine('info', t.connectFirst)
      context.openConnectDialog()

      return
    }
    if (!context.connection.virtual) {
      const confirmed = await context.showSafetyWarning()

      if (!confirmed) {
        appendLine('info', t.safetyDeclined)

        return
      }
    }

    if (!ready) {
      return
    }
    setOutput([])
    bridge.start()
    setIsRunning(true)

    if (language === 'python') {
      pythonRuntime.run(code, hooks)
    } else {
      cppRuntime.run(code, hooks)
    }
  }, [language, context, ensureRuntime, bridge, appendLog, finishRun, t])

  const handleStop = useCallback(() => {
    setIsStopping(true)
    appendLine('info', t.stoppingNote)
    if (language === 'python') {
      pythonRuntime.stop(() => {
        appendLine('warn', t.restartingRuntime)
      })
    } else {
      cppRuntime.stop()
    }
  }, [language, pythonRuntime, cppRuntime, t])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b shrink-0 select-none">
        <button className={tabCls(tab === 'code')} onClick={() => setTab('code')}>
          {t.tabCode}
        </button>
        <button className={tabCls(tab === 'world')} onClick={() => setTab('world')}>
          {t.tabWorld}
        </button>
        {isRunning && (
          <div className="ml-auto flex items-center gap-1.5 px-3 text-xs text-primary font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            {t.running}
          </div>
        )}
      </div>

      {/* ── Code tab ────────────────────────────────────────────────────────── */}
      <div className={`flex flex-col flex-1 min-h-0 ${tab !== 'code' ? 'hidden' : ''}`}>
        <div className="relative flex-1 min-h-0">
          <CodeEditor language={language} initialCode={codeRef.current[language]} onChange={(code) => (codeRef.current[language] = code)} />

          {/* Loader overlay while heavy runtimes download */}
          {loader.active && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm">
              {!loader.error && <Loader2 className="w-8 h-8 animate-spin text-primary" />}
              <div className="text-sm font-medium">{loader.error ? t.loadingError : t.loadingTitle}</div>
              {!loader.error && <div className="text-xs text-muted-foreground">{loader.label}…</div>}
              {!loader.error && <div className="text-xs text-muted-foreground max-w-sm text-center">{t.runtimeNote}</div>}
              {loader.error && (
                <Button size="sm" variant="outline" onClick={() => void ensureRuntime(language)}>
                  {t.retry}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-3 py-2.5 border-t bg-card shrink-0">
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={handleStop} disabled={isStopping && language === 'cpp'} className="gap-1.5">
              <Square className="w-3.5 h-3.5" />
              {isStopping ? t.forceStop : t.stop}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void handleRun()} disabled={loader.active} className="gap-1.5">
              <Play className="w-3.5 h-3.5" />
              {t.run}
            </Button>
          )}

          <div className="relative">
            <select
              value={language}
              disabled={isRunning || loader.active}
              onChange={(e) => setLanguage(e.target.value as EditorLanguage)}
              className="h-8 appearance-none rounded-md border border-input bg-background pl-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 cursor-pointer"
              aria-label={t.languageLabel}
            >
              <option value="python">Python</option>
              <option value="cpp">C++</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>

          <span className="ml-1 text-xs text-muted-foreground hidden md:inline">{t.runtimeNote}</span>

          {output.length > 0 && (
            <button className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setOutput([])}>
              {t.clearOutput}
            </button>
          )}
        </div>

        {/* Console */}
        <div className="border-t bg-muted/40 h-40 overflow-y-auto shrink-0">
          <div className="px-3 py-1.5 space-y-0.5 font-mono text-xs">
            {output.length === 0 && <div className="text-muted-foreground">{t.consoleEmpty}</div>}
            {output.map((line, i) => (
              <div key={i} className={lineCls(line.kind)}>
                {line.kind === 'error' ? '✖ ' : line.kind === 'warn' ? '⚠ ' : line.kind === 'info' ? '· ' : '> '}
                {line.text}
              </div>
            ))}
            <div ref={outputEndRef} />
          </div>
        </div>
      </div>

      {/* ── 3D view tab — always mounted so the simulated robot keeps its pose ── */}
      <div className={`flex-1 min-h-0 ${tab !== 'world' ? 'hidden' : ''}`}>
        <context.WorldView ref={worldViewRef} motionMode="instant" />
      </div>
    </div>
  )
}
