'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { repo as demoRepo } from './fixture'
import { createRepoIndex, type RepoIndex } from './analysis'
import type { BranchId, FileState, RepoModel } from './types'

export type Selection =
  | { kind: 'file'; path: string }
  | { kind: 'module'; id: string }
  | null

export type DiffTarget =
  | { kind: 'commit'; sha: string }
  | { kind: 'file'; sha: string; path: string }
  | null

interface WorkspaceValue {
  /** The active repository model (demo fixture or a loaded project). */
  model: RepoModel
  /** History/ancestry queries scoped to the active model. */
  index: RepoIndex
  /** Swap the active model to a freshly loaded project. */
  loadProject: (model: RepoModel) => void
  /** Restore the built-in demo repository. */
  resetProject: () => void
  /** True while the demo fixture is active. */
  isDemo: boolean

  branch: BranchId
  setBranch: (b: BranchId) => void

  /** The commit that defines the current snapshot AND the impact highlight. */
  selectedSha: string
  selectCommit: (sha: string) => void

  selection: Selection
  select: (s: Selection) => void

  hovered: string | null
  setHovered: (path: string | null) => void

  hoveredCommit: string | null
  setHoveredCommit: (sha: string | null) => void

  diff: DiffTarget
  openDiff: (t: DiffTarget) => void
  closeDiff: () => void

  branchViewOpen: boolean
  toggleBranchView: () => void

  search: string
  setSearch: (q: string) => void

  // derived
  fileStates: Map<string, FileState>
  impactedPaths: Set<string>
  isHead: boolean
}

const Ctx = createContext<WorkspaceValue | null>(null)

const headOfModel = (m: RepoModel, b: BranchId) =>
  m.branches.find((x) => x.id === b)?.head ?? m.branches[0]?.head ?? ''

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<RepoModel>(demoRepo)
  const [branch, setBranchState] = useState<BranchId>(demoRepo.defaultBranch)
  const [selectedSha, setSelectedSha] = useState<string>(
    headOfModel(demoRepo, demoRepo.defaultBranch),
  )
  const [selection, setSelection] = useState<Selection>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffTarget>(null)
  const [branchViewOpen, setBranchViewOpen] = useState(false)
  const [search, setSearch] = useState('')

  const index = useMemo(() => createRepoIndex(model), [model])

  const setBranch = useCallback(
    (b: BranchId) => {
      setBranchState(b)
      setSelectedSha(headOfModel(model, b))
    },
    [model],
  )

  const selectCommit = useCallback(
    (sha: string) => {
      setSelectedSha(sha)
      const c = index.getCommit(sha)
      if (c) setBranchState(c.branch)
    },
    [index],
  )

  const applyModel = useCallback((m: RepoModel) => {
    setModel(m)
    setBranchState(m.defaultBranch)
    setSelectedSha(headOfModel(m, m.defaultBranch))
    setSelection(null)
    setHovered(null)
    setDiff(null)
    setBranchViewOpen(false)
    setSearch('')
  }, [])

  const loadProject = useCallback(
    (m: RepoModel) => applyModel(m),
    [applyModel],
  )
  const resetProject = useCallback(() => applyModel(demoRepo), [applyModel])

  const fileStates = useMemo(
    () => index.fileStatesAt(selectedSha),
    [index, selectedSha],
  )
  const impactedPaths = useMemo(
    () => new Set(index.commitImpact(selectedSha)),
    [index, selectedSha],
  )
  const isHead = selectedSha === headOfModel(model, branch)
  const isDemo = model === demoRepo

  const value = useMemo<WorkspaceValue>(
    () => ({
      model,
      index,
      loadProject,
      resetProject,
      isDemo,
      branch,
      setBranch,
      selectedSha,
      selectCommit,
      selection,
      select: setSelection,
      hovered,
      setHovered,
      diff,
      openDiff: setDiff,
      closeDiff: () => setDiff(null),
      branchViewOpen,
      toggleBranchView: () => setBranchViewOpen((v) => !v),
      search,
      setSearch,
      fileStates,
      impactedPaths,
      isHead,
    }),
    [
      model,
      index,
      loadProject,
      resetProject,
      isDemo,
      branch,
      setBranch,
      selectedSha,
      selectCommit,
      selection,
      hovered,
      diff,
      branchViewOpen,
      search,
      fileStates,
      impactedPaths,
      isHead,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return v
}
