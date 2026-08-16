'use client'

import { useMemo } from 'react'
import { X, GitFork, GitCommit } from 'lucide-react'
import {
  branchColorVar,
  branchShortLabel,
  formatDate,
} from '@/lib/repo/analysis'
import { useWorkspace } from '@/lib/repo/store'
import type { BranchId } from '@/lib/repo/types'

export function BranchDivergence() {
  const { model, index, branchViewOpen, toggleBranchView, selectCommit, openDiff } =
    useWorkspace()

  // Common ancestor is the first point a non-root branch diverged from.
  const base =
    model.branches.find((b) => b.branchedFrom)?.branchedFrom ?? null
  const baseCommit = base ? index.getCommit(base) : undefined

  const columns = useMemo(() => {
    if (!base) return []
    const baseAncestry = index.ancestorsOf(base)
    return model.branches.map((br) => {
      const unique = index
        .ancestryCommits(br.head)
        .filter((c) => !baseAncestry.has(c.sha) || c.sha === base)
        .filter((c) => c.sha !== base)
        .reverse()
      const files = new Set<string>()
      let add = 0
      let del = 0
      for (const c of unique)
        for (const ch of c.changes) {
          files.add(ch.path)
          add += ch.additions
          del += ch.deletions
        }
      return { branch: br.id, unique, fileCount: files.size, add, del }
    })
  }, [base, index, model])

  if (!branchViewOpen) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background/98 backdrop-blur-sm">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <GitFork className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Branch divergence
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            Diverged from{' '}
            <span className="text-foreground">{base?.slice(0, 7)}</span>
            {baseCommit ? ` · ${baseCommit.message}` : ''}
          </p>
        </div>
        <button
          onClick={toggleBranchView}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close branch view"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {columns.map((col) => (
            <section
              key={col.branch}
              className="flex flex-col overflow-hidden rounded-lg border bg-card"
              style={{
                borderColor: `color-mix(in oklch, ${branchColorVar(col.branch as BranchId)} 45%, var(--border))`,
              }}
            >
              <div
                className="flex items-center gap-2 border-b px-3 py-2.5"
                style={{
                  borderColor: 'var(--border)',
                  background: `color-mix(in oklch, ${branchColorVar(col.branch as BranchId)} 12%, transparent)`,
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: branchColorVar(col.branch as BranchId) }}
                />
                <span className="font-mono text-xs font-semibold text-foreground">
                  {branchShortLabel(col.branch as BranchId)}
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {col.unique.length} commit
                  {col.unique.length === 1 ? '' : 's'} ahead
                </span>
              </div>

              <div className="flex items-center gap-3 border-b border-border px-3 py-2 font-mono text-[11px]">
                <span className="text-muted-foreground">
                  {col.fileCount} files
                </span>
                <span className="text-add">+{col.add}</span>
                <span className="text-del">-{col.del}</span>
              </div>

              <div className="flex min-h-24 flex-col p-2">
                {col.unique.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                    At the divergence point.
                  </p>
                ) : (
                  col.unique.map((c) => (
                    <button
                      key={c.sha}
                      onDoubleClick={() =>
                        openDiff({ kind: 'commit', sha: c.sha })
                      }
                      onClick={() => {
                        selectCommit(c.sha)
                        toggleBranchView()
                      }}
                      className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      title="Click to time-travel · double-click for diff"
                    >
                      <GitCommit className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground group-hover:text-primary">
                          {c.message}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c.sha.slice(0, 7)} · {formatDate(c.timestamp)}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
