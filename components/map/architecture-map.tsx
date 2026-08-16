'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { LocateFixed, Lock, RotateCcw, Unlock } from 'lucide-react'
import {
  branchColorVar,
  branchShortLabel,
  churnWeight,
  recencyIntensity,
  recencyLabel,
} from '@/lib/repo/analysis'
import { CHILD_H, CHILD_W, HEADER_H, computeLayout } from '@/lib/repo/layout'
import { useWorkspace } from '@/lib/repo/store'
import type { Dependency } from '@/lib/repo/types'
import { FileNode, type FileNodeData } from './file-node'
import { ModuleNode, type ModuleNodeData } from './module-node'

const nodeTypes = { file: FileNode, module: ModuleNode }
const AUTO_COLLAPSE_FILES = 36

function MapOverview({ nodes, onRecenter }: { nodes: Node[]; onRecenter: () => void }) {
  const modules = nodes.filter((node) => node.type === 'module')
  if (modules.length === 0) return null

  const boxes = modules.map((node) => {
    const width = typeof node.style?.width === 'number' ? node.style.width : 160
    const height = typeof node.style?.height === 'number' ? node.style.height : 54
    return { id: node.id, x: node.position.x, y: node.position.y, width, height }
  })
  const minX = Math.min(...boxes.map((box) => box.x)) - 32
  const minY = Math.min(...boxes.map((box) => box.y)) - 32
  const maxX = Math.max(...boxes.map((box) => box.x + box.width)) + 32
  const maxY = Math.max(...boxes.map((box) => box.y + box.height)) + 32

  return (
    <Panel position="bottom-right" className="!m-4">
      <button
        type="button"
        onClick={onRecenter}
        className="block overflow-hidden rounded-lg border border-border bg-card/90 p-1.5 text-left shadow-lg backdrop-blur"
        title="Map overview — click to recenter"
        aria-label="Map overview — click to recenter"
      >
        <span className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Overview
        </span>
        <svg width={190} height={112} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}>
          <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#151b2b" />
          {boxes.map((box) => (
            <rect
              key={box.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={10}
              fill="#164e63"
              stroke="#7dd3fc"
              strokeWidth={3}
            />
          ))}
        </svg>
      </button>
    </Panel>
  )
}

// dependency adjacency (both directions) among a given set of existing files
function buildNeighborhood(
  seed: string[],
  existing: Set<string>,
  dependencies: Dependency[],
): Set<string> {
  const down = new Map<string, string[]>() // x -> its deps
  const up = new Map<string, string[]>() // x -> its dependents
  for (const d of dependencies) {
    if (!existing.has(d.source) || !existing.has(d.target)) continue
    ;(down.get(d.source) ?? down.set(d.source, []).get(d.source)!).push(d.target)
    ;(up.get(d.target) ?? up.set(d.target, []).get(d.target)!).push(d.source)
  }
  const result = new Set<string>(seed)
  const walk = (start: string, map: Map<string, string[]>) => {
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()!
      for (const n of map.get(cur) ?? []) {
        if (!result.has(n)) {
          result.add(n)
          stack.push(n)
        }
      }
    }
  }
  for (const s of seed) {
    walk(s, down)
    walk(s, up)
  }
  return result
}

