'use client'

import { useMemo } from 'react'
import {
  FileCode,
  Boxes,
  GitCommit,
  ArrowRight,
  History,
  Layers,
} from 'lucide-react'
import {
  branchColorVar,
  branchShortLabel,
  fileName,
  formatDate,
  recencyLabel,
} from '@/lib/repo/analysis'
import { useWorkspace } from '@/lib/repo/store'
import { cn } from '@/lib/utils'

export function DetailPanel() {
  const { model, index, selection, fileStates, selectedSha, openDiff, select } =
    useWorkspace()

  if (!selection) return <EmptyState />
  if (selection.kind === 'module')
    return <ModuleDetail id={selection.id} />
  return <FileDetail path={selection.path} />

  function EmptyState() {
    const module = model.modules
    return (
      <div className="flex h-full flex-col justify-center gap-3 px-5 text-center">
        <Layers className="mx-auto h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">Nothing selected</p>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          Select a file or module on the map to inspect its Git history, churn,
          and dependencies. Click a commit in the timeline to travel through
          time — the map redraws to that moment and highlights what changed.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {module.slice(0, 12).map((m) => (
            <button
              key={m.id}
              onClick={() => select({ kind: 'module', id: m.id })}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function ModuleDetail({ id }: { id: string }) {
    const mod = model.modules.find((m) => m.id === id)
    const files = useMemo(
      () =>
        [...fileStates.values()]
          .filter((s) => s.moduleId === id && s.exists)
          .sort((a, b) => b.churn - a.churn),
      [id],
    )
    if (!mod) return <EmptyState />
    const totalChurn = files.reduce((s, f) => s + f.churn, 0)

    return (
      <div className="flex h-full flex-col">
        <PanelHeader
          icon={<Boxes className="h-4 w-4" />}
          eyebrow="Module"
          title={mod.label}
          subtitle={`${files.length} file${files.length === 1 ? '' : 's'} · ${totalChurn} lines churned`}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <SectionLabel>Files by churn</SectionLabel>
          <div className="flex flex-col gap-1">
            {files.map((f) => {
              const pct = totalChurn ? (f.churn / totalChurn) * 100 : 0
              return (
                <button
                  key={f.path}
                  onClick={() => select({ kind: 'file', path: f.path })}
                  className="group relative flex items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/60"
                >
                  <span
                    className="absolute inset-y-0 left-0 opacity-15"
                    style={{
                      width: `${pct}%`,
                      background: branchColorVar(f.lastBranch),
                    }}
                  />
                  <span
                    className="z-10 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: branchColorVar(f.lastBranch) }}
                  />
                  <span className="z-10 truncate font-mono text-xs text-foreground">
                    {f.name}
                  </span>
                  <span className="z-10 ml-auto font-mono text-[11px] text-muted-foreground">
                    {f.churn}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function FileDetail({ path }: { path: string }) {
    const st = fileStates.get(path)

    const history = useMemo(() => {
      return index
        .ancestryCommits(selectedSha)
        .filter((c) =>
          c.changes.some((ch) => ch.path === path || ch.from === path),
        )
        .reverse()
    }, [path])

    const deps = useMemo(
      () => model.dependencies.filter((d) => d.source === path),
      [path],
    )
    const dependents = useMemo(
      () => model.dependencies.filter((d) => d.target === path),
      [path],
    )

    if (!st || !st.exists) {
      return (
        <div className="flex h-full flex-col">
          <PanelHeader
            icon={<FileCode className="h-4 w-4" />}
            eyebrow="File"
            title={fileName(path)}
            subtitle={path}
          />
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
            <History className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              This file does not exist at the selected point in history.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col">
        <PanelHeader
          icon={<FileCode className="h-4 w-4" />}
          eyebrow="File"
          title={st.name}
          subtitle={path}
          accent={branchColorVar(st.lastBranch)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Churn" value={st.churn} hint="lines" />
            <Stat label="Commits" value={st.commitCount} />
            <Stat label="Last edit" value={recencyLabel(st.ageDays)} small />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {st.reachableFrom.map((b) => (
              <span
                key={b}
                className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  color: branchColorVar(b),
                  border: `1px solid ${branchColorVar(b)}`,
                }}
              >
                {branchShortLabel(b)}
              </span>
            ))}
            <span className="font-mono text-[11px] text-add">
              +{st.additions}
            </span>
            <span className="font-mono text-[11px] text-del">
              -{st.deletions}
            </span>
          </div>

          {(deps.length > 0 || dependents.length > 0) && (
            <>
              <SectionLabel className="mt-4">Dependencies</SectionLabel>
              <div className="flex flex-col gap-1">
                {dependents.map((d) => (
                  <DepRow
                    key={`in-${d.source}`}
                    dir="in"
                    path={d.source}
                    onClick={() => select({ kind: 'file', path: d.source })}
                  />
                ))}
                {deps.map((d) => (
                  <DepRow
                    key={`out-${d.target}`}
                    dir="out"
                    path={d.target}
                    onClick={() => select({ kind: 'file', path: d.target })}
                  />
                ))}
              </div>
            </>
          )}

          <SectionLabel className="mt-4">
            History ({history.length})
          </SectionLabel>
          <div className="flex flex-col">
            {history.map((c, i) => (
              <button
                key={c.sha}
                onClick={() => openDiff({ kind: 'file', sha: c.sha, path })}
                className="group flex items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <div className="flex flex-col items-center pt-0.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-2 ring-background"
                    style={{ background: branchColorVar(c.branch) }}
                  />
                  {i < history.length - 1 && (
                    <span className="mt-0.5 h-full min-h-4 w-px bg-border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="truncate text-xs text-foreground group-hover:text-primary">
                    {c.message}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {c.sha.slice(0, 7)} · {formatDate(c.timestamp)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }
}

function PanelHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  accent,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  subtitle: string
  accent?: string
}) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span style={accent ? { color: accent } : undefined}>{icon}</span>
        {eyebrow}
      </div>
      <h2 className="mt-1 truncate text-sm font-semibold text-foreground">
        {title}
      </h2>
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        {subtitle}
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  small,
}: {
  label: string
  value: string | number
  hint?: string
  small?: boolean
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 font-semibold text-foreground',
          small ? 'text-[11px] leading-tight' : 'text-base',
        )}
      >
        {value}
        {hint && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </p>
    </div>
  )
}

function DepRow({
  dir,
  path,
  onClick,
}: {
  dir: 'in' | 'out'
  path: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary/60"
    >
      <ArrowRight
        className={cn(
          'h-3 w-3 shrink-0 text-muted-foreground',
          dir === 'in' && 'rotate-180',
        )}
      />
      <span className="truncate font-mono text-[11px] text-foreground group-hover:text-primary">
        {fileName(path)}
      </span>
      <span className={cn("ml-auto text-[9px] uppercase tracking-wide text-muted-foreground", dir === 'in' ? 'text-incoming' : 'text-outgoing')}>
        {dir === 'in' ? 'used by' : 'imports'}
      </span>
    </button>
  )
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        'mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      <GitCommit className="h-3 w-3" />
      {children}
    </p>
  )
}
