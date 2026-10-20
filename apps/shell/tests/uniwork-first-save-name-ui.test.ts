/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocActionResult,
  UniworkDocSummary,
  UniworkFirstSaveNameRequest,
  UniworkFolderNode,
  UniworkMoveResult,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { FirstSaveNameHost } from '../src/renderer/src/uniwork-folders/FirstSaveNameDialog'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'

/**
 * UNI-1959 part 4 (mirrors the web UNI-1960): the first save of a document
 * created blank from the New menu asks "Name the document" with a Location
 * row. Main pushes the request (`onUniworkFirstSaveName`) and holds the save
 * until the renderer answers (`uniworkFirstSaveNameAnswer`); the dialog renames
 * through the existing rename call and, when the folder changed, moves through
 * the existing move call, both before it answers `continue`. A refused move
 * keeps the name, says why at the dialog and answers nothing; Cancel answers
 * `cancel` (no save).
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const saveVi = uniworkSaveStrings.vi
const saveEn = uniworkSaveStrings.en
const folderVi = uniworkFolderStrings.vi

const ok = <T>(value: T) => ({ ok: true as const, value })

function node(
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...extra,
  }
}

const summary = (id: string, title: string, parentId: string | null): UniworkDocSummary => ({
  id,
  workspaceId: 'ws-1',
  title,
  format: 'docx',
  updatedAt: '2026-10-19T08:00:00Z',
  kind: 'file',
  parentId,
})

const REQUEST: UniworkFirstSaveNameRequest = {
  requestId: 'r1',
  path: 'C:\\wc\\d1\\untitled.docx',
  documentId: 'd1',
  workspaceId: 'ws-1',
  title: 'Untitled document.docx',
  parentId: 'f-mine',
}

let tree: UniworkFolderNode[]
let calls: string[]
let renameAnswer: () => Promise<UniworkDocActionResult<UniworkDocSummary>>
let moveAnswer: () => Promise<UniworkDocActionResult<UniworkMoveResult>>
let host: HTMLDivElement
let root: Root
let push: (request: UniworkFirstSaveNameRequest) => void
let dismiss: (requestId: string) => void
/** the requests the dialog host acknowledged as shown (main's delivery clock) */
let acks: string[]

function installApi() {
  let listener: ((r: UniworkFirstSaveNameRequest) => void) | null = null
  let dismissListener: ((requestId: string) => void) | null = null
  const fns = {
    onUniworkFirstSaveName: vi.fn((cb: (r: UniworkFirstSaveNameRequest) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    }),
    uniworkFirstSaveNameAnswer: vi.fn(
      async (input: { requestId: string; answer: 'continue' | 'cancel' | 'shown' }) => {
        if (input.answer === 'shown') acks.push(input.requestId)
        else calls.push(`answer:${input.requestId}:${input.answer}`)
      },
    ),
    onUniworkFirstSaveNameDismiss: vi.fn((cb: (requestId: string) => void) => {
      dismissListener = cb
      return () => {
        dismissListener = null
      }
    }),
    uniworkRenameDocument: vi.fn(async (id: string, title: string) => {
      calls.push(`rename:${id}:${title}`)
      return renameAnswer()
    }),
    uniworkMoveDocument: vi.fn(async (input: { documentId: string; parentId: string | null }) => {
      calls.push(`move:${input.documentId}:${input.parentId}`)
      return moveAnswer()
    }),
    uniworkFolderTree: vi.fn(async () => ok(tree)),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = new Proxy(fns as unknown as HomeApi, {
    get(target, prop) {
      if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined
      return undefined
    },
  })
  push = (request) => listener?.(request)
  dismiss = (requestId) => dismissListener?.(requestId)
  return fns
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}

async function render(lang: 'vi' | 'en' = 'vi') {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: lang }, createElement(FirstSaveNameHost)))
  })
  await flush()
}

