// ---------------------------------------------------------------------------
// Real Git history reader.
//
// Given the raw bytes of a `.git` directory (from a .zip upload or a directory
// picker), this reconstructs the actual commit graph, branches and per-commit
// diffs — instead of synthesizing a single fake "import" commit — and produces
// the same normalized RepoModel the rest of the app consumes.
//
// Supports both storage forms Git uses:
//   • loose objects  (.git/objects/ab/cdef…, zlib-compressed)
//   • packfiles      (.git/objects/pack/*.pack + *.idx, incl. ref/ofs deltas)
// ---------------------------------------------------------------------------

import { inflate, Inflate } from 'pako'
import type {
  Branch,
  Commit,
  DiffHunk,
  DiffLine,
  FileChange,
  FileStatus,
  RepoModel,
} from './types'
import {
  buildDependencies,
  buildModules,
  isIgnored,
  isSource,
  MAX_DIFF_LINES,
  type RawFile,
} from './loader'
import { branchColorVar } from './analysis'

/** Bytes of a `.git` directory, keyed by path *relative to `.git/`*. */
export type GitFileMap = Map<string, Uint8Array>

const MAX_COMMITS = 600 // most recent commits kept in the model
const MAX_REACHABLE = 8000 // hard ceiling on graph walk
const MAX_FILES = 800
const MAX_BLOB_BYTES = 400_000 // skip diffing blobs larger than this
const MAX_DIFF_CELLS = 1_500_000 // LCS table cap (n*m)

const td = new TextDecoder('utf-8', { fatal: false })

// --- low-level object access ----------------------------------------------

interface GitObject {
  type: 'commit' | 'tree' | 'blob' | 'tag'
  body: Uint8Array
}

const TYPE_NAMES: Record<number, GitObject['type']> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
}

/** Inflate a complete zlib stream (loose object = one stream per file). */
function inflateAll(bytes: Uint8Array): Uint8Array {
  return inflate(bytes)
}

/** Inflate one zlib stream that may be followed by trailing bytes (packfile). */
function inflateStream(bytes: Uint8Array): Uint8Array {
  const inf = new Inflate()
  inf.push(bytes, true)
  if (inf.err) throw new Error(`inflate failed: ${inf.msg}`)
  return inf.result as Uint8Array
}

function hex(bytes: Uint8Array, start: number, len = 20): string {
  let s = ''
  for (let i = 0; i < len; i++) s += bytes[start + i].toString(16).padStart(2, '0')
  return s
}

/** Split a raw object ("<type> <size>\0<body>") into type + body. */
function parseLooseObject(raw: Uint8Array): GitObject {
  let sp = -1
  let nul = -1
  for (let i = 0; i < raw.length; i++) {
    if (sp < 0 && raw[i] === 0x20) sp = i
    else if (raw[i] === 0x00) {
      nul = i
      break
    }
  }
  if (sp < 0 || nul < 0) throw new Error('malformed loose object header')
  const type = td.decode(raw.subarray(0, sp)) as GitObject['type']
  return { type, body: raw.subarray(nul + 1) }
}

// --- packfile support -------------------------------------------------------

interface PackEntry {
  packName: string
  offset: number
}

interface PackStore {
  packs: Map<string, Uint8Array> // packName -> .pack bytes
  index: Map<string, PackEntry> // sha -> location
}

/** Parse a v2 .idx file into sha -> offset entries for one pack. */
function parseIdx(packName: string, idx: Uint8Array, index: Map<string, PackEntry>) {
  // magic \377 t O c, version 2
  if (!(idx[0] === 0xff && idx[1] === 0x74 && idx[2] === 0x4f && idx[3] === 0x63)) {
    return // v1 idx not supported; skip
  }
  const dv = new DataView(idx.buffer, idx.byteOffset, idx.byteLength)
  const count = dv.getUint32(8 + 255 * 4)
  const shaBase = 8 + 256 * 4
  const crcBase = shaBase + count * 20
  const offBase = crcBase + count * 4
  const bigBase = offBase + count * 4
  for (let i = 0; i < count; i++) {
    const sha = hex(idx, shaBase + i * 20)
    let off = dv.getUint32(offBase + i * 4)
    if (off & 0x80000000) {
      // high bit set -> index into 8-byte large-offset table
      const bigIdx = off & 0x7fffffff
      const hi = dv.getUint32(bigBase + bigIdx * 8)
      const lo = dv.getUint32(bigBase + bigIdx * 8 + 4)
      off = hi * 0x100000000 + lo
    }
    index.set(sha, { packName, offset: off })
  }
}

