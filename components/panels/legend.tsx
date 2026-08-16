'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { branchColorVar, branchShortLabel } from '@/lib/repo/analysis'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/repo/store'

export function Legend() {
  const [open, setOpen] = useState(true)
  const { model } = useWorkspace()

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-56 overflow-hidden rounded-lg border border-border bg-card/90 backdrop-blur-md">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Visual encoding
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-border px-3 py-2.5 text-[11px]">
          <div>
            <p className="mb-1 text-muted-foreground">Border = last branch</p>
            <div className="flex flex-wrap gap-1.5">
              {model.branches.map((branch) => (
                <span
                  key={branch.id}
                  className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    color: branchColorVar(branch.id),
                    border: `1px solid ${branchColorVar(branch.id)}`,
                  }}
                >
                  {branchShortLabel(branch.id)}
                </span>
              ))}
            </div>
          </div>

          <Row>
            <span className="text-muted-foreground">Brightness</span>
            <span className="flex items-center gap-1">
              <i className="h-3 w-4 rounded-sm bg-primary opacity-30" />
              <i className="h-3 w-4 rounded-sm bg-primary opacity-60" />
              <i className="h-3 w-4 rounded-sm bg-primary" />
              <span className="ml-1 text-muted-foreground">recency</span>
            </span>
          </Row>

          <Row>
            <span className="text-muted-foreground">Node size</span>
            <span className="flex items-end gap-1">
              <i className="h-2 w-2 rounded-full bg-foreground/60" />
              <i className="h-3 w-3 rounded-full bg-foreground/60" />
              <span className="ml-1 text-muted-foreground">churn</span>
            </span>
          </Row>

          <Row>
            <span className="text-muted-foreground">Ring pulse</span>
            <span className="flex items-center gap-1">
              <i className="h-3 w-3 rounded-full ring-2 ring-primary" />
              <span className="text-muted-foreground">changed here</span>
            </span>
          </Row>

          <Row>
            <span className="text-muted-foreground">Flow direction</span>
            <span className="flex items-center gap-1">
              <i className="h-3 w-4 rounded-sm bg-incoming" />
              <i className="h-3 w-4 rounded-sm bg-outgoing" />
              <span className="ml-1 text-muted-foreground">imports / used by</span>
            </span>
          </Row>
        </div>
      )}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2">{children}</div>
}
