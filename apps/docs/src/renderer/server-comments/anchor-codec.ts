/**
 * G8-12 (UNI-1407): the docx anchor of a server comment (contract-collab §4.1, lane contract §3.4).
 * Pure: a ProseMirror range in the open document <-> the closed server schema
 * `{format:'docx', v:1, para_id?, path, start, end, quote, prefix, suffix}`.
 *
 * - `path` = child indexes from the doc root down to the textblock; `start` / `end` = offsets inside
 *   that textblock, in ProseMirror units (one per UTF-16 code unit, one per inline leaf).
 * - An anchor lives inside one textblock: a range that crosses paragraphs is clipped to the first.
 * - `quote` / `prefix` / `suffix` are capped at 500 code points each and the canonical JSON of the
 *   whole anchor at 4 KiB (the server rejects anything larger); context is trimmed first, then the quote.
 *
 * Locating runs in order: `para_id` (w14:paraId of the source paragraph, when the editor knows it), then
 * `path` + a quote check, then a search for the quote over every textblock, ranked by how much of the
 * stored prefix / suffix still surrounds each match. Nothing found = the anchor is lost.
 */
import type { Node as PmNode } from '@tiptap/pm/model'
import type { CollabAnchor } from './seam'

export const QUOTE_MAX = 500
export const ANCHOR_MAX_BYTES = 4096
/** context kept on each side of the quote before the 4 KiB trim */
const CONTEXT_DEFAULT = 64
/** inline leaves (images, breaks) read as one space so offsets stay aligned with positions */
const LEAF = ' '

export interface DocxAnchor extends CollabAnchor {
  format: 'docx'
  v: 1
  para_id?: string
  path: number[]
  start: number
  end: number
  quote: string
  prefix: string
  suffix: string
}

export interface PmRange {
  from: number
  to: number
}

export interface DocxCodecOptions {
  /** the w14:paraId of the source paragraph a textblock came from, when the editor knows it */
  paraIdOf?(node: PmNode): string | undefined
}

/** JSON with object keys sorted by UTF-8 byte order and no whitespace (the server's canonical form) */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const enc = new TextEncoder()
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort((a, b) => {
      const x = enc.encode(a)
      const y = enc.encode(b)
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!
      return x.length - y.length
    })
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

function byteSize(anchor: DocxAnchor): number {
  return new TextEncoder().encode(canonicalJson(anchor)).length
}

