import { WorkspaceProvider } from '@/lib/repo/store'
import { Toolbar } from '@/components/toolbar'
import { ArchitectureMap } from '@/components/map/architecture-map'
import { CommitTimeline } from '@/components/timeline/commit-timeline'
import { DetailPanel } from '@/components/panels/detail-panel'
import { DiffViewer } from '@/components/panels/diff-viewer'
import { BranchDivergence } from '@/components/panels/branch-divergence'
import { Legend } from '@/components/panels/legend'

export default function Page() {
  return (
    <WorkspaceProvider>
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <Toolbar />

        <div className="flex min-h-0 flex-1">
          {/* map = the product */}
          <section className="relative min-w-0 flex-1">
            <ArchitectureMap />
            <Legend />
            <DiffViewer />
            <BranchDivergence />
          </section>

          {/* contextual detail */}
          <aside className="hidden w-80 shrink-0 border-l border-border bg-card/40 lg:block">
            <DetailPanel />
          </aside>
        </div>

        {/* global timeline */}
        <section className="shrink-0 border-t border-border bg-card/40">
          <CommitTimeline />
        </section>
      </main>
    </WorkspaceProvider>
  )
}