function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let p = 0
  const readVarSize = (): number => {
    let size = 0
    let shift = 0
    let c: number
    do {
      c = delta[p++]
      size |= (c & 0x7f) << shift
      shift += 7
    } while (c & 0x80)
    return size >>> 0
  }
  readVarSize() // base size (unused)
  const outSize = readVarSize()
  const out = new Uint8Array(outSize)
  let o = 0
  while (p < delta.length) {
    const op = delta[p++]
    if (op & 0x80) {
      // copy from base
      let cpOff = 0
      let cpSize = 0
      if (op & 0x01) cpOff |= delta[p++]
      if (op & 0x02) cpOff |= delta[p++] << 8
      if (op & 0x04) cpOff |= delta[p++] << 16
      if (op & 0x08) cpOff |= delta[p++] << 24
      cpOff >>>= 0
      if (op & 0x10) cpSize |= delta[p++]
      if (op & 0x20) cpSize |= delta[p++] << 8
      if (op & 0x40) cpSize |= delta[p++] << 16
      if (cpSize === 0) cpSize = 0x10000
      out.set(base.subarray(cpOff, cpOff + cpSize), o)
      o += cpSize
    } else if (op) {
      // insert literal
      out.set(delta.subarray(p, p + op), o)
      o += op
      p += op
    } else {
      throw new Error('invalid delta opcode 0')
    }
  }
  return out
}

// --- unified object store ---------------------------------------------------

interface ObjectStore {
  get(sha: string): GitObject
}

function createObjectStore(git: GitFileMap): ObjectStore {
  // Collect packs.
  const pack: PackStore = { packs: new Map(), index: new Map() }
  for (const [path, bytes] of git) {
    if (path.startsWith('objects/pack/') && path.endsWith('.pack')) {
      pack.packs.set(path, bytes)
    }
  }
  for (const [path, bytes] of git) {
    if (path.startsWith('objects/pack/') && path.endsWith('.idx')) {
      parseIdx(path.replace(/\.idx$/, '.pack'), bytes, pack.index)
    }
  }

  const cache = new Map<string, GitObject>()

  function readPackObject(packName: string, offset: number): GitObject {
    const buf = pack.packs.get(packName)
    if (!buf) throw new Error(`missing pack ${packName}`)
    let p = offset
    let c = buf[p++]
    const typeNum = (c >> 4) & 0x07
    let size = c & 0x0f
    let shift = 4
    while (c & 0x80) {
      c = buf[p++]
      size |= (c & 0x7f) << shift
      shift += 7
    }
    void size

    if (typeNum === 6) {
      // OFS_DELTA: base is at (this object offset - negative offset)
      c = buf[p++]
      let neg = c & 0x7f
      while (c & 0x80) {
        c = buf[p++]
        neg = ((neg + 1) << 7) | (c & 0x7f)
      }
      const base = readPackObject(packName, offset - neg)
      const delta = inflateStream(buf.subarray(p))
      return { type: base.type, body: applyDelta(base.body, delta) }
    }
    if (typeNum === 7) {
      // REF_DELTA: base referenced by sha
      const baseSha = hex(buf, p)
      p += 20
      const base = get(baseSha)
      const delta = inflateStream(buf.subarray(p))
      return { type: base.type, body: applyDelta(base.body, delta) }
    }
    const type = TYPE_NAMES[typeNum]
    if (!type) throw new Error(`unknown pack object type ${typeNum}`)
    return { type, body: inflateStream(buf.subarray(p)) }
  }

  function get(sha: string): GitObject {
    const cached = cache.get(sha)
    if (cached) return cached
    let obj: GitObject
    const loosePath = `objects/${sha.slice(0, 2)}/${sha.slice(2)}`
    const loose = git.get(loosePath)
    if (loose) {
      obj = parseLooseObject(inflateAll(loose))
    } else {
      const entry = pack.index.get(sha)
      if (!entry) throw new Error(`object not found: ${sha}`)
      obj = readPackObject(entry.packName, entry.offset)
    }
    cache.set(sha, obj)
    return obj
  }

  return { get }
}

