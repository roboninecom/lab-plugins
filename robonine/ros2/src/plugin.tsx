import {
  type EditorLanguage,
  type LibrarySettings,
  type WorkspaceFile,
  downloadWorkspaceZip,
  fileLanguage,
  isValidFileName,
  loadFiles,
  loadLibraries,
  saveFiles,
  saveLibraries,
  templateFor,
  usesMoveIt,
} from './workspace'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginContext, WorldViewApi } from '@robonine/plugin-sdk'
import { MOVEIT_SHIM_SOURCE } from './python/moveitSource'
import { createPythonRuntime } from './python/pyRunner'
import { Loader2, Play, Square } from 'lucide-react'
import type { MoveItHostApi } from './core/moveit'
import { createCppRuntime } from './cpp/cppRunner'
import { createRobotBridge } from './core/bridge'
import { translations } from './translations'
import { RosCore } from './core/rosCore'
import { SidePanel } from './sidePanel'
import { CodeEditor } from './editor'

interface Props {
  context: PluginContext
}

type Tab = 'code' | 'world'

interface OutputLine {
  kind: 'error' | 'info' | 'stdout' | 'warn'
  text: string
}

interface LoaderState {
  active: boolean
  label: string
  error: boolean
}

const IDLE_LOADER: LoaderState = { active: false, label: '', error: false }
const PYTHON_PACKAGES = ['numpy', 'scipy']

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button } = context.ui
  const [tab, setTab] = useState<Tab>('code')
  const [isRunning, setIsRunning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [loader, setLoader] = useState<LoaderState>(IDLE_LOADER)
  const [output, setOutput] = useState<OutputLine[]>([])
  const [libraries, setLibraries] = useState<LibrarySettings>(loadLibraries)
  const worldViewRef = useRef<WorldViewApi>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const filesRef = useRef<WorkspaceFile[]>([])
  const runningLanguageRef = useRef<EditorLanguage>('python')
  const contextRef = useRef(context)
  const librariesRef = useRef(libraries)
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

  if (filesRef.current.length === 0) {
    filesRef.current = loadFiles()
  }

  const [fileNames, setFileNames] = useState<string[]>(() => filesRef.current.map((file) => file.name))
  const [activeName, setActiveName] = useState<string>(() => filesRef.current[0].name)
  const activeLanguage: EditorLanguage = fileLanguage(activeName) ?? 'python'
  const activeFile = filesRef.current.find((file) => file.name === activeName) ?? filesRef.current[0]

  contextRef.current = context
  librariesRef.current = libraries

  // ── MoveIt host services (IK + named targets come from the platform) ──────

  const moveitHost = useMemo<MoveItHostApi>(
    () => ({
      async solveIk(target, seed) {
        try {
          return await contextRef.current.kinematics.inverseKinematics(target, seed)
        } catch {
          return null
        }
      },
      namedTarget(name) {
        const config = contextRef.current.robotConfig
        const home: Record<string, number> = {}

        if (!config || name !== 'home') {
          return null
        }

        for (const [joint, servoId] of Object.entries(config.jointServoId)) {
          home[joint] = config.neutralJointValue(servoId)
        }

        return home
      },
    }),
    [],
  )

  const pythonRuntime = useMemo(() => createPythonRuntime(core, moveitHost), [core, moveitHost])
  const cppRuntime = useMemo(() => createCppRuntime(core, () => (librariesRef.current.moveit ? moveitHost : null)), [core, moveitHost])

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

  // ── Workspace ───────────────────────────────────────────────────────────────

  const persistFiles = useCallback(() => {
    saveFiles(filesRef.current)
  }, [])

  const handleContentChange = useCallback(
    (code: string) => {
      const file = filesRef.current.find((entry) => entry.name === activeName)

      if (file) {
        file.content = code
        persistFiles()
      }
    },
    [activeName, persistFiles],
  )

  const handleCreateFile = useCallback(
    (name: string): boolean => {
      if (!isValidFileName(name)) {
        contextRef.current.toast.error(t.invalidFileName)

        return false
      }
      if (filesRef.current.some((file) => file.name === name)) {
        contextRef.current.toast.error(t.duplicateFileName)

        return false
      }
      filesRef.current.push({ name, content: templateFor(name) })
      persistFiles()
      setFileNames(filesRef.current.map((file) => file.name))
      setActiveName(name)

      return true
    },
    [persistFiles, t],
  )

  const handleRenameFile = useCallback(
    (oldName: string, newName: string): boolean => {
      const file = filesRef.current.find((entry) => entry.name === oldName)

      if (newName === oldName) {
        return true
      }
      if (!isValidFileName(newName)) {
        contextRef.current.toast.error(t.invalidFileName)

        return false
      }
      if (filesRef.current.some((file) => file.name === newName)) {
        contextRef.current.toast.error(t.duplicateFileName)

        return false
      }

      if (!file) {
        return false
      }
      file.name = newName
      persistFiles()
      setFileNames(filesRef.current.map((entry) => entry.name))
      setActiveName((current) => (current === oldName ? newName : current))

      return true
    },
    [persistFiles, t],
  )

  const handleDeleteFile = useCallback(
    (name: string) => {
      if (filesRef.current.length <= 1) {
        contextRef.current.toast.error(t.lastFileNote)

        return
      }
      filesRef.current = filesRef.current.filter((file) => file.name !== name)
      persistFiles()
      setFileNames(filesRef.current.map((file) => file.name))
      setActiveName((current) => (current === name ? filesRef.current[0].name : current))
    },
    [persistFiles, t],
  )

  const handleToggleLibrary = useCallback((key: keyof LibrarySettings) => {
    setLibraries((prev) => {
      const next = { ...prev, [key]: !prev[key] }

      saveLibraries(next)

      return next
    })
  }, [])

  // ── Runtime loading (lazy: nothing downloads until the first run) ─────────

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
    setLoader(IDLE_LOADER)
  }, [bridge])

  const handleRun = useCallback(async () => {
    const language = activeLanguage
    const code = filesRef.current.find((file) => file.name === activeName)?.content ?? ''

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
    if (!libraries.moveit && usesMoveIt(code, language)) {
      appendLine('info', t.moveitDisabledHint)

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

    const ready = await ensureRuntime(language)

    if (!ready) {
      return
    }
    setOutput([])
    bridge.start()
    runningLanguageRef.current = language
    setIsRunning(true)

    if (language === 'python') {
      pythonRuntime.run(
        code,
        {
          packages: libraries.numpy ? PYTHON_PACKAGES : [],
          moveit: libraries.moveit ? { code: MOVEIT_SHIM_SOURCE, config: JSON.stringify({ namedTargets: { home: moveitHost.namedTarget('home') ?? {} } }) } : null,
        },
        {
          ...hooks,
          onProgress: (progress) => {
            setLoader({ active: true, label: progress.step === 'package' ? `${t.loadingPackage}: ${progress.name ?? ''}` : t.loadingRclpy, error: false })
          },
          onStarted: () => {
            setLoader(IDLE_LOADER)
          },
        },
      )
    } else {
      cppRuntime.run(code, hooks)
    }
  }, [activeLanguage, activeName, libraries, context, ensureRuntime, bridge, appendLog, finishRun, moveitHost, t])

  const handleStop = useCallback(() => {
    setIsStopping(true)
    appendLine('info', t.stoppingNote)
    if (runningLanguageRef.current === 'python') {
      pythonRuntime.stop(() => {
        appendLine('warn', t.restartingRuntime)
      })
    } else {
      cppRuntime.stop()
    }
  }, [pythonRuntime, cppRuntime, t])

  return (
    // -m-2 pulls into the host page's p-4, halving the effective padding for this tool.
    <div className="flex flex-1 min-h-0 -m-2">
      {/* ── Workspace panel: files + libraries ──────────────────────────────── */}
      <SidePanel
        t={t}
        ui={context.ui}
        fileNames={fileNames}
        activeName={activeName}
        libraries={libraries}
        onSelect={setActiveName}
        onCreate={handleCreateFile}
        onRename={handleRenameFile}
        onDelete={handleDeleteFile}
        onDownload={() => downloadWorkspaceZip(filesRef.current)}
        onToggleLibrary={handleToggleLibrary}
      />

      <div className="flex flex-col flex-1 min-h-0 min-w-0">
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
            <CodeEditor fileName={activeFile.name} language={activeLanguage} initialCode={activeFile.content} onChange={handleContentChange} />

            {/* Loader overlay while heavy runtimes download */}
            {loader.active && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm">
                {!loader.error && <Loader2 className="w-8 h-8 animate-spin text-primary" />}
                <div className="text-sm font-medium">{loader.error ? t.loadingError : t.loadingTitle}</div>
                {!loader.error && <div className="text-xs text-muted-foreground">{loader.label}…</div>}
                {!loader.error && <div className="text-xs text-muted-foreground max-w-sm text-center">{t.runtimeNote}</div>}
                {loader.error && (
                  <Button size="sm" variant="outline" onClick={() => void ensureRuntime(activeLanguage)}>
                    {t.retry}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 px-3 py-2.5 border-t bg-card shrink-0">
            {isRunning ? (
              <Button size="sm" variant="destructive" onClick={handleStop} disabled={isStopping && runningLanguageRef.current === 'cpp'} className="gap-1.5">
                <Square className="w-3.5 h-3.5" />
                {isStopping ? t.forceStop : t.stop}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void handleRun()} disabled={loader.active} className="gap-1.5">
                <Play className="w-3.5 h-3.5" />
                {t.run}
              </Button>
            )}

            <span className="font-mono text-xs text-muted-foreground truncate">{activeFile.name}</span>

            <span className="ml-1 text-xs text-muted-foreground hidden md:inline">{t.runtimeNote}</span>

            {output.length > 0 && (
              <button className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setOutput([])}>
                {t.clearOutput}
              </button>
            )}
          </div>

          {/* Console */}
          <div className="border-t bg-muted/40 h-40 overflow-y-auto shrink-0" data-id="ros2-console">
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
    </div>
  )
}
