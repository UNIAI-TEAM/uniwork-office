import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { watchEditorLoads } from '../src/main/uniwork-docs/editor-load-hook'

/** a web contents: an id and the `did-finish-load` event */
class FakeContents extends EventEmitter {
  constructor(readonly id: number) {
    super()
  }
}

describe('UNI-2510 R1-7: an editor view that loads again starts a new editor session', () => {
  it('notes the document of an editor view on every load, and ignores views with no document', () => {
    const paths = new Map([[7, '/docs/Plan.docx']])
    const noted: string[] = []
    const editor = new FakeContents(7)
    const shell = new FakeContents(1)
    for (const contents of [editor, shell]) {
      watchEditorLoads(
        contents,
        (id) => paths.get(id),
        (path) => noted.push(path),
      )
    }

    editor.emit('did-finish-load')
    editor.emit('did-finish-load') // crash reload / the module's own location.reload()
    shell.emit('did-finish-load')

    expect(noted).toEqual(['/docs/Plan.docx', '/docs/Plan.docx'])
  })

  it('follows the view when it shows another document later (the path is read at load time)', () => {
    let shown: string | undefined
    const noted: string[] = []
    const editor = new FakeContents(7)
    watchEditorLoads(
      editor,
      () => shown,
      (path) => noted.push(path),
    )

    editor.emit('did-finish-load')
    shown = '/docs/A.docx'
    editor.emit('did-finish-load')
    shown = '/docs/B.docx'
    editor.emit('did-finish-load')

    expect(noted).toEqual(['/docs/A.docx', '/docs/B.docx'])
  })
})
