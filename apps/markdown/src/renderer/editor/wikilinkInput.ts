import { Extension, InputRule } from '@tiptap/core'
import { Mapping } from '@tiptap/pm/transform'
import { Plugin } from '@tiptap/pm/state'

/**
 * The wiki mark is made by the markdown parser, so a link typed or pasted in
 * the editor stayed plain text until the file was reopened. These rules add the
 * mark (only the mark: the text never changes) when the closing `]]` is typed
 * and to the links of a paste or drop.
 *
 * Same literal as `WIKI_LINK_RE` in wikilink.ts, minus the backslash. A marked
 * literal with a backslash doubles it on every serialize, so those stay plain
 * (as they are today) rather than widening that.
 */
const TYPED = /\[\[([^[\]|\\\n]+?)(?:\|([^[\]\\\n]+))?\]\]$/
const PASTED = /\[\[[^[\]|\\\n]+?(?:\|[^[\]\\\n]+)?\]\]/g

export const WikiMarkOnInput = Extension.create({
  name: 'wikiMarkOnInput',

  // Not markInputRule: it swallows the typed character and deletes the text
  // of a capture group. A custom rule keeps the text and adds the mark.
  addInputRules() {
    const wikiLink = this.editor.schema.marks.wikiLink
    if (!wikiLink) return []
    return [
      new InputRule({
        find: TYPED,
        handler: ({ state, range, match }) => {
          if (!state.selection.empty) return null
          // not over a hyperlink or inline code (a literal split by a code run
          // still has the code mark in its range)
          const { link, code } = state.schema.marks
          if (link && state.doc.rangeHasMark(range.from, range.to, link)) return null
          if (code && state.doc.rangeHasMark(range.from, range.to, code)) return null
          // the closing `]` is not in the doc yet; after a composition it is
          const typed = match[0].slice(range.to - range.from)
          const { tr } = state
          tr.insertText(typed, range.to)
          tr.addMark(range.from, range.to + typed.length, wikiLink.create())
          // the next character typed must not continue the link
          tr.removeStoredMark(wikiLink)
        },
      }),
    ]
  },

  // Not markPasteRule: it skips pastes that carry `data-pm-slice` (an in-app
  // copy) and does not know the `code` mark.
  addProseMirrorPlugins() {
    const wikiLink = this.editor.schema.marks.wikiLink
    if (!wikiLink) return []
    return [
      new Plugin({
        appendTransaction(trs, _old, state) {
          if (
            !trs.some((tr) => tr.docChanged && ['paste', 'drop'].includes(tr.getMeta('uiEvent')))
          ) {
            return null
          }
          // changed ranges, each mapped through the steps that came after it
          const all = new Mapping()
          trs.forEach((tr) => all.appendMapping(tr.mapping))
          const ranges: [number, number][] = []
          all.maps.forEach((map, i) => {
            const rest = all.slice(i + 1)
            map.forEach((_a, _b, from, to) => ranges.push([rest.map(from, -1), rest.map(to, 1)]))
          })
          const out = state.tr
          for (const [from, to] of ranges) {
            state.doc.nodesBetween(from, to, (node, pos, parent) => {
              if (parent?.type.spec.code) return
              if (
                !node.isText ||
                node.marks.some(
                  (m) => m.type.spec.code || m.type.name === 'link' || m.type === wikiLink,
                )
              ) {
                return
              }
              for (const m of node.text!.matchAll(PASTED)) {
                const a = pos + m.index
                const b = a + m[0].length
                if (b > from && a < to) out.addMark(a, b, wikiLink.create())
              }
            })
          }
          return out.docChanged ? out : null
        },
      }),
    ]
  },
})
