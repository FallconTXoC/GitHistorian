// ---------------------------------------------------------------------------
// Project loader.
//
// Turns a set of raw source files (from a directory picker or a .zip archive)
// into the same normalized RepoModel the demo fixture produces, so the entire
// map / detail / diff experience works against a real project.
//
// Since a raw snapshot has no Git history, we synthesize a single "import"
// commit that adds every file. Dependencies are derived by parsing imports for
// JavaScript/TypeScript AND Python.
// ---------------------------------------------------------------------------

import type {
  Commit,
  Dependency,
  DiffHunk,
  FileChange,
  ModuleDef,
  RepoModel,
} from './types'

export interface RawFile {
  path: string
  content: string
}

// Keep the map meaningful: only source files, and cap the total.
const SOURCE_EXT = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'pyi',
  'sql',
  'json',
  'css',
  'scss',
  'go',
  'rb',
  'java',
  'rs',
  'vue',
  'svelte',
])

const IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'vendor',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  'site-packages',
  'target',
  '.mypy_cache',
  '.pytest_cache',
])

const MAX_FILES = 600
export const MAX_DIFF_LINES = 200
const CONTAINER_DIRS = new Set([
  'src',
  'app',
  'lib',
  'source',
  'packages',
  'apps',
])

export function extOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

export function isIgnored(path: string): boolean {
  return path.split('/').some((seg) => IGNORE_SEGMENTS.has(seg))
}

export function isSource(path: string): boolean {
  return SOURCE_EXT.has(extOf(path))
}

/** Strip a single shared leading folder (zips/pickers usually wrap the root). */
export function stripCommonRoot(paths: string[]): (p: string) => string {
  if (paths.length === 0) return (p) => p
  const firstSegs = paths.map((p) => p.split('/')[0])
  const shared = firstSegs[0]
  const allShare =
    shared && firstSegs.every((s) => s === shared) && paths.every((p) => p.includes('/'))
  if (!allShare) return (p) => p
  const cut = shared.length + 1
  return (p) => p.slice(cut)
}

// --- module grouping -------------------------------------------------------

interface ModuleKey {
  id: string
  label: string
  prefix: string
}

function moduleKeyForPath(path: string): ModuleKey {
  const segs = path.split('/')
  if (segs.length === 1) return { id: 'root', label: '(root)', prefix: '' }
  let depth = 1
  if (CONTAINER_DIRS.has(segs[0]) && segs.length > 2) depth = 2
  const dirSegs = segs.slice(0, depth)
  const prefix = dirSegs.join('/') + '/'
  return { id: dirSegs.join('/'), label: dirSegs[dirSegs.length - 1], prefix }
}

export function buildModules(paths: string[]): ModuleDef[] {
  const keys = new Map<string, ModuleKey>()
  for (const p of paths) {
    const k = moduleKeyForPath(p)
    if (!keys.has(k.id)) keys.set(k.id, k)
  }
  const list = [...keys.values()].sort((a, b) => a.id.localeCompare(b.id))
  // Lay modules out in a stable grid.
  const perRow = Math.max(1, Math.ceil(Math.sqrt(list.length)))
  return list.map((k, i) => ({
    id: k.id,
    label: k.label,
    prefix: k.prefix,
    layer: Math.floor(i / perRow),
    column: i % perRow,
  }))
}

// --- dependency parsing ----------------------------------------------------

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const JS_INDEX = JS_EXTS.map((e) => '/index' + e)

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Resolve a "./x" or "../x" style path relative to `fromPath`. */
function resolveRelative(fromPath: string, spec: string): string {
  const stack = dirname(fromPath).split('/').filter(Boolean)
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function firstExisting(bases: string[], fileSet: Set<string>): string | null {
  for (const base of bases) {
    if (fileSet.has(base)) return base
    for (const e of JS_EXTS) if (fileSet.has(base + e)) return base + e
    for (const idx of JS_INDEX) if (fileSet.has(base + idx)) return base + idx
  }
  return null
}

function parseJsDeps(
  fromPath: string,
  content: string,
  fileSet: Set<string>,
): string[] {
  const specs = new Set<string>()
  const patterns = [
    /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(content))) specs.add(m[1])
  }

  const out: string[] = []
  for (const spec of specs) {
    let base: string | null = null
    if (spec.startsWith('.')) {
      base = resolveRelative(fromPath, spec)
    } else if (spec.startsWith('@/')) {
      base = spec.slice(2) // Next.js-style root alias
    } else if (spec.startsWith('~/')) {
      base = spec.slice(2)
    } else {
      continue // bare package → external, skip
    }
    const resolved = firstExisting([base], fileSet)
    if (resolved && resolved !== fromPath) out.push(resolved)
  }
  return out
}

function pyCandidates(modSlash: string): string[] {
  return [modSlash + '.py', modSlash + '/__init__.py', modSlash + '.pyi']
}