// --- ref parsing ------------------------------------------------------------

interface Refs {
  heads: Map<string, string> // branch name -> sha
  headBranch: string | null // current branch from HEAD symref
}

function parseRefs(git: GitFileMap, store: ObjectStore): Refs {
  const heads = new Map<string, string>()

  const resolve = (raw: string, depth = 0): string | null => {
    const val = raw.trim()
    if (val.startsWith('ref:')) {
      if (depth > 8) return null
      const target = val.slice(4).trim()
      const bytes = git.get(target)
      if (bytes) return resolve(td.decode(bytes), depth + 1)
      // fall through to packed-refs lookup by full ref name below
      return packed.get(target) ?? null
    }
    return /^[0-9a-f]{40}$/.test(val) ? val : null
  }

  // packed-refs first (loose refs win over these).
  const packed = new Map<string, string>()
  const packedBytes = git.get('packed-refs')
  if (packedBytes) {
    for (const line of td.decode(packedBytes).split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || t.startsWith('^')) continue
      const sp = t.indexOf(' ')
      if (sp < 0) continue
      packed.set(t.slice(sp + 1).trim(), t.slice(0, sp).trim())
    }
  }
  for (const [ref, sha] of packed) {
    if (ref.startsWith('refs/heads/')) heads.set(ref.slice('refs/heads/'.length), sha)
  }

  // loose refs/heads/*
  for (const [path, bytes] of git) {
    if (path.startsWith('refs/heads/')) {
      const sha = resolve(td.decode(bytes))
      if (sha) heads.set(path.slice('refs/heads/'.length), sha)
    }
  }

  // HEAD -> current branch
  let headBranch: string | null = null
  const head = git.get('HEAD')
  if (head) {
    const v = td.decode(head).trim()
    if (v.startsWith('ref: refs/heads/')) headBranch = v.slice('ref: refs/heads/'.length)
  }

  // Keep only heads whose commit object is actually present.
  for (const [name, sha] of [...heads]) {
    try {
      const o = store.get(sha)
      if (o.type !== 'commit') heads.delete(name)
    } catch {
      heads.delete(name)
    }
  }

  return { heads, headBranch }
}

// --- commit + tree parsing --------------------------------------------------

interface ParsedCommit {
  sha: string
  tree: string
  parents: string[]
  author: string
  message: string
  timeMs: number
}

function parseCommit(sha: string, body: Uint8Array): ParsedCommit {
  const text = td.decode(body)
  const nl = text.indexOf('\n\n')
  const header = nl < 0 ? text : text.slice(0, nl)
  const message = nl < 0 ? '' : text.slice(nl + 2)
  let tree = ''
  const parents: string[] = []
  let author = 'unknown'
  let timeMs = Date.now()
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5).trim()
    else if (line.startsWith('parent ')) parents.push(line.slice(7).trim())
    else if (line.startsWith('author ')) {
      const m = /^author (.*?) <([^>]*)> (\d+) ([+-]\d{4})/.exec(line)
      if (m) {
        author = m[1].trim() || 'unknown'
        timeMs = parseInt(m[3], 10) * 1000
      }
    }
  }
  const firstLine = message.split('\n')[0].trim()
  return { sha, tree, parents, author, message: firstLine || '(no message)', timeMs }
}

