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
  UniworkFirstSaveInput,
  UniworkFirstSaveNameRequest,
  UniworkFolderNode,
} from '../src/shared/home-api'
import type { UniworkShareApi } from '../src/shared/share-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  SaveDialogHost,
  resetFirstSavesForTests,
} from '../src/renderer/src/uniwork-folders/SaveDialog'
import { FirstSaveNameHost } from '../src/renderer/src/uniwork-folders/FirstSaveNameDialog'
import { FirstSaveShare } from '../src/renderer/src/uniwork-folders/FirstSaveShare'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { setCurrentWorkbenchBucket } from '../src/renderer/src/workbench-bucket'
import { writeActiveWorkspaceId } from '../src/renderer/src/active-workspace'
import {
  createFakeShareApi,
  type FakeShareApi,
} from '../src/renderer/src/uniwork-share/fake-share-api'

/**
 * APP-SHARE-DIALOG SD-D (card ADDENDUM 1, web UNI-2038 G4): the first-save dialogs get the web's
 * "Chia sẻ với workspace" switch. Off by default; a document that already reads as shared shows it
 * on and locked; with the switch on, the document is shared with its workspace through
 * window.uniworkShare only after the save succeeded, and a share failure never undoes the save.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const vi_ = uniworkSaveStrings.vi
const en = uniworkSaveStrings.en
const docEn = uniworkDocumentStrings.en

const TAB_PATH = 'C:\\Users\\me\\Documents\\Biên bản họp tuần 43.docx'
const WS = 'ws_1'
const DOC = 'd1'

const ok = <T>(value: T) => ({ ok: true as const, value })

function node(
  id: string,
  title: string,
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return { id, parentId: null, title, position: 0, children: [], ...extra }
}

const summary = (id: string, title: string): UniworkDocSummary => ({
  id,
  workspaceId: WS,
  title,
  format: 'docx',
  updatedAt: '2026-10-17T08:00:00Z',
  kind: 'file',
  parentId: 'mf',
})

let tabs: TabSummary[]
let calls: string[]
let firstSaveAnswer: () => Promise<UniworkDocActionResult<UniworkDocSummary>>
let renameAnswer: () => Promise<UniworkDocActionResult<UniworkDocSummary>>
let host: HTMLDivElement
let root: Root
let share: FakeShareApi
let shareChanged: Array<{ documentId: string; workspaceId: string }>
const onShareChanged = ((e: CustomEvent<{ documentId: string; workspaceId: string }>) =>
  shareChanged.push(e.detail)) as EventListener

function installApi() {
  let open: ((r: { path: string }) => void) | null = null
  let nameListener: ((r: UniworkFirstSaveNameRequest) => void) | null = null
  const fns = {
    onUniworkFirstSaveOpen: vi.fn((cb: (r: { path: string }) => void) => {
      open = cb
      return () => {
        open = null
      }
    }),
    uniworkFirstSaveOpenAck: vi.fn(async () => undefined),
    uniworkEnsureMyFolder: vi.fn(async () =>
      ok({
        ...summary('mf', 'My Folder'),
        kind: 'folder' as const,
        systemKind: 'my_folder' as const,
      }),
    ),
    uniworkFirstSave: vi.fn((input: UniworkFirstSaveInput) => {
      calls.push(`first-save:${input.title}`)
      return firstSaveAnswer()
    }),
    uniworkListWorkspaces: vi.fn(async () =>
      ok([{ id: WS, name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'org', myRole: 'member' }]),
    ),
    uniworkFolderTree: vi.fn(async () =>
      ok([node('mf', 'My Folder', { systemKind: 'my_folder' }), node('f-proj', 'Dự án')]),
    ),
    onUniworkFirstSaveName: vi.fn((cb: (r: UniworkFirstSaveNameRequest) => void) => {
      nameListener = cb
      return () => {
        nameListener = null
      }
    }),
    uniworkFirstSaveNameAnswer: vi.fn(async (input: { requestId: string; answer: string }) => {
      if (input.answer !== 'shown') calls.push(`answer:${input.answer}`)
    }),
    uniworkRenameDocument: vi.fn(
      async (id: string, title: string, options?: { shareWithWorkspace?: boolean }) => {
        calls.push(`rename:${id}:${title}${options?.shareWithWorkspace ? ':share' : ''}`)
        return renameAnswer()
      },
    ),
    uniworkMoveDocument: vi.fn(async () => ok({ summary: summary(DOC, 'x'), renamedTo: null })),
  }
  window.aiOffice = new Proxy(fns as unknown as HomeApi, {
    get(target, prop) {
      if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined
      return undefined
    },
  })
  window.aiOfficeTabs = {
    list: vi.fn(async () => tabs),
  } as unknown as typeof window.aiOfficeTabs
  return {
    push: (path: string) => open?.({ path }),
    pushName: (request: UniworkFirstSaveNameRequest) => nameListener?.(request),
  }
}

let api: ReturnType<typeof installApi>

async function flush() {
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
  })
}

async function render(lang: 'vi' | 'en' = 'vi') {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(UniworkLiveHost),
        createElement(SaveDialogHost),
        createElement(FirstSaveNameHost),
      ),
    )
  })
  await flush()
}

async function openSaveDialog() {
  await act(async () => {
    api.push(TAB_PATH)
  })
  await flush()
}

const NAME_REQUEST: UniworkFirstSaveNameRequest = {
  requestId: 'r1',
  path: 'C:\\wc\\d1\\untitled.docx',
  documentId: DOC,
  workspaceId: WS,
  title: 'Untitled document.docx',
  parentId: 'mf',
}

async function openNameDialog() {
  await act(async () => {
    api.pushName(NAME_REQUEST)
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const rowSwitch = () => $<HTMLButtonElement>('[data-testid="first-save-share"] [role="switch"]')
const rowHint = () => $('[data-testid="first-save-share"] .ufs-share-hint')
const saveButton = () => $('.uws-dialog button[type="submit"]')
const toast = () => $('.uw-act-toast')
const updates = () => share.calls.filter((c) => c.method === 'update')

beforeEach(() => {
  tabs = [
    { id: 'home', kind: 'home', title: 'Home', closable: false, active: false },
    { id: 't1', kind: 'docs', title: 'x', closable: true, active: true, filePath: TAB_PATH },
  ]
  calls = []
  shareChanged = []
  firstSaveAnswer = async () => ok(summary(DOC, 'Biên bản họp tuần 43.docx'))
  renameAnswer = async () => ok(summary(DOC, 'Biên bản họp tuần 43.docx'))
  api = installApi()
  share = createFakeShareApi({ documentId: DOC })
  ;(window as unknown as { uniworkShare: UniworkShareApi }).uniworkShare = share
  window.addEventListener('uniwork:doc-share-changed', onShareChanged)
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
  writeActiveWorkspaceId(WS)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  window.removeEventListener('uniwork:doc-share-changed', onShareChanged)
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  resetLiveForTests()
  resetFirstSavesForTests()
  setCurrentWorkbenchBucket('')
  delete (window as unknown as { uniworkShare?: unknown }).uniworkShare
})

describe('FirstSaveShare row', () => {
  const renderRow = async (props: {
    checked: boolean
    alreadyShared: boolean
    disabled?: boolean
  }) => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(FirstSaveShare, { disabled: false, onChange, ...props }),
        ),
      )
    })
    return onChange
  }

  it('is a switch named "Chia sẻ với workspace", off by default, with no hint', async () => {
    await renderRow({ checked: false, alreadyShared: false })
    const sw = rowSwitch()!
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-labelledby')).toBeTruthy()
    const label = document.getElementById(sw.getAttribute('aria-labelledby')!)
    expect(label?.textContent).toBe('Chia sẻ với workspace')
    expect(rowHint()).toBeNull()
    expect(sw.getAttribute('aria-disabled')).toBeNull()
  })

  it('turned on, it explains who can view the document (aria-describedby)', async () => {
    const onChange = await renderRow({ checked: false, alreadyShared: false })
    await click(rowSwitch())
    expect(onChange).toHaveBeenCalledWith(true)
    await renderRow({ checked: true, alreadyShared: false })
    expect(rowSwitch()!.getAttribute('aria-checked')).toBe('true')
    expect(rowHint()?.textContent).toBe('Mọi người trong workspace có thể xem tài liệu này')
    expect(rowSwitch()!.getAttribute('aria-describedby')).toBe(rowHint()!.id)
  })

  it('an already shared document shows on and locked with the "Đã chia sẻ" hint; a click changes nothing', async () => {
    const onChange = await renderRow({ checked: false, alreadyShared: true })
    const sw = rowSwitch()!
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.getAttribute('aria-disabled')).toBe('true')
    expect(rowHint()?.textContent).toBe('Đã chia sẻ với workspace')
    await click(sw)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is locked while the save runs (disabled)', async () => {
    const onChange = await renderRow({ checked: false, alreadyShared: false, disabled: true })
    expect(rowSwitch()!.getAttribute('aria-disabled')).toBe('true')
    await click(rowSwitch())
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SaveDialog (first save of a new document to UniWork)', () => {
  it('shows the switch off by default, between the location and Lưu (vi)', async () => {
    await render()
    await openSaveDialog()
    expect(rowSwitch()?.getAttribute('aria-checked')).toBe('false')
    expect(rowHint()).toBeNull()
    const loc = $('.uws-loc')!
    const row = $('[data-testid="first-save-share"]')!
    expect(loc.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      row.compareDocumentPosition(saveButton()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('reads in English too', async () => {
    await render('en')
    await openSaveDialog()
    expect($('[data-testid="first-save-share"]')?.textContent).toContain(en.usShareToggle)
    await click(rowSwitch())
    expect(rowHint()?.textContent).toBe(en.usShareHint)
  })

  it('Lưu with the switch off never touches the share API', async () => {
    await render()
    await openSaveDialog()
    await click(saveButton())
    expect(calls).toEqual(['first-save:Biên bản họp tuần 43.docx'])
    expect(share.calls).toEqual([])
    expect($('.uws-dialog')).toBeNull()
  })

  it('Lưu with the switch on sends the web PATCH (title + visibility) AFTER the save succeeded, not a Share API write', async () => {
    await render()
    await openSaveDialog()
    await click(rowSwitch())
    expect(rowSwitch()!.getAttribute('aria-checked')).toBe('true')
    await click(saveButton())
    expect(calls).toEqual([
      'first-save:Biên bản họp tuần 43.docx',
      `rename:${DOC}:Biên bản họp tuần 43.docx:share`,
    ])
    expect(updates()).toEqual([])
    expect($('.uws-dialog')).toBeNull()
    expect(toast()).toBeNull()
    // the lists that show the row learn that its share scope changed
    expect(shareChanged).toEqual([{ documentId: DOC, workspaceId: WS }])
  })

  it('a refused save shares nothing and keeps the dialog with its switch', async () => {
    firstSaveAnswer = async () => ({ ok: false, error: 'invalid_destination' })
    await render()
    await openSaveDialog()
    await click(rowSwitch())
    await click(saveButton())
    expect(calls).toEqual(['first-save:Biên bản họp tuần 43.docx'])
    expect($('.uws-dialog')).not.toBeNull()
    expect(rowSwitch()?.getAttribute('aria-checked')).toBe('true')
  })

  it('a share failure keeps the saved document, closes the dialog and says so at a toast with the web copy', async () => {
    renameAnswer = async () => ({ ok: false, error: 'server_error' })
    await render()
    await openSaveDialog()
    await click(rowSwitch())
    await click(saveButton())
    expect($('.uws-dialog')).toBeNull()
    expect(calls).toEqual([
      'first-save:Biên bản họp tuần 43.docx',
      `rename:${DOC}:Biên bản họp tuần 43.docx:share`,
    ])
    const t = toast()!
    expect(t.getAttribute('role')).toBe('alert')
    expect(t.textContent).toContain('Không chia sẻ được. Kiểm tra lại đối tượng và mức quyền.')
    expect(shareChanged).toEqual([])
  })

  it("a share failure that is a permission refusal uses the app's own forbidden sentence", async () => {
    renameAnswer = async () => ({ ok: false, error: 'forbidden' })
    await render('en')
    await openSaveDialog()
    await click(rowSwitch())
    await click(saveButton())
    expect(toast()?.textContent).toContain(docEn.uwErrForbidden)
  })

  it('a bridge that throws is a failed share, the save still stands', async () => {
    renameAnswer = async () => {
      throw new Error('ipc gone')
    }
    await render()
    await openSaveDialog()
    await click(rowSwitch())
    await click(saveButton())
    expect($('.uws-dialog')).toBeNull()
    expect(toast()?.textContent).toContain('Không chia sẻ được')
    expect(shareChanged).toEqual([])
  })

  it('the share row of a new document is never locked as "already shared"', async () => {
    await render()
    await openSaveDialog()
    expect(rowSwitch()?.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('FirstSaveNameDialog (a blank document from the New menu, the web first-save dialog)', () => {
  /** the fake document starts shared with its home workspace: take that grant away */
  const makePrivate = async () => {
    await share.update({
      documentId: DOC,
      items: [{ principalType: 'workspace', principalId: WS, level: null }],
    })
    share.calls.length = 0
    calls.length = 0
  }

  it('a private document shows the switch off; with it on, Lưu sends ONE rename+share PATCH, then continues', async () => {
    await makePrivate()
    await render()
    await openNameDialog()
    await vi.waitFor(() => expect(rowSwitch()).not.toBeNull())
    expect(rowSwitch()!.getAttribute('aria-checked')).toBe('false')
    await click(rowSwitch())
    await click($('.ufs-dialog button[type="submit"]'))
    expect(share.calls.map((c) => c.method)).toEqual(['get'])
    expect(calls).toEqual([`rename:${DOC}:Untitled document.docx:share`, 'answer:continue'])
    expect(shareChanged).toEqual([{ documentId: DOC, workspaceId: WS }])
  })

  it('a document already shared with the workspace shows it on and locked and sends no share call', async () => {
    await act(async () => {
      await share.update({
        documentId: DOC,
        items: [{ principalType: 'workspace', principalId: WS, level: 'view' }],
      })
    })
    share.calls.length = 0
    calls.length = 0
    await render()
    await openNameDialog()
    await vi.waitFor(() => expect(rowSwitch()?.getAttribute('aria-checked')).toBe('true'))
    expect(rowSwitch()!.getAttribute('aria-disabled')).toBe('true')
    expect(rowHint()?.textContent).toBe(vi_.usShareAlready)
    await click($('.ufs-dialog button[type="submit"]'))
    expect(calls).toEqual(['answer:continue'])
    expect(shareChanged).toEqual([])
  })

  it('a person who cannot manage the document gets no switch (the web shows it for manage only)', async () => {
    share = createFakeShareApi({ documentId: DOC, myLevel: 'edit' })
    ;(window as unknown as { uniworkShare: UniworkShareApi }).uniworkShare = share
    await render()
    await openNameDialog()
    await flush()
    expect($('.ufs-dialog')).not.toBeNull()
    expect(rowSwitch()).toBeNull()
  })

  it('a share failure keeps the dialog open at its error line (like a refused move) and never continues', async () => {
    await makePrivate()
    await render()
    await openNameDialog()
    await vi.waitFor(() => expect(rowSwitch()).not.toBeNull())
    renameAnswer = async () => ({ ok: false, error: 'server_error' })
    await click(rowSwitch())
    await click($('.ufs-dialog button[type="submit"]'))
    expect($('.ufs-dialog')).not.toBeNull()
    expect($('.ufs-dialog [role="alert"]')?.textContent).toContain(
      'Không chia sẻ được. Kiểm tra lại đối tượng và mức quyền.',
    )
    expect(calls.some((c) => c.startsWith('answer:'))).toBe(false)
    // a retry sends the PATCH again, then continues
    renameAnswer = async () => ok(summary(DOC, 'Untitled document.docx'))
    await click($('.ufs-dialog button[type="submit"]'))
    expect(calls.filter((c) => c.endsWith(':share'))).toHaveLength(2)
    expect(calls.at(-1)).toBe('answer:continue')
    expect(shareChanged).toEqual([{ documentId: DOC, workspaceId: WS }])
  })

  it('a retry after a refused move does not send the share again', async () => {
    await makePrivate()
    await render()
    await openNameDialog()
    await vi.waitFor(() => expect(rowSwitch()).not.toBeNull())
    await click(rowSwitch())
    ;(window.aiOffice.uniworkMoveDocument as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'forbidden',
    })
    await click($('.ufs-dialog .ufs-change'))
    await click($$('[role="treeitem"]').find((el) => el.textContent?.includes('Dự án')))
    await click($('.uwf-picker-confirm'))
    await click($('.ufs-dialog button[type="submit"]'))
    expect($('.ufs-dialog')).not.toBeNull()
    expect(calls.filter((c) => c.endsWith(':share'))).toHaveLength(1)
    await click($('.ufs-dialog button[type="submit"]'))
    expect(calls.filter((c) => c.endsWith(':share'))).toHaveLength(1)
    expect(calls.at(-1)).toBe('answer:continue')
  })

  it('with the switch off no share write happens', async () => {
    await makePrivate()
    await render()
    await openNameDialog()
    await vi.waitFor(() => expect(rowSwitch()).not.toBeNull())
    await click($('.ufs-dialog button[type="submit"]'))
    expect(calls).toEqual(['answer:continue'])
  })
})
