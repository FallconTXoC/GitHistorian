'use client'

import { useRef, useState } from 'react'
import { FolderOpen, FileArchive, Loader2, RotateCcw, AlertCircle } from 'lucide-react'
import {
  buildModelFromFiles,
  filesFromDirectoryInput,
  filesFromZip,
  projectNameFromFile,
} from '@/lib/repo/loader'
import {
  buildModelFromGit,
  gitFilesFromDirectoryInput,
  gitFilesFromZip,
} from '@/lib/repo/git'
import { useWorkspace } from '@/lib/repo/store'
import { cn } from '@/lib/utils'

export function ProjectLoader() {
  const { loadProject, resetProject, isDemo, model } = useWorkspace()
  const dirRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(load: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await load()
    } catch (e) {
      console.log('[v0] project load failed:', e)
      setError(e instanceof Error ? e.message : 'Could not read that project.')
    } finally {
      setBusy(false)
    }
  }

  async function onDir(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files
    if (!list || list.length === 0) return
    const rootName =
      (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split(
        '/',
      )[0] || 'project'
    await run(async () => {
      // Prefer real Git history if a .git directory is present.
      const git = await gitFilesFromDirectoryInput(list)
      const fromGit = git.size ? buildModelFromGit(rootName, git) : null
      if (fromGit) {
        loadProject(fromGit)
        return
      }
      const raw = await filesFromDirectoryInput(list)
      const m = buildModelFromFiles(rootName, raw)
      if (!m) throw new Error('No source files found in that folder.')
      loadProject(m)
    })
    e.target.value = ''
  }

  async function onZip(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await run(async () => {
      const name = projectNameFromFile(file)
      // Prefer real Git history if the archive contains a .git directory.
      const git = await gitFilesFromZip(file)
      const fromGit = git.size ? buildModelFromGit(name, git) : null
      if (fromGit) {
        loadProject(fromGit)
        return
      }
      const raw = await filesFromZip(file)
      const m = buildModelFromFiles(name, raw)
      if (!m) throw new Error('No source files found in that archive.')
      loadProject(m)
    })
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
        <button
          onClick={() => dirRef.current?.click()}
          disabled={busy}
          title="Open a project folder from your computer"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
          Open folder
        </button>
        <span className="h-4 w-px bg-border" />
        <button
          onClick={() => zipRef.current?.click()}
          disabled={busy}
          title="Upload a .zip archive of a project"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <FileArchive className="h-3.5 w-3.5" />
          .zip
        </button>
      </div>

      {!isDemo && (
        <button
          onClick={resetProject}
          title="Return to the built-in demo repository"
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Demo
        </button>
      )}

      {error && (
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-del/40 bg-del/10 px-2 py-1 text-[11px] text-del',
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      )}

      {busy && (
        <span className="font-mono text-[11px] text-muted-foreground">
          reading {model.name}…
        </span>
      )}

      {/* hidden inputs */}
      <input
        ref={dirRef}
        type="file"
        onChange={onDir}
        className="hidden"
        // directory selection — not in the standard input typings
        {...({ webkitdirectory: '', directory: '', multiple: true } as Record<
          string,
          unknown
        >)}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        onChange={onZip}
        className="hidden"
      />
    </div>
  )
}
