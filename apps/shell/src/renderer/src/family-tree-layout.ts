/**
 * Pure layout for the Family Tree canvas (generation bands + parent edges).
 */
import type { WbFamilyTreeNode } from './workbench-pins'

export const FT_CARD_W = 148
export const FT_CARD_H = 78
export const FT_H_GAP = 28
export const FT_V_GAP = 96
export const FT_PAD_X = 40
export const FT_PAD_Y = 36

export interface FtLaidOutNode {
  node: WbFamilyTreeNode
  x: number
  y: number
  w: number
  h: number
}

export interface FtEdge {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  midY: number
}

export interface FtSpouseBar {
  id: string
  x1: number
  x2: number
  y: number
}

export interface FtLayout {
  nodes: FtLaidOutNode[]
  edges: FtEdge[]
  spouseBars: FtSpouseBar[]
  width: number
  height: number
  generations: number[]
}

const SIDE_ORDER: Record<WbFamilyTreeNode['side'], number> = {
  paternal: 0,
  maternal: 1,
  self: 2,
  spouse: 3,
  other: 4,
}

function uniqueSortedGens(nodes: WbFamilyTreeNode[]): number[] {
  return [...new Set(nodes.map((n) => n.generation))].sort((a, b) => b - a)
}

/** Pair spouses once (lower id first). */
function spousePairs(nodes: WbFamilyTreeNode[]): [string, string][] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const pairs: [string, string][] = []
  for (const n of nodes) {
    const s = n.spouseId
    if (!s || !byId.has(s) || seen.has(n.id)) continue
    const a = n.id < s ? n.id : s
    const b = n.id < s ? s : n.id
    if (seen.has(a)) continue
    seen.add(a)
    seen.add(b)
    pairs.push([a, b])
  }
  return pairs
}

function groupUnits(nodes: WbFamilyTreeNode[]): string[][] {
  const pairs = spousePairs(nodes)
  const inPair = new Set(pairs.flat())
  const units: string[][] = pairs.map(([a, b]) => [a, b])
  for (const n of nodes) {
    if (!inPair.has(n.id)) units.push([n.id])
  }
  return units
}

function unitSortKey(
  unit: string[],
  byId: Map<string, WbFamilyTreeNode>,
  parentX: Map<string, number>,
): number {
  const nodes = unit.map((id) => byId.get(id)!).filter(Boolean)
  let parentAvg = 0
  let parentCount = 0
  for (const n of nodes) {
    for (const pid of n.parentIds ?? []) {
      const px = parentX.get(pid)
      if (px != null) {
        parentAvg += px
        parentCount++
      }
    }
  }
  if (parentCount > 0) return parentAvg / parentCount
  const side = Math.min(...nodes.map((n) => SIDE_ORDER[n.side] ?? 9))
  const name = nodes.map((n) => n.name).join('|')
  return side * 1e6 + name.charCodeAt(0)
}