/** the first `n` code points */
function headCp(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

/** the last `n` code points */
function tailCp(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(cps.length - n).join('')
}

function blockText(node: PmNode): string {
  return node.textBetween(0, node.content.size, undefined, LEAF)
}

function defaultParaIdOf(node: PmNode): string | undefined {
  const v = (node.attrs as Record<string, unknown>).paraId
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** the anchor of `range` in `doc`, or null when the range is empty or not inside a textblock */
export function encodeDocxAnchor(
  doc: PmNode,
  range: PmRange,
  opts: DocxCodecOptions = {},
): DocxAnchor | null {
  if (range.from >= range.to || range.from < 0 || range.to > doc.content.size) return null
  const $from = doc.resolve(range.from)
  let depth = $from.depth
  while (depth > 0 && !$from.node(depth).isTextblock) depth--
  const block = $from.node(depth)
  if (!block.isTextblock) return null
  const path: number[] = []
  for (let d = 0; d < depth; d++) path.push($from.index(d))
  const contentStart = $from.start(depth)
  const text = blockText(block)
  const start = range.from - contentStart
  const end = Math.min(range.to - contentStart, text.length)
  if (start >= end) return null
  const selected = text.slice(start, end)
  const anchor: DocxAnchor = {
    format: 'docx',
    v: 1,
    path,
    start,
    end,
    quote: headCp(selected, QUOTE_MAX),
    prefix: tailCp(text.slice(0, start), CONTEXT_DEFAULT),
    suffix: headCp(text.slice(end), CONTEXT_DEFAULT),
  }
  const paraId = (opts.paraIdOf ?? defaultParaIdOf)(block)
  if (paraId) anchor.para_id = paraId
  // trim to the 4 KiB cap: context first (halving), then the quote
  while (byteSize(anchor) > ANCHOR_MAX_BYTES && (anchor.prefix || anchor.suffix)) {
    const p = [...anchor.prefix].length
    const s = [...anchor.suffix].length
    anchor.prefix = tailCp(anchor.prefix, Math.floor(p / 2))
    anchor.suffix = headCp(anchor.suffix, Math.floor(s / 2))
  }
  while (byteSize(anchor) > ANCHOR_MAX_BYTES && anchor.quote) {
    anchor.quote = headCp(anchor.quote, Math.floor([...anchor.quote].length * 0.75))
  }
  return anchor
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** a well-formed docx anchor, or null */
export function asDocxAnchor(anchor: CollabAnchor | null | undefined): DocxAnchor | null {
  if (!anchor || anchor.format !== 'docx') return null
  const a = anchor as Partial<DocxAnchor>
  if (!Array.isArray(a.path) || !a.path.every(isInt)) return null
  if (!isInt(a.start) || !isInt(a.end) || a.start > a.end) return null
  if (typeof a.quote !== 'string') return null
  return {
    format: 'docx',
    v: 1,
    path: a.path,
    start: a.start,
    end: a.end,
    quote: a.quote,
    prefix: typeof a.prefix === 'string' ? a.prefix : '',
    suffix: typeof a.suffix === 'string' ? a.suffix : '',
    ...(typeof a.para_id === 'string' && a.para_id ? { para_id: a.para_id } : {}),
  }
}

interface Block {
  node: PmNode
  /** position of the first content token */
  contentStart: number
  path: number[]
}

function blockAtPath(doc: PmNode, path: number[]): Block | null {
  let node = doc
  let contentStart = 0
  for (const idx of path) {
    if (idx >= node.childCount) return null
    let pos = contentStart
    for (let k = 0; k < idx; k++) pos += node.child(k).nodeSize
    node = node.child(idx)
    contentStart = pos + 1
  }
  return node.isTextblock ? { node, contentStart, path } : null
}

function textblocks(doc: PmNode): Block[] {
  const out: Block[] = []
  const walk = (node: PmNode, contentStart: number, path: number[]) => {
    let pos = contentStart
    node.forEach((child, _offset, i) => {
      const childPath = [...path, i]
      if (child.isTextblock) out.push({ node: child, contentStart: pos + 1, path: childPath })
      else if (!child.isLeaf) walk(child, pos + 1, childPath)
      pos += child.nodeSize
    })
  }
  walk(doc, 0, [])
  return out
}

/** the matched span length: the full original span when the quote was capped, else the quote */
function spanLength(a: DocxAnchor): number {
  return Math.max(a.end - a.start, a.quote.length)
}

function quoteAt(text: string, start: number, a: DocxAnchor): boolean {
  if (a.quote === '') return start <= text.length
  return text.startsWith(a.quote, start)
}

function rangeIn(b: Block, start: number, a: DocxAnchor): PmRange {
  const len = b.node.content.size
  const end = Math.min(start + (a.quote === '' ? 0 : spanLength(a)), len)
  return { from: b.contentStart + start, to: b.contentStart + end }
}

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/** best occurrence of the quote in `blocks`: most surrounding context, then nearest to the stored path/offset */
function search(blocks: Block[], a: DocxAnchor): PmRange | null {
  if (a.quote === '') return null
  let best: { score: number; dist: number; range: PmRange } | null = null
  for (const b of blocks) {
    const text = blockText(b.node)
    const samePath = b.path.length === a.path.length && b.path.every((x, i) => x === a.path[i])
    for (let at = text.indexOf(a.quote); at !== -1; at = text.indexOf(a.quote, at + 1)) {
      const score =
        commonSuffix(text.slice(0, at), a.prefix) +
        commonPrefix(text.slice(at + a.quote.length), a.suffix)
      const dist = samePath ? Math.abs(at - a.start) : Number.MAX_SAFE_INTEGER
      if (!best || score > best.score || (score === best.score && dist < best.dist)) {
        best = { score, dist, range: rangeIn(b, at, a) }
      }
    }
  }
  return best?.range ?? null
}

/** the range of `anchor` in `doc`, or null when it can no longer be found */
export function locateDocxAnchor(
  doc: PmNode,
  anchor: CollabAnchor | null | undefined,
  opts: DocxCodecOptions = {},
): PmRange | null {
  const a = asDocxAnchor(anchor)
  if (!a) return null
  const all = textblocks(doc)
  if (a.para_id) {
    const paraIdOf = opts.paraIdOf ?? defaultParaIdOf
    const hits = all.filter((b) => paraIdOf(b.node) === a.para_id)
    for (const b of hits) {
      if (quoteAt(blockText(b.node), a.start, a)) return rangeIn(b, a.start, a)
    }
    const inPara = search(hits, a)
    if (inPara) return inPara
  }
  const byPath = blockAtPath(doc, a.path)
  if (byPath && quoteAt(blockText(byPath.node), a.start, a)) return rangeIn(byPath, a.start, a)
  return search(all, a)
}
