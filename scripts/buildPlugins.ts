import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import * as esbuild from 'esbuild'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import * as fs from 'node:fs'

const gzip = promisify(zlib.gzip)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pluginsDir = path.join(root, 'robonine')
const outDir = path.join(root, 'dist')

// Replace react / react/jsx-runtime with reads from the host's global registry
// so plugins share the same React instance as the platform app.
const reactGlobalsPlugin: esbuild.Plugin = {
  name: 'react-globals',
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'robonine-globals' }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'react/jsx-runtime', namespace: 'robonine-globals' }))

    build.onLoad({ filter: /.*/, namespace: 'robonine-globals' }, (args) => {
      if (args.path === 'react') {
        return {
          loader: 'js',
          contents: `
const R = window.__ROBONINE__.react
const {
  useState, useEffect, useCallback, useMemo, useRef, useContext,
  useReducer, useLayoutEffect, useImperativeHandle, useId,
  forwardRef, createContext, memo, Fragment, createElement,
  Children, Component, PureComponent, cloneElement,
  createRef, isValidElement, startTransition, Suspense, lazy, use
} = R
export {
  useState, useEffect, useCallback, useMemo, useRef, useContext,
  useReducer, useLayoutEffect, useImperativeHandle, useId,
  forwardRef, createContext, memo, Fragment, createElement,
  Children, Component, PureComponent, cloneElement,
  createRef, isValidElement, startTransition, Suspense, lazy, use
}
export default R
`,
        }
      }

      return {
        loader: 'js',
        contents: `
const { jsx, jsxs, Fragment } = window.__ROBONINE__.jsxRuntime
export { jsx, jsxs, Fragment }
`,
      }
    })
  },
}

async function buildPlugin(slug: string) {
  const pluginDir = path.join(pluginsDir, slug)
  const entryPoint = path.join(pluginDir, 'src/index.ts')
  const tmpFile = path.join(outDir, `robonine_${slug}.tmp.js`)
  const roboFile = path.join(outDir, `robonine_${slug}.robo9`)
  const pluginNodeModules = path.join(pluginDir, 'node_modules')

  fs.mkdirSync(outDir, { recursive: true })

  const nodePaths = [path.join(root, 'node_modules'), ...(fs.existsSync(pluginNodeModules) ? [pluginNodeModules] : [])]

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: tmpFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    jsx: 'automatic',
    plugins: [reactGlobalsPlugin],
    nodePaths,
  })

  const jsContent = fs.readFileSync(tmpFile)
  const compressed = await gzip(jsContent, { level: 9 })

  fs.writeFileSync(roboFile, compressed)
  fs.rmSync(tmpFile)

  const kb = (jsContent.length / 1024).toFixed(1)
  const compKb = (compressed.length / 1024).toFixed(1)

  console.log(`  robonine_${slug}: ${kb} kB → ${compKb} kB (gzip) → ${path.relative(root, roboFile)}`)
}

const target = process.argv[2]
const allSlugs = fs.readdirSync(pluginsDir).filter((s) => fs.statSync(path.join(pluginsDir, s)).isDirectory())
const slugs = target ? [target] : allSlugs

if (target && !allSlugs.includes(target)) {
  console.error(`Unknown plugin: ${target}`)
  console.error(`Available: ${allSlugs.join(', ')}`)
  process.exit(1)
}

console.log(`Building ${slugs.length} plugin(s)...`)
await Promise.all(slugs.map(buildPlugin))
console.log('Done.')