export function layoutFamilyTree(nodes: WbFamilyTreeNode[]): FtLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], spouseBars: [], width: 480, height: 280, generations: [] }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const gens = uniqueSortedGens(nodes)
  const genIndex = new Map(gens.map((g, i) => [g, i]))
  const laid = new Map<string, FtLaidOutNode>()
  const parentCenterX = new Map<string, number>()

  let maxRight = 0

  for (const g of gens) {
    const inGen = nodes.filter((n) => n.generation === g)
    const units = groupUnits(inGen).sort(
      (a, b) => unitSortKey(a, byId, parentCenterX) - unitSortKey(b, byId, parentCenterX),
    )
    const rowY = FT_PAD_Y + (genIndex.get(g) ?? 0) * (FT_CARD_H + FT_V_GAP)

    let cursorX = FT_PAD_X
    for (const unit of units) {
      const unitW =
        unit.length * FT_CARD_W + (unit.length - 1) * Math.round(FT_H_GAP * 0.45)
      for (let i = 0; i < unit.length; i++) {
        const id = unit[i]!
        const node = byId.get(id)!
        const x = cursorX + i * (FT_CARD_W + Math.round(FT_H_GAP * 0.45))
        const item: FtLaidOutNode = { node, x, y: rowY, w: FT_CARD_W, h: FT_CARD_H }
        laid.set(id, item)
        parentCenterX.set(id, x + FT_CARD_W / 2)
      }
      cursorX += unitW + FT_H_GAP
    }
    maxRight = Math.max(maxRight, cursorX - FT_H_GAP + FT_PAD_X)
  }

  // Second pass: nudge units toward parent midpoints when space allows (simple pull).
  for (const g of gens) {
    const inGen = nodes.filter((n) => n.generation === g)
    for (const n of inGen) {
      const parents = (n.parentIds ?? []).map((id) => laid.get(id)).filter(Boolean) as FtLaidOutNode[]
      if (parents.length === 0) continue
      const target =
        parents.reduce((s, p) => s + p.x + p.w / 2, 0) / parents.length - FT_CARD_W / 2
      const cur = laid.get(n.id)
      if (!cur) continue
      const spouse = n.spouseId ? laid.get(n.spouseId) : undefined
      // Only gentle nudge if not colliding hard — keep relative order.
      const delta = (target - cur.x) * 0.35
      if (Math.abs(delta) < 8) continue
      cur.x += delta
      parentCenterX.set(n.id, cur.x + FT_CARD_W / 2)
      if (spouse && n.spouseId) {
        const pairLeft = Math.min(cur.x, spouse.x)
        const pairRight = Math.max(cur.x + FT_CARD_W, spouse.x + FT_CARD_W)
        // keep spouse glued
        if (cur.x <= spouse.x) {
          spouse.x = cur.x + FT_CARD_W + Math.round(FT_H_GAP * 0.45)
        } else {
          spouse.x = cur.x - FT_CARD_W - Math.round(FT_H_GAP * 0.45)
        }
        parentCenterX.set(n.spouseId, spouse.x + FT_CARD_W / 2)
        maxRight = Math.max(maxRight, pairRight + FT_PAD_X + Math.abs(delta))
      }
    }
  }

  // Normalize: shift so min x >= PAD
  let minX = Infinity
  for (const n of laid.values()) minX = Math.min(minX, n.x)
  const shift = minX < FT_PAD_X ? FT_PAD_X - minX : 0
  if (shift !== 0) {
    for (const n of laid.values()) {
      n.x += shift
      parentCenterX.set(n.node.id, n.x + FT_CARD_W / 2)
    }
  }

  maxRight = 0
  let maxBottom = 0
  for (const n of laid.values()) {
    maxRight = Math.max(maxRight, n.x + n.w)
    maxBottom = Math.max(maxBottom, n.y + n.h)
  }

  const edges: FtEdge[] = []
  for (const n of nodes) {
    const child = laid.get(n.id)
    if (!child) continue
    for (const pid of n.parentIds ?? []) {
      const parent = laid.get(pid)
      if (!parent) continue
      const x1 = parent.x + parent.w / 2
      const y1 = parent.y + parent.h
      const x2 = child.x + child.w / 2
      const y2 = child.y
      const midY = y1 + (y2 - y1) / 2
      edges.push({ id: `${pid}->${n.id}`, x1, y1, x2, y2, midY })
    }
  }

  const spouseBars: FtSpouseBar[] = []
  for (const [a, b] of spousePairs(nodes)) {
    const A = laid.get(a)
    const B = laid.get(b)
    if (!A || !B) continue
    const left = A.x < B.x ? A : B
    const right = A.x < B.x ? B : A
    spouseBars.push({
      id: `spouse:${a}:${b}`,
      x1: left.x + left.w,
      x2: right.x,
      y: left.y + left.h / 2,
    })
  }

  return {
    nodes: [...laid.values()],
    edges,
    spouseBars,
    width: Math.max(480, maxRight + FT_PAD_X),
    height: Math.max(280, maxBottom + FT_PAD_Y),
    generations: gens,
  }
}