/** Flatten a tree object into a Map<path, blobSha>, caching per tree sha. */
function createTreeReader(store: ObjectStore) {
  const cache = new Map<string, Map<string, string>>()

  function read(treeSha: string, prefix = '', out?: Map<string, string>): Map<string, string> {
    if (!prefix) {
      const cached = cache.get(treeSha)
      if (cached) return cached
    }
    const result = out ?? new Map<string, string>()
    let obj: GitObject
    try {
      obj = store.get(treeSha)
    } catch {
      return result
    }
    if (obj.type !== 'tree') return result
    const b = obj.body
    let p = 0
    while (p < b.length) {
      let sp = p
      while (b[sp] !== 0x20) sp++
      const mode = td.decode(b.subarray(p, sp))
      let nul = sp + 1
      while (b[nul] !== 0x00) nul++
      const name = td.decode(b.subarray(sp + 1, nul))
      const sha = hex(b, nul + 1)
      p = nul + 21
      const full = prefix ? `${prefix}/${name}` : name
      if (mode === '40000' || mode === '040000') {
        read(sha, full, result)
      } else if (mode === '160000') {
        // gitlink (submodule) — skip
      } else {
        result.set(full, sha)
      }
    }
    if (!prefix) cache.set(treeSha, result)
    return result
  }

  return read
}

// --- diffing ----------------------------------------------------------------

function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

/** Line-level diff producing counts + a bounded unified hunk. */
function diffText(
  oldText: string,
  newText: string,
): { additions: number; deletions: number; hunk: DiffHunk | null } {
  const a = oldText.length ? oldText.split('\n') : []
  const b = newText.length ? newText.split('\n') : []

  // Trim matching prefix/suffix to shrink the DP problem.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const am = a.slice(start, endA)
  const bm = b.slice(start, endB)

  let script: DiffLine[]
  if ((am.length + 1) * (bm.length + 1) > MAX_DIFF_CELLS) {
    // Too large for LCS — represent as full replace of the changed region.
    script = [
      ...am.map((text) => ({ type: 'del' as const, text })),
      ...bm.map((text) => ({ type: 'add' as const, text })),
    ]
  } else {
    script = lcsDiff(am, bm)
  }

  const additions = script.filter((l) => l.type === 'add').length
  const deletions = script.filter((l) => l.type === 'del').length
  if (additions === 0 && deletions === 0) return { additions: 0, deletions: 0, hunk: null }

  const lines: DiffLine[] = []
  if (start > 0) lines.push({ type: 'context', text: a[start - 1] })
  lines.push(...script)
  if (endA < a.length) lines.push({ type: 'context', text: a[endA] })

  const shown = lines.slice(0, MAX_DIFF_LINES)
  if (lines.length > MAX_DIFF_LINES) {
    shown.push({ type: 'context', text: `… ${lines.length - MAX_DIFF_LINES} more lines` })
  }
  const hunk: DiffHunk = {
    header: `@@ -${start + 1},${endA - start} +${start + 1},${endB - start} @@`,
    lines: shown,
  }
  return { additions, deletions, hunk }
}

