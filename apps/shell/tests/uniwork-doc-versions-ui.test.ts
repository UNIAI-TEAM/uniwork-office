/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { VersionHistorySheet } from '../src/renderer/src/uniwork-doc-history/VersionHistorySheet'
import {
  canWriteVersions,
  pageText,
  versionsEntryAllowed,
  type VersionHistoryTarget,
} from '../src/renderer/src/uniwork-doc-history/version-history-model'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkVersionStrings } from '../src/renderer/src/i18n/strings-uniwork-versions'
import {
  createFakeDocHistoryBridge,
  failure,
  versionOf,
  type FakeDocHistoryBridge,
} from './doc-history-fake-bridge'

/**
 * UNI-2077 UI-V: the Version history sheet. Gates (who may create / restore), the loading /
 * empty / error / paging states, the named checkpoint, the restore with its confirm and the
 * edit-lock refusal, the preview and the download, all against the fake bridge.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkVersionStrings.en as Record<string, string>
const viText = uniworkVersionStrings.vi as Record<string, string>
const t = (key: string, params?: Record<string, string | number>, table = en) =>
  (table[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) =>
    params && n in params ? String(params[n]) : w,
  )

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const target = (partial: Partial<VersionHistoryTarget> = {}): VersionHistoryTarget => ({
  id: 'doc-1',
  workspaceId: 'ws-1',
  title: 'Báo cáo.docx',
  kind: 'file',
  myLevel: 'edit',
  ...partial,
})

describe('version history gates (model)', () => {
  it('create / restore need edit or manage and no shelf', () => {
    expect(canWriteVersions(target({ myLevel: 'edit' }))).toBe(true)
    expect(canWriteVersions(target({ myLevel: 'manage' }))).toBe(true)
    expect(canWriteVersions(target({ myLevel: 'comment' }))).toBe(false)
    expect(canWriteVersions(target({ myLevel: 'view' }))).toBe(false)
    expect(canWriteVersions(target({ myLevel: undefined }))).toBe(false)
    expect(canWriteVersions(target({ myLevel: 'manage', shelvedAt: '2026-10-01T00:00:00Z' }))).toBe(
      false,
    )
    expect(canWriteVersions(target({ myLevel: 'manage', archived: true }))).toBe(false)
  })

  it('every reader of a file or page has the entry; folders and the trash do not', () => {
    expect(versionsEntryAllowed(target({ myLevel: 'view' }))).toBe(true)
    expect(versionsEntryAllowed(target({ kind: 'page', myLevel: 'view' }))).toBe(true)
    expect(versionsEntryAllowed(target({ kind: 'folder' }))).toBe(false)
    expect(versionsEntryAllowed(target({ archived: true }))).toBe(false)
    expect(versionsEntryAllowed(target({ shelvedAt: '2026-10-01T00:00:00Z' }))).toBe(true)
  })

  it('a page version reads as its paragraphs', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Tiêu đề' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Một ' },
            { type: 'text', text: 'dòng', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'paragraph' },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ý một' }] }],
            },
          ],
        },
      ],
    }
    expect(pageText(content)).toBe('Tiêu đề\nMột dòng\ný một')
    expect(pageText(null)).toBe('')
    expect(pageText({ type: 'doc', content: [] })).toBe('')
    expect(pageText('nope')).toBe('')
  })
})

describe('VersionHistorySheet (UNI-2077 UI-V)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>
  let onChanged: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
    onChanged = vi.fn()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  const minh = { created_by: 'u_minh', created_by_kind: 'human' }
  const threeVersions = () => [
    versionOf({ id: 'v3', version: 3, label: 'Trước review', ...minh }),
    versionOf({
      id: 'v2',
      version: 2,
      reason: 'auto',
      created_by: 'sys',
      created_by_kind: 'system',
    }),
    versionOf({
      id: 'v1',
      version: 1,
      reason: 'upload',
      size_bytes: 0,
      created_by: 'u_gone',
      created_by_kind: 'human',
    }),
  ]

  async function open(
    row: VersionHistoryTarget = target(),
    bridge: FakeDocHistoryBridge = createFakeDocHistoryBridge({ versions: threeVersions() }),
    lang: 'en' | 'vi' = 'en',
  ): Promise<FakeDocHistoryBridge> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(VersionHistorySheet, {
            open: true,
            onClose,
            onChanged,
            row,
            bridge,
            shareApi: createFakeShareApi(),
          }),
        ),
      )
    })
    await flush()
    return bridge
  }

  const dialogs = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="dialog"]'))
  const sheet = () => dialogs()[0]!
  const top = () => dialogs()[dialogs().length - 1]!
  const rows = () => Array.from(sheet().querySelectorAll<HTMLElement>('[data-version-row]'))
  const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
    )
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const viewButton = (no: number) => button(sheet(), t('vhsPreviewTitle', { no }))
  const labelInput = () => sheet().querySelector<HTMLInputElement>('input[type="text"]')!
  const submitForm = async () => {
    await act(async () => {
      sheet()
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
  }

  describe('the list', () => {
    it('is a labelled dialog with the title and the description', async () => {
      await open()
      expect(sheet().getAttribute('aria-modal')).toBe('true')
      const title = document.getElementById(sheet().getAttribute('aria-labelledby')!)
      expect(title?.textContent).toBe(t('vhsTitle'))
      expect(sheet().textContent).toContain(t('vhsDescription'))
    })

    it('shows the loading state, then the rows newest first', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      let release: () => void = () => {}
      bridge.versions.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ ok: true, value: { versions: threeVersions(), next_cursor: null } })
          }),
      )
      await open(target(), bridge)
      expect(sheet().textContent).toContain(t('vhsLoading'))
      expect(sheet().querySelector('[aria-busy="true"]')).not.toBeNull()
      await act(async () => release())
      await flush()
      expect(rows().map((r) => r.getAttribute('data-version-row'))).toEqual(['3', '2', '1'])
      expect(bridge.versions).toHaveBeenCalledWith({ documentId: 'doc-1' })
    })

    it('a row has the version, its name, the reason, the size, the time and the author', async () => {
      await open()
      const first = rows()[0]!
      expect(first.textContent).toContain(t('vhsRowVersion', { no: 3 }))
      expect(first.textContent).toContain('Trước review')
      expect(first.textContent).toContain(t('vhsReasonManual'))
      expect(first.textContent).toContain('24 KB')
      expect(first.textContent).toContain('Minh Trần')
      expect(first.querySelector('time')?.getAttribute('datetime')).toBe('2099-01-02T03:04:05Z')
      // the newest row is the current one, and only that row
      expect(first.textContent).toContain(t('vhsCurrentBadge'))
      expect(rows()[1]!.textContent).not.toContain(t('vhsCurrentBadge'))
    })

    it('reads the reason, a system author and a former member the way the web does', async () => {
      await open()
      expect(rows()[1]!.textContent).toContain(t('vhsReasonAuto'))
      expect(rows()[1]!.textContent).toContain(t('vhsAuthorSystem'))
      expect(rows()[2]!.textContent).toContain(t('vhsReasonUpload'))
      expect(rows()[2]!.textContent).toContain(t('vhsAuthorFormer'))
      // a size of 0 draws nothing
      expect(rows()[2]!.textContent).not.toMatch(/\d\s?KB/)
    })

    it('an unknown reason reads as other, never as a broken row', async () => {
      await open(
        target(),
        createFakeDocHistoryBridge({ versions: [versionOf({ reason: 'imported-by-robot' })] }),
      )
      expect(rows()[0]!.textContent).toContain(t('vhsReasonUnknown'))
    })

    it('an agent that is not a member keeps its badge and does not read Agent twice', async () => {
      await open(
        target(),
        createFakeDocHistoryBridge({
          versions: [versionOf({ created_by: 'agent_x', created_by_kind: 'agent' })],
        }),
      )
      const author = rows()[0]!.querySelector('[data-testid="version-author"]')!
      expect(author.textContent).toBe(t('vhsAuthorAgent'))
      expect(author.querySelector('.uw-versions-author-name')).toBeNull()
    })

    it('an old row with no author draws no author line', async () => {
      await open(
        target(),
        createFakeDocHistoryBridge({
          versions: [versionOf({ created_by: '', created_by_kind: 'system' })],
        }),
      )
      expect(rows()[0]!.querySelector('[data-testid="version-author"]')).toBeNull()
    })

    it('waits for the member list before it names an author', async () => {
      const share = createFakeShareApi()
      let release: () => void = () => {}
      const members = share.members.bind(share)
      share.members = () =>
        new Promise((resolve) => {
          release = () => void members({}).then(resolve)
        })
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(VersionHistorySheet, {
              open: true,
              onClose,
              row: target(),
              bridge: createFakeDocHistoryBridge({ versions: threeVersions() }),
              shareApi: share,
            }),
          ),
        )
      })
      await flush()
      expect(rows()[0]!.textContent).not.toContain('Minh Trần')
      expect(rows()[0]!.textContent).not.toContain(t('vhsAuthorFormer'))
      await act(async () => release())
      await flush()
      expect(rows()[0]!.textContent).toContain('Minh Trần')
    })

    it('an empty history says so', async () => {
      await open(target(), createFakeDocHistoryBridge({ versions: [] }))
      expect(rows()).toHaveLength(0)
      expect(sheet().textContent).toContain(t('vhsEmpty'))
    })

    it('a failed load says so and Retry reads the list again', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.versions.mockResolvedValueOnce(failure('network'))
      await open(target(), bridge)
      const alert = sheet().querySelector('[role="alert"]')
      expect(alert?.textContent).toContain(t('vhsError'))
      await click(button(sheet(), t('vhsRetry')))
      expect(bridge.versions).toHaveBeenCalledTimes(2)
      expect(rows()).toHaveLength(3)
      expect(sheet().querySelector('[role="alert"]')).toBeNull()
    })

    it('pages: Load more appends the next page with the cursor', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.versions
        .mockResolvedValueOnce({
          ok: true,
          value: {
            versions: [versionOf({ id: 'v3', version: 3 }), versionOf({ id: 'v2', version: 2 })],
            next_cursor: 'c1',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { versions: [versionOf({ id: 'v1', version: 1 })], next_cursor: null },
        })
      await open(target(), bridge)
      expect(rows()).toHaveLength(2)
      await click(button(sheet(), t('vhsLoadMore')))
      expect(bridge.versions).toHaveBeenLastCalledWith({ documentId: 'doc-1', cursor: 'c1' })
      expect(rows()).toHaveLength(3)
      expect(button(sheet(), t('vhsLoadMore'))).toBeUndefined()
    })

    it('a checkpoint reload is not cancelled by Load more, and the new row shows', async () => {
      const bridge = createFakeDocHistoryBridge()
      const page1 = [versionOf({ id: 'v3', version: 3 }), versionOf({ id: 'v2', version: 2 })]
      let release: () => void = () => {}
      bridge.versions
        .mockResolvedValueOnce({ ok: true, value: { versions: page1, next_cursor: 'c1' } })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () =>
                resolve({
                  ok: true,
                  value: {
                    versions: [versionOf({ id: 'v4', version: 4 }), ...page1],
                    next_cursor: 'c1',
                  },
                })
            }),
        )
      await open(target(), bridge)
      await submitForm()
      // the reload is pending: Load more waits for it instead of overtaking it
      await click(button(sheet(), t('vhsLoadMore')))
      expect(bridge.versions).toHaveBeenCalledTimes(2)
      await act(async () => release())
      await flush()
      expect(rows().map((r) => r.getAttribute('data-version-row'))).toEqual(['4', '3', '2'])
    })

    it('a page read in flight is dropped when a reload lands, so the list never mixes pages', async () => {
      const bridge = createFakeDocHistoryBridge()
      const page1 = [versionOf({ id: 'v3', version: 3 }), versionOf({ id: 'v2', version: 2 })]
      let releaseMore: () => void = () => {}
      bridge.versions
        .mockResolvedValueOnce({ ok: true, value: { versions: page1, next_cursor: 'c1' } })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseMore = () =>
                resolve({
                  ok: true,
                  value: { versions: [versionOf({ id: 'v1', version: 1 })], next_cursor: null },
                })
            }),
        )
        .mockResolvedValueOnce({
          ok: true,
          value: {
            versions: [versionOf({ id: 'v4', version: 4 }), ...page1],
            next_cursor: 'c2',
          },
        })
      await open(target(), bridge)
      await click(button(sheet(), t('vhsLoadMore')))
      await submitForm()
      await act(async () => releaseMore())
      await flush()
      expect(rows().map((r) => r.getAttribute('data-version-row'))).toEqual(['4', '3', '2'])
      expect(button(sheet(), t('vhsLoadMore'))).toBeDefined()
    })

    it('the last page moves the focus to its first row instead of dropping it to the body', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.versions
        .mockResolvedValueOnce({
          ok: true,
          value: { versions: [versionOf({ id: 'v3', version: 3 })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            versions: [versionOf({ id: 'v2', version: 2 }), versionOf({ id: 'v1', version: 1 })],
            next_cursor: null,
          },
        })
      await open(target(), bridge)
      const more = button(sheet(), t('vhsLoadMore')) as HTMLButtonElement
      more.focus()
      await click(more)
      expect(button(sheet(), t('vhsLoadMore'))).toBeUndefined()
      expect(document.activeElement).toBe(rows()[1])
      expect(rows()[1]!.getAttribute('data-version-row')).toBe('2')
    })

    it('a failed page keeps the rows and offers the same button again', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.versions
        .mockResolvedValueOnce({
          ok: true,
          value: { versions: [versionOf({ id: 'v2', version: 2 })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce(failure('timeout'))
      await open(target(), bridge)
      await click(button(sheet(), t('vhsLoadMore')))
      expect(rows()).toHaveLength(1)
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsError'))
      expect(button(sheet(), t('vhsLoadMore'))).toBeDefined()
    })

    it('Close and Escape leave the sheet', async () => {
      await open()
      await click(button(sheet(), t('vhsClose')))
      expect(onClose).toHaveBeenCalledTimes(1)
      await act(async () => {
        sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('speaks Vietnamese verbatim from the web', async () => {
      await open(target(), undefined, 'vi')
      expect(sheet().textContent).toContain('Lịch sử phiên bản')
      expect(rows()[0]!.textContent).toContain('Phiên bản 3')
      expect(rows()[0]!.textContent).toContain('mốc thủ công')
      expect(rows()[0]!.textContent).toContain(viText.vhsCurrentBadge)
    })
  })

  describe('who may write', () => {
    it('an editor gets the checkpoint form and a restore button per row', async () => {
      await open(target({ myLevel: 'edit' }))
      expect(sheet().querySelector('form')).not.toBeNull()
      expect(button(sheet(), t('vhsRestore', { no: 3 }))).toBeDefined()
      expect(button(sheet(), t('vhsRestore', { no: 1 }))).toBeDefined()
      expect(sheet().textContent).not.toContain(t('vhsManageOnly'))
    })

    it('a viewer reads the history and is told why there is no write', async () => {
      await open(target({ myLevel: 'view' }))
      expect(rows()).toHaveLength(3)
      expect(sheet().querySelector('form')).toBeNull()
      expect(button(sheet(), t('vhsRestore', { no: 3 }))).toBeUndefined()
      expect(sheet().textContent).toContain(t('vhsManageOnly'))
      // downloads stay available to a reader
      expect(button(sheet(), t('vhsDownloadVersion', { no: 3 }))).toBeDefined()
    })

    it('a shelved document keeps its history readable and says it is archived', async () => {
      await open(target({ myLevel: 'manage', shelvedAt: '2026-10-01T00:00:00Z' }))
      expect(rows()).toHaveLength(3)
      expect(sheet().querySelector('form')).toBeNull()
      expect(button(sheet(), t('vhsRestore', { no: 3 }))).toBeUndefined()
      expect(sheet().textContent).toContain(t('vhsShelvedBlocked'))
      expect(sheet().textContent).not.toContain(t('vhsManageOnly'))
    })
  })

  describe('a named checkpoint', () => {
    it('sends the trimmed name with one key, refreshes the list and clears the field', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      await open(target(), bridge)
      await typeInto(labelInput(), '  Bản gửi khách  ')
      await submitForm()
      expect(bridge.createVersion).toHaveBeenCalledTimes(1)
      const call = bridge.createVersion.mock.calls[0]![0]
      expect(call.documentId).toBe('doc-1')
      expect(call.label).toBe('Bản gửi khách')
      expect(call.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
      expect(bridge.versions).toHaveBeenCalledTimes(2)
      expect(labelInput().value).toBe('')
      expect(sheet().querySelector('[role="status"]')?.textContent).toBe(
        t('vhsNameDone', { no: 4 }),
      )
      expect(onChanged).toHaveBeenCalled()
    })

    it('an empty name still creates a checkpoint, with no label', async () => {
      const bridge = await open()
      await submitForm()
      expect(bridge.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', label: undefined }),
      )
    })

    it('a failure keeps the name and a retry of the same name reuses the key', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.createVersion.mockResolvedValueOnce(failure('network'))
      await open(target(), bridge)
      await typeInto(labelInput(), 'Mốc A')
      await submitForm()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsNameFailed'))
      expect(labelInput().value).toBe('Mốc A')
      await submitForm()
      const [first, second] = bridge.createVersion.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).toBe(first)
      expect(sheet().querySelector('[role="alert"]')).toBeNull()
    })

    it('a changed name is a new intent with a new key', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.createVersion.mockResolvedValueOnce(failure('network'))
      await open(target(), bridge)
      await typeInto(labelInput(), 'Mốc A')
      await submitForm()
      await typeInto(labelInput(), 'Mốc B')
      expect(sheet().querySelector('[role="alert"]')).toBeNull()
      await submitForm()
      const [first, second] = bridge.createVersion.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).not.toBe(first)
    })

    it('says so when nothing changed since the newest version', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.createVersion.mockResolvedValueOnce(failure('version_unchanged', { status: 409 }))
      await open(target(), bridge)
      await submitForm()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsNameUnchanged'))
    })

    it('a shelved refusal reads as archived, a forbidden one as needing edit', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.createVersion.mockResolvedValueOnce(failure('document_shelved', { status: 409 }))
      await open(target(), bridge)
      await submitForm()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsShelvedBlocked'))
      bridge.createVersion.mockResolvedValueOnce(failure('forbidden', { status: 403 }))
      await submitForm()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsManageOnly'))
    })

    it('the field takes at most 200 characters and the button is busy while it waits', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      let release: () => void = () => {}
      bridge.createVersion.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, value: versionOf({ version: 4 }) })
          }),
      )
      await open(target(), bridge)
      expect(labelInput().maxLength).toBe(200)
      await submitForm()
      const submit = sheet().querySelector<HTMLButtonElement>('form button[type="submit"]')!
      expect(submit.disabled).toBe(true)
      expect(submit.getAttribute('aria-busy')).toBe('true')
      expect(submit.textContent).toContain(t('vhsNameSubmitting'))
      await act(async () => release())
      await flush()
      expect(submit.disabled).toBe(false)
    })
  })

  describe('restore', () => {
    const restoreButton = (no: number) => button(sheet(), t('vhsRestore', { no }))
    const confirmButton = () => button(top(), t('vhsRestoreConfirmSubmit'))

    it('asks first, with the web wording, and nothing is sent until confirmed', async () => {
      const bridge = await open()
      await click(restoreButton(2))
      expect(dialogs()).toHaveLength(2)
      expect(top().textContent).toContain(t('vhsRestoreConfirmTitle', { no: 2 }))
      expect(top().textContent).toContain(t('vhsRestoreConfirmDescription'))
      expect(bridge.restore).not.toHaveBeenCalled()
      await click(button(top(), t('vhsCancel')))
      expect(dialogs()).toHaveLength(1)
      expect(bridge.restore).not.toHaveBeenCalled()
    })

    it('Escape closes only the confirm, not the sheet', async () => {
      await open()
      await click(restoreButton(2))
      await act(async () => {
        top().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(dialogs()).toHaveLength(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('confirm restores that version with one key, closes the confirm and refreshes', async () => {
      const bridge = await open()
      await click(restoreButton(2))
      await click(confirmButton())
      expect(bridge.restore).toHaveBeenCalledTimes(1)
      const call = bridge.restore.mock.calls[0]![0]
      expect(call.documentId).toBe('doc-1')
      expect(call.versionNo).toBe(2)
      expect(call.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
      // the app's rows carry no revision: main picks the base
      expect(call.baseRevision).toBeUndefined()
      expect(dialogs()).toHaveLength(1)
      expect(bridge.versions).toHaveBeenCalledTimes(2)
      expect(onChanged).toHaveBeenCalled()
    })

    it('shows the restoring state and cannot be cancelled while it waits', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      let release: () => void = () => {}
      bridge.restore.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                ok: true,
                value: {
                  document: {
                    id: 'doc-1',
                    kind: 'file',
                    title: 'a',
                    revision: '9',
                    current_version: 4,
                  },
                  version: versionOf({ version: 4, reason: 'restore', restored_from: 2 }),
                },
              })
          }),
      )
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().textContent).toContain(t('vhsRestoreSubmitting'))
      expect(button(top(), t('vhsCancel'))!.hasAttribute('disabled')).toBe(true)
      await act(async () => release())
      await flush()
      expect(dialogs()).toHaveLength(1)
    })

    it('an edit lock held by someone else keeps the confirm open with the lock sentence and a new key next time', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(
        failure('edit_locked', {
          status: 423,
          editLock: { holderName: 'Minh', since: null, expiresAt: null, heldByMe: false },
        }),
      )
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(dialogs()).toHaveLength(2)
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsLockedByOther'))
      await click(confirmButton())
      const [first, second] = bridge.restore.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).not.toBe(first)
      expect(dialogs()).toHaveLength(1)
    })

    it('a lock the same person holds in another window has its own sentence', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(
        failure('edit_locked', {
          status: 423,
          editLock: { holderName: 'Tôi', since: null, expiresAt: null, heldByMe: true },
        }),
      )
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsLockedByMe'))
    })

    it('a stale base says the copy just changed and starts a new intent', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(
        failure('conflict', { status: 409, currentRevision: '42' }),
      )
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsRestoreConflict'))
      await click(confirmButton())
      const [first, second] = bridge.restore.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).not.toBe(first)
    })

    it('a lost edit lock says it could not restore and the retry mints a new key', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(failure('edit_lock_lost', { status: 409 }))
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsRestoreFailed'))
      await click(confirmButton())
      const [first, second] = bridge.restore.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).not.toBe(first)
    })

    it('a restore clears the success line of an earlier checkpoint', async () => {
      const bridge = await open()
      await submitForm()
      expect(sheet().querySelector('[role="status"]')?.textContent).toBe(t('vhsNameDone', { no: 4 }))
      await click(restoreButton(2))
      await click(confirmButton())
      expect(sheet().querySelector('[role="status"]')).toBeNull()
      expect(bridge.restore).toHaveBeenCalledTimes(1)
    })

    it('any other failure says it could not restore and a retry keeps the key', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(failure('network'))
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsRestoreFailed'))
      await click(confirmButton())
      const [first, second] = bridge.restore.mock.calls.map((c) => c[0].idempotencyKey)
      expect(second).toBe(first)
    })

    it('a shelved refusal reads as archived and a 403 as needing edit', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.restore.mockResolvedValueOnce(failure('document_shelved', { status: 409 }))
      await open(target(), bridge)
      await click(restoreButton(2))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsShelvedBlocked'))
      bridge.restore.mockResolvedValueOnce(failure('forbidden', { status: 403 }))
      await click(confirmButton())
      expect(top().querySelector('[role="alert"]')?.textContent).toBe(t('vhsManageOnly'))
    })

    it('a restore moves the current badge to the new version', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      await open(target(), bridge)
      bridge.versions.mockResolvedValueOnce({
        ok: true,
        value: {
          versions: [
            versionOf({ id: 'v4', version: 4, reason: 'restore', restored_from: 2 }),
            ...threeVersions(),
          ],
          next_cursor: null,
        },
      })
      await click(restoreButton(2))
      await click(confirmButton())
      expect(rows()[0]!.getAttribute('data-version-row')).toBe('4')
      expect(rows()[0]!.textContent).toContain(t('vhsCurrentBadge'))
      expect(rows()[1]!.textContent).not.toContain(t('vhsCurrentBadge'))
    })
  })

  describe('preview and download', () => {
    it('a file version opens its read-only copy in a tab and the sheet closes to show it', async () => {
      const bridge = await open()
      await click(viewButton(3))
      expect(bridge.openVersion).toHaveBeenCalledWith({ documentId: 'doc-1', versionNo: 3 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('every row names its own View button by version', async () => {
      await open()
      for (const no of [3, 2, 1]) {
        expect(viewButton(no)?.getAttribute('aria-label')).toBe(t('vhsPreviewTitle', { no }))
      }
    })

    it('a version the app cannot open says so and points at the download', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.openVersion.mockResolvedValueOnce(failure('unsupported_format'))
      await open(target(), bridge)
      await click(viewButton(3))
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(
        t('vhsOpenUnsupported'),
      )
    })

    it('another failure to open reads as the preview error', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.openVersion.mockResolvedValueOnce(failure('network'))
      await open(target(), bridge)
      await click(viewButton(3))
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsPreviewError'))
    })

    it('a page version shows its text in a read-only dialog', async () => {
      const bridge = createFakeDocHistoryBridge({
        versions: [versionOf({ id: 'v1', version: 1, kind: 'page', file_id: null })],
      })
      bridge.version.mockResolvedValueOnce({
        ok: true,
        value: versionOf({
          version: 1,
          kind: 'page',
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung cũ' }] }],
          },
        }),
      })
      await open(target({ kind: 'page' }), bridge)
      await click(viewButton(1))
      expect(bridge.version).toHaveBeenCalledWith({ documentId: 'doc-1', versionNo: 1 })
      expect(bridge.openVersion).not.toHaveBeenCalled()
      expect(top().textContent).toContain(t('vhsPreviewTitle', { no: 1 }))
      expect(top().textContent).toContain('Nội dung cũ')
      expect(top().querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
      await click(button(top(), t('vhsClose')))
      expect(dialogs()).toHaveLength(1)
    })

    it('a page version with no content, and one that fails to load, say so', async () => {
      const bridge = createFakeDocHistoryBridge({
        versions: [versionOf({ version: 1, kind: 'page', file_id: null })],
      })
      bridge.version.mockResolvedValueOnce({
        ok: true,
        value: versionOf({ version: 1, kind: 'page', content: { type: 'doc', content: [] } }),
      })
      await open(target({ kind: 'page' }), bridge)
      await click(viewButton(1))
      expect(top().textContent).toContain(t('vhsPreviewEmpty'))
      await click(button(top(), t('vhsClose')))
      bridge.version.mockResolvedValueOnce(failure('network'))
      await click(viewButton(1))
      expect(top().querySelector('[role="alert"]')?.textContent).toContain(t('vhsPreviewError'))
    })

    it('a file version downloads under the document name; a page has no download', async () => {
      const bridge = await open()
      await click(button(sheet(), t('vhsDownloadVersion', { no: 2 })))
      expect(bridge.downloadVersion).toHaveBeenCalledWith({
        documentId: 'doc-1',
        versionNo: 2,
        suggestedName: 'Báo cáo.docx',
      })
      expect(sheet().querySelector('[role="alert"]')).toBeNull()
    })

    it('a cancelled save dialog is silent, any other failure says so', async () => {
      const bridge = createFakeDocHistoryBridge({ versions: threeVersions() })
      bridge.downloadVersion.mockResolvedValueOnce(failure('dialog_canceled'))
      await open(target(), bridge)
      await click(button(sheet(), t('vhsDownloadVersion', { no: 3 })))
      expect(sheet().querySelector('[role="alert"]')).toBeNull()
      bridge.downloadVersion.mockResolvedValueOnce(failure('write_failed'))
      await click(button(sheet(), t('vhsDownloadVersion', { no: 3 })))
      expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(t('vhsDownloadFailed'))
    })

    it('a page document offers no download', async () => {
      await open(
        target({ kind: 'page' }),
        createFakeDocHistoryBridge({ versions: [versionOf({ kind: 'page', file_id: null })] }),
      )
      expect(button(sheet(), t('vhsDownloadVersion', { no: 3 }))).toBeUndefined()
    })
  })
})
