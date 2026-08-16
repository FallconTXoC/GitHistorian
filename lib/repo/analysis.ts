import type {
  BranchId,
  Commit,
  FileState,
  Lang,
  ModuleDef,
  RepoModel,
} from './types'

// ---------------------------------------------------------------------------
// Pure, model-independent helpers.
// ---------------------------------------------------------------------------

/** Assign a file to its owning module using the longest matching prefix. */
export function moduleForPath(path: string, modules: ModuleDef[]): string {
  let best: ModuleDef | null = null
  let bestLen = -1
  for (const m of modules) {
    if (m.prefix && path.startsWith(m.prefix) && m.prefix.length > bestLen) {
      best = m
      bestLen = m.prefix.length
    }
  }
  if (best) return best.id
  const root = modules.find((m) => m.prefix === '')
  return root ? root.id : 'other'
}

function extOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

export function langForPath(path: string): Lang {
  if (
    path.includes('.test.') ||
    path.includes('.spec.') ||
    path.includes('_test.') ||
    /(^|\/)tests?\//.test(path)
  )
    return 'test'
  const e = extOf(path)
  if (e === 'py' || e === 'pyi') return 'py'
  if (e === 'sql') return 'sql'
  if (
    e === 'json' ||
    e === 'yml' ||
    e === 'yaml' ||
    e === 'toml' ||
    path.endsWith('.config.ts')
  )
    return 'config'
  if (e === 'js' || e === 'jsx' || e === 'mjs' || e === 'cjs') return 'js'
  return 'ts'
}

export function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

const DAY = 1000 * 60 * 60 * 24

// --- visual encoding scales ------------------------------------------------

/** Recency → opacity/intensity. Recent = vivid, old = subdued. */
export function recencyIntensity(ageDays: number | null): number {
  if (ageDays == null) return 0.35
  if (ageDays <= 3) return 1
  if (ageDays <= 14) return 0.85
  if (ageDays <= 45) return 0.68
  if (ageDays <= 120) return 0.52
  if (ageDays <= 365) return 0.42
  return 0.32
}

export function recencyLabel(ageDays: number | null): string {
  if (ageDays == null) return 'unknown'
  if (ageDays === 0) return 'today'
  if (ageDays === 1) return 'yesterday'
  if (ageDays < 7) return `${ageDays} days ago`
  if (ageDays < 30) return `${Math.round(ageDays / 7)} weeks ago`
  if (ageDays < 365) return `${Math.round(ageDays / 30)} months ago`
  return `${(ageDays / 365).toFixed(1)} years ago`
}

/** Churn → a 0..1 weight used for node size, normalised across the snapshot. */
export function churnWeight(churn: number, maxChurn: number): number {
  if (maxChurn <= 0) return 0
  // dampen with sqrt so a single huge file doesn't dwarf everything
  return Math.sqrt(churn) / Math.sqrt(maxChurn)
}

// Palette for branches beyond the three built-in demo branches.
const DYNAMIC_BRANCH_VARS = [
  'var(--branch-main)',
  'var(--branch-refactor)',
  'var(--branch-feature)',
]

export function branchColorVar(branch: BranchId | null): string {
  switch (branch) {
    case 'main':
      return 'var(--branch-main)'
    case 'refactor':
      return 'var(--branch-refactor)'
    case 'feature/payments':
      return 'var(--branch-feature)'
    case null:
    case undefined:
      return 'var(--muted-foreground)'
    default: {
      // Deterministic colour for arbitrary (loaded-project) branch ids.
      let h = 0
      for (let i = 0; i < branch.length; i++) h = (h * 31 + branch.charCodeAt(i)) >>> 0
      return DYNAMIC_BRANCH_VARS[h % DYNAMIC_BRANCH_VARS.length]
    }
  }
}

