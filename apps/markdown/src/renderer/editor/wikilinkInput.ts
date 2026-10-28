import { Extension, InputRule } from '@tiptap/core'
import { Mapping } from '@tiptap/pm/transform'
import { Plugin } from '@tiptap/pm/state'

/**
 * The wiki mark is made by the markdown parser, so a link typed or pasted in
 * the editor stayed plain text until the file was reopened. These rules add the
 * mark (only the mark: the text never changes) when the closing `]]` is typed
 * and to the links of a paste or drop. A pasted `![[embed]]` becomes the embed
 * node the tokenizer builds on load, so it renders at once too.
 *
 * Same literal as `WIKI_LINK_RE` in wikilink.ts, backslash included: the
 * serializer writes a wiki-marked literal verbatim (F8), so a backslash in it
 * no longer doubles on save.
 *
 * Where the schema has the embed node (cap 'wikiVault'), the `[[x]]` inside a
 * `![[x]]` is not a link: the embed owns that span, as it does when the file
 * is loaded. A `!` the author escaped (`\![[x]]`) does not make an embed.
 */
const TYPED = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+))?\]\]$/
const TYPED_NOT_EMBED = /(?<!(?<!\\)!)\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+))?\]\]$/
/** one pasted wiki literal: group 1 is the embed's unescaped `!`, unset for a link */
const PASTED_ANY = /(?:(?<!\\)(!))?\[\[[^[\]|\n]+?(?:\|[^[\]\n]+)?\]\]/g
const PASTED_LINK_ONLY = /\[\[[^[\]|\n]+?(?:\|[^[\]\n]+)?\]\]/g

export const WikiMarkOnInput = Extension.create({
  name: 'wikiMarkOnInput',

  // Not markInputRule: it swallows the typed character and deletes the text
  // of a capture group. A custom rule keeps the text and adds the mark.
  addInputRules() {
    const wikiLink = this.editor.schema.marks.wikiLink
    if (!wikiLink) return []
    return [
      new InputRule({
        find: this.editor.schema.nodes.wikiEmbed ? TYPED_NOT_EMBED : TYPED,
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
    const wikiEmbed = this.editor.schema.nodes.wikiEmbed
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
          // wiki literals of the changed ranges, once each: ranges may overlap
          const found = new Map<number, { from: number; to: number; embed: boolean }>()
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
              for (const m of node.text!.matchAll(wikiEmbed ? PASTED_ANY : PASTED_LINK_ONLY)) {
                const a = pos + m.index
                const b = a + m[0].length
                if (b > from && a < to) found.set(a, { from: a, to: b, embed: !!m[1] })
              }
            })
          }
          // from the end: an embed swaps its text for a node, which moves what follows
          for (const hit of [...found.values()].sort((x, y) => y.from - x.from)) {
            if (hit.embed) {
              const raw = state.doc.textBetween(hit.from, hit.to)
              out.replaceWith(hit.from, hit.to, wikiEmbed!.create({ raw }))
            } else {
              out.addMark(hit.from, hit.to, wikiLink.create())
            }
          }
          return out.docChanged ? out : null
        },
      }),
    ]
  },
})
