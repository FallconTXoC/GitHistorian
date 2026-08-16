'use client'

import { useMemo, useRef, useState } from 'react'
import { GitCommitHorizontal, GitFork } from 'lucide-react'
import { branchColorVar, branchShortLabel } from '@/lib/repo/analysis'
import { useWorkspace } from '@/lib/repo/store'
import type { BranchId, Commit } from '@/lib/repo/types'

const COL_W = 74
const PAD_X = 120
const LANE_TOP = 28
const LANE_GAP = 36

export function CommitTimeline() {
  const [open, setOpen] = useState(true)
  const { model, selectedSha, selectCommit, hoveredCommit, setHoveredCommit, openDiff } =
    useWorkspace()
  const scrollRef = useRef<HTMLDivElement>(null)

  // One vertical lane per branch, in the model's branch order.
  const lanes = useMemo<BranchId[]>(
    () => model.branches.map((b) => b.id),
    [model],
  )
  const laneY = useMemo(() => {
    const m: Record<string, number> = {}
    lanes.forEach((b, i) => (m[b] = LANE_TOP + i * LANE_GAP))
    return m
  }, [lanes])
  const yOf = (b: BranchId) => laneY[b] ?? LANE_TOP
  const svgHeight = Math.max(132, LANE_TOP + lanes.length * LANE_GAP + 8)

  // Commits oldest -> newest, assigned an x column by chronological order.
  const ordered = useMemo(
    () =>
      [...model.commits].sort(
        (a, b) => +new Date(a.timestamp) - +new Date(b.timestamp),
      ),
    [model],
  )
  const colOf = useMemo(() => {
    const m = new Map<string, number>()
    ordered.forEach((c, i) => m.set(c.sha, i))
    return m
  }, [ordered])

  const xOf = (sha: string) => PAD_X + (colOf.get(sha) ?? 0) * COL_W
  const width = PAD_X + ordered.length * COL_W + 40
  const bySha = useMemo(
    () => new Map(model.commits.map((c) => [c.sha, c])),
    [model],
  )
  // Refs describe branch identity more faithfully than a per-commit lane:
  // multiple branch names may legitimately point at the same commit.
  const tipsAt = useMemo(() => {
    const tips = new Map<string, BranchId[]>()
    for (const branch of model.branches) {
      const names = tips.get(branch.head) ?? []
      names.push(branch.id)
      tips.set(branch.head, names)
    }
    return tips
  }, [model.branches])

  const detailCommit =
  hoveredCommit && bySha.has(hoveredCommit) ? hoveredCommit : selectedSha

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
          History
          <span className="text-muted-foreground">
            {ordered.length > 1
              ? '· click a commit to travel through time'
              : '· imported snapshot (no Git history)'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lanes.map((b) => (
            <div key={b} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: branchColorVar(b) }}
              />
              <span className="font-mono text-[11px] text-muted-foreground">
                {branchShortLabel(b)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {open &&(
      <div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto">
          <svg
            width={width}
            height={svgHeight}
            className="block"
            role="img"
            aria-label="Commit history graph"
          >
            {/* lane baselines */}
            {lanes.map((b) => (
              <line
                key={b}
                x1={PAD_X - 40}
                x2={width}
                y1={yOf(b)}
                y2={yOf(b)}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ))}

            {/* parent edges */}
            {ordered.map((c) =>
              c.parents.map((p) => {
                const parent = bySha.get(p)
                if (!parent) return null
                const x1 = xOf(p)
                const y1 = yOf(parent.branch)
                const x2 = xOf(c.sha)
                const y2 = yOf(c.branch)
                const branched = parent.branch !== c.branch
                const mx = (x1 + x2) / 2
                return (
                  <path
                    key={`${p}-${c.sha}`}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={branchColorVar(c.branch)}
                    strokeWidth={branched ? 1.75 : 2.25}
                    strokeOpacity={branched ? 0.7 : 0.9}
                  />
                )
              }),
            )}

            {/* commit nodes */}
            {ordered.map((c) => {
              const x = xOf(c.sha)
              const y = yOf(c.branch)
              const selected = c.sha === selectedSha
              const isHover = c.sha === hoveredCommit
              const isMerge = c.parents.length > 1
              return (
                <g
                  key={c.sha}
                  transform={`translate(${x}, ${y})`}
                  className="cursor-pointer"
                  onClick={() => selectCommit(c.sha)}
                  onDoubleClick={() => openDiff({ kind: 'commit', sha: c.sha })}
                  onMouseEnter={() => setHoveredCommit(c.sha)}
                  onMouseLeave={() => setHoveredCommit(null)}
                >
                  {selected && (
                    <circle
                      r={11}
                      fill="none"
                      stroke={branchColorVar(c.branch)}
                      strokeWidth={2}
                      className="animate-pulse-ring"
                    />
                  )}
                  <circle
                    r={isMerge ? 7 : 5.5}
                    fill={
                      selected || isHover
                        ? branchColorVar(c.branch)
                        : 'var(--card)'
                    }
                    stroke={branchColorVar(c.branch)}
                    strokeWidth={2}
                  />
                  {isMerge && (
                    <GitFork
                      x={-4}
                      y={-4}
                      width={8}
                      height={8}
                      color="var(--background)"
                    />
                  )}
                </g>
              )
            })}

            {/* Branch refs belong to commits, not to a made-up exclusive owner. */}
            {ordered.map((c) => {
              const tips = tipsAt.get(c.sha)
              if (!tips?.length) return null
              const x = xOf(c.sha)
              const y = yOf(c.branch)
              return (
                <g key={`tips-${c.sha}`} pointerEvents="none">
                  {tips.map((branch, i) => {
                    const label = branchShortLabel(branch)
                    const tagY = -14 - i * 15
                    const tagW = 10 + label.length * 6.5
                    return (
                      <g key={branch} transform={`translate(${x + 9}, ${y + tagY})`}>
                        <rect
                          x={0}
                          y={-10}
                          width={tagW}
                          height={14}
                          rx={3}
                          fill="var(--card)"
                          stroke={branchColorVar(branch)}
                          strokeWidth={1}
                        />
                        <text
                          x={5}
                          y={0.5}
                          fill={branchColorVar(branch)}
                          fontSize={10}
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                        >
                          {label}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        </div>

        <TimelineDetail commit={bySha.get(detailCommit)} />
      </div>
      )}
    </div>
  )
}

function TimelineDetail({ commit }: { commit: Commit | undefined }) {
  if (!commit) return null
  const files = commit.changes.length
  const add = commit.changes.reduce((s, c) => s + c.additions, 0)
  const del = commit.changes.reduce((s, c) => s + c.deletions, 0)
  return (
    <div className="flex items-center gap-3 border-t border-border/60 px-4 py-2 text-xs">
      <span
        className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
        style={{
          color: branchColorVar(commit.branch),
          background: 'color-mix(in oklch, var(--card) 60%, transparent)',
          border: `1px solid ${branchColorVar(commit.branch)}`,
        }}
      >
        {commit.sha.slice(0, 7)}
      </span>
      <span className="truncate font-medium text-foreground">
        {commit.message}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
        {commit.author} · {files} file{files === 1 ? '' : 's'} ·{' '}
        <span className="text-add">+{add}</span>{' '}
        <span className="text-del">-{del}</span>
      </span>
    </div>
  )
}
