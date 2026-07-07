// Source of the module worker that hosts Pyodide. Kept as a string because
// the plugin ships as a single-file .robo9 bundle, so the worker is created
// from a Blob URL. No template interpolation happens here — all runtime
// values arrive via postMessage.

export const PY_WORKER_SOURCE = `
const state = {
  pyodide: null,
  ready: false,
  stopped: false,
  queue: [],
}

function post(msg) {
  self.postMessage(msg)
}

const bridge = {
  log(level, text) {
    post({ type: 'log', level: String(level), text: String(text) })
  },
  publish(topic, msgType, payload) {
    post({ type: 'ros', op: 'publish', topic: String(topic), msgType: String(msgType), payload: String(payload) })
  },
  subscribe(topic) {
    post({ type: 'ros', op: 'subscribe', topic: String(topic) })
  },
  drain() {
    if (state.queue.length === 0) {
      return '[]'
    }
    const raw = JSON.stringify(state.queue)
    state.queue.length = 0
    return raw
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },
  now() {
    return performance.now()
  },
  ok() {
    return !state.stopped
  },
}

async function init(msg) {
  post({ type: 'progress', step: 'pyodide' })
  const mod = await import(msg.pyodideUrl)
  const indexURL = msg.pyodideUrl.slice(0, msg.pyodideUrl.lastIndexOf('/') + 1)
  state.pyodide = await mod.loadPyodide({
    indexURL,
    stdout: (text) => post({ type: 'log', level: 'stdout', text }),
    stderr: (text) => post({ type: 'log', level: 'stderr', text }),
  })
  for (const name of msg.packages) {
    post({ type: 'progress', step: 'package', name })
    await state.pyodide.loadPackage(name)
  }
  post({ type: 'progress', step: 'rclpy' })
  state.pyodide.registerJsModule('_robonine_ros', bridge)
  state.pyodide.runPython(msg.shimCode)
  const jspi = typeof WebAssembly.Suspending === 'function'
  state.ready = true
  post({ type: 'ready', jspi })
}

function formatError(err) {
  const text = String((err && err.message) || err)
  const marker = text.indexOf('File "<exec>"')
  if (marker === -1) {
    return text
  }
  const head = text.slice(0, text.indexOf('Traceback'))
  const tail = text.slice(marker)
  return (head + 'Traceback (most recent call last):\\n  ' + tail).trim()
}

async function run(msg) {
  state.stopped = false
  state.queue.length = 0
  let namespace = null
  try {
    state.pyodide.runPython('import rclpy; rclpy._robonine_reset()')
    namespace = state.pyodide.toPy({ __name__: '__main__' })
    post({ type: 'started' })
    await state.pyodide.runPythonAsync(msg.code, { globals: namespace })
    post({ type: 'done', stopped: false })
  } catch (err) {
    const text = String((err && err.message) || err)
    if (state.stopped || text.includes('KeyboardInterrupt')) {
      post({ type: 'done', stopped: true })
    } else {
      post({ type: 'error', text: formatError(err) })
    }
  } finally {
    if (namespace) {
      namespace.destroy()
    }
  }
}

self.onmessage = (event) => {
  const msg = event.data
  if (msg.type === 'init') {
    init(msg).catch((err) => post({ type: 'init-error', text: String((err && err.message) || err) }))
  } else if (msg.type === 'run') {
    run(msg)
  } else if (msg.type === 'ros' && msg.op === 'message') {
    state.queue.push({ topic: msg.topic, data: msg.data })
    if (state.queue.length > 200) {
      state.queue.shift()
    }
  } else if (msg.type === 'stop') {
    state.stopped = true
  }
}
`
