import type { Language as LanguageT, Parser as ParserT } from 'web-tree-sitter'

// Lazily downloads the tree-sitter JS bindings, the core wasm and the C++
// grammar from the CDN when the student first switches to C++. The npm
// package is used for types only — bundling its JS would drag emscripten's
// Node-specific imports into the browser bundle.

const WEB_TREE_SITTER_VERSION = '0.26.10'
const TREE_SITTER_CPP_VERSION = '0.23.4'
const CORE_BASE = `https://cdn.jsdelivr.net/npm/web-tree-sitter@${WEB_TREE_SITTER_VERSION}/`
const CPP_WASM_URL = `https://cdn.jsdelivr.net/npm/tree-sitter-cpp@${TREE_SITTER_CPP_VERSION}/tree-sitter-cpp.wasm`

export type CppLoadStep = 'parser' | 'grammar'

interface WebTreeSitterModule {
  Parser: typeof ParserT
  Language: typeof LanguageT
}

let parserPromise: Promise<ParserT> | null = null

export function loadCppParser(onProgress: (step: CppLoadStep) => void): Promise<ParserT> {
  if (parserPromise) {
    return parserPromise
  }
  parserPromise = (async () => {
    // Indirection keeps esbuild from trying to bundle the CDN module.
    const moduleUrl = `${CORE_BASE}web-tree-sitter.js`

    onProgress('parser')

    const { Parser, Language } = (await import(/* webpackIgnore: true */ moduleUrl)) as WebTreeSitterModule

    await Parser.init({
      locateFile: (name: string) => `${CORE_BASE}${name}`,
    })
    onProgress('grammar')

    const language = await Language.load(CPP_WASM_URL)
    const parser = new Parser()

    parser.setLanguage(language)

    return parser
  })()
  parserPromise.catch(() => {
    parserPromise = null
  })

  return parserPromise
}
