import type { PluginServiceFactory } from '@robonine/plugin-sdk'

export const OPENCV_VERSION = '4.13.0'

const OPENCV_URL = `https://docs.opencv.org/${OPENCV_VERSION}/opencv.js`

export interface OpenCVService {
  /** Resolves when OpenCV is loaded and ready to use. */
  ready: Promise<void>
  /** OpenCV version string, e.g. "4.10.0" */
  version: string
  /** Returns the raw cv object. Call after ready resolves. */
  getCv: () => unknown
}

let loadPromise: Promise<void> | null = null

function loadOpenCV(): Promise<void> {
  if (loadPromise) {
    return loadPromise
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const win = window as Record<string, unknown>
    const cur = win['cv'] as Record<string, unknown> | undefined
    const script = document.createElement('script')

    if (cur && typeof cur['Mat'] === 'function') {
      resolve()

      return
    }

    script.src = OPENCV_URL
    script.async = true

    script.onload = () => {
      const cv = win['cv'] as Record<string, unknown> | undefined

      if (!cv) {
        loadPromise = null
        reject(new Error(`OpenCV.js ${OPENCV_VERSION} failed to initialise`))

        return
      }

      // opencv.js 4.x exposes Module["then"] which fires after onRuntimeInitialized.
      if (typeof cv['then'] === 'function') {
        ;(cv as { then: (fn: () => void) => void }).then(() => resolve())

        return
      }

      if (typeof cv['Mat'] === 'function') {
        resolve()

        return
      }

      const prev = cv['onRuntimeInitialized'] as (() => void) | undefined

      cv['onRuntimeInitialized'] = () => {
        prev?.()
        resolve()
      }
    }

    script.onerror = () => {
      loadPromise = null
      reject(new Error(`Failed to load OpenCV.js ${OPENCV_VERSION}`))
    }

    document.head.appendChild(script)
  })

  return loadPromise
}

export const PluginService: PluginServiceFactory = () => {
  const ready = loadOpenCV()

  const service: OpenCVService = {
    ready,
    version: OPENCV_VERSION,
    getCv: () => (window as Record<string, unknown>)['cv'],
  }

  return service
}
