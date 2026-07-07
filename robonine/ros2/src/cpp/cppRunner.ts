import { type CppLoadStep, loadCppParser } from './parserLoader'
import { TranspileError, transpileCpp } from './transpiler'
import { createRclcppRuntime } from './rclcppRuntime'
import type { RosCore } from '../core/rosCore'
import type { Parser } from 'web-tree-sitter'

// Orchestrates the C++ pipeline: lazy parser download → transpile → execute
// the generated JavaScript on the main thread with cooperative stop, exactly
// like the block-code executor does.

export interface CppRunHooks {
  onLog(level: string, text: string): void
  onDone(stopped: boolean): void
  onError(text: string): void
}

export interface CppRuntime {
  isLoaded(): boolean
  isRunning(): boolean
  load(onProgress: (step: CppLoadStep) => void): Promise<void>
  run(code: string, hooks: CppRunHooks): void
  stop(): void
  dispose(): void
}

export function createCppRuntime(core: RosCore): CppRuntime {
  let parser: Parser | null = null
  let running = false
  let activeRuntime: ReturnType<typeof createRclcppRuntime> | null = null

  return {
    isLoaded() {
      return parser !== null
    },

    isRunning() {
      return running
    },

    async load(onProgress) {
      parser = await loadCppParser(onProgress)
    },

    run(code, hooks) {
      let program: string
      const runtime = createRclcppRuntime(core, { onLog: hooks.onLog })

      if (!parser || running) {
        return
      }

      try {
        program = transpileCpp(parser, code)
      } catch (err) {
        if (err instanceof TranspileError) {
          hooks.onError(err.message)
        } else {
          hooks.onError(err instanceof Error ? err.message : String(err))
        }

        return
      }

      activeRuntime = runtime
      running = true
      void (async () => {
        try {
          const factory = new Function('__rt', `"use strict"; return (async () => {\n${program}\n})()`)

          await (factory(runtime.rt) as Promise<unknown>)
          finish(false)
        } catch (err) {
          if (runtime.isStopError(err)) {
            finish(true)
          } else {
            finish(false, err instanceof Error ? err.message : String(err))
          }
        }
      })()

      function finish(stopped: boolean, error?: string): void {
        if (activeRuntime !== runtime) {
          return
        }
        runtime.stop()
        activeRuntime = null
        running = false
        if (error !== undefined) {
          hooks.onError(error)
        } else {
          hooks.onDone(stopped)
        }
      }
    },

    stop() {
      activeRuntime?.stop()
    },

    dispose() {
      activeRuntime?.stop()
      activeRuntime = null
      running = false
    },
  }
}
