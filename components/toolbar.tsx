'use client'

import { GitBranch, Search, GitFork, History, X, Crosshair } from 'lucide-react'
import {
  branchColorVar,
  branchShortLabel,
  formatDate,
} from '@/lib/repo/analysis'
import { useWorkspace } from '@/lib/repo/store'
import { ProjectLoader } from '@/components/project-loader'
import { cn } from '@/lib/utils'

export function Toolbar() {
  const {
    model,
    index,
    branch,
    setBranch,
    selectedSha,
    selectCommit,
    isHead,
    search,
    setSearch,
    toggleBranchView,
    branchViewOpen,
  } = useWorkspace()

  const selected = index.getCommit(selectedSha)
  const head = model.branches.find((b) => b.id === branch)?.head ?? selectedSha

  return (
    <header className="flex items-center gap-3 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">GitHistorian</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {model.name}
          </p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      {/* branch switcher */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
        {model.branches.map((b) => (
          <button
            key={b.id}
            onClick={() => setBranch(b.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors',
              branch === b.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            style={
              branch === b.id
                ? {
                    background: `color-mix(in oklch, ${branchColorVar(b.id)} 22%, transparent)`,
                  }
                : undefined
            }
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: branchColorVar(b.id) }}
            />
            {branchShortLabel(b.id)}
          </button>
        ))}
      </div>

      {/* time-travel status */}
      {!isHead && selected && (
        <button
          onClick={() => selectCommit(head)}
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/20"
        >
          <History className="h-3.5 w-3.5" />
          <span className="font-mono">
            viewing {selectedSha.slice(0, 7)} · {formatDate(selected.timestamp)}
          </span>
          <Crosshair className="h-3 w-3" />
          <span>back to HEAD</span>
        </button>
      )}
      {isHead && (
        <span className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-add" />
          HEAD · {selectedSha.slice(0, 7)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ProjectLoader />

        <div className="mx-0.5 h-6 w-px bg-border" />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find files…"
            className="h-8 w-48 rounded-md border border-border bg-background pl-8 pr-7 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={toggleBranchView}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
            branchViewOpen
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <GitFork className="h-3.5 w-3.5" />
          Compare branches
        </button>
      </div>
    </header>
  )
}
