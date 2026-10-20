/**
 * G8-12 (UNI-1407): where each server comment sits in the open document, kept live while the user
 * edits (addendum §4.3: the editor holds anchors in the model and sends a fresh map after each Save).
 *
 * A ProseMirror plugin owns `id -> range | null` (null = lost) and maps every range through each
 * transaction, so the next Save encodes from the live position, not from the anchor the server sent.
 * A range whose text was deleted entirely collapses and becomes lost. The highlights are inline
 * decorations (lane decision D3): never the `comment` mark, so nothing reaches `comments.xml` or the
 * body's comment ranges, and the document is never marked dirty by a server comment.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  asDocxAnchor,
  canonicalJson,
  encodeDocxAnchor,
  locateDocxAnchor,
  type DocxAnchor,
  type DocxCodecOptions,
  type PmRange,
} from './anchor-codec'
import type { CollabAnchor, CollabAnchorAdapter } from './seam'

/** what the tracker needs from a server thread root */
export interface TrackedRoot {
  id: string
  anchor?: CollabAnchor | null
  anchor_state?: string | null
  resolved?: boolean
  deleted?: boolean
}

interface TrackerState {
  ranges: ReadonlyMap<string, PmRange | null>
  /** ids drawn as highlights (open, live threads) */
  shown: ReadonlySet<string>
  deco: DecorationSet
}

interface TrackerMeta {
  ranges?: ReadonlyMap<string, PmRange | null>
  shown?: ReadonlySet<string>
}

export const serverCommentsPluginKey = new PluginKey<TrackerState>('serverComments')

export const SERVER_COMMENT_CLASS = 'doc-server-comment'

function decorations(
  doc: PmNode,
  ranges: ReadonlyMap<string, PmRange | null>,
  shown: ReadonlySet<string>,
): DecorationSet {
  const decos: Decoration[] = []
  for (const [id, r] of ranges) {
    if (!r || r.from >= r.to || !shown.has(id)) continue
    decos.push(
      Decoration.inline(r.from, r.to, { class: SERVER_COMMENT_CLASS, 'data-server-comment': id }),
    )
  }
  return DecorationSet.create(doc, decos)
}

export function createServerCommentsPlugin(): Plugin<TrackerState> {
  return new Plugin<TrackerState>({
    key: serverCommentsPluginKey,
    state: {
      init: (_config, state) => ({
        ranges: new Map(),
        shown: new Set(),
        deco: DecorationSet.create(state.doc, []),
      }),
      apply(tr, prev) {
        const meta = tr.getMeta(serverCommentsPluginKey) as TrackerMeta | undefined
        if (!tr.docChanged && !meta) return prev
        let ranges = prev.ranges
        if (tr.docChanged) {
          const mapped = new Map<string, PmRange | null>()
          for (const [id, r] of ranges) {
            if (!r) {
              mapped.set(id, null)
              continue
            }
            // the range keeps text typed inside it, not text typed at its edges
            const from = tr.mapping.map(r.from, 1)
            const to = tr.mapping.map(r.to, -1)
            mapped.set(id, r.from < r.to && from >= to ? null : { from, to: Math.max(from, to) })
          }
          ranges = mapped
        }
        if (meta?.ranges) ranges = meta.ranges
        const shown = meta?.shown ?? prev.shown
        return { ranges, shown, deco: decorations(tr.doc, ranges, shown) }
      },
    },
    props: {
      decorations: (state) => serverCommentsPluginKey.getState(state)?.deco ?? null,
    },
  })
}

/** true when the first step replaces the whole old document (what TipTap `setContent` dispatches) */
function replacesWholeDoc(tr: Transaction): boolean {
  const step = tr.steps[0]
  return step instanceof ReplaceStep && step.from === 0 && step.to === tr.before.content.size
}

export function trackedRanges(state: EditorState): ReadonlyMap<string, PmRange | null> {
  return serverCommentsPluginKey.getState(state)?.ranges ?? new Map()
}

export interface ServerAnchors {
  /** take the latest thread roots: new ids are located once, gone ids dropped, known ids keep their live range */
  syncThreads(roots: readonly TrackedRoot[]): void
  /** undefined = not tracked; null = lost */
  rangeOf(id: string): PmRange | null | undefined
  encode(range: PmRange): DocxAnchor | null
  locate(anchor: CollabAnchor | null | undefined): PmRange | null
  /** the kit adapter; a new object whenever a thread becomes located or lost, so the list re-sorts */
  adapter(): CollabAnchorAdapter
  /** select the range and scroll it into view without focusing the editor */
  select(range: PmRange): void
  dispose(): void
}

/**
 * Registers the tracker plugin on `editor` (removed by `dispose`). `onAdapterChange` fires when the
 * located/lost set changed and the panel should pick up the new adapter.
 */
