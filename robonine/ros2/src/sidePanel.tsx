import { ChevronDown, ChevronRight, Download, FileCode2, FilePlus2, Folder, Pencil, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { PluginContext } from '@robonine/plugin-sdk'
import type { LibrarySettings } from './workspace'
import type { translations } from './translations'

// Workspace panel shown to the right of the main menu: the user's program
// files (create / rename / delete, with implicit folders from `/` in the
// path) and the library switches that decide which optional heavy packages
// get downloaded. MoveIt 2 ships disabled by default.

type Copies = (typeof translations)['en']

interface LibraryRow {
  key: keyof LibrarySettings
  label: string
  hint: string
}

interface DirNode {
  path: string
  name: string
  dirs: DirNode[]
  files: Array<{ path: string; name: string }>
}

interface Props {
  t: Copies
  ui: PluginContext['ui']
  fileNames: string[]
  activeName: string
  libraries: LibrarySettings
  onSelect(name: string): void
  onCreate(name: string): boolean
  onRename(oldName: string, newName: string): boolean
  onDelete(name: string): void
  onDownload(): void
  onToggleLibrary(key: keyof LibrarySettings): void
}

/** Folders exist implicitly through file paths — an empty folder disappears. */
function buildTree(fileNames: string[]): DirNode {
  const root: DirNode = { path: '', name: '', dirs: [], files: [] }

  for (const path of [...fileNames].sort()) {
    const parts = path.split('/')
    let node = root

    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/')
      let child = node.dirs.find((dir) => dir.path === dirPath)

      if (!child) {
        child = { path: dirPath, name: parts[i], dirs: [], files: [] }
        node.dirs.push(child)
      }
      node = child
    }
    node.files.push({ path, name: parts[parts.length - 1] })
  }

  return root
}

function NameInput({ initial, placeholder, onCommit, onCancel }: { initial: string; placeholder: string; onCommit: (name: string) => boolean; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      defaultValue={initial}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full h-6 rounded border border-input bg-background px-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (onCommit(e.currentTarget.value.trim())) {
            onCancel()
          }
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={onCancel}
    />
  )
}

export function SidePanel({ t, ui, fileNames, activeName, libraries, onSelect, onCreate, onRename, onDelete, onDownload, onToggleLibrary }: Props) {
  const { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } = ui
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  const libraryRows: LibraryRow[] = [
    { key: 'numpy', label: t.libNumpy, hint: t.libNumpyHint },
    { key: 'moveit', label: t.libMoveit, hint: t.libMoveitHint },
  ]

  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  const indent = (depth: number) => ({ paddingLeft: 12 + depth * 14 })

  const renderFile = (file: { path: string; name: string }, depth: number): ReactNode => (
    <div
      key={file.path}
      className={`group flex items-center gap-1.5 pr-1.5 py-1 text-sm cursor-pointer ${file.path === activeName ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
      style={indent(depth)}
      onClick={() => onSelect(file.path)}
    >
      <FileCode2 className="w-3.5 h-3.5 shrink-0" />
      {renaming === file.path ? (
        <NameInput initial={file.path} placeholder={t.newFilePlaceholder} onCommit={(newName) => onRename(file.path, newName)} onCancel={() => setRenaming(null)} />
      ) : (
        <>
          <span className="flex-1 truncate font-mono text-xs">{file.name}</span>
          {/* invisible (not hidden) so the row keeps its size on hover */}
          <button
            className="invisible group-hover:visible flex w-5 h-5 items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            title={t.renameFile}
            aria-label={`${t.renameFile} ${file.path}`}
            onClick={(e) => {
              e.stopPropagation()
              setRenaming(file.path)
            }}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            className="invisible group-hover:visible flex w-5 h-5 items-center justify-center rounded text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
            title={t.deleteFile}
            aria-label={`${t.deleteFile} ${file.path}`}
            onClick={(e) => {
              e.stopPropagation()
              setDeleteTarget(file.path)
            }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  )

  const renderDir = (dir: DirNode, depth: number): ReactNode => {
    const collapsed = collapsedDirs.has(dir.path)

    return (
      <div key={dir.path}>
        <div
          className="flex items-center gap-1.5 pr-1.5 py-1 text-sm cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
          style={indent(depth)}
          onClick={() => toggleDir(dir.path)}
        >
          {collapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
          <Folder className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 truncate font-mono text-xs">{dir.name}</span>
        </div>
        {!collapsed && (
          <>
            {dir.dirs.map((child) => renderDir(child, depth + 1))}
            {dir.files.map((file) => renderFile(file, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const tree = buildTree(fileNames)

  return (
    <div className="flex w-56 shrink-0 flex-col min-h-0 border-r select-none" data-id="ros2-side-panel">
      {/* ── Files ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 border-b shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.filesTitle}</span>
        <span className="flex items-center">
          <button
            className="flex w-6 h-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            title={t.downloadFiles}
            aria-label={t.downloadFiles}
            onClick={onDownload}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            className="flex w-6 h-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            title={t.newFile}
            aria-label={t.newFile}
            onClick={() => setCreating(true)}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {tree.dirs.map((dir) => renderDir(dir, 0))}
        {tree.files.map((file) => renderFile(file, 0))}
        {creating && (
          <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1">
            <FileCode2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <NameInput initial="" placeholder={t.newFilePlaceholder} onCommit={onCreate} onCancel={() => setCreating(false)} />
          </div>
        )}
      </div>

      {/* ── Libraries — the rows scroll once the list outgrows the panel ─────── */}
      <div className="border-t shrink-0 flex flex-col min-h-0 max-h-[40%]">
        <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">{t.librariesTitle}</div>
        <div className="pb-2 overflow-y-auto min-h-0">
          {libraryRows.map((row) => (
            <label key={row.key} className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors">
              <input type="checkbox" className="mt-0.5 accent-primary cursor-pointer" checked={libraries[row.key]} data-id={`ros2-lib-${row.key}`} onChange={() => onToggleLibrary(row.key)} />
              <span className="flex flex-col min-w-0">
                <span className="text-sm leading-tight">{row.label}</span>
                <span className="text-xs text-muted-foreground leading-tight">{row.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Delete confirmation ─────────────────────────────────────────────── */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteFileTitle}</DialogTitle>
            <DialogDescription>{t.deleteFileNote.replace('{name}', deleteTarget ?? '')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              data-id="ros2-confirm-delete"
              onClick={() => {
                if (deleteTarget) {
                  onDelete(deleteTarget)
                }
                setDeleteTarget(null)
              }}
            >
              {t.deleteFile}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