async function request(next: UniworkFirstSaveNameRequest = REQUEST) {
  await act(async () => {
    push(next)
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const dialog = () => $('[role="dialog"].ufs-dialog')
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const nameInput = () => $<HTMLInputElement>('.ufs-dialog .uws-name-input')!
const save = () => click($('.ufs-dialog button[type="submit"]'))
const cancel = () => click($('.ufs-dialog .ufs-cancel'))

/** Change -> pick a folder -> confirm, the way the Move to... picker is used */
async function changeFolderTo(title: string) {
  await click($('.ufs-dialog .ufs-change'))
  expect($('.uwf-picker')).not.toBeNull()
  await click(treeItem(title))
  await click($('.uwf-picker-confirm'))
}

beforeEach(() => {
  tree = [
    node('f-mine', 'My Folder', [], { systemKind: 'my_folder' }),
    node('f-proj', 'Dự án', [node('f-proj-q4', 'Quý 4')]),
  ]
  calls = []
  acks = []
  renameAnswer = async () => ok(summary('d1', 'renamed.docx', 'f-mine'))
  moveAnswer = async () => ok({ summary: summary('d1', 'renamed.docx', 'f-proj'), renamedTo: null })
  // jsdom's localStorage is not always a full Storage here (Node's own experimental one wins)
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  installApi()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    try {
      root.unmount()
    } catch {
      // a test that unmounted the host itself
    }
  })
  host.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('UNI-1959 first save: Name the document + Location', () => {
  it('shows nothing until main pushes a request', async () => {
    await render()
    expect(dialog()).toBeNull()
  })

  it('opens with the default title without its extension, the current place and Change (vi)', async () => {
    await render('vi')
    await request()
    expect(dialog()).not.toBeNull()
    expect($('.ufs-dialog h3')?.textContent).toBe('Đặt tên tài liệu')
    expect(nameInput().value).toBe('Untitled document')
    expect($('.ufs-dialog .uws-ext')?.textContent).toBe('.docx')
    // the document sits in My Folder: its label, with the lock glyph
    expect($('.ufs-dialog .ufs-loc-label')?.textContent).toBe(folderVi.ufLocation)
    expect($('.ufs-dialog .ufs-loc-value')?.textContent).toBe('Thư mục của tôi')
    expect($('.ufs-dialog .ufs-loc-icon svg')).not.toBeNull()
    expect($('.ufs-dialog .ufs-change')?.textContent).toBe(saveVi.usChange)
    expect($('.ufs-dialog .ufs-hint')?.textContent).toBe('Bạn có thể đổi tên hoặc di chuyển sau.')
    expect($('.ufs-dialog button[type="submit"]')?.textContent).toBe(saveVi.usSave)
  })

  it('reads in English too', async () => {
    await render('en')
    await request()
    expect($('.ufs-dialog h3')?.textContent).toBe('Name the document')
    expect($('.ufs-dialog .ufs-hint')?.textContent).toBe('You can rename or move it later.')
    expect($('.ufs-dialog .ufs-change')?.textContent).toBe(saveEn.usChange)
    expect($('.ufs-dialog .ufs-loc-value')?.textContent).toBe(saveEn.usMyFolder)
  })

  it('names a folder by its path when the document is not in My Folder', async () => {
    await render('vi')
    await request({ ...REQUEST, parentId: 'f-proj-q4' })
    expect($('.ufs-dialog .ufs-loc-value')?.textContent).toContain('Quý 4')
  })

  it('Save with the name and folder unchanged sends no rename and no move, then continues', async () => {
    await render()
    await request()
    await save()
    expect(calls).toEqual(['answer:r1:continue'])
    expect(dialog()).toBeNull()
  })

  it('a new name renames with the extension re-added, then continues', async () => {
    await render()
    await request()
    await type(nameInput(), 'Báo cáo Q4')
    await save()
    expect(calls).toEqual(['rename:d1:Báo cáo Q4.docx', 'answer:r1:continue'])
    expect(dialog()).toBeNull()
  })

  it('does not double the extension when the person types it', async () => {
    await render()
    await request()
    await type(nameInput(), 'Q4.docx')
    await save()
    expect(calls[0]).toBe('rename:d1:Q4.docx')
  })

  it('Change opens the existing folder picker at the current folder, and the pick shows as the place', async () => {
    await render()
    await request()
    await click($('.ufs-dialog .ufs-change'))
    expect($('.uwf-picker')).not.toBeNull()
    // the root is never a place for a document
    await click(treeItem('Dự án'))
    await click($('.uwf-picker-confirm'))
    expect($('.uwf-picker')).toBeNull()
    expect($('.ufs-dialog .ufs-loc-value')?.textContent).toContain('Dự án')
    // choosing only changes the dialog: nothing is sent yet
    expect(calls).toEqual([])
  })

  it('a changed folder moves the document before the save continues', async () => {
    await render()
    await request()
    await changeFolderTo('Dự án')
    await save()
    expect(calls).toEqual(['move:d1:f-proj', 'answer:r1:continue'])
  })

  it('a new name and a new folder rename first, then move, then continue', async () => {
    await render()
    await request()
    await type(nameInput(), 'Kế hoạch')
    await changeFolderTo('Dự án')
    await save()
    expect(calls).toEqual(['rename:d1:Kế hoạch.docx', 'move:d1:f-proj', 'answer:r1:continue'])
  })

  it('picking the folder it is already in sends no move', async () => {
    // the picker names My Folder by its label: the English one is "My Folder"
    await render('en')
    await request()
    await changeFolderTo('My Folder')
    await save()
    expect(calls).toEqual(['answer:r1:continue'])
  })

  it('a refused move keeps the name, says why, keeps the dialog and never continues the save', async () => {
    moveAnswer = async () => ({ ok: false, error: 'forbidden' })
    await render('vi')
    await request()
    await type(nameInput(), 'Kế hoạch')
    await changeFolderTo('Dự án')
    await save()
    expect(calls).toEqual(['rename:d1:Kế hoạch.docx', 'move:d1:f-proj'])
    expect(dialog()).not.toBeNull()
    expect($('.ufs-dialog [role="alert"]')?.textContent).not.toBe('')
    expect(nameInput().value).toBe('Kế hoạch')
    expect(calls.some((c) => c.startsWith('answer'))).toBe(false)
  })

  it('retrying after a refused move does not rename again, and a good move then continues', async () => {
    moveAnswer = async () => ({ ok: false, error: 'forbidden' })
    await render()
    await request()
    await type(nameInput(), 'Kế hoạch')
    await changeFolderTo('Dự án')
    await save()
    moveAnswer = async () =>
      ok({ summary: summary('d1', 'Kế hoạch.docx', 'f-proj'), renamedTo: null })
    await save()
    expect(calls).toEqual([
      'rename:d1:Kế hoạch.docx',
      'move:d1:f-proj',
      'move:d1:f-proj',
      'answer:r1:continue',
    ])
    expect(dialog()).toBeNull()
  })

  it('a refused move can be given up with Cancel: the save does not run', async () => {
    moveAnswer = async () => ({ ok: false, error: 'forbidden' })
    await render()
    await request()
    await changeFolderTo('Dự án')
    await save()
    await cancel()
    expect(calls).toEqual(['move:d1:f-proj', 'answer:r1:cancel'])
    expect(dialog()).toBeNull()
  })

  it('a refused rename stays at the name field and moves nothing', async () => {
    renameAnswer = async () => ({ ok: false, error: 'forbidden' })
    await render()
    await request()
    await type(nameInput(), 'Kế hoạch')
    await changeFolderTo('Dự án')
    await save()
    expect(calls).toEqual(['rename:d1:Kế hoạch.docx'])
    expect(dialog()).not.toBeNull()
    expect($('.ufs-dialog [role="alert"]')?.textContent).not.toBe('')
  })

  it('an empty name is refused at the field without any call', async () => {
    await render()
    await request()
    await type(nameInput(), '   ')
    await save()
    expect(calls).toEqual([])
    expect($('.ufs-dialog [role="alert"]')?.textContent).not.toBe('')
  })

  it('Cancel answers cancel and sends neither rename nor move', async () => {
    await render()
    await request()
    await type(nameInput(), 'Kế hoạch')
    await changeFolderTo('Dự án')
    await cancel()
    expect(calls).toEqual(['answer:r1:cancel'])
    expect(dialog()).toBeNull()
  })

  it('Esc answers cancel', async () => {
    await render()
    await request()
    await act(async () => {
      $('.ufs-dialog')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await flush()
    expect(calls).toEqual(['answer:r1:cancel'])
  })

  it('a second request is a second dialog, answered with its own id', async () => {
    await render()
    await request()
    await save()
    await request({
      ...REQUEST,
      requestId: 'r2',
      documentId: 'd2',
      title: 'Tài liệu chưa đặt tên.docx',
    })
    expect(nameInput().value).toBe('Tài liệu chưa đặt tên')
    await save()
    expect(calls).toEqual(['answer:r1:continue', 'answer:r2:continue'])
  })
})

describe('UNI-1959 r2: the dialog host and the ask it holds (FE-1, BE-3, BE-4, BE-11)', () => {
  const second: UniworkFirstSaveNameRequest = {
    ...REQUEST,
    requestId: 'r2',
    documentId: 'd2',
    title: 'Tài liệu chưa đặt tên.docx',
  }

  it('acknowledges each push once, the moment it is received (main stops its delivery clock)', async () => {
    await render()
    await request()
    await request(second)
    expect(acks).toEqual(['r1', 'r2'])
  })

  it('unmounting the host answers cancel for the open ask and every queued one', async () => {
    await render()
    await request()
    await request(second)
    await act(async () => root.unmount())
    expect(calls).toEqual(['answer:r1:cancel', 'answer:r2:cancel'])
  })

  it('an ask already answered is not answered again by the unmount', async () => {
    await render()
    await request()
    await save()
    await act(async () => root.unmount())
    expect(calls).toEqual(['answer:r1:continue'])
  })

  it('a dismiss from main drops the open dialog without answering (main already settled it)', async () => {
    await render()
    await request()
    expect(dialog()).not.toBeNull()
    await act(async () => dismiss('r1'))
    await flush()
    expect(dialog()).toBeNull()
    expect(calls).toEqual([])
  })

  it('a dismiss for a queued ask removes its slot: the next dialog never shows', async () => {
    await render()
    await request()
    await request(second)
    await act(async () => dismiss('r2'))
    await flush()
    await save()
    expect(dialog()).toBeNull()
    expect(calls).toEqual(['answer:r1:continue'])
  })

  it('a dismiss of the open ask shows the queued one next', async () => {
    await render()
    await request()
    await request(second)
    await act(async () => dismiss('r1'))
    await flush()
    expect(nameInput().value).toBe('Tài liệu chưa đặt tên')
  })

  it('a dismiss for an unknown id changes nothing', async () => {
    await render()
    await request()
    await act(async () => dismiss('nope'))
    await flush()
    expect(dialog()).not.toBeNull()
  })
})
