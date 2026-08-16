'use client'

import { memo } from 'react'
import { Boxes, ChevronDown } from 'lucide-react'

export interface ModuleNodeData {
  label: string
  fileCount: number
  dominantColor: string
  activity: number // 0..1
  dimmed: boolean
  selected: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  [key: string]: unknown
}

function ModuleNodeImpl({ data }: { data: ModuleNodeData }) {
  const {
    label,
    fileCount,
    dominantColor,
    activity,
    dimmed,
    selected,
    collapsed,
    onToggleCollapsed,
  } = data

  return (
    <div
      className="h-full w-full rounded-xl border transition-all duration-200"
      style={{
        opacity: dimmed ? 0.35 : 1,
        borderColor: selected ? dominantColor : 'var(--border)',
        background:
          'color-mix(in oklch, var(--surface) 55%, transparent)',
        boxShadow: selected
          ? `inset 0 0 0 1px ${dominantColor}`
          : 'none',
      }}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Boxes size={15} style={{ color: dominantColor }} />
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
            {fileCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* activity strip — how busy this area has been */}
          <div className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-2 w-1 rounded-full"
                style={{
                  backgroundColor:
                    activity > i / 4 ? dominantColor : 'var(--muted)',
                  opacity: activity > i / 4 ? 0.9 : 0.5,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapsed()
            }}
            className="nodrag nopan rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
            title={collapsed ? 'Expand folder' : 'Collapse folder'}
          >
            <ChevronDown
              size={15}
              className={collapsed ? '-rotate-90 transition-transform' : 'transition-transform'}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

export const ModuleNode = memo(ModuleNodeImpl)
