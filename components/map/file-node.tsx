'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

export interface FileNodeData {
  name: string
  lang: string
  branchLabel: string
  branchColor: string
  ageLabel: string
  intensity: number // recency 0..1
  churnW: number // normalised churn 0..1
  churn: number
  commitCount: number
  impacted: boolean
  dimmed: boolean
  selected: boolean
  multiBranch: boolean
  status: FileStatus
  [key: string]: unknown
}

function FileNodeImpl({ data }: { data: FileNodeData }) {
  const {
    name,
    lang,
    branchLabel,
    branchColor,
    ageLabel,
    intensity,
    churnW,
    churn,
    impacted,
    dimmed,
    selected,
    multiBranch,
    status,
  } = data

  const borderColor =
    status === 'deleted'
      ? 'var(--del)'
      : status === 'added'
        ? 'var(--add)'
        : branchColor

  // recency drives how vivid the card reads
  const cardOpacity =
    dimmed ? 0.24 : status === 'deleted' ? 0.33 : 0.35 + intensity * 0.65

  return (
    <div
      className="group relative h-full w-full rounded-md border bg-card transition-all duration-200"
      style={{
        opacity: cardOpacity,
        borderColor: borderColor,
        borderStyle: status === 'deleted' ? 'dashed' : 'solid',
        boxShadow:
        status === 'deleted' ? `none` :
        selected
          ? `0 0 0 1.5px ${borderColor}, 0 8px 24px -8px ${borderColor}`
          : impacted
            ? `0 0 0 1px ${borderColor}, 0 0 18px -4px ${borderColor}`
            : 'none',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />

      {/* branch accent rail — colour = last-changing branch, opacity = recency */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px] rounded-l-md"
        style={{ backgroundColor: borderColor, opacity: 0.35 + intensity * 0.65 }}
      />

      <div className="flex h-full flex-col justify-between p-2 pl-3">
        <div className="flex items-start justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: branchColor }}
            />
            <span className="truncate font-mono text-[12px] leading-tight text-card-foreground">
              {name}
            </span>
          </div>
          {(status === 'deleted' || status === 'added') && (
            <span
              className={`shrink-0 rounded-sm px-1 text-[9px] font-medium uppercase tracking-wide text-accent-foreground ${
                status === 'deleted' ? 'bg-del' : 'bg-add-darker'
              }`}
            >
              {status === 'deleted' ? '-' : '+'}
            </span>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-1 rounded-full"
                style={{ backgroundColor: branchColor }}
              />
              {branchLabel}
              {multiBranch && <span className="opacity-60">+</span>}
            </span>
            <span className="tabular-nums">{ageLabel}</span>
          </div>
          {/* churn bar — length encodes change volume in the current view */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(6, churnW * 100)}%`,
                backgroundColor: branchColor,
                opacity: 0.85,
              }}
              title={`${churn} lines changed`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const FileNode = memo(FileNodeImpl)
