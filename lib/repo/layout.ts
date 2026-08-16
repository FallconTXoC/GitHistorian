import { fileName, moduleForPath } from './analysis'
import type { RepoModel } from './types'

// Fixed cell geometry keeps every file anchored to a canonical slot, so the map
// stays spatially stable as the user moves through branches and history.
export const CHILD_W = 172
export const CHILD_H = 68
const GAP_X = 18
const GAP_Y = 14
const PAD = 16
export const HEADER_H = 46
const LAYER_GAP = 120
const MODULE_GAP_X = 120
const ORIGIN_X = 80
const ORIGIN_Y = 60

export interface ModuleBox {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  layer: number
}

export interface FileSlot {
  path: string
  parentId: string
  x: number
  y: number
}

interface LayoutResult {
  modules: ModuleBox[]
  files: Map<string, FileSlot>
}

function colsFor(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : 2
}

// Cache layout per model so switching projects recomputes, but repeated
// renders of the same model stay cheap and spatially stable.
const cache = new WeakMap<RepoModel, LayoutResult>()

/** Canonical layout for the entire codebase (all files that ever existed). */
export function computeLayout(repo: RepoModel): LayoutResult {
  const cached = cache.get(repo)
  if (cached) return cached

  const filesByModule = new Map<string, string[]>()
  for (const path of repo.files) {
    const mod = moduleForPath(path, repo.modules)
    const list = filesByModule.get(mod) ?? []
    list.push(path)
    filesByModule.set(mod, list)
  }
  for (const list of filesByModule.values()) {
    list.sort((a, b) => fileName(a).localeCompare(fileName(b)))
  }

  // size each module box to fit its files
  const boxes = new Map<string, ModuleBox>()
  for (const mod of repo.modules) {
    const files = filesByModule.get(mod.id) ?? []
    const cols = colsFor(files.length)
    const rows = Math.max(1, Math.ceil(files.length / cols))
    const w = PAD * 2 + cols * CHILD_W + (cols - 1) * GAP_X
    const h = HEADER_H + PAD + rows * CHILD_H + (rows - 1) * GAP_Y + PAD
    boxes.set(mod.id, { id: mod.id, label: mod.label, x: 0, y: 0, w, h, layer: mod.layer })
  }

  // stack layers top → bottom; place modules left → right within a layer
  const layers = Array.from(new Set(repo.modules.map((m) => m.layer))).sort(
    (a, b) => a - b,
  )
  let y = ORIGIN_Y
  for (const layer of layers) {
    const mods = repo.modules
      .filter((m) => m.layer === layer)
      .sort((a, b) => a.column - b.column)
    let x = ORIGIN_X
    let maxH = 0
    for (const m of mods) {
      const box = boxes.get(m.id)!
      box.x = x
      box.y = y
      x += box.w + MODULE_GAP_X
      maxH = Math.max(maxH, box.h)
    }
    y += maxH + LAYER_GAP
  }

  // place files within their module box
  const files = new Map<string, FileSlot>()
  for (const mod of repo.modules) {
    const list = filesByModule.get(mod.id) ?? []
    const cols = colsFor(list.length)
    list.forEach((path, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      files.set(path, {
        path,
        parentId: mod.id,
        x: PAD + col * (CHILD_W + GAP_X),
        y: HEADER_H + PAD + row * (CHILD_H + GAP_Y),
      })
    })
  }

  const result: LayoutResult = { modules: Array.from(boxes.values()), files }
  cache.set(repo, result)
  return result
}
