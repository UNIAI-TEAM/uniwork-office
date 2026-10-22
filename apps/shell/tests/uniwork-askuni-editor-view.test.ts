import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * UNI-2076 s1f (RB-2), s8-guard: the production wiring that feeds the editor
 * family's path and binding, and which webContents the guard calls an editor
 * view (the same registry the comments channels use: tab views, detached
 * windows, the slides audience window). Every other test stubs these deps, so
 * a re-pointed path would pass them all.
 */

describe('the production wiring of the editor family', () => {
  const src = (file: string) =>
    readFileSync(join(__dirname, '..', 'src', 'main', file), 'utf8').replace(/\s+/g, ' ')

  it('uniwork-docs/wiring.ts: the path is the sender own commentsPathFor, the binding goes through askUniDocBinding', () => {
    const wiring = src('uniwork-docs/wiring.ts')
    expect(wiring).toContain('editorPath: (sender) => wiring.commentsPathFor?.(sender) ?? null,')
    expect(wiring).toContain('docBinding: (path) => askUniDocBinding(service, path),')
  })

  it('index.ts: the guard decides which webContents is an editor view, Ask UNI keeps no predicate', () => {
    const main = src('index.ts')
    expect(main).toContain('tabManager?.hasWebContents(id) === true')
    expect(main).toContain('isDetachedWebContents(id)')
    expect(main).not.toContain('isAskUniEditorView')
    expect(main).not.toContain("tab.kind !== 'home'")
    expect(src('uniwork-docs/wiring.ts')).not.toContain('isEditorContents')
  })
})
