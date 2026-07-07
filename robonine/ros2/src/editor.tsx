import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { python } from '@codemirror/lang-python'
import { cpp } from '@codemirror/lang-cpp'
import { useEffect, useRef } from 'react'

export type EditorLanguage = 'python' | 'cpp'

interface Props {
  language: EditorLanguage
  initialCode: string
  onChange: (code: string) => void
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(0,0,0,0.06)' },
  '&.cm-focused': { outline: 'none' },
})

export function CodeEditor({ language, initialCode, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)

  onChangeRef.current = onChange

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const view = new EditorView({ parent: container })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Swap document and grammar together when the language changes; each
  // language keeps its own buffer in the parent.
  useEffect(() => {
    const view = viewRef.current

    if (!view) {
      return
    }
    view.setState(
      EditorState.create({
        doc: initialCode,
        extensions: [
          basicSetup,
          editorTheme,
          languageCompartment.current.of(language === 'python' ? python() : cpp()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    )
  }, [language])

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
}
