import type { MoveItHostApi } from '../core/moveit'
import { RCLPY_SHIM_SOURCE } from './rclpySource'
import { PY_WORKER_SOURCE } from './workerSource'
import type { RosCore } from '../core/rosCore'

// Main-thread controller for the Pyodide worker. Owns the worker lifecycle,
// forwards ROS traffic between the worker and the shared RosCore, answers
// MoveIt IK requests through the host kinematics, and escalates a soft stop
// (Ctrl+C-like) to a worker restart when the student code refuses to yield.

export const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs'

const SOFT_STOP_TIMEOUT_MS = 2500

export interface PythonLoadStep {
  step: 'package' | 'pyodide' | 'rclpy'
  name?: string
}

export interface PythonRunOptions {
  /** Pyodide packages the run needs (downloaded on first use). */
  packages: string[]
  /** MoveIt shim to (re)install for this run; null removes it. */
  moveit: { code: string; config: string } | null
}

export interface PythonRunHooks {
  onLog(level: string, text: string): void
  onDone(stopped: boolean): void
  onError(text: string): void
  /** Pre-run downloads (packages enabled after the initial load). */
  onProgress?(progress: PythonLoadStep): void
  /** The user program actually started executing. */
  onStarted?(): void
}

export interface PythonRuntime {
  isLoaded(): boolean
  hasJspi(): boolean
  isRunning(): boolean
  load(onProgress: (p: PythonLoadStep) => void): Promise<void>
  run(code: string, options: PythonRunOptions, hooks: PythonRunHooks): void
  stop(onForceRestart: () => void): void
  dispose(): void
}

interface WorkerMessage {
  type: string
  op?: string
  step?: PythonLoadStep['step']
  name?: string
  level?: string
  text?: string
  topic?: string
  msgType?: string
  payload?: string
  id?: number
  jspi?: boolean
  stopped?: boolean
}

export function createPythonRuntime(core: RosCore, moveitHost: MoveItHostApi): PythonRuntime {
  let worker: Worker | null = null
  let workerUrl: string | null = null
  let loaded = false
  let jspi = false
  let running = false
  let loadPromise: Promise<void> | null = null
  let onProgress: ((p: PythonLoadStep) => void) | null = null
  let hooks: PythonRunHooks | null = null
  let stopTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribers: Array<() => void> = []

  function cleanupRun(): void {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    unsubscribers = []
    running = false
    if (stopTimer) {
      clearTimeout(stopTimer)
      stopTimer = null
    }
  }

  function destroyWorker(): void {
    worker?.terminate()
    worker = null
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl)
      workerUrl = null
    }
    loaded = false
    loadPromise = null
  }

  async function answerIkRequest(requestWorker: Worker, id: number, payload: string): Promise<void> {
    let solution: Record<string, number> | null

    try {
      const request = JSON.parse(payload) as { target: [number, number, number]; seed: Record<string, number> }

      solution = await moveitHost.solveIk(request.target, request.seed ?? {})
    } catch {
      solution = null
    }
    // The original worker may have been force-restarted while IK was solving.
    if (worker === requestWorker) {
      requestWorker.postMessage({ type: 'moveit', op: 'result', id, payload: JSON.stringify(solution) })
    }
  }

  function handleMessage(msg: WorkerMessage, resolveLoad: () => void, rejectLoad: (err: Error) => void): void {
    switch (msg.type) {
      case 'progress':
        if (msg.step) {
          onProgress?.({ step: msg.step, name: msg.name })
          hooks?.onProgress?.({ step: msg.step, name: msg.name })
        }
        break
      case 'ready':
        loaded = true
        jspi = Boolean(msg.jspi)
        resolveLoad()
        break
      case 'init-error':
        rejectLoad(new Error(msg.text ?? 'Failed to load Pyodide'))
        break
      case 'started':
        hooks?.onStarted?.()
        break
      case 'log':
        hooks?.onLog(msg.level ?? 'info', msg.text ?? '')
        break
      case 'ros':
        if (msg.op === 'publish' && msg.topic && msg.payload) {
          core.publish(msg.topic, msg.msgType ?? '', JSON.parse(msg.payload))
        } else if (msg.op === 'subscribe' && msg.topic) {
          const topic = msg.topic

          unsubscribers.push(
            core.subscribe(topic, (rosMsg) => {
              worker?.postMessage({ type: 'ros', op: 'message', topic, data: rosMsg })
            }),
          )
        }
        break
      case 'moveit':
        if (msg.op === 'ik' && msg.id !== undefined && worker) {
          void answerIkRequest(worker, msg.id, msg.payload ?? '{}')
        }
        break
      case 'done': {
        const runHooks = hooks

        cleanupRun()
        runHooks?.onDone(Boolean(msg.stopped))
        break
      }
      case 'error': {
        const runHooks = hooks

        cleanupRun()
        runHooks?.onError(msg.text ?? 'Unknown error')
        break
      }
      default:
        break
    }
  }

  return {
    isLoaded() {
      return loaded
    },

    hasJspi() {
      return jspi
    },

    isRunning() {
      return running
    },

    load(progressCallback) {
      onProgress = progressCallback
      if (loadPromise) {
        return loadPromise
      }
      loadPromise = new Promise<void>((resolve, reject) => {
        const blob = new Blob([PY_WORKER_SOURCE], { type: 'text/javascript' })

        workerUrl = URL.createObjectURL(blob)
        worker = new Worker(workerUrl, { type: 'module' })
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => handleMessage(event.data, resolve, reject)
        worker.onerror = (event) => {
          reject(new Error(event.message || 'Python worker failed'))
        }
        worker.postMessage({
          type: 'init',
          pyodideUrl: PYODIDE_URL,
          shimCode: RCLPY_SHIM_SOURCE,
        })
      })
      loadPromise.catch(() => {
        destroyWorker()
      })

      return loadPromise
    },

    run(code, options, runHooks) {
      if (!worker || !loaded || running) {
        return
      }
      hooks = runHooks
      running = true
      worker.postMessage({ type: 'run', code, packages: options.packages, moveit: options.moveit })
    },

    stop(onForceRestart) {
      if (!worker || !running) {
        return
      }
      worker.postMessage({ type: 'stop' })
      stopTimer = setTimeout(() => {
        const runHooks = hooks

        destroyWorker()
        cleanupRun()
        runHooks?.onDone(true)
        onForceRestart()
      }, SOFT_STOP_TIMEOUT_MS)
    },

    dispose() {
      cleanupRun()
      destroyWorker()
    },
  }
}