function MapInner() {
  const {
    model,
    fileStates,
    impactedPaths,
    selection,
    select,
    setHovered,
    search,
    selectedSha,
  } = useWorkspace()
  const { fitView } = useReactFlow()
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(
    () => new Set(),
  )
  const [modulePositions, setModulePositions] = useState<
    Map<string, { x: number; y: number }>
  >(() => new Map())
  const [layoutUnlocked, setLayoutUnlocked] = useState(false)

  const layout = useMemo(() => computeLayout(model), [model])

  // A new repository needs a fresh view and must not inherit a prior
  // repository's folder arrangement or collapsed state.
  useEffect(() => {
    const fileCounts = new Map<string, number>()
    for (const slot of layout.files.values()) {
      fileCounts.set(slot.parentId, (fileCounts.get(slot.parentId) ?? 0) + 1)
    }
    // Keep large projects navigable on first load. The header shows the total
    // file count and remains a one-click way to reveal a folder's contents.
    setCollapsedModules(
      new Set(
        [...fileCounts].filter(([, count]) => count > AUTO_COLLAPSE_FILES).map(([id]) => id),
      ),
    )
    setModulePositions(new Map())
    setLayoutUnlocked(false)
    let fitFrame = 0
    const frame = requestAnimationFrame(() => {
      // Wait for the collapsed nodes to be committed before measuring bounds.
      fitFrame = requestAnimationFrame(() => {
        fitView({ padding: 0.18, duration: 220 })
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(fitFrame)
    }
  }, [model, layout, fitView])

  const existingSet = useMemo(() => {
    const s = new Set<string>()
    for (const [path, st] of fileStates) if (st.exists) s.add(path)
    return s
  }, [fileStates])

  const isImmediateChange = (st) =>
    !!st &&
    st.lastCommit?.sha === selectedSha &&
    (st.status === 'added' || st.status === 'deleted')

  const visibleSet = useMemo(() => {
    const s = new Set<string>()
    for (const [path, st] of fileStates) {
      if (st.exists || isImmediateChange(st)) s.add(path)
    }
    return s
  }, [fileStates, isImmediateChange])

  const maxChurn = useMemo(() => {
    let m = 0
    for (const p of existingSet) m = Math.max(m, fileStates.get(p)!.churn)
    return m
  }, [existingSet, fileStates])

  // focus neighborhood driven by selection / search
  const focus = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      const matched = [...existingSet].filter((p) =>
        p.toLowerCase().includes(q),
      )
      return { active: true, set: new Set(matched) }
    }
    if (selection?.kind === 'file' && existingSet.has(selection.path)) {
      return {
        active: true,
        set: buildNeighborhood([selection.path], existingSet, model.dependencies),
      }
    }
    if (selection?.kind === 'module') {
      const inMod = [...existingSet].filter(
        (p) => fileStates.get(p)!.moduleId === selection.id,
      )
      return {
        active: true,
        set: buildNeighborhood(inMod, existingSet, model.dependencies),
      }
    }
    return { active: false, set: new Set<string>() }
  }, [search, selection, existingSet, fileStates, model.dependencies])

  // module aggregates
  const moduleAgg = useMemo(() => {
    const agg = new Map<
      string,
      { count: number; churn: number; commits: number; branchChurn: Map<string, number> }
    >()
    for (const p of existingSet) {
      const st = fileStates.get(p)!
      const a =
        agg.get(st.moduleId) ??
        agg
          .set(st.moduleId, {
            count: 0,
            churn: 0,
            commits: 0,
            branchChurn: new Map(),
          })
          .get(st.moduleId)!
      a.count++
      a.churn += st.churn
      a.commits += st.commitCount
      if (st.lastBranch) {
        a.branchChurn.set(
          st.lastBranch,
          (a.branchChurn.get(st.lastBranch) ?? 0) + st.churn,
        )
      }
    }
    return agg
  }, [existingSet, fileStates])

  const maxModuleCommits = useMemo(() => {
    let m = 1
    for (const a of moduleAgg.values()) m = Math.max(m, a.commits)
    return m
  }, [moduleAgg])

  const visiblePaths = useMemo(() => {
    const paths = new Set<string>()
    for (const [path, slot] of layout.files) {
      if (!collapsedModules.has(slot.parentId)) paths.add(path)
    }
    return paths
  }, [collapsedModules, layout.files])

  const toggleModule = useCallback((id: string) => {
    setCollapsedModules((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = []

    for (const box of layout.modules) {
      const a = moduleAgg.get(box.id)
      if (!a) continue // module has no files at this point in time
      let dominant: string | null = null
      let best = -1
      for (const [b, c] of a.branchChurn) if (c > best) ((best = c), (dominant = b))
      const moduleInFocus =
        !focus.active ||
        [...focus.set].some((p) => fileStates.get(p)?.moduleId === box.id) ||
        (selection?.kind === 'module' && selection.id === box.id)

      out.push({
        id: `mod:${box.id}`,
        type: 'module',
        position: modulePositions.get(box.id) ?? { x: box.x, y: box.y },
        draggable: layoutUnlocked,
        selectable: true,
        style: { width: box.w, height: collapsedModules.has(box.id) ? HEADER_H + 1 : box.h },
        data: {
          label: box.label,
          fileCount: a.count,
          dominantColor: branchColorVar(dominant as never),
          activity: a.commits / maxModuleCommits,
          dimmed: !moduleInFocus,
          selected: selection?.kind === 'module' && selection.id === box.id,
          collapsed: collapsedModules.has(box.id),
          onToggleCollapsed: () => toggleModule(box.id),
        } satisfies ModuleNodeData,
      })
    }

    for (const [path, slot] of layout.files) {
      const st = fileStates.get(path)
      if (!st || (!st.exists && !isImmediateChange(st))) continue
      if (!visiblePaths.has(path)) continue
      if (!moduleAgg.has(slot.parentId)) continue

      const inFocus = !focus.active || focus.set.has(path)
      out.push({
        id: `file:${path}`,
        type: 'file',
        parentId: `mod:${slot.parentId}`,
        extent: 'parent',
        position: { x: slot.x, y: slot.y },
        draggable: false,
        selectable: true,
        style: { width: CHILD_W, height: CHILD_H },
        data: {
          name: st.name,
          lang: st.lang,
          branchLabel: branchShortLabel(st.lastBranch),
          branchColor: branchColorVar(st.lastBranch),
          ageLabel: recencyLabel(st.ageDays),
          intensity: recencyIntensity(st.ageDays),
          churnW: churnWeight(st.churn, maxChurn),
          churn: st.churn,
          commitCount: st.commitCount,
          impacted: impactedPaths.has(path),
          dimmed: !inFocus,
          selected: selection?.kind === 'file' && selection.path === path,
          multiBranch: st.reachableFrom.length > 1,
          status: st.status,
        } satisfies FileNodeData,
      })
    }

    return out
  }, [
    layout,
    fileStates,
    moduleAgg,
    maxChurn,
    maxModuleCommits,
    impactedPaths,
    selection,
    focus,
    collapsedModules,
    modulePositions,
    layoutUnlocked,
    toggleModule,
    visiblePaths,
  ])

  const getEdgeDirection = (
    source: string,
    target: string,
  ): 'incoming' | 'outgoing' | 'neutral' => {
    const selectedFile = selection?.kind === 'file' ? selection.path : null
    if (selectedFile) {
      if (source === selectedFile) return 'outgoing'
      if (target === selectedFile) return 'incoming'
    }

    const selectedModule = selection?.kind === 'module' ? selection.id : null
    if (selectedModule) {
      const sourceModule = fileStates.get(source)?.moduleId
      const targetModule = fileStates.get(target)?.moduleId

      if (sourceModule === selectedModule && targetModule !== selectedModule) {
        return 'outgoing'
      }
      if (targetModule === selectedModule && sourceModule !== selectedModule) {
        return 'incoming'
      }
    }

    return 'neutral'
  }

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []

    for (const d of model.dependencies) {
      const sourceExists = fileStates.get(d.source)?.exists ?? false
      const targetExists = fileStates.get(d.target)?.exists ?? false

      if (
        !sourceExists ||
        !targetExists ||
        !visiblePaths.has(d.source) ||
        !visiblePaths.has(d.target)
      ) {
        continue
      }


      const inFocus =
        focus.active && focus.set.has(d.source) && focus.set.has(d.target)
      const faded = focus.active && !inFocus
      const direction = getEdgeDirection(d.source, d.target)

      let stroke = 'var(--border)'

      if (inFocus) {
        if (direction === 'outgoing') {
          stroke = 'var(--outgoing)'
        } else if (direction === 'incoming') {
          stroke = 'var(--incoming)'
        }
      }

      out.push({
        id: `e:${d.source}->${d.target}`,
        source: `file:${d.source}`,
        target: `file:${d.target}`,
        type: 'default',
        animated: inFocus,
        style: {
          stroke,
          strokeWidth: inFocus ? 1.6 : direction === 'neutral' ? 1 : 1.3,
          opacity: faded ? 0.12 : inFocus ? 0.95 : direction === 'neutral' ? 0.4 : 0.75,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: stroke,
        },
      })
    }

    return out
  }, [existingSet, focus, model.dependencies, visiblePaths, selection, fileStates])

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      if (node.type === 'module') {
        const id = node.id.replace('mod:', '')
        select({ kind: 'module', id })
      } else if (node.type === 'file') {
        const path = node.id.replace('file:', '')
        select({ kind: 'file', path })
      }
    },
    [select],
  )

  const onNodeEnter = useCallback<NodeMouseHandler>(
    (_e, node) => {
      if (node.type === 'file') setHovered(node.id.replace('file:', ''))
    },
    [setHovered],
  )

  const onNodeDragStop = useCallback<NodeMouseHandler>((_event, node) => {
    if (node.type !== 'module') return
    const id = node.id.replace('mod:', '')
    setModulePositions((current) => {
      const next = new Map(current)
      next.set(id, node.position)
      return next
    })
  }, [])

  const recenter = useCallback(() => {
    fitView({ padding: 0.18, duration: 220 })
  }, [fitView])

  const resetLayout = useCallback(() => {
    setModulePositions(new Map())
    setLayoutUnlocked(false)
    requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 220 })
    })
  }, [fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeEnter}
      onNodeMouseLeave={() => setHovered(null)}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => select(null)}
      nodesDraggable={layoutUnlocked}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.18}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1}
        color="var(--border)"
      />
      <Controls
        position="top-right"
        showInteractive={false}
        className="!rounded-lg !border !border-border !bg-card/90 !shadow-lg [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-accent [&_button]:!fill-foreground"
      />
      <MapOverview nodes={nodes} onRecenter={recenter} />
      <Panel position="top-left" className="!m-4 !flex !gap-2">
        <button
          type="button"
          onClick={recenter}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
          title="Recenter map"
          aria-label="Recenter map"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          Recenter
        </button>
        <button
          type="button"
          onClick={resetLayout}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
          title="Restore automatic folder positions"
          aria-label="Reset folder layout"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset layout
        </button>
        <button
          type="button"
          onClick={() => setLayoutUnlocked((value) => !value)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
          title={layoutUnlocked ? 'Lock folder positions' : 'Unlock folder positions'}
        >
          {layoutUnlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {layoutUnlocked ? 'Layout unlocked' : 'Unlock layout'}
        </button>
      </Panel>
    </ReactFlow>
  )
}

export function ArchitectureMap() {
  return (
    <ReactFlowProvider>
      <MapInner />
    </ReactFlowProvider>
  )
}
