import { CPP_SAMPLE, MOVEIT_CPP_SAMPLE, MOVEIT_PYTHON_SAMPLE, NEW_CPP_TEMPLATE, NEW_PYTHON_TEMPLATE, PYTHON_SAMPLE } from './samples'
import { strToU8, zipSync } from 'fflate'

// The user's workspace: a small set of named .py/.cpp files plus the library
// switches, persisted in localStorage so work survives reloads. Nothing here
// touches the runtimes — plugin.tsx decides what to load based on the toggles.

export type EditorLanguage = 'cpp' | 'python'

export interface WorkspaceFile {
  name: string
  content: string
}

export interface LibrarySettings {
  numpy: boolean
  moveit: boolean
}

const FILES_KEY = 'robonine.ros2.files.v1'
const LIBRARIES_KEY = 'robonine.ros2.libraries.v1'

export const DEFAULT_LIBRARIES: LibrarySettings = { numpy: true, moveit: false }

// Optional folder segments (up to 3 levels), e.g. drivers/motor.py.
const FILE_NAME_PATTERN = /^(?:[A-Za-z0-9_][A-Za-z0-9_-]{0,40}\/){0,3}[A-Za-z0-9_][A-Za-z0-9_.-]{0,40}\.(py|cpp)$/

export function fileLanguage(name: string): EditorLanguage | null {
  if (name.endsWith('.py')) {
    return 'python'
  }
  if (name.endsWith('.cpp')) {
    return 'cpp'
  }

  return null
}

export function isValidFileName(name: string): boolean {
  return FILE_NAME_PATTERN.test(name)
}

export function templateFor(name: string): string {
  return fileLanguage(name) === 'cpp' ? NEW_CPP_TEMPLATE : NEW_PYTHON_TEMPLATE
}

export function defaultFiles(): WorkspaceFile[] {
  return [
    { name: 'wave_node.py', content: PYTHON_SAMPLE },
    { name: 'wave_node.cpp', content: CPP_SAMPLE },
    { name: 'moveit_demo.py', content: MOVEIT_PYTHON_SAMPLE },
    { name: 'moveit_demo.cpp', content: MOVEIT_CPP_SAMPLE },
  ]
}

export function loadFiles(): WorkspaceFile[] {
  try {
    const raw = localStorage.getItem(FILES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null

    if (Array.isArray(parsed)) {
      const files = parsed.filter(
        (file): file is WorkspaceFile =>
          typeof file === 'object' &&
          file !== null &&
          typeof (file as WorkspaceFile).name === 'string' &&
          typeof (file as WorkspaceFile).content === 'string' &&
          fileLanguage((file as WorkspaceFile).name) !== null,
      )

      if (files.length > 0) {
        return files
      }
    }
  } catch {
    // Corrupt storage falls back to the samples.
  }

  return defaultFiles()
}

export function saveFiles(files: WorkspaceFile[]): void {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files))
  } catch {
    // Quota errors just lose persistence, never break the editor.
  }
}

export function loadLibraries(): LibrarySettings {
  try {
    const raw = localStorage.getItem(LIBRARIES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null

    if (parsed && typeof parsed === 'object') {
      const stored = parsed as Partial<Record<keyof LibrarySettings, unknown>>

      return {
        numpy: typeof stored.numpy === 'boolean' ? stored.numpy : DEFAULT_LIBRARIES.numpy,
        moveit: typeof stored.moveit === 'boolean' ? stored.moveit : DEFAULT_LIBRARIES.moveit,
      }
    }
  } catch {
    // Corrupt storage falls back to the defaults.
  }

  return { ...DEFAULT_LIBRARIES }
}

export function saveLibraries(libraries: LibrarySettings): void {
  try {
    localStorage.setItem(LIBRARIES_KEY, JSON.stringify(libraries))
  } catch {
    // Quota errors just lose persistence.
  }
}

/** Pack the whole workspace into a ZIP (folder structure preserved) and trigger a download. */
export function downloadWorkspaceZip(files: WorkspaceFile[]): void {
  const entries: Record<string, Uint8Array> = {}
  const anchor = document.createElement('a')

  for (const file of files) {
    entries[file.name] = strToU8(file.content)
  }

  const zipped = zipSync(entries)
  const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }))

  anchor.href = url
  anchor.download = 'ros2-workspace.zip'
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Does the program reference MoveIt (used to hint when the library is off)? */
export function usesMoveIt(code: string, language: EditorLanguage): boolean {
  if (language === 'python') {
    return /(^|\n)\s*(import|from)\s+moveit\b/.test(code)
  }

  return /moveit::|MoveGroupInterface/.test(code)
}
