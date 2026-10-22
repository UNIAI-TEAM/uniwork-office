import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAskUniEditorView } from '../src/main/uniwork-askuni/doc-sender'

/**
 * UNI-2076 s1f (RB-2): which webContents is an Ask UNI editor view (an editor
 * tab's view or a detached editor window, never Home's shell page), and the
 * production wiring that feeds the editor family's path and binding. Every
 * other test stubs these deps, so a flipped predicate or a re-pointed path
 * would pass them all.
 */

describe('isAskUniEditorView', () => {
  it('Home is not an editor view, even when a detached window claims the id', () => {
    expect(isAskUniEditorView({ kind: 'home' }, false)).toBe(false)
    expect(isAskUniEditorView({ kind: 'home' }, true)).toBe(false)
  })

  it('an editor tab view (any kind but home) is one', () => {
    expect(isAskUniEditorView({ kind: 'docx' }, false)).toBe(true)
    expect(isAskUniEditorView({ kind: 'html' }, false)).toBe(true)
  })

  it('a detached editor window is one', () => {
    expect(isAskUniEditorView(undefined, true)).toBe(true)
    expect(isAskUniEditorView(null, true)).toBe(true)
  })

  it('an unknown webContents is not one', () => {
    expect(isAskUniEditorView(undefined, false)).toBe(false)
    expect(isAskUniEditorView(null, false)).toBe(false)
  })
})

describe('the production wiring of the editor family', () => {
  const src = (file: string) =>
    readFileSync(join(__dirname, '..', 'src', 'main', file), 'utf8').replace(/\s+/g, ' ')

  it('uniwork-docs/wiring.ts: the path is the sender own commentsPathFor, the binding goes through askUniDocBinding', () => {
    const wiring = src('uniwork-docs/wiring.ts')
    expect(wiring).toContain('editorPath: (sender) => wiring.commentsPathFor?.(sender) ?? null,')
    expect(wiring).toContain('docBinding: (path) => askUniDocBinding(service, path),')
    expect(wiring).toContain('isEditorContents: (id) => wiring.isEditorContents?.(id) === true,')
  })

  it('index.ts: isEditorContents goes through isAskUniEditorView with the tab and the detached window', () => {
    const main = src('index.ts')
    expect(main).toContain('isAskUniEditorView(')
    expect(main).toContain('tabManager?.describeWebContents(id)')
    expect(main).toContain('detachedWindowForWebContents(id) !== undefined')
    expect(main).not.toContain("tab.kind !== 'home'")
  })
})
