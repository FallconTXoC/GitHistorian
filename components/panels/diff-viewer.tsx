'use client'

import { useMemo } from 'react'
import { X, FileCode, ArrowRight } from 'lucide-react'
import { branchColorVar, formatDate } from '@/lib/repo/analysis'
import { useWorkspace } from '@/lib/repo/store'
import { cn } from '@/lib/utils'
import type { FileChange } from '@/lib/repo/types'

const STATUS_STYLE: Record<string, string> = {
  added: 'text-add border-add/40 bg-add/10',
  modified: 'text-primary border-primary/40 bg-primary/10',
  deleted: 'text-del border-del/40 bg-del/10',
  renamed: 'text-accent-foreground border-border bg-muted',
}

export function DiffViewer() {
  const { diff, closeDiff, index } = useWorkspace()

  const commit = useMemo(() => {
    if (!diff) return undefined
    return index.getCommit(diff.sha)
  }, [diff, index])

  if (!diff || !commit) return null

  const changes =
    diff.kind === 'file'
      ? commit.changes.filter((c) => c.path === diff.path || c.from === diff.path)
      : commit.changes

  const totalAdd = changes.reduce((s, c) => s + c.additions, 0)
  const totalDel = changes.reduce((s, c) => s + c.deletions, 0)

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background/98 backdrop-blur-sm">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span
          className="rounded px-2 py-0.5 font-mono text-xs font-semibold"
          style={{
            color: branchColorVar(commit.branch),
            border: `1px solid ${branchColorVar(commit.branch)}`,
          }}
        >
          {commit.sha.slice(0, 7)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {commit.message}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {commit.author} · {formatDate(commit.timestamp)} ·{' '}
            {changes.length} file{changes.length === 1 ? '' : 's'} ·{' '}
            <span className="text-add">+{totalAdd}</span>{' '}
            <span className="text-del">-{totalDel}</span>
          </p>
        </div>
        <button
          onClick={closeDiff}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close diff"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {changes.map((c) => (
            <FileDiff key={c.path} change={c} />
          ))}
        </div>
      </div>
    </div>
  )
}

function FileDiff({ change }: { change: FileChange }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
        {change.from ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-foreground">
            <span className="text-muted-foreground line-through">
              {change.from}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            {change.path}
          </span>
        ) : (
          <span className="font-mono text-xs text-foreground">
            {change.path}
          </span>
        )}
        <span
          className={cn(
            'ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
            STATUS_STYLE[change.status],
          )}
        >
          {change.status}
        </span>
        <span className="font-mono text-[11px]">
          <span className="text-add">+{change.additions}</span>{' '}
          <span className="text-del">-{change.deletions}</span>
        </span>
      </div>

      {change.hunks.length === 0 ? (
        <p className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {change.status === 'deleted'
            ? 'File removed.'
            : 'Binary or no textual diff.'}
        </p>
      ) : (
        <div className="overflow-x-auto font-mono text-xs leading-relaxed">
          {change.hunks.map((h, hi) => (
            <div key={hi}>
              <div className="bg-primary/5 px-4 py-1 text-[11px] text-primary/80">
                {h.header}
              </div>
              {h.lines.map((l, li) => (
                <div
                  key={li}
                  className={cn(
                    'flex px-4',
                    l.type === 'add' && 'bg-add/10 text-add',
                    l.type === 'del' && 'bg-del/10 text-del',
                    l.type === 'context' && 'text-muted-foreground',
                  )}
                >
                  <span className="mr-3 select-none opacity-50">
                    {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre">{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
