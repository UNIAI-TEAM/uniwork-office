/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkFolderNode, UniworkResult } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { ArchiveConfirm } from '../src/renderer/src/UniworkDocActions'
import { BulkTrashConfirm } from '../src/renderer/src/doclist/BulkBar'
import { UniworkFolderPicker } from '../src/renderer/src/uniwork-folders/UniworkFolderPicker'
import { useFolderActions } from '../src/renderer/src/uniwork-folders/use-folder-actions'
import {
  MOVE_BLOCK_KEYS,
  buildFolderIndex,
  folderActionFailure,
  moveBlockOf,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * UNI-2066 WS-C: the desktop half of the move and trash rules for workspace folders (contract
 * A5-A8). The bridge is a typed fake; no main runs. The fake tree:
 *
 *   MY (my_folder)              WS1            WS2
 *   ├ MY_A  └ MY_B              └ WS1_A
 *     └ MY_A1
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkFolderStrings.en
const docEn = uniworkDocumentStrings.en
const CANCEL = 'Cancel'
const vi_ = uniworkFolderStrings.vi

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

const TREE = [
  node('MY', [node('MY_A', [node('MY_A1')]), node('MY_B')], { systemKind: 'my_folder' }),
  node('WS1', [node('WS1_A')]),
  node('WS2'),
]
const index = buildFolderIndex(TREE)

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

describe('A5 moveBlockOf: a workspace folder cannot enter My Folder or its subtree', () => {
  const ws = (id: string, parentId: string | null) => ({ id, kind: 'folder' as const, parentId })

  it.each(['MY', 'MY_A', 'MY_A1', 'MY_B'])('blocks %s for a workspace folder', (target) => {
    expect(moveBlockOf(index, ws('WS1_A', 'WS1'), target)).toBe('my_folder')
    expect(moveBlockOf(index, ws('WS2', null), target)).toBe('my_folder')
  })

  it('has a reason key for the block', () => {
    expect(MOVE_BLOCK_KEYS.my_folder).toBe('ufDisabledWsFolder')
  })

  it('leaves the workspace targets open for a workspace folder', () => {
    expect(moveBlockOf(index, ws('WS1_A', 'WS1'), 'WS2')).toBeNull()
    expect(moveBlockOf(index, ws('WS1_A', 'WS1'), null)).toBeNull()
  })

  it('does not block a folder that already lives in My Folder', () => {
    expect(moveBlockOf(index, ws('MY_A1', 'MY_A'), 'MY_B')).toBeNull()
    expect(moveBlockOf(index, ws('MY_A1', 'MY_A'), 'MY')).toBeNull()
    expect(moveBlockOf(index, ws('MY_A1', 'MY_A'), 'MY_A')).toBe('current')
  })

  it('does not block a document, in any target', () => {
    const doc = { id: 'doc1', kind: 'file' as const, parentId: null }
    for (const target of ['MY', 'MY_A', 'MY_A1', 'WS1']) {
      expect(moveBlockOf(index, doc, target)).toBeNull()
    }
  })

  it('does not block a placement with nothing moving (New / Upload / Save a copy)', () => {
    expect(moveBlockOf(index, null, 'MY')).toBeNull()
  })

  it('does not guess for a folder the tree does not hold', () => {
    expect(moveBlockOf(index, ws('ghost', null), 'MY')).toBeNull()
  })
})

describe('A6 folderActionFailure maps folder_into_my_folder', () => {
  it('to the ufIntoMyFolder sentence, whose vi/en text is the web wording', () => {
    expect(folderActionFailure('folder_into_my_folder')).toEqual({ key: 'ufIntoMyFolder' })
    expect(en.ufIntoMyFolder).toBe(
      "A workspace folder can't be moved into My Folder. Refresh the list and try again.",
    )
    expect(vi_.ufIntoMyFolder).toBe(
      'Thư mục của workspace không thể chuyển vào Thư mục của tôi. Hãy tải lại danh sách rồi thử lại.',
    )
  })
})

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function mount(el: ReturnType<typeof createElement>, lang: 'en' | 'vi' = 'en') {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang }, el))
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!
const twisty = (title: string) => treeItem(title).querySelector('.uwf-twisty')
const button = (label: string) => $$('button').find((b) => b.textContent === label)!

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

const myFolderLabel = 'My Folder'