export function branchShortLabel(branch: BranchId | null): string {
  if (branch === 'feature/payments') return 'payments'
  if (!branch) return 'unknown'
  // Show the last path segment for branches like "feature/x".
  return branch.includes('/') ? branch.split('/').pop()! : branch
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Model-bound index. All history/ancestry queries are scoped to one RepoModel
// so the app can swap between the demo repo and any loaded project safely.
// ---------------------------------------------------------------------------

export interface RepoIndex {
  model: RepoModel
  getCommit(sha: string): Commit | undefined
  ancestorsOf(sha: string): Set<string>
  ancestryCommits(sha: string): Commit[]
  branchesReaching(sha: string): BranchId[]
  fileStatesAt(selectedSha: string): Map<string, FileState>
  commitImpact(sha: string): string[]
}

export function createRepoIndex(model: RepoModel): RepoIndex {
  const commitBySha = new Map(model.commits.map((c) => [c.sha, c]))
  const ancestryCache = new Map<string, Set<string>>()

  function getCommit(sha: string): Commit | undefined {
    return commitBySha.get(sha)
  }

  /** All commits reachable from `sha` by walking parent links (inclusive). */
  function ancestorsOf(sha: string): Set<string> {
    const seen = new Set<string>()
    const stack = [sha]
    while (stack.length) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      const c = commitBySha.get(cur)
      if (c) stack.push(...c.parents)
    }
    return seen
  }

  function ancestry(sha: string): Set<string> {
    let a = ancestryCache.get(sha)
    if (!a) {
      a = ancestorsOf(sha)
      ancestryCache.set(sha, a)
    }
    return a
  }

  /** Commits in an ancestry, oldest → newest. */
  function ancestryCommits(sha: string): Commit[] {
    const set = ancestry(sha)
    return model.commits
      .filter((c) => set.has(c.sha))
      .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
  }

  /** Which branch tips can reach the given commit. */
  function branchesReaching(sha: string): BranchId[] {
    return model.branches
      .filter((b) => ancestry(b.head).has(sha))
      .map((b) => b.id)
  }

  /**
   * Compute the state of every file as of a selected commit — the snapshot the
   * architecture map renders. Files created later than the selected commit (or
   * on branches the commit can't reach) simply don't exist yet.
   */
  function fileStatesAt(selectedSha: string): Map<string, FileState> {
    const commits = ancestryCommits(selectedSha)
    const reference = commitBySha.get(selectedSha)
    const refTime = reference ? +new Date(reference.timestamp) : Date.now()

    const states = new Map<string, FileState>()

    for (const path of model.files) {
      let exists = false
      let status: FileStatus = 'modified'
      let firstSeen: string | null = null
      let lastCommit: Commit | null = null
      let churn = 0
      let additions = 0
      let deletions = 0
      let commitCount = 0

      for (const c of commits) {
        const ch = c.changes.find((x) => x.path === path || x.from === path)
        if (!ch) continue
        commitCount++
        churn += ch.additions + ch.deletions
        additions += ch.additions
        deletions += ch.deletions
        lastCommit = c
        status = ch.status


        if (ch.status === 'added' || ch.status === 'renamed') {
          exists = true
          if (!firstSeen) firstSeen = c.timestamp
        } else if (ch.status === 'deleted') {
          exists = false
        } else {
          exists = true
        }
      }

      if (commitCount === 0) continue

      const lastChangedAt = lastCommit?.timestamp ?? null
      const ageDays = lastChangedAt
        ? Math.max(0, Math.round((refTime - +new Date(lastChangedAt)) / DAY))
        : null

      states.set(path, {
        path,
        name: fileName(path),
        moduleId: moduleForPath(path, model.modules),
        lang: langForPath(path),
        exists,
        status,
        lastCommit,
        lastBranch: lastCommit?.branch ?? null,
        reachableFrom: lastCommit ? branchesReaching(lastCommit.sha) : [],
        lastChangedAt,
        ageDays,
        churn,
        additions,
        deletions,
        commitCount,
        firstSeen,
      })
    }

    return states
  }

  /** Files touched by a single commit (for impact highlighting). */
  function commitImpact(sha: string): string[] {
    const c = commitBySha.get(sha)
    if (!c) return []
    return c.changes.map((ch) => ch.path)
  }

  return {
    model,
    getCommit,
    ancestorsOf,
    ancestryCommits,
    branchesReaching,
    fileStatesAt,
    commitImpact,
  }
}
