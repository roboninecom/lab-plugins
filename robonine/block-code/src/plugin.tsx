import { ChevronDown, Download, Play, Square, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Executor, type RunMode, createExecutor } from './executor'
import { registerRobotBlocks, toolbox } from './robotBlocks'
import type { PluginContext } from '@robonine/plugin-sdk'
import { javascriptGenerator } from 'blockly/javascript'
import type { WorldViewApi } from '@robonine/plugin-sdk'
import { translations } from './translations'
import * as Blockly from 'blockly'

registerRobotBlocks()

interface Props {
  context: PluginContext
}

type Tab = 'blocks' | 'world'

interface OutputLine {
  kind: 'print' | 'error' | 'info'
  text: string
}

export function PluginRoot({ context }: Props) {
  const t = useMemo(() => translations[context.locale as keyof typeof translations] ?? translations.en, [context.locale])
  const { Button } = context.ui
  const [tab, setTab] = useState<Tab>('blocks')
  const [mode, setMode] = useState<RunMode>('simulation')
  const [isRunning, setIsRunning] = useState(false)
  const [output, setOutput] = useState<OutputLine[]>([])
  const worldViewRef = useRef<WorldViewApi>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const blocklyContainerRef = useRef<HTMLDivElement>(null)
  const executorRef = useRef<Executor | null>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // ── Blockly injection ───────────────────────────────────────────────────────

  // ── Tab style helper ────────────────────────────────────────────────────────
  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`

  // Blockly v12 + Zelos: mousedown on a block starts a gesture, then bubbles to
  // the workspace which tries to start the same gesture again and throws. The block
  // interaction still completes correctly — suppress the duplicate-start error.
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.message?.includes('gesture had already been started')) {
        e.preventDefault()
      }
    }

    window.addEventListener('error', handler)

    return () => window.removeEventListener('error', handler)
  }, [])

  useEffect(() => {
    const el = blocklyContainerRef.current

    // Resize when container changes size; center on first resize.
    let centered = false

    // Tailwind preflight sets `svg { display: block }` which overrides Blockly's
    // `display="none"` SVG attribute, keeping flyout scrollbars permanently visible.
    const style = document.createElement('style')

    const theme = Blockly.Theme.defineTheme('zelosInter', {
      name: 'zelosInter',
      base: Blockly.Themes.Zelos,
      fontStyle: { family: 'Inter, ui-sans-serif, sans-serif' },
      componentStyles: { toolboxBackgroundColour: '#ffffff', flyoutBackgroundColour: '#ffffff' },
    })

    const prevThickness = Blockly.Scrollbar.scrollbarThickness
    let trashObserver: MutationObserver | null = null
    let zoomObserver: MutationObserver | null = null

    // Align the trashcan's right edge with the zoom controls' right edge.
    // Blockly repositions both via JS on every resize, so MutationObservers keep
    // them in sync. Zoom clip width = 32px; trash clip width = 47px at scale 0.78.
    const TRASH_SCALE = 0.78
    const ZOOM_CLIP_W = 32
    const TRASH_CLIP_W = 47

    if (!el) {
      return
    }
    style.textContent =
      '.injectionDiv svg[display="none"] { display: none !important; }' +
      ' .blocklyMainBackground { stroke: none; }' +
      ' .blocklyToolboxCategory { cursor: pointer; transition: background-color 0.15s ease; }' +
      ' .blocklyToolboxCategory:hover { background-color: rgba(0,0,0,0.07) !important; }' +
      ' .blocklyTrash:hover { opacity: 0.65 !important; }'
    document.head.appendChild(style)

    // Blockly v12: the dropdowndiv module keeps a `div` variable that is only set
    // by createDom() when no .blocklyDropDownDiv exists in the DOM. If a stale
    // element lingers (e.g. React StrictMode double-mount or HMR), createDom()
    // short-circuits and leaves `div` undefined, crashing on the first dropdown click.
    document.querySelectorAll('.blocklyDropDownDiv').forEach((n) => n.remove())

    Blockly.Scrollbar.scrollbarThickness = 15

    const ws = Blockly.inject(el, {
      toolbox,
      renderer: 'zelos',
      theme,
      grid: { spacing: 24, length: 4, colour: 'rgba(0,0,0,0.06)', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.9 },
      trashcan: true,
      move: { scrollbars: true, drag: true, wheel: false },
    })

    Blockly.Scrollbar.scrollbarThickness = prevThickness

    workspaceRef.current = ws

    const trashEl = el.querySelector('.blocklyTrash') as SVGGElement | null
    const zoomContainer = el.querySelector('.blocklyZoom')?.parentElement as SVGGElement | null

    if (trashEl && zoomContainer) {
      const getZoomX = () => {
        const m = zoomContainer.getAttribute('transform')?.match(/translate\((-?[\d.]+)/)

        return m ? parseFloat(m[1]) : 0
      }

      const adjustTrash = () => {
        const t = trashEl.getAttribute('transform')
        const match = t?.match(/translate\((-?[\d.]+),(-?[\d.]+)\)/)
        const newX = getZoomX() + ZOOM_CLIP_W - TRASH_CLIP_W * TRASH_SCALE + 3

        if (!match) {
          return
        }

        const y = parseFloat(match[2])

        trashObserver!.disconnect()
        trashEl.setAttribute('transform', `translate(${newX},${y}) scale(${TRASH_SCALE})`)
        trashObserver!.observe(trashEl, { attributes: true, attributeFilter: ['transform'] })
      }

      trashObserver = new MutationObserver(adjustTrash)
      trashObserver.observe(trashEl, { attributes: true, attributeFilter: ['transform'] })
      adjustTrash()

      zoomObserver = new MutationObserver(adjustTrash)
      zoomObserver.observe(zoomContainer, { attributes: true, attributeFilter: ['transform'] })
    }

    const ro = new ResizeObserver(() => {
      if (!el.offsetParent && el.offsetWidth === 0) {
        return
      }
      Blockly.svgResize(ws)
      if (!centered) {
        centered = true
        ws.scrollCenter()
      }
    })

    ro.observe(el)

    // After the toolbox flyout opens or closes Blockly's scrollbar metrics go
    // stale. Re-running svgResize fixes the phantom oversized handle.
    const onToolboxChange = () =>
      requestAnimationFrame(() => {
        if (el.offsetWidth > 0) {
          Blockly.svgResize(ws)
        }
      })

    ws.addChangeListener(onToolboxChange)

    return () => {
      ro.disconnect()
      trashObserver?.disconnect()
      zoomObserver?.disconnect()
      ws.removeChangeListener(onToolboxChange)
      ws.dispose()
      document.head.removeChild(style)
      workspaceRef.current = null
    }
  }, [])

  // Re-size Blockly when switching back to the blocks tab.
  useEffect(() => {
    if (tab === 'blocks' && workspaceRef.current) {
      requestAnimationFrame(() => {
        if (workspaceRef.current) {
          Blockly.svgResize(workspaceRef.current)
        }
      })
    }
  }, [tab])

  // ── Auto-scroll output ──────────────────────────────────────────────────────

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  // ── Execution ───────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    const ws = workspaceRef.current

    const executor = createExecutor({
      context,
      worldView: worldViewRef.current,
      mode,
      onPrint: (line) => setOutput((prev) => [...prev, { kind: 'print', text: line }]),
      onError: (msg) => {
        const text = msg === 'ik_failed' ? t.ikFailed : `${t.programError}: ${msg}`

        setOutput((prev) => [...prev, { kind: 'error', text }])
      },
      onDone: () => {
        setIsRunning(false)
        executorRef.current = null
      },
    })

    if (!ws) {
      return
    }

    const code = javascriptGenerator.workspaceToCode(ws)

    if (!code.trim()) {
      setOutput((prev) => [...prev, { kind: 'info', text: t.noBlocks }])

      return
    }

    if (mode === 'real' && (!context.connection.connected || context.connection.virtual)) {
      setOutput((prev) => [...prev, { kind: 'error', text: t.realModeNoRobot }])

      return
    }

    if (mode === 'real') {
      const confirmed = await context.showSafetyWarning()

      if (!confirmed) {
        return
      }
    }

    setTab('world')
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    executorRef.current = executor
    setIsRunning(true)
    executor.run(code)
  }, [context, mode, t])

  const handleStop = useCallback(() => {
    executorRef.current?.stop()
    executorRef.current = null
    setIsRunning(false)
  }, [])

  const handleExport = useCallback(() => {
    const ws = workspaceRef.current
    const a = document.createElement('a')

    if (!ws) {
      return
    }

    const state = Blockly.serialization.workspaces.save(ws)
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    a.href = url
    a.download = 'program.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const reader = new FileReader()

    if (!file || !workspaceRef.current) {
      return
    }

    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string)

        Blockly.serialization.workspaces.load(state, workspaceRef.current!)
      } catch {
        setOutput((prev) => [...prev, { kind: 'error', text: 'Failed to import: invalid file.' }])
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  const modeNote = mode === 'simulation' ? t.simulationNote : t.realNote

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b shrink-0 select-none">
        <button className={tabCls(tab === 'blocks')} onClick={() => setTab('blocks')}>
          {t.tabBlocks}
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

      {/* ── Blocks tab ─────────────────────────────────────────────────────── */}
      <div className={`flex flex-col flex-1 min-h-0 ${tab !== 'blocks' ? 'hidden' : ''}`}>
        {/* Blockly workspace */}
        <div ref={blocklyContainerRef} className="flex-1 min-h-0" />

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-3 py-2.5 border-t bg-card shrink-0">
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={handleStop} className="gap-1.5">
              <Square className="w-3.5 h-3.5" />
              {t.stop}
            </Button>
          ) : (
            <Button size="sm" onClick={handleRun} className="gap-1.5">
              <Play className="w-3.5 h-3.5" />
              {t.run}
            </Button>
          )}

          <div className="relative">
            <select
              value={mode}
              disabled={isRunning}
              onChange={(e) => setMode(e.target.value as RunMode)}
              className="h-8 appearance-none rounded-md border border-input bg-background pl-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 cursor-pointer"
            >
              <option value="simulation">{t.modeSimulation}</option>
              <option value="real">{t.modeReal}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>

          <span className="ml-1 text-xs text-muted-foreground hidden sm:inline">{modeNote}</span>

          <div className="ml-auto flex items-center gap-2">
            {output.length > 0 && (
              <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setOutput([])}>
                {t.clearOutput}
              </button>
            )}
            <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()} className="gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.importProgram}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.exportProgram}</span>
            </Button>
          </div>
        </div>

        {/* Output panel */}
        {output.length > 0 && (
          <div className="border-t bg-muted/40 max-h-36 overflow-y-auto shrink-0">
            <div className="px-3 py-1.5 space-y-0.5 font-mono text-xs">
              {output.map((line, i) => (
                <div key={i} className={line.kind === 'error' ? 'text-destructive' : line.kind === 'info' ? 'text-muted-foreground' : 'text-foreground'}>
                  {line.kind === 'error' ? '✖ ' : line.kind === 'info' ? '· ' : '> '}
                  {line.text}
                </div>
              ))}
              <div ref={outputEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* ── World View tab — always mounted so simulation state persists ─────── */}
      <div className={`flex-1 min-h-0 ${tab !== 'world' ? 'hidden' : ''}`}>
        <context.WorldView ref={worldViewRef} motionMode="realistic" />
      </div>
    </div>
  )
}
