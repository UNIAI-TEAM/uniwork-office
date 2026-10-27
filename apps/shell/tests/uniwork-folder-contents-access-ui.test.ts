/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { FolderContentsAccessBar } from '../src/renderer/src/uniwork-share/FolderContentsAccessBar'
import {
  FolderContentsAccessDialog,
  type FolderContentsTarget,
} from '../src/renderer/src/uniwork-share/FolderContentsAccessDialog'
import {
  FOLDER_BATCH_MAX_FAILURES,
  FOLDER_BATCH_POLL_MS,
  resetFolderBatchesForTest,
  trackFolderBatch,
} from '../src/renderer/src/uniwork-share/folder-contents-access-store'
import {
  createFakeShareApi,
  type FakeShareApi,
  type FakeShareOptions,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { FolderContentsAccessRequest, UniworkShareApi } from '../src/shared/share-api'

/**
 * UNI-2244: the "Share documents inside…" dialog (web folder-contents-access dialog): mode Thêm /
 * Thay thế, the picker + one level, the home-workspace row of the replace mode, a dry run before any
 * write, the summary with its warnings, the destructive replace button, the sync toast, the
 * background run followed in the bar (closing the dialog does not stop it), 409 and 422.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkShareStrings.en as Record<string, string>
const viText = uniworkShareStrings.vi as Record<string, string>
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

const FOLDER: FolderContentsTarget = { id: 'fld_1', workspaceId: 'ws_1', title: 'Plans' }

/**
 * The fake's candidate list only knows its seeded document, not a folder id: the picker reads the
 * people of the organization, so the folder's list is the seeded document's.
 */
function withFolderCandidates(api: FakeShareApi): FakeShareApi {
  return Object.assign(Object.create(api) as FakeShareApi, {
    candidates: (input: Parameters<UniworkShareApi['candidates']>[0]) =>
      api.candidates({ ...input, documentId: 'doc_1' }),
  })
}

describe('FolderContentsAccessDialog (UNI-2244)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>
  let onChanged: ReturnType<typeof vi.fn>
  let onNotice: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
    onChanged = vi.fn()
    onNotice = vi.fn()
    resetFolderBatchesForTest()
  })
  afterEach(async () => {
    vi.useRealTimers()
    resetFolderBatchesForTest()
    await act(async () => root.unmount())
    host.remove()
  })

  async function open(
    options: FakeShareOptions = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<FakeShareApi> {
    const fake = createFakeShareApi(options)
    const api = withFolderCandidates(fake)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(
            'div',
            null,
            createElement(FolderContentsAccessDialog, {
              open: true,
              folder: FOLDER,
              workspaceName: 'Team',
              api,
              onClose,
              onChanged,
              onNotice,
            }),
            createElement(FolderContentsAccessBar, {}),
          ),
        ),
      )
    })
    await flush()
    return fake
  }

  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  async function pick(name: string) {
    const input = q<HTMLInputElement>('[data-fca-form] input[role="combobox"]')!
    await click(input)
    await click(qa('[role="option"]').find((o) => o.textContent?.includes(name)))
  }
  async function setMode(mode: 'merge' | 'replace') {
    await click(q(`[data-fca-mode="${mode}"]`))
  }
  const confirm = () => q<HTMLButtonElement>('[data-fca-confirm]')
  const apply = () => q<HTMLButtonElement>('[data-fca-apply]')
  const requests = (api: FakeShareApi) =>
    api.calls
      .filter((c) => c.method === 'folderContentsAccess')
      .map((c) => c.args[0] as FolderContentsAccessRequest)

  it('title, the fixed sentence, merge by default and the two modes in the spec copy', async () => {
    await open()
    const dialog = q('[role="dialog"]')!
    expect(q('#' + dialog.getAttribute('aria-labelledby'))!.textContent).toBe(
      t('shrFcTitle', { title: 'Plans' }),
    )
    expect(q('#' + dialog.getAttribute('aria-describedby'))!.textContent).toBe(t('shrFcFixed'))
    expect(q<HTMLInputElement>('[data-fca-mode="merge"]')!.checked).toBe(true)
    expect(q<HTMLInputElement>('[data-fca-mode="replace"]')!.checked).toBe(false)
    expect(dialog.textContent).toContain(t('shrFcModeMerge'))
    expect(dialog.textContent).toContain(t('shrFcModeReplace'))
    // merge has no home-workspace row
    expect(q('[data-fca-home]')).toBeNull()
  })

  it('vi copy: the menu sentence, the fixed sentence and the two modes', async () => {
    await open({}, 'vi')
    expect(viText.shrFcMenu).toBe('Chia sẻ các tài liệu bên trong…')
    expect(q('[role="dialog"]')!.textContent).toContain(
      'Áp dụng cho các tài liệu hiện có. Tài liệu thêm sau không tự nhận quyền.',
    )
    expect(q('[role="dialog"]')!.textContent).toContain('Thêm vào quyền đã có')
    expect(q('[role="dialog"]')!.textContent).toContain('Thay thế quyền cũ')
  })

  it('merge needs a person: Confirm with nobody picked asks nothing', async () => {
    const api = await open()
    expect(confirm()!.getAttribute('aria-disabled')).toBe('true')
    await click(confirm())
    expect(requests(api)).toEqual([])
  })

  it('Confirm runs a dry run first (nothing written) and shows the summary', async () => {
    const api = await open({ folderContents: { total: 42, notManageable: 5, unchanged: 0 } })
    await pick('Minh')
    await click(confirm())
    expect(requests(api)).toEqual([
      {
        folderId: 'fld_1',
        mode: 'merge',
        dryRun: true,
        items: [{ principalType: 'user', principalId: 'u_minh', level: 'view' }],
      },
    ])
    const review = q('[data-fca-review]')!
    expect(review).toBeTruthy()
    // "Sẽ đổi 37 tài liệu · bỏ qua 5 bạn không quản lý"
    expect(review.textContent).toContain(
      `${t('shrFcWillChangeOther', { count: 37 })} · ${t('shrFcSkippedNotManageable', { count: 5 })}`,
    )
    // a merge never says who loses access
    expect(review.textContent).not.toContain('lose access')
    // the primary (not destructive) button of the add mode; no write happened yet
    expect(apply()!.className).toContain('btn-primary')
    expect(apply()!.textContent).toBe(t('shrFcApplyMerge'))
    expect(requests(api).every((r) => r.dryRun)).toBe(true)
  })

  it('apply of a small folder (sync): one real call, the counts toast, closes and refetches', async () => {
    const api = await open({ folderContents: { total: 10, notManageable: 2, locked: 1 } })
    await pick('Minh')
    await click(confirm())
    await click(apply())
    const calls = requests(api)
    expect(calls.map((c) => c.dryRun)).toEqual([true, false])
    expect(onNotice).toHaveBeenCalledWith(
      `${t('shrFcDoneOther', { count: 7 })} · ${t('shrFcSkippedTotal', { count: 3 })}`,
      'ok',
    )
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('replace: the home-workspace row is always there; "not shared" sends no row (to_private)', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 12 } })
    await setMode('replace')
    const home = q<HTMLSelectElement>('[data-fca-home-level]')!
    expect(q('[data-fca-home]')!.textContent).toContain(t('shrFcHomeRow', { name: 'Team' }))
    expect(Array.from(home.options).map((o) => o.value)).toEqual([
      'view',
      'comment',
      'edit',
      'none',
    ])
    expect(home.value).toBe('none')
    // an empty list is valid in replace (it removes every share), with its own note
    expect(q('[data-fca-home]')!.textContent).toContain(t('shrFcReplaceEmpty'))
    await click(confirm())
    expect(requests(api)[0]).toMatchObject({ mode: 'replace', dryRun: true, items: [] })
    const review = q('[data-fca-review]')!
    expect(review.textContent).toContain(t('shrFcLosingOther', { count: 12 }))
    expect(review.textContent).toContain(t('shrFcWarnPrivate'))
  })

  it('replace: a chosen home level is sent as the workspace row; apply is destructive', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 1 } })
    await setMode('replace')
    await choose(q<HTMLSelectElement>('[data-fca-home-level]')!, 'edit')
    await pick('Minh')
    await click(confirm())
    expect(requests(api)[0]!.items).toEqual([
      { principalType: 'user', principalId: 'u_minh', level: 'view' },
      { principalType: 'workspace', principalId: 'ws_1', level: 'edit' },
    ])
    const review = q('[data-fca-review]')!
    expect(review.textContent).toContain(t('shrFcLosingOne', { count: 1 }))
    expect(review.textContent).not.toContain(t('shrFcWarnPrivate'))
    expect(apply()!.className).toContain('btn-danger')
    expect(apply()!.textContent).toBe(t('shrFcApplyReplace'))
    // focus starts on Back, never on the destructive button
    expect(document.activeElement).toBe(q('[data-fca-back]'))
    await click(apply())
    expect(requests(api).map((r) => r.dryRun)).toEqual([true, false])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a picked copy of the home workspace never doubles the replace row', async () => {
    const api = await open({ folderContents: { total: 4 } })
    await setMode('replace')
    await choose(q<HTMLSelectElement>('[data-fca-home-level]')!, 'comment')
    await click(confirm())
    const items = requests(api)[0]!.items
    expect(items.filter((i) => i.principalType === 'workspace')).toEqual([
      { principalType: 'workspace', principalId: 'ws_1', level: 'comment' },
    ])
  })

  it('warnings of the dry run: wide_scope for a group, downgrade; each has its sentence', async () => {
    await open({ folderContents: { total: 6, downgradedUsers: 3 } })
    await setMode('replace')
    await choose(q<HTMLSelectElement>('[data-fca-home-level]')!, 'view')
    await pick('Acme')
    await click(confirm())
    const warnings = qa('[data-fca-warning]').map((w) => w.textContent)
    expect(warnings).toEqual([t('shrFcWarnWide'), t('shrFcWarnDowngrade')])
    expect(q('[data-fca-review]')!.textContent).toContain(t('shrFcDowngradedOther', { count: 3 }))
  })

  it('only the three known warnings are shown; any other value is ignored', async () => {
    const fake = createFakeShareApi({ folderContents: { total: 6 } })
    const api = withFolderCandidates(fake)
    const real = fake.folderContentsAccess
    api.folderContentsAccess = async (req) => {
      const answer = await real(req)
      if (answer.ok && answer.value.kind === 'dryRun') {
        answer.value.preview.warnings = ['to_private', 'mystery', 'wide_scope', 'to_private']
      }
      return answer
    }
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(FolderContentsAccessDialog, { open: true, folder: FOLDER, api, onClose }),
        ),
      )
    })
    await flush()
    await pick('Minh')
    await click(confirm())
    expect(qa('[data-fca-warning]').map((w) => w.textContent)).toEqual([
      t('shrFcWarnPrivate'),
      t('shrFcWarnWide'),
    ])
  })

  it('nothing to change: the summary says so and offers no apply button', async () => {
    await open({ folderContents: { total: 3, unchanged: 3 } })
    await pick('Minh')
    await click(confirm())
    expect(q('[data-fca-review]')!.textContent).toContain(t('shrFcNothing'))
    expect(apply()).toBeNull()
    expect(q('[data-fca-back]')).toBeTruthy()
  })

  it('Back from the review returns to the form with the picked people kept', async () => {
    await open({ folderContents: { total: 6 } })
    await pick('Minh')
    await click(confirm())
    await click(q('[data-fca-back]'))
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-form]')!.textContent).toContain('Minh')
  })

  it('background run (202): tracked in the bar, the dialog closes, progress then a done toast', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 3 } })
    await pick('Minh')
    await click(confirm())
    await click(apply())
    expect(onClose).toHaveBeenCalledTimes(1)
    // closing the dialog does not stop the run: the bar follows it
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const bar = q('[data-testid="folder-contents-access-bar"]')!
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('data-phase')).toBe('running')
    expect(
      api.calls.filter((c) => c.method === 'folderContentsAccessBatch').length,
    ).toBeGreaterThanOrEqual(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_BATCH_POLL_MS * 3)
    })
    expect(q('[data-testid="folder-contents-access-bar"]')!.getAttribute('data-phase')).toBe(
      'completed',
    )
    expect(q('[data-testid="folder-contents-access-bar"]')!.textContent).toContain(
      t('shrFcDoneOther', { count: 900 }),
    )
  })

  it('a progress bar shows processed / total and is a labelled progressbar', async () => {
    vi.useFakeTimers()
    await open({ folderContents: { total: 900, batchSteps: 4 } })
    await pick('Minh')
    await click(confirm())
    await click(apply())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_BATCH_POLL_MS * 2)
    })
    const bar = q('[data-testid="folder-contents-access-bar"]')!
    const meter = bar.querySelector('progress')!
    expect(meter.getAttribute('aria-label')).toContain('Plans')
    expect(Number(meter.getAttribute('value'))).toBeGreaterThan(0)
    expect(bar.textContent).toMatch(/Plans.*: \d+\/900/)
  })

  it('a failed background run ends in an error bar naming the folder', async () => {
    vi.useFakeTimers()
    await open({ folderContents: { total: 900, batchSteps: 2, batchFails: true } })
    await pick('Minh')
    await click(confirm())
    await click(apply())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_BATCH_POLL_MS * 3)
    })
    const bar = q('[data-testid="folder-contents-access-bar"]')!
    expect(bar.getAttribute('data-phase')).toBe('failed')
    expect(bar.className).toContain('zd-bar-error')
    expect(bar.textContent).toContain('Plans')
  })

  it('409 on the dry run: says so, follows the running batch and closes', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 6 } })
    // a first run holds the folder (another window / person)
    await pick('Minh')
    await click(confirm())
    await click(apply())
    expect(onClose).toHaveBeenCalledTimes(1)
    onClose.mockClear()
    // a second dialog on the same folder meets the held lock
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(FolderContentsAccessDialog, {
            open: true,
            folder: FOLDER,
            api: withFolderCandidates(api),
            onClose,
            onNotice,
          }),
        ),
      )
    })
    await flush()
    await pick('An')
    await click(confirm())
    expect(onNotice).toHaveBeenCalledWith(t('shrFcRunning'), 'ok')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('422 rejected[]: back on the form, the refused person marked inline with the reason', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        {
          index: 0,
          principalType: 'user',
          principalId: 'u_minh',
          code: 'principal_not_in_organization',
        },
      ],
    })
    await click(confirm())
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-error]')!.textContent).toBe(`Minh Trần: ${t('shrRejectedNotInOrg')}`)
  })

  it('not_a_folder and a network error read in the share copy; the dialog stays open', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', { ok: false, error: 'not_a_folder', status: 422 })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcNotAFolder'))
    api.failNext('folderContentsAccess', { ok: false, error: 'network' })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrSubmitFailed'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failed apply after a good dry run goes back to the form with the error', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    await click(confirm())
    api.failNext('folderContentsAccess', { ok: false, error: 'network' })
    await click(apply())
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrSubmitFailed'))
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('a workspace or the organization is held at edit when the level is manage; a person keeps it', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await choose(q<HTMLSelectElement>('[data-fca-level]')!, 'manage')
    await pick('Minh')
    await pick('Design')
    await pick('Acme')
    await click(confirm())
    expect(requests(api)[0]!.items).toEqual([
      { principalType: 'user', principalId: 'u_minh', level: 'manage' },
      { principalType: 'workspace', principalId: 'ws_2', level: 'edit' },
      { principalType: 'organization', principalId: 'org_1', level: 'edit' },
    ])
  })

  it.each([
    ['principal_not_in_organization', 'shrRejectedNotInOrg'],
    ['level_not_allowed', 'shrRejectedLevelNotAllowed'],
    ['duplicate_principal', 'shrRejectedDuplicate'],
    ['break_glass_required', 'shrRejectedBreakGlass'],
  ])('422 code %s reads as its own inline sentence', async (code, key) => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [{ index: 0, principalType: 'user', principalId: 'u_minh', code }],
    })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(`Minh Trần: ${t(key)}`)
  })

  it('a server without the route (coded 501 -> endpointMissing) says the feature is not available', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'server_error',
      status: 501,
      endpointMissing: true,
    })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcUnavailable'))
    expect(q('[data-fca-form]')).toBeTruthy()
  })

  it('Escape closes the dialog and the buttons carry their labels (keyboard)', async () => {
    await open()
    expect(q('[data-fca-cancel]')!.textContent).toBe(t('shrConfirmCancel'))
    expect(q('[data-fca-confirm]')!.textContent).toBe(t('shrConfirmAccept'))
    await act(async () => {
      q('[role="dialog"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('folder contents access store (UNI-2244)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetFolderBatchesForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetFolderBatchesForTest()
  })

  it('a 404 on the poll ends the run as failed (nothing left to follow)', async () => {
    const api = createFakeShareApi({ folderContents: { total: 900 } })
    const settled: string[] = []
    const { onFolderBatchSettled } =
      await import('../src/renderer/src/uniwork-share/folder-contents-access-store')
    onFolderBatchSettled((batch) => settled.push(`${batch.batchId}:${batch.phase}`))
    trackFolderBatch({
      api,
      batchId: 'fb_unknown',
      folderId: 'fld_1',
      folderTitle: 'Plans',
      total: 0,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toEqual(['fb_unknown:failed'])
  })

  it('a dead network is retried, then given up after the failure cap', async () => {
    const api = createFakeShareApi({ folderContents: { total: 900 } })
    const dead = {
      ...api,
      folderContentsAccessBatch: vi.fn(async () => ({
        ok: false as const,
        error: 'network' as const,
      })),
    } as unknown as UniworkShareApi
    const settled: string[] = []
    const { onFolderBatchSettled } =
      await import('../src/renderer/src/uniwork-share/folder-contents-access-store')
    onFolderBatchSettled((batch) => settled.push(batch.phase))
    trackFolderBatch({ api: dead, batchId: 'fb_x', folderId: 'fld_1', folderTitle: 'P', total: 5 })
    await vi.advanceTimersByTimeAsync(FOLDER_BATCH_POLL_MS * (FOLDER_BATCH_MAX_FAILURES + 1))
    expect(dead.folderContentsAccessBatch).toHaveBeenCalledTimes(FOLDER_BATCH_MAX_FAILURES)
    expect(settled).toEqual(['failed'])
  })

  it('an unknown batch status reads as running: the poll goes on (web parity)', async () => {
    const api = createFakeShareApi({ folderContents: { total: 900 } })
    let reads = 0
    const odd = {
      ...api,
      folderContentsAccessBatch: vi.fn(async () => {
        reads++
        return {
          ok: true as const,
          value: {
            batchId: 'fb_odd',
            status: (reads < 3 ? 'paused' : 'completed') as 'completed',
            total: 10,
            processed: reads,
            changed: 0,
            unchanged: 0,
            skippedNotManageable: 0,
            skippedLocked: 0,
          },
        }
      }),
    } as unknown as UniworkShareApi
    const settled: string[] = []
    const { onFolderBatchSettled } =
      await import('../src/renderer/src/uniwork-share/folder-contents-access-store')
    onFolderBatchSettled((batch) => settled.push(batch.phase))
    trackFolderBatch({
      api: odd,
      batchId: 'fb_odd',
      folderId: 'fld_1',
      folderTitle: 'P',
      total: 10,
    })
    await vi.advanceTimersByTimeAsync(FOLDER_BATCH_POLL_MS * 4)
    expect(reads).toBe(3)
    expect(settled).toEqual(['completed'])
  })

  it('tracking the same running batch twice polls it once', async () => {
    const api = createFakeShareApi({ folderContents: { total: 900, batchSteps: 9 } })
    const started = await api.folderContentsAccess({
      folderId: 'fld_1',
      mode: 'merge',
      dryRun: false,
      items: [{ principalType: 'user', principalId: 'u_minh', level: 'view' }],
    })
    if (!started.ok || started.value.kind !== 'background') throw new Error('expected background')
    const input = {
      api,
      batchId: started.value.batchId,
      folderId: 'fld_1',
      folderTitle: 'Plans',
      total: 900,
    }
    trackFolderBatch(input)
    trackFolderBatch(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.calls.filter((c) => c.method === 'folderContentsAccessBatch')).toHaveLength(1)
  })
})