/** Classic LCS backtrace → ordered edit script (del before add at each change). */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const dp = new Int32Array((n + 1) * (m + 1))
  const w = m + 1
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      out.push({ type: 'del', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

// --- model assembly ----------------------------------------------------------

/**
 * Build a RepoModel from raw `.git` bytes. Returns null when no commit history
 * can be recovered (caller should fall back to the snapshot loader).
 */
export function buildModelFromGit(name: string, git: GitFileMap): RepoModel | null {
  if (git.size === 0) return null
  let store: ObjectStore
  let refs: Refs
  try {
    store = createObjectStore(git)
    refs = parseRefs(git, store)
  } catch {
    return null
  }
  if (refs.heads.size === 0) return null

  const readTree = createTreeReader(store)

  // 1. Walk the commit graph reachable from all branch heads.
  const parsed = new Map<string, ParsedCommit>()
  const queue = [...refs.heads.values()]
  while (queue.length && parsed.size < MAX_REACHABLE) {
    const sha = queue.pop()!
    if (parsed.has(sha)) continue
    let obj: GitObject
    try {
      obj = store.get(sha)
    } catch {
      continue
    }
    if (obj.type !== 'commit') continue
    const c = parseCommit(sha, obj.body)
    parsed.set(sha, c)
    for (const p of c.parents) if (!parsed.has(p)) queue.push(p)
  }
  if (parsed.size === 0) return null

  // 2. Keep the most recent MAX_COMMITS; restrict parent links to that set.
  const ordered = [...parsed.values()].sort((x, y) => y.timeMs - x.timeMs)
  const kept = ordered.slice(0, MAX_COMMITS)
  const keptSet = new Set(kept.map((c) => c.sha))

  // 3. Ancestry within the kept graph, for branch assignment.
  const parentsOf = new Map<string, string[]>()
  for (const c of kept) parentsOf.set(c.sha, c.parents.filter((p) => keptSet.has(p)))

  const ancestorsCache = new Map<string, Set<string>>()
  const ancestorsOf = (sha: string): Set<string> => {
    const memo = ancestorsCache.get(sha)
    if (memo) return memo
    const seen = new Set<string>()
    const stack = [sha]
    while (stack.length) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const p of parentsOf.get(cur) ?? []) stack.push(p)
    }
    ancestorsCache.set(sha, seen)
    return seen
  }

  // 4. Keep the checked-out branch as the data snapshot, but draw history from
  // a stable base lane when the repository has one.  HEAD is often a topic
  // branch, and using it as the first lane would otherwise make it claim every
  // shared ancestor of (for example) `main`.
  const headNames = [...refs.heads.keys()]
  const defaultBranch =
    (refs.headBranch && refs.heads.has(refs.headBranch) && refs.headBranch) ||
    (refs.heads.has('main') && 'main') ||
    (refs.heads.has('master') && 'master') ||
    headNames[0]
  const baseBranch =
    (refs.heads.has('main') && 'main') ||
    (refs.heads.has('master') && 'master') ||
    defaultBranch
  const branchOrder = [
    baseBranch,
    ...headNames.filter((n) => n !== baseBranch).sort((a, b) => a.localeCompare(b)),
  ]

  // A commit can be reachable from more than one ref, so it does not have a
  // literal single "branch".  For the one lane the UI needs, put shared
  // history on the base lane and commits unique to a ref on that ref's lane.
  // This makes a linear topic branch visibly leave `main` at its ref tip,
  // instead of colouring the entire history as the currently checked-out ref.
  const reachedBy = new Map<string, string[]>()
  for (const bname of branchOrder) {
    const head = refs.heads.get(bname)!
    if (!keptSet.has(head)) continue
    for (const sha of ancestorsOf(head)) {
      const branches = reachedBy.get(sha) ?? []
      branches.push(bname)
      reachedBy.set(sha, branches)
    }
  }
  const branchOf = new Map<string, string>()
  for (const sha of keptSet) {
    const branches = reachedBy.get(sha) ?? []
    branchOf.set(sha, branches.length === 1 ? branches[0] : baseBranch)
  }

  // 5. Build per-commit file changes (diff against first kept parent).
  const blobText = new Map<string, string | null>() // sha -> text, null = binary/oversized
  const getBlobText = (sha: string): string | null => {
    if (blobText.has(sha)) return blobText.get(sha)!
    let text: string | null = null
    try {
      const obj = store.get(sha)
      if (obj.type === 'blob' && obj.body.length <= MAX_BLOB_BYTES && !isBinary(obj.body)) {
        text = td.decode(obj.body)
      }
    } catch {
      text = null
    }
    blobText.set(sha, text)
    return text
  }

  const commits: Commit[] = []
  const everyFile = new Set<string>()

  for (const pc of kept) {
    const tree = readTree(pc.tree)
    const parentSha = pc.parents.find((p) => keptSet.has(p))
    const parentTree = parentSha ? readTree(parsed.get(parentSha)!.tree) : new Map<string, string>()

    for (const path of tree.keys()) if (isSource(path) && !isIgnored(path)) everyFile.add(path)

    const changes: FileChange[] = []
    const paths = new Set<string>([...tree.keys(), ...parentTree.keys()])
    for (const path of paths) {
      const newSha = tree.get(path)
      const oldSha = parentTree.get(path)
      if (newSha === oldSha) continue
      let status: FileStatus
      let additions = 0
      let deletions = 0
      let hunks: DiffHunk[] = []
      if (!oldSha) {
        status = 'added'
        const t = getBlobText(newSha!)
        const d = diffText('', t ?? '')
        additions = d.additions
        if (d.hunk) hunks = [d.hunk]
      } else if (!newSha) {
        status = 'deleted'
        const t = getBlobText(oldSha)
        const d = diffText(t ?? '', '')
        deletions = d.deletions
        if (d.hunk) hunks = [d.hunk]
      } else {
        status = 'modified'
        const oldT = getBlobText(oldSha)
        const newT = getBlobText(newSha)
        if (oldT != null && newT != null) {
          const d = diffText(oldT, newT)
          additions = d.additions
          deletions = d.deletions
          if (d.hunk) hunks = [d.hunk]
        }
      }
      changes.push({ path, status, additions, deletions, hunks })
    }
    changes.sort((x, y) => x.path.localeCompare(y.path))

    commits.push({
      sha: pc.sha,
      message: pc.message,
      author: pc.author,
      timestamp: new Date(pc.timeMs).toISOString(),
      branch: branchOf.get(pc.sha) ?? defaultBranch,
      parents: pc.parents.filter((p) => keptSet.has(p)),
      changes,
    })
  }

  // 6. Files / modules / dependencies (at the default branch head).
  const files = [...everyFile].sort((a, b) => a.localeCompare(b)).slice(0, MAX_FILES)
  const fileSet = new Set(files)
  const modules = buildModules(files)

  const headTree = readTree(parsed.get(refs.heads.get(defaultBranch)!)!.tree)
  const headSources: RawFile[] = []
  for (const [path, sha] of headTree) {
    if (!fileSet.has(path)) continue
    const t = getBlobText(sha)
    if (t != null) headSources.push({ path, content: t })
  }
  const dependencies = buildDependencies(headSources)

  // 7. Branches with divergence points (merge-base with default).
  const defaultHead = refs.heads.get(defaultBranch)!
  const defaultAncestors = ancestorsOf(defaultHead)
  const branches: Branch[] = branchOrder
    .filter((bname) => keptSet.has(refs.heads.get(bname)!))
    .map((bname) => {
      const head = refs.heads.get(bname)!
      let branchedFrom: string | null = null
      if (bname !== defaultBranch) {
        // newest commit reachable from both this branch and the default branch
        let best: string | null = null
        let bestTime = -Infinity
        for (const sha of ancestorsOf(head)) {
          if (defaultAncestors.has(sha)) {
            const t = parsed.get(sha)?.timeMs ?? -Infinity
            if (t > bestTime) {
              bestTime = t
              best = sha
            }
          }
        }
        branchedFrom = best
      }
      return { id: bname, head, branchedFrom, color: branchColorVar(bname) }
    })

  return {
    name,
    defaultBranch,
    modules,
    files,
    dependencies,
    commits,
    branches,
  }
}

// --- input adapters ----------------------------------------------------------

/** Key a full archive/tree path by its location relative to the `.git/` dir. */
function gitRelKey(path: string): string | null {
  const norm = path.replace(/\\/g, '/')
  const segs = norm.split('/')
  const i = segs.indexOf('.git')
  if (i < 0) return null
  const rel = segs.slice(i + 1).join('/')
  return rel || null
}

/** Extract `.git` bytes from a .zip archive. */
export async function gitFilesFromZip(file: File): Promise<GitFileMap> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(file)
  const out: GitFileMap = new Map()
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const key = gitRelKey(entry.name)
    if (!key) continue
    try {
      out.set(key, await entry.async('uint8array'))
    } catch {
      // skip unreadable entry
    }
  }
  return out
}

/** Extract `.git` bytes from a <input webkitdirectory> FileList. */
export async function gitFilesFromDirectoryInput(list: FileList): Promise<GitFileMap> {
  const out: GitFileMap = new Map()
  for (const f of Array.from(list)) {
    const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const key = gitRelKey(p)
    if (!key) continue
    try {
      out.set(key, new Uint8Array(await f.arrayBuffer()))
    } catch {
      // skip unreadable entry
    }
  }
  return out
}