export function sampleFamilyTree(vi: boolean): WbFamilyTreeNode[] {
  const id = (k: string) => `sample-${k}`
  const ongNoi = id('ong-noi')
  const baNoi = id('ba-noi')
  const ongNgoai = id('ong-ngoai')
  const baNgoai = id('ba-ngoai')
  const bo = id('bo')
  const me = id('me')
  const toi = id('toi')
  const voChong = id('vo-chong')
  const con = id('con')

  if (vi) {
    return [
      {
        id: ongNoi,
        name: 'Ông Nội',
        generation: 2,
        side: 'paternal',
        gender: 'm',
        birthYear: '1948',
        spouseId: baNoi,
      },
      {
        id: baNoi,
        name: 'Bà Nội',
        generation: 2,
        side: 'paternal',
        gender: 'f',
        birthYear: '1952',
        spouseId: ongNoi,
      },
      {
        id: ongNgoai,
        name: 'Ông Ngoại',
        generation: 2,
        side: 'maternal',
        gender: 'm',
        birthYear: '1950',
        spouseId: baNgoai,
      },
      {
        id: baNgoai,
        name: 'Bà Ngoại',
        generation: 2,
        side: 'maternal',
        gender: 'f',
        birthYear: '1954',
        spouseId: ongNgoai,
      },
      {
        id: bo,
        name: 'Bố',
        generation: 1,
        side: 'paternal',
        gender: 'm',
        birthYear: '1975',
        parentIds: [ongNoi, baNoi],
        spouseId: me,
      },
      {
        id: me,
        name: 'Mẹ',
        generation: 1,
        side: 'maternal',
        gender: 'f',
        birthYear: '1978',
        parentIds: [ongNgoai, baNgoai],
        spouseId: bo,
      },
      {
        id: toi,
        name: 'Tôi',
        generation: 0,
        side: 'self',
        gender: 'x',
        birthYear: '2000',
        parentIds: [bo, me],
        spouseId: voChong,
      },
      {
        id: voChong,
        name: 'Vợ/Chồng',
        generation: 0,
        side: 'spouse',
        gender: 'x',
        birthYear: '2001',
        spouseId: toi,
      },
      {
        id: con,
        name: 'Con',
        generation: -1,
        side: 'self',
        gender: 'x',
        birthYear: '2024',
        parentIds: [toi, voChong],
      },
    ]
  }

  return [
    {
      id: ongNoi,
      name: 'Grandpa (P)',
      generation: 2,
      side: 'paternal',
      gender: 'm',
      birthYear: '1948',
      spouseId: baNoi,
    },
    {
      id: baNoi,
      name: 'Grandma (P)',
      generation: 2,
      side: 'paternal',
      gender: 'f',
      birthYear: '1952',
      spouseId: ongNoi,
    },
    {
      id: ongNgoai,
      name: 'Grandpa (M)',
      generation: 2,
      side: 'maternal',
      gender: 'm',
      birthYear: '1950',
      spouseId: baNgoai,
    },
    {
      id: baNgoai,
      name: 'Grandma (M)',
      generation: 2,
      side: 'maternal',
      gender: 'f',
      birthYear: '1954',
      spouseId: ongNgoai,
    },
    {
      id: bo,
      name: 'Father',
      generation: 1,
      side: 'paternal',
      gender: 'm',
      birthYear: '1975',
      parentIds: [ongNoi, baNoi],
      spouseId: me,
    },
    {
      id: me,
      name: 'Mother',
      generation: 1,
      side: 'maternal',
      gender: 'f',
      birthYear: '1978',
      parentIds: [ongNgoai, baNgoai],
      spouseId: bo,
    },
    {
      id: toi,
      name: 'Me',
      generation: 0,
      side: 'self',
      gender: 'x',
      birthYear: '2000',
      parentIds: [bo, me],
      spouseId: voChong,
    },
    {
      id: voChong,
      name: 'Spouse',
      generation: 0,
      side: 'spouse',
      gender: 'x',
      birthYear: '2001',
      spouseId: toi,
    },
    {
      id: con,
      name: 'Child',
      generation: -1,
      side: 'self',
      gender: 'x',
      birthYear: '2024',
      parentIds: [toi, voChong],
    },
  ]
}
