import { Annotation, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { html } from '@codemirror/lang-html'
import { tags } from '@lezer/highlight'
import { aiHighlight } from './cm-highlight'
import { findHighlight } from './cm-find'
import { joinRunEdits, runHistoryExtension } from './cm-run-history'
import { htmlShortcutCommand } from '../shortcuts'

/** Marks transactions that replace the document from outside the editor (load, patches) */
export const External = Annotation.define<boolean>()

/** Colors come from --cm-* custom properties (tokens.css palette, light/dark aware) */
const highlight = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--cm-tag)' },
  { tag: tags.angleBracket, color: 'var(--cm-punct)' },
  { tag: tags.attributeName, color: 'var(--cm-attr)' },
  { tag: tags.attributeValue, color: 'var(--cm-string)' },
  { tag: tags.string, color: 'var(--cm-string)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: tags.number, color: 'var(--cm-number)' },
  { tag: tags.propertyName, color: 'var(--cm-attr)' },
  { tag: tags.definitionKeyword, color: 'var(--cm-keyword)' },
  { tag: tags.processingInstruction, color: 'var(--cm-comment)' },
  { tag: tags.documentMeta, color: 'var(--cm-comment)' },
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', height: '100%' },
  '.cm-scroller': {
    fontFamily: "'SF Mono', Menlo, Consolas, 'Noto Sans Mono', 'Liberation Mono', monospace",
    fontSize: '13px',
    lineHeight: '1.55',
  },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--accent-soft)' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--hover)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
})

/**
 * Undo and redo come from the html shortcut table (Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z; the Cmd forms on
 * macOS), whatever the key event looks like. CodeMirror's own keymap drops Shift for a letter key,
 * so with Caps Lock on (or a synthetic event) the lowercase "z" matched Ctrl+Z and UNDID, emptying
 * the source under an undone AI run; its stock history keymap binds Ctrl-Shift-z on Linux only
 * (Mac: Shift-Cmd-z, and Cmd+Y is not bound at all), leaving Windows to the browser. The shared
 * matcher compares the letter case-insensitively and skips composition and AltGr.
 */
const historyKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      // an IME composition owns its keys (CodeMirror's own keymap skips them too)
      if (view.composing) return false
      const command = htmlShortcutCommand(event)
      if (command !== 'undo' && command !== 'redo') return false
      event.preventDefault()
      if (command === 'undo') undo(view)
      else redo(view)
      return true
    },
  }),
)

export function buildExtensions(onDocChanged: (view: EditorView) => void): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history({ joinToEvent: joinRunEdits }),
    runHistoryExtension,
    historyKeys,
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    html(),
    aiHighlight(),
    findHighlight,
    EditorView.lineWrapping,
    theme,
    EditorView.updateListener.of((update) => {
      // programmatic reveals (preview click, citation) carry External and must not feed back into selection
      if (update.transactions.some((tr) => tr.annotation(External))) return
      if (update.docChanged || update.selectionSet) onDocChanged(update.view)
    }),
  ]
}
