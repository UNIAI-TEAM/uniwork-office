/**
 * Hover hint of the placed marks on the page (UNI-1232 R2-02): a placed Add-text / check / cross
 * mark said "Click an image on the page ...", which describes a picture, not the text just placed.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ImageEditLayer, type LocalImageEdit } from '../src/renderer/ImageEditLayer'
import type { StaticFormFillRecord } from '../src/shared/ipc'

const IMAGE_HINT = 'Click an image on the page'
const MARK_HINT = 'Drag to move, corners to resize'
const rect: [number, number, number, number] = [100, 100, 220, 140]
const fill: StaticFormFillRecord = { id: 'f1', kind: 'text', pageIndex: 0, rect, text: 'Hello' }

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const edit = (id: string, staticFill?: StaticFormFillRecord): LocalImageEdit => ({
  id,
  staticFill,
  input: { kind: 'insertImage', pageIndex: 0, image: 'AAAA', rect, layer: 'aboveText' },
})

async function render(props: Partial<Parameters<typeof ImageEditLayer>[0]>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(ImageEditLayer, {
        geom: { pw: 612, ph: 792, rot: 0 },
        scale: 1,
        edits: [],
        existing: [],
        selectedId: null,
        selectedKey: null,
        editHint: IMAGE_HINT,
        staticFillHint: MARK_HINT,
        onSelectEdit: () => {},
        onSelectExisting: () => {},
        ...props,
      }),
    )
  })
  return [...container.querySelectorAll('[data-tip]')].map((n) => n.getAttribute('data-tip'))
}

describe('ImageEditLayer hover hints', () => {
  it('a placed form-fill mark (pending) says how to move it, a picture keeps the image hint', async () => {
    expect(await render({ edits: [edit('e1', fill)] })).toEqual([MARK_HINT])
    await act(async () => root?.unmount())
    expect(await render({ edits: [edit('e2')] })).toEqual([IMAGE_HINT])
  })

  it('a saved form-fill mark (existing) gets the mark hint, other images the image hint', async () => {
    const other: [number, number, number, number] = [300, 300, 400, 400]
    const tips = await render({
      existing: [
        { pageIndex: 0, rect, aboveText: true },
        { pageIndex: 0, rect: other, aboveText: false },
      ],
      isStaticFill: (ref) => ref.rect === rect,
    })
    expect(tips.sort()).toEqual([IMAGE_HINT, MARK_HINT].sort())
  })
})