function parsePyDeps(
  fromPath: string,
  content: string,
  fileSet: Set<string>,
  pyRoots: string[],
): string[] {
  const out: string[] = []
  const pkgDir = dirname(fromPath)

  const tryResolve = (modSlash: string): boolean => {
    // Try as-is (relative form already absolute), then under each source root.
    const roots = ['', ...pyRoots]
    for (const root of roots) {
      const full = root ? root + '/' + modSlash : modSlash
      for (const c of pyCandidates(full)) {
        if (fileSet.has(c) && c !== fromPath) {
          out.push(c)
          return true
        }
      }
    }
    return false
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // from <mod> import <names>
    const from = /^from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(line)
    if (from) {
      const dots = from[1].length
      const modDotted = from[2]
      const names = from[3]
      let baseSlash: string
      if (dots > 0) {
        // relative: one dot = current package dir, each extra = up one level
        const up = pkgDir.split('/').filter(Boolean)
        for (let i = 1; i < dots; i++) up.pop()
        baseSlash = [...up, ...(modDotted ? modDotted.split('.') : [])].join('/')
      } else {
        baseSlash = modDotted.split('.').join('/')
      }
      if (baseSlash) tryResolve(baseSlash)
      // Imported names may themselves be submodules (from pkg import sub).
      for (const n of names.split(',')) {
        const name = n.trim().split(/\s+as\s+/)[0].replace(/[()]/g, '').trim()
        if (name && name !== '*') tryResolve(baseSlash ? baseSlash + '/' + name : name)
      }
      continue
    }

    // import <mod>[, <mod2>]
    const imp = /^import\s+(.+)$/.exec(line)
    if (imp) {
      for (const part of imp[1].split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim()
        if (mod) tryResolve(mod.split('.').join('/'))
      }
    }
  }
  return out
}

export function buildDependencies(files: RawFile[]): Dependency[] {
  const fileSet = new Set(files.map((f) => f.path))
  const pyRoots = [
    ...new Set(
      files
        .filter((f) => f.path.endsWith('.py'))
        .map((f) => f.path.split('/')[0])
        .filter((seg) => seg && seg.includes('.') === false),
    ),
  ]
  const seen = new Set<string>()
  const deps: Dependency[] = []
  const add = (source: string, target: string) => {
    if (source === target) return
    const key = source + '\u0000' + target
    if (seen.has(key)) return
    seen.add(key)
    deps.push({ source, target, type: 'import' })
  }

  for (const f of files) {
    const e = extOf(f.path)
    if (e === 'py' || e === 'pyi') {
      for (const t of parsePyDeps(f.path, f.content, fileSet, pyRoots)) add(f.path, t)
    } else if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'].includes(e)) {
      for (const t of parseJsDeps(f.path, f.content, fileSet)) add(f.path, t)
    }
  }
  return deps
}

// --- model assembly --------------------------------------------------------

function shortSha(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7)
}

export function toHunk(content: string): DiffHunk {
  const lines = content.split('\n')
  const shown = lines.slice(0, MAX_DIFF_LINES)
  const suffix =
    lines.length > MAX_DIFF_LINES
      ? [{ type: 'context' as const, text: `… ${lines.length - MAX_DIFF_LINES} more lines` }]
      : []
  return {
    header: `@@ -0,0 +1,${lines.length} @@`,
    lines: [...shown.map((text) => ({ type: 'add' as const, text })), ...suffix],
  }
}

/** Build a RepoModel from raw files. Returns null if no usable source files. */
export function buildModelFromFiles(name: string, raw: RawFile[]): RepoModel | null {
  // Filter to source files, drop ignored dirs, cap the count.
  const files = raw
    .filter((f) => f.path && !isIgnored(f.path) && isSource(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_FILES)

  if (files.length === 0) return null

  const paths = files.map((f) => f.path)
  const modules = buildModules(paths)
  const dependencies = buildDependencies(files)

  const sha = shortSha(name + ':' + paths.join(','))
  const changes: FileChange[] = files.map((f) => {
    const additions = f.content.length ? f.content.split('\n').length : 0
    return {
      path: f.path,
      status: 'added',
      additions,
      deletions: 0,
      hunks: additions ? [toHunk(f.content)] : [],
    }
  })

  const commit: Commit = {
    sha,
    message: `Imported ${name}`,
    author: 'local snapshot',
    timestamp: new Date().toISOString(),
    branch: 'main',
    parents: [],
    changes,
  }

  return {
    name,
    defaultBranch: 'main',
    modules,
    files: paths,
    dependencies,
    commits: [commit],
    branches: [
      { id: 'main', head: sha, branchedFrom: null, color: 'var(--branch-main)' },
    ],
  }
}

// --- input adapters --------------------------------------------------------

/** Read a <input type="file" webkitdirectory> FileList into raw files. */
export async function filesFromDirectoryInput(
  fileList: FileList,
): Promise<RawFile[]> {
  const entries = Array.from(fileList)
  const rel = stripCommonRoot(
    entries.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
  )
  const picked = entries.filter((f) => {
    const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    return !isIgnored(p) && isSource(p)
  })
  const out: RawFile[] = []
  for (const f of picked) {
    const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    try {
      out.push({ path: rel(p), content: await f.text() })
    } catch {
      // skip unreadable/binary files
    }
  }
  return out
}

/** Read a .zip File into raw files. */
export async function filesFromZip(file: File): Promise<RawFile[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(file)
  const all = Object.values(zip.files).filter((e) => !e.dir)
  const rel = stripCommonRoot(all.map((e) => e.name))
  const out: RawFile[] = []
  for (const entry of all) {
    if (isIgnored(entry.name) || !isSource(entry.name)) continue
    try {
      out.push({ path: rel(entry.name), content: await entry.async('string') })
    } catch {
      // skip unreadable entries
    }
  }
  return out
}

export function projectNameFromFile(file: File): string {
  return file.name.replace(/\.zip$/i, '') || 'project'
}