describe('A5 the picker locks My Folder for a moved workspace folder', () => {
  const picker = (
    moving: { id: string; kind: 'folder' | 'file'; parentId: string | null },
    extra: Partial<Parameters<typeof UniworkFolderPicker>[0]> = {},
  ) =>
    createElement(UniworkFolderPicker, {
      title: 'Move',
      confirmLabel: en.ufMove,
      workspaceId: 'w1',
      loadTree: async () => ok(TREE),
      nodes: TREE,
      moving,
      initialFolderId: moving.parentId,
      onPick: vi.fn(),
      onCancel: vi.fn(),
      ...extra,
    })

  it('disables the My Folder row with the reason and cannot confirm it', async () => {
    const onPick = vi.fn()
    await mount(picker({ id: 'WS1_A', kind: 'folder', parentId: 'WS1' }, { onPick }))
    const mine = treeItem(myFolderLabel)
    expect(mine.getAttribute('aria-disabled')).toBe('true')
    expect(mine.querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledWsFolder)
    await click(mine)
    await click(button(en.ufMove))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('locks the whole subtree (a nested row shows the reason too)', async () => {
    await mount(picker({ id: 'WS1_A', kind: 'folder', parentId: 'WS1' }))
    await click(twisty(myFolderLabel))
    const nested = $$('[role="treeitem"]').filter((el) =>
      ['MY_A', 'MY_B'].includes(el.querySelector('.uwf-tree-title')?.textContent ?? ''),
    )
    expect(nested.length).toBeGreaterThan(0)
    for (const row of nested) {
      expect(row.getAttribute('aria-disabled')).toBe('true')
      expect(row.querySelector('.uwf-reason')?.textContent).toBe(en.ufDisabledWsFolder)
    }
  })

  it('leaves My Folder open when a document is moved', async () => {
    await mount(picker({ id: 'doc1', kind: 'file', parentId: null }))
    expect(treeItem(myFolderLabel).getAttribute('aria-disabled')).toBeNull()
  })

  it('leaves My Folder open when a folder of My Folder is moved', async () => {
    await mount(picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }))
    expect(treeItem(myFolderLabel).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('A7 leaving My Folder asks first', () => {
  const picker = (
    moving: { id: string; kind: 'folder' | 'file'; parentId: string | null },
    onPick = vi.fn(),
    lang: 'en' | 'vi' = 'en',
  ) =>
    mount(
      createElement(UniworkFolderPicker, {
        title: 'Move',
        confirmLabel: en.ufMove,
        workspaceId: 'w1',
        loadTree: async () => ok(TREE),
        nodes: TREE,
        moving,
        initialFolderId: moving.parentId,
        onPick,
        onCancel: vi.fn(),
      }),
      lang,
    )
  const dialogs = () => $$('[role="dialog"]')
  const confirmDialog = () => dialogs().find((d) => d.textContent?.includes(en.ufMoveOutTitle))

  it('shows the confirm for a My Folder folder moved to a workspace folder; nothing is sent yet', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(onPick).not.toHaveBeenCalled()
    const dialog = confirmDialog()!
    expect(dialog).toBeDefined()
    expect(dialog.textContent).toContain(en.ufMoveOutBody)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('shows it for the workspace root too', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem(en.ufRoot))
    await click(button(en.ufMove))
    expect(confirmDialog()).toBeDefined()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Cancel returns to the picker with nothing sent, and it can still be confirmed after', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    const dialog = confirmDialog()!
    await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === CANCEL))
    expect(confirmDialog()).toBeUndefined()
    expect($('.uwf-picker')).not.toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    await click(button(en.ufMove))
    expect(confirmDialog()).toBeDefined()
  })

  it('Escape closes only the confirm, not the picker', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    const dialog = confirmDialog()!
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(confirmDialog()).toBeUndefined()
    expect($('.uwf-picker')).not.toBeNull()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Tab stays inside the confirm', async () => {
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' })
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    const dialog = confirmDialog()!
    const buttons = Array.from(dialog.querySelectorAll('button'))
    expect(buttons.length).toBe(2)
    buttons[buttons.length - 1]!.focus()
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('Confirm sends the move once, with the picked folder', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    const dialog = confirmDialog()!
    await click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === en.ufMoveOutConfirm,
      ),
    )
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith({ folderId: 'WS2', path: [{ id: 'WS2', title: 'WS2' }] })
    expect(confirmDialog()).toBeUndefined()
  })

  it('does not ask for a folder moved inside My Folder', async () => {
    const onPick = vi.fn()
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, onPick)
    await click(treeItem('MY_B'))
    await click(button(en.ufMove))
    expect(confirmDialog()).toBeUndefined()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('does not ask for a workspace folder moved to the workspace', async () => {
    const onPick = vi.fn()
    await picker({ id: 'WS1_A', kind: 'folder', parentId: 'WS1' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(confirmDialog()).toBeUndefined()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('never asks for a document, even one that leaves My Folder', async () => {
    const onPick = vi.fn()
    await picker({ id: 'doc1', kind: 'file', parentId: 'MY' }, onPick)
    await click(treeItem('WS2'))
    await click(button(en.ufMove))
    expect(confirmDialog()).toBeUndefined()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('words the confirm in vi', async () => {
    await picker({ id: 'MY_A1', kind: 'folder', parentId: 'MY_A' }, vi.fn(), 'vi')
    await click(treeItem('WS2'))
    await click($('.uwf-picker-confirm'))
    const dialog = $$('[role="dialog"]').find((d) => d.textContent?.includes(vi_.ufMoveOutTitle))!
    expect(dialog.textContent).toContain('Chuyển thư mục ra workspace?')
    expect(dialog.textContent).toContain(
      'Thư mục và tên sẽ hiện cho cả workspace; tài liệu bên trong vẫn giữ quyền như cũ',
    )
    expect(dialog.textContent).toContain('Chuyển')
  })
})

describe('A6 a 422 folder_into_my_folder reaches the person as one sentence', () => {
  it('shows the ufIntoMyFolder text in the toast of a refused move', async () => {
    window.aiOffice = {
      uniworkMoveDocument: vi.fn(async () => ({
        ok: false as const,
        error: 'folder_into_my_folder' as const,
      })),
    } as unknown as HomeApi
    const toasts: string[] = []
    function Harness() {
      const actions = useFolderActions({
        workspaceId: 'w1',
        onChanged: () => undefined,
        notify: (message) => toasts.push(message),
      })
      const [started, setStarted] = useState(false)
      return createElement(
        'button',
        {
          id: 'go',
          onClick: () => {
            setStarted(true)
            void actions.move(
              { id: 'ghost', kind: 'folder', parentId: null, title: 'Ghost' },
              { folderId: 'MY', path: [{ id: 'MY', title: 'My Folder' }] },
            )
          },
        },
        started ? 'sent' : 'send',
      )
    }
    await mount(createElement(Harness))
    await click($('#go'))
    expect(toasts).toEqual([en.ufIntoMyFolder])
  })
})

describe('A8 trashing one folder reads the archive impact', () => {
  let impact: ReturnType<typeof vi.fn>
  const confirm = (props: Partial<Parameters<typeof ArchiveConfirm>[0]> = {}) =>
    createElement(ArchiveConfirm, {
      name: 'Plans',
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      ...props,
    })
  const sentence = () => document.body.textContent?.includes(en.ufTrashRelocated)

  function fake(result: unknown) {
    impact = vi.fn(async () => result)
    window.aiOffice = { uniworkArchiveImpact: impact } as unknown as HomeApi
  }

  it('adds the sentence, without any number, when relocatedCount > 0', async () => {
    fake(ok({ tooLarge: false, folders: 1, documents: 2, relocatedCount: 3 }))
    await mount(confirm({ folderId: 'f1' }))
    expect(impact).toHaveBeenCalledWith('f1')
    expect(sentence()).toBe(true)
    const line = $$('p').find((p) => p.textContent === en.ufTrashRelocated)
    expect(line).toBeDefined()
    expect(line!.textContent).not.toMatch(/\d/)
  })

  it('has no sentence when relocatedCount is 0', async () => {
    fake(ok({ tooLarge: false, folders: 1, documents: 2, relocatedCount: 0 }))
    await mount(confirm({ folderId: 'f1' }))
    expect(sentence()).toBe(false)
  })

  it('has no sentence when the read fails, and the confirm still works', async () => {
    fake({ ok: false, error: 'network' })
    const onConfirm = vi.fn()
    await mount(confirm({ folderId: 'f1', onConfirm }))
    expect(sentence()).toBe(false)
    await click(button(docEn.uwDocArchive))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('has no sentence when the tree is too large, and the confirm still works', async () => {
    fake(ok({ tooLarge: true }))
    const onConfirm = vi.fn()
    await mount(confirm({ folderId: 'f1', onConfirm }))
    expect(sentence()).toBe(false)
    await click(button(docEn.uwDocArchive))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('has no sentence when the read throws, and the confirm still works', async () => {
    impact = vi.fn(async () => {
      throw new Error('boom')
    })
    window.aiOffice = { uniworkArchiveImpact: impact } as unknown as HomeApi
    const onConfirm = vi.fn()
    await mount(confirm({ folderId: 'f1', onConfirm }))
    expect(sentence()).toBe(false)
    await click(button(docEn.uwDocArchive))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('waits for the read: the confirm is inert while it is pending', async () => {
    let release: (value: unknown) => void = () => undefined
    impact = vi.fn(() => new Promise((resolve) => (release = resolve)))
    window.aiOffice = { uniworkArchiveImpact: impact } as unknown as HomeApi
    const onConfirm = vi.fn()
    await mount(confirm({ folderId: 'f1', onConfirm }))
    const go = button(docEn.uwDocArchive)
    expect(go.getAttribute('aria-disabled')).toBe('true')
    await click(go)
    expect(onConfirm).not.toHaveBeenCalled()
    await act(async () =>
      release(ok({ tooLarge: false, folders: 0, documents: 1, relocatedCount: 1 })),
    )
    await flush()
    expect(sentence()).toBe(true)
    expect(button(docEn.uwDocArchive).getAttribute('aria-disabled')).toBeNull()
  })

  it('makes no impact call for a document', async () => {
    fake(ok({ tooLarge: false, folders: 0, documents: 0, relocatedCount: 5 }))
    await mount(confirm())
    expect(impact).not.toHaveBeenCalled()
    expect(sentence()).toBe(false)
  })

  it('words the sentence in vi', async () => {
    fake(ok({ tooLarge: false, folders: 0, documents: 1, relocatedCount: 1 }))
    await mount(confirm({ folderId: 'f1' }), 'vi')
    expect($('.modal')?.textContent).toContain(
      'Tài liệu của người khác trong thư mục này sẽ được trả về cho chủ sở hữu, giữ nguyên quyền truy cập.',
    )
  })
})

describe('A8 bulk trash with a folder carries the static clause, no impact calls', () => {
  const bulk = (hasFolder?: boolean) =>
    createElement(BulkTrashConfirm, {
      count: 2,
      ...(hasFolder === undefined ? {} : { hasFolder }),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    })
  let impact: ReturnType<typeof vi.fn>
  beforeEach(() => {
    impact = vi.fn()
    window.aiOffice = { uniworkArchiveImpact: impact } as unknown as HomeApi
  })

  it('adds the clause when a folder is selected', async () => {
    await mount(bulk(true))
    expect($('.modal')?.textContent).toContain(en.ufTrashRelocated)
    expect(impact).not.toHaveBeenCalled()
  })

  it.each([false, undefined])('omits it when no folder is selected (%s)', async (hasFolder) => {
    await mount(bulk(hasFolder))
    expect($('.modal')?.textContent).not.toContain(en.ufTrashRelocated)
    expect(impact).not.toHaveBeenCalled()
  })
})

describe('strings', () => {
  it('pins the vi/en wording to the web', () => {
    expect(en.ufDisabledWsFolder).toBe("A workspace folder can't be moved into My Folder")
    expect(vi_.ufDisabledWsFolder).toBe(
      'Không thể chuyển thư mục của workspace vào Thư mục của tôi',
    )
    expect(en.ufMoveOutTitle).toBe('Move this folder out to the workspace?')
    expect(en.ufMoveOutBody).toBe(
      'The folder and its name will be visible to the whole workspace; documents inside keep their own access',
    )
    expect(en.ufMoveOutConfirm).toBe('Move')
    expect(en.ufTrashRelocated).toBe(
      "Other people's documents in this folder go back to their owners, with their access unchanged.",
    )
    expect(vi_.ufMoveOutTitle).toBe('Chuyển thư mục ra workspace?')
    expect(vi_.ufMoveOutConfirm).toBe('Chuyển')
  })

  it('never says "shared folder" / "thư mục chung" or counts hidden documents, in any locale', () => {
    const keys = [
      'ufDisabledWsFolder',
      'ufMoveOutTitle',
      'ufMoveOutBody',
      'ufMoveOutConfirm',
      'ufTrashRelocated',
      'ufIntoMyFolder',
    ] as const
    for (const [lang, strings] of Object.entries(uniworkFolderStrings)) {
      for (const key of keys) {
        const text = (strings as Record<string, string>)[key]
        expect(text, `${lang}.${key}`).toBeTruthy()
        expect(text.toLowerCase(), `${lang}.${key}`).not.toMatch(/shared folder|thư mục chung/)
        expect(text, `${lang}.${key}`).not.toMatch(/\{(n|count|number)\}|\d/)
      }
    }
  })
})