export function createServerAnchors(
  editor: Editor,
  opts: DocxCodecOptions & { onAdapterChange?(): void } = {},
): ServerAnchors {
  const plugin = createServerCommentsPlugin()
  editor.registerPlugin(plugin)
  /** canonical anchor JSON -> comment id, for the adapter calls that pass only an anchor */
  let byAnchor = new Map<string, string>()
  let signature = ''
  /** comment id -> the anchor the server last sent, for recovering a range lost while editing */
  let serverAnchors = new Map<string, DocxAnchor>()
  /** ids whose located range collapsed in this session (not the ones the server already reported lost) */
  const lostHere = new Set<string>()
  let lastRanges: ReadonlyMap<string, PmRange | null> = new Map()

  const state = () => editor.state
  const dispatchMeta = (meta: TrackerMeta) => {
    if (editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(serverCommentsPluginKey, meta))
  }
  const locate = (anchor: CollabAnchor | null | undefined) =>
    locateDocxAnchor(state().doc, anchor, opts)
  const rangeOfAnchor = (anchor: CollabAnchor): PmRange | null => {
    const id = byAnchor.get(canonicalJson(anchor))
    const tracked = id !== undefined ? trackedRanges(state()).get(id) : undefined
    return tracked !== undefined ? tracked : locate(anchor)
  }
  const select = (range: PmRange) => {
    if (editor.isDestroyed) return
    const { doc } = editor.state
    const from = Math.max(0, Math.min(range.from, doc.content.size))
    const to = Math.max(from, Math.min(range.to, doc.content.size))
    const tr = editor.state.tr.setSelection(TextSelection.create(doc, from, to)).scrollIntoView()
    editor.view.dispatch(tr)
  }

  const makeAdapter = (): CollabAnchorAdapter => ({
    order: (anchor) => rangeOfAnchor(anchor)?.from ?? Number.MAX_SAFE_INTEGER,
    locate: (anchor) => rangeOfAnchor(anchor) !== null,
    goTo: (anchor) => {
      const r = rangeOfAnchor(anchor)
      if (r) select(r)
    },
  })
  let adapter = makeAdapter()

  const refreshAdapter = () => {
    const ranges = trackedRanges(state())
    const sig = [...ranges].map(([id, r]) => `${id}:${r ? 1 : 0}`).join(',')
    if (sig === signature) return
    signature = sig
    adapter = makeAdapter()
    opts.onAdapterChange?.()
  }

  /**
   * Delete + undo: a range that collapsed comes back when its text does. Only where the stored prefix
   * and suffix still surround it (never at another place with the same words), and only from the next
   * document change after it was lost, so deleting a commented paragraph never re-attaches at once.
   */
  const recoverLost = (transaction: Transaction) => {
    const now = trackedRanges(state())
    const justLost = new Set<string>()
    let recovered: Map<string, PmRange | null> | null = null
    const replaced = replacesWholeDoc(transaction)
    for (const [id, r] of now) {
      const before = lastRanges.get(id)
      if (r !== null || !before) continue
      // a whole-document replace (the reload after Save) collapses every range at once: look the
      // text up again, from the old document and the live range, so edits made before the Save count;
      // locate in the final state doc: appendTransaction plugins may change it after this transaction
      const anchor = replaced ? encodeDocxAnchor(transaction.before, before, opts) : null
      const range = anchor
        ? locateDocxAnchor(state().doc, anchor, { ...opts, requireContext: true })
        : null
      if (range) {
        recovered ??= new Map(now)
        recovered.set(id, range)
        continue
      }
      lostHere.add(id)
      justLost.add(id)
    }
    for (const id of [...lostHere]) {
      if (now.get(id) !== null) {
        lostHere.delete(id)
        continue
      }
      const anchor = serverAnchors.get(id)
      if (justLost.has(id) || !anchor) continue
      const range = locateDocxAnchor(state().doc, anchor, { ...opts, requireContext: true })
      if (!range) continue
      lostHere.delete(id)
      recovered ??= new Map(now)
      recovered.set(id, range)
    }
    if (recovered) dispatchMeta({ ranges: recovered })
    lastRanges = trackedRanges(state())
  }

  // a lost / found flip while typing re-sorts the list on the next panel render
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return
    recoverLost(transaction)
    refreshAdapter()
  }
  editor.on('transaction', onTransaction)

  return {
    syncThreads(roots) {
      const prev = trackedRanges(state())
      const ranges = new Map<string, PmRange | null>()
      const shown = new Set<string>()
      byAnchor = new Map()
      serverAnchors = new Map()
      for (const root of roots) {
        const anchor = asDocxAnchor(root.anchor)
        if (!anchor || root.deleted) continue
        byAnchor.set(canonicalJson(root.anchor), root.id)
        serverAnchors.set(root.id, anchor)
        const known = prev.get(root.id)
        const range =
          known !== undefined ? known : root.anchor_state === 'lost' ? null : locate(anchor)
        ranges.set(root.id, range)
        if (!root.resolved) shown.add(root.id)
      }
      dispatchMeta({ ranges, shown })
      for (const id of lostHere) if (!ranges.has(id)) lostHere.delete(id)
      lastRanges = trackedRanges(state())
      refreshAdapter()
    },
    rangeOf: (id) => trackedRanges(state()).get(id),
    encode: (range) => encodeDocxAnchor(state().doc, range, opts),
    locate,
    adapter: () => adapter,
    select,
    dispose() {
      editor.off('transaction', onTransaction)
      if (!editor.isDestroyed) editor.unregisterPlugin(serverCommentsPluginKey)
    },
  }
}
