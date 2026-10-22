/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkFolderNode, UniworkResult } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkFolderPicker } from '../src/renderer/src/uniwork-folders/UniworkFolderPicker'
import {
  FOLDER_MAX_DEPTH,
  buildFolderIndex,
  moveBlockOf,
  type MovingItem,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'

/**
 * UNI-2078 slice 3: the folder picker takes a batch of moving items (the bulk Move of the
 * Documents list). The batch rules are the single-item rules applied to every item:
 *
 *   MY (my_folder)          WS1            WS2        CH: f1 > f2 > ... > f19
 *   ├ MY_A  └ MY_B          └ WS1_A
 *     └ MY_A1
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkFolderStrings.en
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

function node(
  id: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title: id,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...extra,
  }
}

/** f1 > f2 > ... > f<n> (f1 at depth 1) */
function chain(n: number): UniworkFolderNode {
  let leaf = node(`f${n}`)
  for (let i = n - 1; i >= 1; i--) leaf = node(`f${i}`, [leaf])
  return leaf
}

const TREE = [
  node('MY', [node('MY_A', [node('MY_A1')]), node('MY_B')], { systemKind: 'my_folder' }),
  node('WS1', [node('WS1_A')]),
  node('WS2'),
]
const index = buildFolderIndex(TREE)

const folder = (id: string, parentId: string | null): MovingItem => ({
  id,
  kind: 'folder',
  parentId,
})
const file = (id: string, parentId: string | null): MovingItem => ({ id, kind: 'file', parentId })

describe('moveBlockOf: a batch (UNI-2078 slice 3)', () => {
  it('a one-item batch judges exactly like the single item', () => {
    for (const target of [null, 'MY', 'MY_A', 'MY_A1', 'WS1', 'WS1_A', 'WS2']) {
      for (const item of [folder('WS1_A', 'WS1'), folder('MY_A1', 'MY_A'), file('d1', 'WS2')]) {
        expect(moveBlockOf(index, [item], target)).toBe(moveBlockOf(index, item, target))
      }
    }
  })

  it('blocks a target inside, or equal to, any moving folder', () => {
    const batch = [file('d1', 'WS2'), folder('WS1', null), folder('WS2', null)]
    expect(moveBlockOf(index, batch, 'WS1')).toBe('inside')
    expect(moveBlockOf(index, batch, 'WS1_A')).toBe('inside')
    expect(moveBlockOf(index, batch, 'WS2')).toBe('inside')
    // (the two workspace folders may not enter My Folder either; the root is free)
    expect(moveBlockOf(index, batch, 'MY_B')).toBe('my_folder')
    expect(moveBlockOf(index, batch, null)).toBeNull()
    // files alone have no subtree
    expect(moveBlockOf(index, [file('d1', null), file('d2', null)], 'WS1_A')).toBeNull()
  })

  it('blocks My Folder (and its subtree) as soon as one workspace folder is in the batch', () => {
    const batch = [folder('MY_B', 'MY'), folder('WS1_A', 'WS1')]
    expect(moveBlockOf(index, batch, 'MY')).toBe('my_folder')
    expect(moveBlockOf(index, batch, 'MY_A')).toBe('my_folder')
    expect(moveBlockOf(index, batch, 'MY_A1')).toBe('my_folder')
    expect(moveBlockOf(index, batch, 'WS2')).toBeNull()
    // only My Folder folders and documents: My Folder stays open
    expect(moveBlockOf(index, [folder('MY_B', 'MY'), file('d1', null)], 'MY_A')).toBeNull()
    expect(moveBlockOf(index, [file('d1', null), file('d2', 'WS1')], 'MY')).toBeNull()
  })

  it('judges depth with the tallest moving folder', () => {
    const deep = buildFolderIndex([
      chain(19),
      node('x', [], {}),
      node('y', [node('y1', [node('y2')])]),
    ])
    const small = [file('d', null), folder('x', null)]
    const tall = [...small, folder('y', null)]
    // y has height 3: under f17 it ends at depth 20, under f18 at 21
    expect(moveBlockOf(deep, tall, 'f17')).toBeNull()
    expect(moveBlockOf(deep, tall, 'f18')).toBe('deep')
    // without y the tallest is a lone folder or a file: both fit under f19 (depth 20)
    expect(moveBlockOf(deep, small, 'f18')).toBeNull()
    expect(moveBlockOf(deep, small, 'f19')).toBeNull()
    expect(FOLDER_MAX_DEPTH).toBe(20)
    const deeper = buildFolderIndex([chain(20), node('x'), node('d')])
    expect(moveBlockOf(deeper, [folder('x', null)], 'f20')).toBe('deep')
    expect(moveBlockOf(deeper, [file('d', null), folder('x', null)], 'f20')).toBe('deep')
    expect(moveBlockOf(deeper, [file('d', null)], 'f20')).toBe('deep')
  })

  it('"current location" holds only when every item shares that parent', () => {
    const shared = [file('d1', 'WS1'), file('d2', 'WS1'), folder('WS1_A', 'WS1')]
    expect(moveBlockOf(index, shared, 'WS1')).toBe('current')
    const mixed = [file('d1', 'WS1'), file('d2', 'WS2')]
    expect(moveBlockOf(index, mixed, 'WS1')).toBeNull()
    expect(moveBlockOf(index, mixed, 'WS2')).toBeNull()
    // the root as a shared parent
    expect(moveBlockOf(index, [file('d1', null), file('d2', null)], null)).toBe('current')
    expect(moveBlockOf(index, [file('d1', null), file('d2', 'WS1')], null)).toBeNull()
  })

  it('an empty batch behaves like a new document being placed', () => {
    expect(moveBlockOf(index, [], 'WS1')).toBeNull()
    expect(moveBlockOf(index, [], null)).toBeNull()
  })
})

describe('UniworkFolderPicker: a batch (UNI-2078 slice 3)', () => {
  let host: HTMLDivElement
  let root: Root

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
  }
  async function mount(el: ReturnType<typeof createElement>) {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, el))
    })
    await flush()
  }
  const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
  const $$ = <T extends Element = HTMLElement>(sel: string) =>
    Array.from(document.querySelectorAll<T>(sel))
  const treeItem = (title: string) =>
    $$('[role="treeitem"]').find(
      (el) => el.querySelector('.uwf-tree-title')?.textContent === title,
    )!
  const button = (label: string) => $$('button').find((b) => b.textContent === label)!
  async function click(el: Element | null | undefined) {
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const confirmDialogs = () =>
    $$('[role="dialog"]').filter((d) => d.textContent?.includes(en.ufMoveOutTitle))

  const picker = (
    moving: readonly MovingItem[],
    extra: Partial<Parameters<typeof UniworkFolderPicker>[0]> = {},
  ) =>
    createElement(UniworkFolderPicker, {
      title: 'Move 3 documents',
      confirmLabel: en.ufMove,
      workspaceId: 'w1',
      loadTree: async () => ok(TREE),
      nodes: TREE,
      moving,
      initialFolderId: null,
      onPick: vi.fn(),
      onCancel: vi.fn(),
      ...extra,
    })

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  it('shows the host title and the description under it', async () => {
    await mount(
      picker([file('d1', null), file('d2', null)], {
        title: 'Move 2 documents',
        description: 'Choose the folder the selected documents move to.',
      }),
    )
    expect($('.uw-act-heading')?.textContent).toBe('Move 2 documents')
    const dialog = $('[role="dialog"]')!
    expect(dialog.textContent).toContain('Choose the folder the selected documents move to.')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('disables the My Folder subtree with the reason when one workspace folder is moved', async () => {
    const onPick = vi.fn()
    await mount(picker([folder('MY_B', 'MY'), folder('WS1_A', 'WS1')], { onPick }))
    const mine = treeItem('My Folder')
    expect(mine.getAttribute('aria-disabled')).toBe('true')
    expect(mine.querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledWsFolder)
    await click(mine)
    await click(button(en.ufMove))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('disables a moving folder and keeps its siblings open', async () => {
    await mount(picker([folder('WS1', null), file('d1', null)]))
    expect(treeItem('WS1').getAttribute('aria-disabled')).toBe('true')
    expect(treeItem('WS1').querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledInside)
    expect(treeItem('WS2').getAttribute('aria-disabled')).toBeNull()
  })

  it('ignores the current location unless every item shares it', async () => {
    await mount(picker([file('d1', 'WS1'), file('d2', 'WS2')], { initialFolderId: null }))
    expect(treeItem('WS1').getAttribute('aria-disabled')).toBeNull()
    expect(treeItem('WS2').getAttribute('aria-disabled')).toBeNull()
    await act(async () => root.unmount())
    root = createRoot(host)
    await mount(picker([file('d1', 'WS1'), file('d2', 'WS1')], { initialFolderId: 'WS1' }))
    expect(treeItem('WS1').getAttribute('aria-disabled')).toBe('true')
    expect(treeItem('WS1').querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledCurrent)
  })

  it('asks ONCE for the whole batch before folders leave My Folder, then sends one pick', async () => {
    const onPick = vi.fn()
    await mount(
      picker([folder('MY_A1', 'MY_A'), folder('MY_B', 'MY'), file('d1', null)], { onPick }),
    )
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(onPick).not.toHaveBeenCalled()
    expect(confirmDialogs()).toHaveLength(1)
    const dialog = confirmDialogs()[0]!
    await click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === en.ufMoveOutConfirm,
      ),
    )
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith({ folderId: 'WS2', path: [{ id: 'WS2', title: 'WS2' }] })
    expect(confirmDialogs()).toHaveLength(0)
  })

  it('Cancel of that confirm sends nothing', async () => {
    const onPick = vi.fn()
    await mount(picker([folder('MY_A1', 'MY_A'), folder('MY_B', 'MY')], { onPick }))
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    const dialog = confirmDialogs()[0]!
    await click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Cancel'),
    )
    expect(confirmDialogs()).toHaveLength(0)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does not ask for documents alone, nor for folders staying inside My Folder', async () => {
    const onPick = vi.fn()
    await mount(picker([file('d1', 'MY_A'), file('d2', null)], { onPick }))
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(confirmDialogs()).toHaveLength(0)
    expect(onPick).toHaveBeenCalledTimes(1)

    const again = vi.fn()
    await act(async () => root.unmount())
    root = createRoot(host)
    await mount(
      picker([folder('MY_A1', 'MY_A'), file('d1', null)], {
        onPick: again,
        initialFolderId: 'MY_A',
      }),
    )
    await click(treeItem('MY_B'))
    await click(button(en.ufMove))
    expect(confirmDialogs()).toHaveLength(0)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('a single moving item (not an array) still works as before', async () => {
    const onPick = vi.fn()
    await mount(picker([], { onPick, moving: folder('MY_A1', 'MY_A') }))
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(confirmDialogs()).toHaveLength(1)
    expect(onPick).not.toHaveBeenCalled()
  })
})
