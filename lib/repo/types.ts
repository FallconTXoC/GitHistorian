// ---------------------------------------------------------------------------
// Normalized repository model.
//
// The real product would populate this from a local Git reader + source parser.
// In this environment we populate it from an internally-consistent fixture that
// mirrors what `git log`, `git diff` and a dependency parser would produce, so
// the entire visual exploration experience is exercised end to end.
// ---------------------------------------------------------------------------

// Known branch ids for the built-in demo. Loaded projects synthesize their own
// branch ids (typically just 'main'), so this stays an open string type.
export type BranchId = 'main' | 'refactor' | 'feature/payments' | (string & {})

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type Lang = 'ts' | 'js' | 'py' | 'test' | 'sql' | 'config'

/** A single line inside a diff hunk. */
export interface DiffLine {
  type: 'context' | 'add' | 'del'
  text: string
}

/** A contiguous block of changed lines within a file. */
export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

/** The change a single commit made to a single file. */
export interface FileChange {
  path: string
  status: FileStatus
  /** Present when status === 'renamed'. */
  from?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface Commit {
  sha: string
  message: string
  author: string
  /** ISO timestamp. */
  timestamp: string
  /** The branch this commit was authored on. */
  branch: BranchId
  /** Parent SHAs (>1 == merge commit). */
  parents: string[]
  changes: FileChange[]
}

export interface Branch {
  id: BranchId
  /** SHA the branch tip points at. */
  head: string
  /** The commit this branch first diverged from (null for the root branch). */
  branchedFrom: string | null
  color: string
}

/** A source-level dependency (import) between two files. */
export interface Dependency {
  source: string
  target: string
  type: 'import'
}

/** A logical module — a top-level source group. Position drives the map layout. */
export interface ModuleDef {
  id: string
  label: string
  /** Directory prefix that assigns files to this module. */
  prefix: string
  /** Architectural layer, top (0) to bottom. Drives vertical placement. */
  layer: number
  /** Horizontal slot within the layer. */
  column: number
}

export interface RepoModel {
  name: string
  defaultBranch: BranchId
  modules: ModuleDef[]
  /** All files that have ever existed, keyed information lives in commits. */
  files: string[]
  dependencies: Dependency[]
  commits: Commit[]
  branches: Branch[]
}

// ---- Derived / computed shapes -------------------------------------------

/** Everything the map needs to know about one file at the selected point in time. */
export interface FileState {
  path: string
  name: string
  moduleId: string
  lang: Lang
  exists: boolean
  status: FileStatus
  /** Most recent commit (within the selected ancestry) that touched the file. */
  lastCommit: Commit | null
  lastBranch: BranchId | null
  /** Branches from which the last change is reachable. */
  reachableFrom: BranchId[]
  lastChangedAt: string | null
  /** Days between last change and the reference (selected) time. */
  ageDays: number | null
  /** Total changed lines across the selected ancestry — drives node size. */
  churn: number
  additions: number
  deletions: number
  /** Number of commits (in ancestry) touching the file — drives activity. */
  commitCount: number
  firstSeen: string | null
}
