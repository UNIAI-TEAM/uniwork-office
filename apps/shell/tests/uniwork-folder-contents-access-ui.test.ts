/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { resetLiveForTests, UniworkLiveHost } from '../src/renderer/src/uniwork-live'
import {
  FolderContentsAccessDialog,
  type FolderContentsTarget,
} from '../src/renderer/src/uniwork-share/FolderContentsAccessDialog'
import {
  buildFolderItems,
  canSubmitFolderItems,
  maxPickedItems,
} from '../src/renderer/src/uniwork-share/folder-contents-access-model'
import {
  FOLDER_BATCH_MAX_FAILURES,
  FOLDER_BATCH_POLL_MS,
  onFolderBatchSettled,
  resetFolderBatchesForTest,
  trackFolderBatch,
} from '../src/renderer/src/uniwork-share/folder-contents-access-store'
import {
  useFolderBatchEnd,
  type FolderBatchEndHandlers,
} from '../src/renderer/src/uniwork-share/use-folder-batch-end'
import {
  createFakeShareApi,
  type FakeShareApi,
  type FakeShareOptions,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { FolderContentsAccessRequest, UniworkShareApi } from '../src/shared/share-api'

/**
 * UNI-2244: the "Share documents inside…" dialog (web folder-contents-access dialog): mode Thêm /
 * Thay thế, the picker + one level, the home-workspace row of the replace mode (no preselected
 * level), a dry run before any write, the summary with its warnings, the destructive replace button,
 * the sync toast, the background run followed INSIDE the dialog (closing it does not stop it; the
 * screen's `useFolderBatchEnd` toasts the end), 409 and 422.
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

/** a screen that lists documents: it hears of the end of a background run */
function EndProbe(props: FolderBatchEndHandlers) {
  useFolderBatchEnd(props)
  return null
}

describe('web copy (UNI-2244): the app strings are the web draft, word for word', () => {
  // web key -> [app key, vi, en] (drive-web contract-fe.md, draft r1 + the pending rows)
  const WEB: Array<[string, string, string, string]> = [
    ['menu', 'shrFcMenu', 'Chia sẻ', 'Share'],
    ['title', 'shrFcTitle', 'Chia sẻ', 'Share'],
    [
      'scope',
      'shrFcScope',
      'Các tài liệu trong thư mục "{title}" và các thư mục con.',
      'Documents in folder "{title}" and its subfolders.',
    ],
    [
      'scope_untitled',
      'shrFcScopeUntitled',
      'Các tài liệu trong thư mục này và các thư mục con.',
      'Documents in this folder and its subfolders.',
    ],
    [
      'fixed_sentence',
      'shrFcFixed',
      'Áp dụng cho các tài liệu hiện có. Tài liệu thêm sau không tự nhận quyền.',
      'Applies to the documents that exist now. Documents added later do not get this access.',
    ],
    ['mode_label', 'shrFcModeLabel', 'Cách áp dụng', 'How to apply'],
    ['mode_merge', 'shrFcModeMerge', 'Thêm vào quyền đã có', 'Add to existing access'],
    ['mode_replace', 'shrFcModeReplace', 'Thay thế quyền cũ', 'Replace existing access'],
    [
      'mode_merge_hint',
      'shrFcModeMergeHint',
      'Cấp thêm cho các đối tượng đã chọn. Quyền đang có không bị hạ hay gỡ.',
      'Grants the people and groups you pick. Existing access is never lowered or removed.',
    ],
    [
      'mode_replace_hint',
      'shrFcModeReplaceHint',
      'Mỗi tài liệu chỉ còn đúng danh sách bên dưới. Ai không có trong danh sách sẽ mất quyền.',
      'Each document keeps exactly the list below. Anyone not in the list loses access.',
    ],
    [
      'principals_title',
      'shrFcPrincipalsTitle',
      'Đối tượng và mức quyền',
      'People and access levels',
    ],
    [
      'principals_empty_merge',
      'shrFcPrincipalsEmptyMerge',
      'Chưa chọn đối tượng nào. Tìm và chọn ít nhất một đối tượng để thêm quyền.',
      'Nobody picked yet. Search and pick at least one person or group to add access.',
    ],
    [
      'principals_empty_replace',
      'shrFcPrincipalsEmptyReplace',
      'Chưa chọn thêm ai. Chỉ dòng Workspace bên dưới được giữ lại.',
      'Nobody else picked. Only the Workspace row below is kept.',
    ],
    ['workspace_row', 'shrFcHomeRow', 'Workspace "{name}"', 'Workspace "{name}"'],
    [
      'workspace_row_unnamed',
      'shrFcHomeRowUnnamed',
      'Workspace chứa thư mục',
      'Workspace of this folder',
    ],
    [
      'workspace_level_label',
      'shrFcHomeLevelLabel',
      'Mức quyền của workspace',
      'Workspace access level',
    ],
    ['workspace_level_choose', 'shrFcHomeLevelChoose', 'Chọn mức quyền', 'Choose access'],
    ['level_private', 'shrFcLevelPrivate', 'Riêng tư', 'Private'],
    ['confirm', 'shrConfirmAccept', 'Xác nhận', 'Confirm'],
    ['checking', 'shrFcChecking', 'Đang kiểm tra…', 'Checking…'],
    ['back', 'shrFcBack', 'Quay lại', 'Back'],
    ['apply', 'shrFcApplyMerge', 'Áp dụng', 'Apply'],
    ['apply_replace', 'shrFcApplyReplace', 'Thay thế quyền', 'Replace access'],
    ['applying', 'shrFcApplying', 'Đang áp dụng…', 'Applying…'],
    [
      'summary_changed_one',
      'shrFcWillChangeOne',
      'Sẽ đổi {count} tài liệu',
      'Will change {count} document',
    ],
    [
      'summary_changed_other',
      'shrFcWillChangeOther',
      'Sẽ đổi {count} tài liệu',
      'Will change {count} documents',
    ],
    [
      'summary_skipped',
      'shrFcSkippedNotManageable',
      'bỏ qua {count} tài liệu bạn không quản lý',
      "skip {count} you don't manage",
    ],
    [
      'toast_unknown',
      'shrFcToastUnknown',
      'Đã gửi thay đổi quyền. Mở các tài liệu để kiểm tra kết quả.',
      'The access change was sent. Open the documents to check the result.',
    ],
    ['summary_locked', 'shrFcSkippedLocked', '{count} đang bị khóa', '{count} locked'],
    [
      'summary_losing_one',
      'shrFcLosingOne',
      '{count} người mất quyền ở ít nhất một tài liệu',
      '{count} person loses access to at least one document',
    ],
    [
      'summary_losing_other',
      'shrFcLosingOther',
      '{count} người mất quyền ở ít nhất một tài liệu',
      '{count} people lose access to at least one document',
    ],
    [
      'warning_wide_scope',
      'shrFcWarnWide',
      'Có cả workspace hoặc cả tổ chức trong danh sách: nhiều người sẽ mở được các tài liệu này.',
      'A whole workspace or organization is in the list: many people will be able to open these documents.',
    ],
    [
      'warning_to_private',
      'shrFcWarnPrivate',
      'Workspace không còn trong danh sách: các tài liệu sẽ chuyển về Riêng tư.',
      'The workspace is no longer in the list: these documents become Private.',
    ],
    [
      'warning_downgrade_one',
      'shrFcWarnDowngradeOne',
      '{count} người bị hạ mức quyền ở ít nhất một tài liệu.',
      '{count} person gets a lower access level on at least one document.',
    ],
    [
      'warning_downgrade_other',
      'shrFcWarnDowngradeOther',
      '{count} người bị hạ mức quyền ở ít nhất một tài liệu.',
      '{count} people get a lower access level on at least one document.',
    ],
    [
      'warning_downgrade_generic',
      'shrFcWarnDowngradeGeneric',
      'Một số quyền trên các tài liệu này sẽ bị hạ mức.',
      'Some access on these documents will be lowered.',
    ],
    [
      'nothing_to_change',
      'shrFcNothing',
      'Không có gì thay đổi: quyền hiện tại đã đúng với danh sách này.',
      'Nothing will change: current access already matches this list.',
    ],
    [
      'toast_done_one',
      'shrFcDoneOne',
      'Đã đổi quyền {count} tài liệu',
      'Access changed on {count} document',
    ],
    [
      'toast_done_other',
      'shrFcDoneOther',
      'Đã đổi quyền {count} tài liệu',
      'Access changed on {count} documents',
    ],
    [
      'toast_skipped_one',
      'shrFcToastSkippedOne',
      'Bỏ qua {count} tài liệu bạn không quản lý.',
      "Skipped {count} document you don't manage.",
    ],
    [
      'toast_skipped_other',
      'shrFcToastSkippedOther',
      'Bỏ qua {count} tài liệu bạn không quản lý.',
      "Skipped {count} documents you don't manage.",
    ],
    [
      'toast_locked_one',
      'shrFcToastLockedOne',
      '{count} tài liệu đang bị khóa nên chưa đổi.',
      '{count} document is locked and was not changed.',
    ],
    [
      'toast_locked_other',
      'shrFcToastLockedOther',
      '{count} tài liệu đang bị khóa nên chưa đổi.',
      '{count} documents are locked and were not changed.',
    ],
    ['progress_title', 'shrFcProgressTitle', 'Đang áp dụng quyền', 'Applying access'],
    ['progress_label', 'shrFcProgressLabel', 'Tiến độ áp dụng quyền', 'Access change progress'],
    [
      'progress_count_one',
      'shrFcProgressCountOne',
      '{processed}/{count} tài liệu',
      '{processed}/{count} document',
    ],
    [
      'progress_count_other',
      'shrFcProgressCountOther',
      '{processed}/{count} tài liệu',
      '{processed}/{count} documents',
    ],
    ['progress_starting', 'shrFcProgressStarting', 'Đang chờ bắt đầu…', 'Waiting to start…'],
    [
      'progress_hint',
      'shrFcProgressHint',
      'Bạn có thể đóng hộp thoại, việc áp dụng vẫn chạy nền. Có kết quả sẽ báo lại.',
      'You can close this dialog; the change keeps running in the background and you will be told when it ends.',
    ],
    [
      'progress_already_running',
      'shrFcProgressAlreadyRunning',
      'Thư mục này đang có một lượt áp dụng quyền chạy nền. Đây là tiến độ của lượt đó.',
      'This folder already has an access change running in the background. This is its progress.',
    ],
    ['progress_close', 'shrFcProgressClose', 'Xong', 'Done'],
    [
      'batch_done_one',
      'shrFcBatchDoneOne',
      'Đã áp dụng quyền cho {count} tài liệu',
      'Access applied to {count} document',
    ],
    [
      'batch_done_other',
      'shrFcBatchDoneOther',
      'Đã áp dụng quyền cho {count} tài liệu',
      'Access applied to {count} documents',
    ],
    [
      'batch_failed',
      'shrFcBatchFailed',
      'Việc áp dụng quyền dừng giữa chừng. Chạy lại Thay thế quyền để hoàn tất.',
      'The access change stopped part-way. Run Replace access again to finish it.',
    ],
    [
      'error_not_a_folder',
      'shrFcNotAFolder',
      'Mục này không phải thư mục nên không đổi quyền hàng loạt được.',
      'This item is not a folder, so its documents cannot be changed in bulk.',
    ],
    [
      'error_generic',
      'shrFcErrorGeneric',
      'Không áp dụng được quyền. Hãy thử lại.',
      'Could not apply access. Try again.',
    ],
    [
      'error_rejected',
      'shrFcErrorRejected',
      'Không áp dụng được cho một số đối tượng. Sửa các đối tượng được đánh dấu rồi thử lại.',
      'Access could not be applied for some people or groups. Fix the marked rows and try again.',
    ],
  ]

  it.each(WEB)('%s -> %s: vi and en as the web draft', (_web, key, vi, enText) => {
    expect(viText[key]).toBe(vi)
    expect(en[key]).toBe(enText)
  })
})

describe('FolderContentsAccessDialog (UNI-2244)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>
  let onChanged: ReturnType<typeof vi.fn>
  let onNotice: ReturnType<typeof vi.fn>
  let endToast: ReturnType<typeof vi.fn>
  let endRefetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
    onChanged = vi.fn()
    onNotice = vi.fn()
    endToast = vi.fn()
    endRefetch = vi.fn()
    resetFolderBatchesForTest()
    resetLiveForTests()
  })
  afterEach(async () => {
    vi.useRealTimers()
    resetFolderBatchesForTest()
    await act(async () => root.unmount())
    host.remove()
    resetLiveForTests()
  })

  function view(
    api: UniworkShareApi,
    lang: 'en' | 'vi',
    folder: FolderContentsTarget = FOLDER,
    workspaceName: string | undefined = 'Team',
  ) {
    return createElement(
      LocaleProvider,
      { initial: lang },
      createElement(
        'div',
        null,
        createElement(FolderContentsAccessDialog, {
          open: true,
          folder,
          workspaceName,
          api,
          onClose,
          onChanged,
          onNotice,
        }),
        createElement(EndProbe, { onToast: endToast, onRefetch: endRefetch }),
        createElement(UniworkLiveHost),
      ),
    )
  }

  async function open(
    options: FakeShareOptions = {},
    lang: 'en' | 'vi' = 'en',
    folder: FolderContentsTarget = FOLDER,
    workspaceName: string | undefined = 'Team',
  ): Promise<FakeShareApi> {
    const fake = createFakeShareApi(options)
    await act(async () => {
      root.render(view(withFolderCandidates(fake), lang, folder, workspaceName))
    })
    await flush()
    return fake
  }

  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
  const live = () => document.querySelector('#uw-live-host [role="status"]')?.textContent ?? ''
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
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  const confirm = () => q<HTMLButtonElement>('[data-fca-confirm]')
  const apply = () => q<HTMLButtonElement>('[data-fca-apply]')
  const homeSelect = () => q<HTMLSelectElement>('[data-fca-home-level]')!
  const requests = (api: FakeShareApi) =>
    api.calls
      .filter((c) => c.method === 'folderContentsAccess')
      .map((c) => c.args[0] as FolderContentsAccessRequest)
  /** merge, one person picked, through the dry run to the apply button */
  async function toReview(api: FakeShareApi) {
    await pick('Minh')
    await click(confirm())
    expect(requests(api)).toHaveLength(1)
  }

  it('title, the fixed sentence, merge by default and the two modes in the web copy', async () => {
    await open()
    const dialog = q('[role="dialog"]')!
    expect(q('#' + dialog.getAttribute('aria-labelledby'))!.textContent).toBe(t('shrFcTitle'))
    // the subtitle names the folder; the fixed sentence stays the description
    expect(q('[data-fca-scope]')!.textContent).toBe(t('shrFcScope', { title: 'Plans' }))
    const describedBy = dialog.getAttribute('aria-describedby')!.split(' ')
    expect(describedBy).toContain(q('[data-fca-scope]')!.id)
    expect(q('#' + describedBy[describedBy.length - 1])!.textContent).toBe(t('shrFcFixed'))
    expect(q<HTMLInputElement>('[data-fca-mode="merge"]')!.checked).toBe(true)
    expect(q<HTMLInputElement>('[data-fca-mode="replace"]')!.checked).toBe(false)
    expect(dialog.textContent).toContain(t('shrFcModeMerge'))
    expect(dialog.textContent).toContain(t('shrFcModeMergeHint'))
    expect(dialog.textContent).toContain(t('shrFcModeReplace'))
    expect(dialog.textContent).toContain(t('shrFcPrincipalsTitle'))
    // nobody picked: the merge hint says how to start
    expect(q('[data-fca-empty]')!.textContent).toBe(t('shrFcPrincipalsEmptyMerge'))
    // merge has no home-workspace row
    expect(q('[data-fca-home]')).toBeNull()
  })

  it('a folder without a title says "this folder" in the subtitle', async () => {
    await open({}, 'en', { ...FOLDER, title: ' ' })
    expect(q('[role="dialog"] h2')!.textContent).toBe(t('shrFcTitle'))
    expect(q('[data-fca-scope]')!.textContent).toBe(t('shrFcScopeUntitled'))
  })

  it('vi copy: the dialog reads the web vi strings', async () => {
    await open({}, 'vi')
    const text = q('[role="dialog"]')!.textContent!
    expect(text).toContain('Các tài liệu trong thư mục "Plans" và các thư mục con.')
    expect(text).toContain(
      'Áp dụng cho các tài liệu hiện có. Tài liệu thêm sau không tự nhận quyền.',
    )
    expect(text).toContain('Thêm vào quyền đã có')
    expect(text).toContain('Thay thế quyền cũ')
    expect(text).toContain('Đối tượng và mức quyền')
    expect(text).toContain('Xác nhận')
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

  it('the locked documents join the first summary line', async () => {
    await open({ folderContents: { total: 20, notManageable: 2, locked: 3 } })
    await pick('Minh')
    await click(confirm())
    expect(q('.uw-fca-summary li')!.textContent).toBe(
      [
        t('shrFcWillChangeOther', { count: 15 }),
        t('shrFcSkippedNotManageable', { count: 2 }),
        t('shrFcSkippedLocked', { count: 3 }),
      ].join(' · '),
    )
  })

  it('the dry-run summary is spoken once: described-by on the focused review button, no live line (R1-2, R2-2)', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 4 } })
    await setMode('replace')
    await choose(homeSelect(), 'view')
    await click(confirm())
    expect(requests(api)).toHaveLength(1)
    // the live region stays empty: the description is the only voice of the summary
    expect(live()).toBe('')
    // the focused button is described by the summary (and the warnings when there are some)
    const focused = document.activeElement as HTMLElement
    expect(focused).toBe(q('[data-fca-back]'))
    const described = focused
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    expect(described).toContain(t('shrFcLosingOther', { count: 4 }))
    expect(apply()!.getAttribute('aria-describedby')).toBe(focused.getAttribute('aria-describedby'))
    // the dialog itself is described by the summary too
    const dialogDesc = q('[role="dialog"]')!.getAttribute('aria-describedby')!.split(' ')
    expect(dialogDesc).toContain(focused.getAttribute('aria-describedby')!.split(' ')[0])
  })

  it('apply of a small folder (sync): one real call, the counts toast, closes and refetches', async () => {
    const api = await open({ folderContents: { total: 10, notManageable: 2, locked: 1 } })
    await toReview(api)
    await click(apply())
    const calls = requests(api)
    expect(calls.map((c) => c.dryRun)).toEqual([true, false])
    expect(onNotice).toHaveBeenCalledWith(
      `${t('shrFcDoneOther', { count: 7 })}. ${t('shrFcToastSkippedOther', { count: 2 })}. ${t('shrFcToastLockedOne', { count: 1 })}`,
      'ok',
    )
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('replace: the home row has no preselected level and Confirm waits for an answer', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 12 } })
    await setMode('replace')
    const home = homeSelect()
    expect(q('[data-fca-home]')!.textContent).toContain(t('shrFcHomeRow', { name: 'Team' }))
    expect(q('[data-fca-home] label')!.textContent).toBe(t('shrFcHomeLevelLabel'))
    expect(Array.from(home.options).map((o) => o.value)).toEqual([
      '',
      'view',
      'comment',
      'edit',
      'private',
    ])
    expect(home.options[0]!.textContent).toBe(t('shrFcHomeLevelChoose'))
    expect(home.options[0]!.disabled).toBe(true)
    expect(home.options[4]!.textContent).toBe(t('shrFcLevelPrivate'))
    expect(home.value).toBe('')
    // an empty list is valid in replace, with its own hint, but not before the home answer
    expect(q('[data-fca-empty]')!.textContent).toBe(t('shrFcPrincipalsEmptyReplace'))
    // nobody picked: no level to choose (the merge form keeps its select)
    expect(q('[data-fca-level]')).toBeNull()
    expect(confirm()!.getAttribute('aria-disabled')).toBe('true')
    await click(confirm())
    expect(requests(api)).toEqual([])
    await choose(home, 'private')
    expect(confirm()!.getAttribute('aria-disabled')).toBeNull()
  })

  it('replace: Private sends no workspace row and warns that the documents turn private', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 12 } })
    await setMode('replace')
    await choose(homeSelect(), 'private')
    await click(confirm())
    expect(requests(api)[0]).toMatchObject({ mode: 'replace', dryRun: true, items: [] })
    const review = q('[data-fca-review]')!
    expect(review.textContent).toContain(t('shrFcLosingOther', { count: 12 }))
    expect(review.textContent).toContain(t('shrFcWarnPrivate'))
  })

  it('replace: a chosen home level is sent as the workspace row; apply is destructive', async () => {
    const api = await open({ folderContents: { total: 8, losingUsers: 1 } })
    await setMode('replace')
    await choose(homeSelect(), 'edit')
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

  it('an unnamed home workspace reads "Workspace of this folder"', async () => {
    await open({}, 'en', FOLDER, '')
    await setMode('replace')
    expect(q('[data-fca-home] h3')!.textContent).toBe(t('shrFcHomeRowUnnamed'))
  })

  it('a picked copy of the home workspace never doubles the replace row', async () => {
    const api = await open({ folderContents: { total: 4 } })
    await setMode('replace')
    await choose(homeSelect(), 'comment')
    await click(confirm())
    const items = requests(api)[0]!.items
    expect(items.filter((i) => i.principalType === 'workspace')).toEqual([
      { principalType: 'workspace', principalId: 'ws_1', level: 'comment' },
    ])
  })

  it('home workspace picked in merge, then Replace: its level moves into the home row, no stray chip (R1-4)', async () => {
    const api = await open({ folderContents: { total: 4 } })
    await choose(q<HTMLSelectElement>('[data-fca-level]')!, 'comment')
    await pick('Team')
    expect(qa('.uw-share-chip').map((c) => c.textContent)).toEqual([
      expect.stringContaining('Team'),
    ])
    await setMode('replace')
    // the chip is gone and the home row shows what it carried
    expect(qa('.uw-share-chip')).toEqual([])
    expect(homeSelect().value).toBe('comment')
    await click(confirm())
    expect(requests(api)[0]!.items).toEqual([
      { principalType: 'workspace', principalId: 'ws_1', level: 'comment' },
    ])
  })

  it('manage on the picked home workspace becomes edit in the home row (a workspace never takes manage)', async () => {
    await open({ folderContents: { total: 4 } })
    await choose(q<HTMLSelectElement>('[data-fca-level]')!, 'manage')
    await pick('Team')
    await setMode('replace')
    expect(homeSelect().value).toBe('edit')
  })

  it('a home answer the person already gave is not overwritten by the moved chip', async () => {
    await open({ folderContents: { total: 4 } })
    await setMode('replace')
    await choose(homeSelect(), 'private')
    await setMode('merge')
    await pick('Team')
    await setMode('replace')
    expect(homeSelect().value).toBe('private')
    expect(qa('.uw-share-chip')).toEqual([])
  })

  it('warnings of the dry run: wide_scope for a group, downgrade with its count; each has its sentence', async () => {
    await open({ folderContents: { total: 6, downgradedUsers: 3 } })
    await setMode('replace')
    await choose(homeSelect(), 'view')
    await pick('Acme')
    await click(confirm())
    const warnings = qa('[data-fca-warning]').map((w) => w.textContent)
    expect(warnings).toEqual([t('shrFcWarnWide'), t('shrFcWarnDowngradeOther', { count: 3 })])
    // the downgrade is a warning, not a summary line
    expect(q('.uw-fca-summary')!.textContent).not.toContain('lower')
  })

  it('a downgrade warning without a usable count reads the generic sentence, never "0 people"', async () => {
    const fake = createFakeShareApi({ folderContents: { total: 6 } })
    const api = withFolderCandidates(fake)
    const real = fake.folderContentsAccess
    api.folderContentsAccess = async (req) => {
      const answer = await real(req)
      if (answer.ok && answer.value.kind === 'dryRun') {
        answer.value.preview.warnings = ['downgrade']
        answer.value.preview.downgradedUsers = 0
      }
      return answer
    }
    await act(async () => {
      root.render(view(api, 'en'))
    })
    await flush()
    await pick('Minh')
    await click(confirm())
    const warnings = qa('[data-fca-warning]').map((w) => w.textContent)
    expect(warnings).toEqual([t('shrFcWarnDowngradeGeneric')])
    expect(warnings[0]).not.toMatch(/\b0\b/)
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
      root.render(view(api, 'en'))
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
    // Back is the only button: it holds the focus and its description carries the sentence
    const back = q('[data-fca-back]')!
    expect(document.activeElement).toBe(back)
    const described = back
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    expect(described).toContain(t('shrFcNothing'))
    expect(live()).toBe('')
  })

  it('Back from the review returns to the form with the picked people kept and focus inside it (R2-1)', async () => {
    await open({ folderContents: { total: 6 } })
    await pick('Minh')
    await click(confirm())
    await click(q('[data-fca-back]'))
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-form]')!.textContent).toContain('Minh')
    expect(q('[data-fca-form]')!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('background run (202): progress inside the dialog, which stays open; the end toasts and closes it', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 3 } })
    await toReview(api)
    await click(apply())
    // the dialog turns into the progress view (title, label, count, hint, Done); nothing closed
    expect(onClose).not.toHaveBeenCalled()
    const progress = q('[data-fca-progress]')!
    expect(progress).toBeTruthy()
    expect(q('[role="dialog"] h2')!.textContent).toBe(t('shrFcProgressTitle'))
    expect(q('#' + q('[role="dialog"]')!.getAttribute('aria-describedby'))!.textContent).toBe(
      t('shrFcProgressHint'),
    )
    expect(q('[data-fca-done]')!.textContent).toBe(t('shrFcProgressClose'))
    expect(q('[data-fca-running]')).toBeNull()
    expect(live()).toBe(t('shrFcProgressTitle'))
    await advance(0)
    expect(
      api.calls.filter((c) => c.method === 'folderContentsAccessBatch').length,
    ).toBeGreaterThanOrEqual(1)
    await advance(FOLDER_BATCH_POLL_MS * 3)
    // the end: one toast with the batch copy, every host refetched, the dialog closed itself
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchDoneOther', { count: 900 }), 'ok')
    expect(endRefetch).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the progress view is a labelled progressbar with processed / total', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 4 } })
    await toReview(api)
    await click(apply())
    // before the first read: the 202 already knows the total
    expect(q('[data-fca-count]')!.textContent).toBe(
      t('shrFcProgressCountOther', { processed: 0, count: 900 }),
    )
    await advance(FOLDER_BATCH_POLL_MS * 2)
    const meter = q<HTMLProgressElement>('[data-fca-progress] progress')!
    expect(meter.getAttribute('aria-label')).toBe(t('shrFcProgressLabel'))
    expect(Number(meter.getAttribute('value'))).toBeGreaterThan(0)
    expect(q('[data-fca-count]')!.textContent).toMatch(/^\d+\/900 documents$/)
    expect(q('[data-fca-count]')!.textContent).not.toBe(
      t('shrFcProgressCountOther', { processed: 0, count: 900 }),
    )
  })

  it('Done closes the dialog; the run keeps going and its end is still toasted', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 3 } })
    await toReview(api)
    await click(apply())
    await click(q('[data-fca-done]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // the host closes the dialog (unmounts it); the store goes on polling
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(EndProbe, { onToast: endToast, onRefetch: endRefetch }),
        ),
      )
    })
    await advance(FOLDER_BATCH_POLL_MS * 4)
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchDoneOther', { count: 900 }), 'ok')
    expect(endRefetch).toHaveBeenCalledTimes(1)
  })

  it('a failed background run ends in an error toast and closes the dialog', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 2, batchFails: true } })
    await toReview(api)
    await click(apply())
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchFailed'), 'error')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a failed background run while the dialog shows its progress: exactly one message reaches the person', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 2, batchFails: true } })
    await toReview(api)
    await click(apply())
    expect(q('[data-fca-progress]')).toBeTruthy()
    await advance(FOLDER_BATCH_POLL_MS * 3)
    // one toast through the screen's host; the dialog adds no notice, no in-dialog error, no live line
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchFailed'), 'error')
    expect(onNotice).not.toHaveBeenCalled()
    expect(q('[data-fca-error]')).toBeNull()
    expect(q('[role="alert"]')).toBeNull()
    expect(live()).not.toContain(t('shrFcBatchFailed'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a failed run followed from a 409, with two hosts mounted: still one message in total', async () => {
    vi.useFakeTimers()
    const second = vi.fn()
    const secondRefetch = vi.fn()
    const api = await open({ folderContents: { total: 6 } })
    // a second screen that lists documents (the home under the folder browser) is mounted too
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(
            'div',
            null,
            createElement(EndProbe, { onToast: second, onRefetch: secondRefetch }),
            view(withFolderCandidates(api), 'en').props.children,
          ),
        ),
      )
    })
    await flush()
    await toReview(api)
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
      batchId: 'fb_ghost',
    })
    await click(apply())
    await advance(0)
    // the screens refetch, the newest alone toasts; nothing else spoke
    expect(second).not.toHaveBeenCalled()
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchFailed'), 'error')
    expect(onNotice).not.toHaveBeenCalled()
    expect(q('[role="alert"]')).toBeNull()
    expect(live()).not.toContain(t('shrFcBatchFailed'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a finished run with skipped documents toasts the counts after the done sentence', async () => {
    vi.useFakeTimers()
    const api = await open({
      folderContents: { total: 900, notManageable: 10, locked: 4, batchSteps: 2 },
    })
    await toReview(api)
    await click(apply())
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(endToast).toHaveBeenCalledWith(
      `${t('shrFcBatchDoneOther', { count: 886 })}. ${t('shrFcToastSkippedOther', { count: 10 })}. ${t('shrFcToastLockedOther', { count: 4 })}`,
      'ok',
    )
  })

  it('409 on the dry run: progress_already_running with that batch inside the dialog', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 6 } })
    // a first run holds the folder (another window / person)
    await toReview(api)
    await click(apply())
    // a second dialog on the same folder meets the held lock
    await act(async () => root.unmount())
    root = createRoot(host)
    onClose.mockClear()
    await act(async () => {
      root.render(view(withFolderCandidates(api), 'en'))
    })
    await flush()
    await pick('An')
    await click(confirm())
    expect(q('[data-fca-running]')!.textContent).toBe(t('shrFcProgressAlreadyRunning'))
    expect(q('[data-fca-progress]')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // that batch's own numbers are drawn, and the end closes the dialog with its toast
    await advance(FOLDER_BATCH_POLL_MS)
    expect(q('[data-fca-count]')!.textContent).toMatch(/^\d+\/900 documents$/)
    await advance(FOLDER_BATCH_POLL_MS * 6)
    expect(endToast).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('409 on the apply step: the same progress view, then the failed end when the batch cannot be read', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 6 } })
    await toReview(api)
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
      batchId: 'fb_ghost',
    })
    await click(apply())
    expect(q('[data-fca-running]')!.textContent).toBe(t('shrFcProgressAlreadyRunning'))
    // the follower from the review step keeps the keyboard inside the dialog (R2-1)
    expect(document.activeElement).toBe(q('[data-fca-done]'))
    // nothing is known of it yet: the starting line
    expect(q('[data-fca-count]')!.textContent).toBe(t('shrFcProgressStarting'))
    expect(requests(api).map((r) => r.dryRun)).toEqual([true, false])
    // the follower reads it at once; a batch that is not ours is a failed end
    await advance(0)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchFailed'), 'error')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('409 without a batch id: the message, no promise of progress, the dialog stays', async () => {
    const api = await open({ folderContents: { total: 6 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
    })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcRunningNoBatch'))
    expect(t('shrFcRunningNoBatch')).not.toContain('progress')
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-progress]')).toBeNull()
    expect(api.calls.filter((c) => c.method === 'folderContentsAccessBatch')).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('409 without a batch id on the apply step: back on the form with the message, no progress follow', async () => {
    const api = await open({ folderContents: { total: 6 } })
    await toReview(api)
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'folder_access_batch_running',
      status: 409,
    })
    await click(apply())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcRunningNoBatch'))
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-progress]')).toBeNull()
    expect(requests(api).map((r) => r.dryRun)).toEqual([true, false])
    expect(api.calls.filter((c) => c.method === 'folderContentsAccessBatch')).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('422 rejected[] on the dry run: back on the form, the refused person marked inline with the reason', async () => {
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
    expect(q('[data-fca-error]')!.textContent).toBe(
      `${t('shrFcErrorRejected')} Minh Trần: ${t('shrRejectedNotInOrg')}`,
    )
    // the chip carries the reason too
    expect(q('[data-rejected-reason="u_minh"]')!.textContent).toBe(t('shrRejectedNotInOrg'))
  })

  it('422 rejected[] on the apply step: back on the form with the same inline errors, nothing toasted', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await toReview(api)
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        { index: 0, principalType: 'user', principalId: 'u_minh', code: 'level_not_allowed' },
      ],
    })
    await click(apply())
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-review]')).toBeNull()
    expect(q('[data-fca-error]')!.textContent).toBe(
      `${t('shrFcErrorRejected')} Minh Trần: ${t('shrRejectedLevelNotAllowed')}`,
    )
    expect(onNotice).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a refused home row is named by the workspace (it has no chip to mark)', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await setMode('replace')
    await choose(homeSelect(), 'edit')
    api.failNext('folderContentsAccess', {
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        { index: 0, principalType: 'workspace', principalId: 'ws_1', code: 'level_not_allowed' },
      ],
    })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(
      `${t('shrFcErrorRejected')} Team: ${t('shrRejectedLevelNotAllowed')}`,
    )
  })

  it('not_a_folder and a network error read in the web copy; the dialog stays open', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', { ok: false, error: 'not_a_folder', status: 422 })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcNotAFolder'))
    api.failNext('folderContentsAccess', { ok: false, error: 'network' })
    await click(confirm())
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcErrorGeneric'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('apply answered 2xx but unreadable (malformed_response): neutral toast, closes, refetches, no error text', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await toReview(api)
    api.failNext('folderContentsAccess', { ok: false, error: 'malformed_response' })
    await click(apply())
    expect(requests(api).map((c) => c.dryRun)).toEqual([true, false])
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith(t('shrFcToastUnknown'), 'ok')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(q('[data-fca-error]')).toBeNull()
  })

  it('a malformed answer to the dry run keeps today behaviour: back on the form with the error, no toast', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await pick('Minh')
    api.failNext('folderContentsAccess', { ok: false, error: 'malformed_response' })
    await click(confirm())
    expect(onNotice).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failed apply after a good dry run goes back to the form with the error', async () => {
    const api = await open({ folderContents: { total: 5 } })
    await toReview(api)
    api.failNext('folderContentsAccess', { ok: false, error: 'network' })
    await click(apply())
    expect(q('[data-fca-form]')).toBeTruthy()
    expect(q('[data-fca-error]')!.textContent).toBe(t('shrFcErrorGeneric'))
    expect(onNotice).not.toHaveBeenCalled()
    // the focused Apply button unmounted: focus is back inside the form, not on <body> (R2-1)
    expect(q('[data-fca-form]')!.contains(document.activeElement)).toBe(true)
  })

  it('202: focus lands on Done, and Esc there closes the dialog without cancelling the run (R2-1)', async () => {
    vi.useFakeTimers()
    const api = await open({ folderContents: { total: 900, batchSteps: 3 } })
    await toReview(api)
    await click(apply())
    expect(q('[data-fca-progress]')).toBeTruthy()
    expect(document.activeElement).toBe(q('[data-fca-done]'))
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    // the run goes on: its end is still toasted and the hosts refetch
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(EndProbe, { onToast: endToast, onRefetch: endRefetch }),
        ),
      )
    })
    await advance(FOLDER_BATCH_POLL_MS * 4)
    expect(endToast).toHaveBeenCalledWith(t('shrFcBatchDoneOther', { count: 900 }), 'ok')
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
    expect(q('[data-fca-error]')!.textContent).toBe(
      `${t('shrFcErrorRejected')} Minh Trần: ${t(key)}`,
    )
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

describe('folder items rules (UNI-2244)', () => {
  const user = (n: number) => ({
    principalType: 'user' as const,
    principalId: `u_${n}`,
    level: 'view' as const,
  })
  const many = (n: number) => Array.from({ length: n }, (_, i) => user(i))

  it('merge: 100 items pass, 101 do not (R1-3)', () => {
    expect(canSubmitFolderItems('merge', many(100), '')).toBe(true)
    expect(canSubmitFolderItems('merge', many(101), '')).toBe(false)
    expect(canSubmitFolderItems('merge', [], '')).toBe(false)
  })

  it('replace: 100 picked plus the home row is 101 and does not pass; the cap keeps a slot for the row', () => {
    const items = buildFolderItems({
      mode: 'replace',
      picked: many(100),
      homeWorkspaceId: 'ws_1',
      homeChoice: 'edit',
    })
    expect(items).toHaveLength(101)
    expect(canSubmitFolderItems('replace', items, 'edit')).toBe(false)
    expect(maxPickedItems('replace')).toBe(99)
    expect(maxPickedItems('merge')).toBe(100)
    expect(
      canSubmitFolderItems(
        'replace',
        buildFolderItems({
          mode: 'replace',
          picked: many(99),
          homeWorkspaceId: 'ws_1',
          homeChoice: 'edit',
        }),
        'edit',
      ),
    ).toBe(true)
  })

  it('replace needs the home answer, an empty list is fine', () => {
    expect(canSubmitFolderItems('replace', [], '')).toBe(false)
    expect(canSubmitFolderItems('replace', [], 'private')).toBe(true)
    expect(
      buildFolderItems({ mode: 'replace', picked: [], homeWorkspaceId: 'ws_1', homeChoice: '' }),
    ).toEqual([])
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

  /** a fake that already holds one background run of its folder, tracked in the store */
  async function startRun(options: {
    batchFails?: boolean
    total?: number
    folderId?: string
    /** the fakes number their batches alike (fb_1): a second fake is tracked under its own id */
    trackAs?: string
  }) {
    const { trackAs, ...fakeOptions } = options
    const fake = createFakeShareApi({
      folderContents: { total: options.total ?? 900, batchSteps: 2, ...fakeOptions },
    })
    const api: UniworkShareApi = trackAs
      ? {
          ...fake,
          folderContentsAccessBatch: (req) =>
            fake.folderContentsAccessBatch({ ...req, batchId: 'fb_1' }),
        }
      : fake
    const folderId = options.folderId ?? 'fld_1'
    const started = await fake.folderContentsAccess({
      folderId,
      mode: 'merge',
      dryRun: false,
      items: [{ principalType: 'user', principalId: 'u_minh', level: 'view' }],
    })
    if (!started.ok || started.value.kind !== 'background') throw new Error('expected background')
    trackFolderBatch({
      api,
      batchId: trackAs ?? started.value.batchId,
      folderId,
      folderTitle: folderId,
      total: started.value.total,
    })
    return started.value.batchId
  }

  describe('hosts', () => {
    let host: HTMLDivElement
    let root: Root
    beforeEach(() => {
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
    })
    afterEach(async () => {
      await act(async () => root.unmount())
      host.remove()
    })
    const mount = async (...probes: FolderBatchEndHandlers[]) => {
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            ...probes.map((p, i) => createElement(EndProbe, { key: i, ...p })),
          ),
        )
      })
    }
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })

    it('two folders at once: each ends on its own, each toasted once', async () => {
      const toast = vi.fn()
      const refetch = vi.fn()
      await mount({ onToast: toast, onRefetch: refetch })
      await startRun({ folderId: 'fld_1', total: 900 })
      await startRun({ folderId: 'fld_2', total: 700, batchFails: true, trackAs: 'fb_second' })
      await advance(FOLDER_BATCH_POLL_MS * 4)
      expect(refetch).toHaveBeenCalledTimes(2)
      expect(toast.mock.calls.map((c) => c[1]).sort()).toEqual(['error', 'ok'])
      expect(toast).toHaveBeenCalledWith(t('shrFcBatchDoneOther', { count: 900 }), 'ok')
      expect(toast).toHaveBeenCalledWith(t('shrFcBatchFailed'), 'error')
    })

    it('two hosts mounted at once (Open dialog over the home): both refetch, the newest toasts once (R1-1)', async () => {
      const homeToast = vi.fn()
      const homeRefetch = vi.fn()
      const dialogToast = vi.fn()
      const dialogRefetch = vi.fn()
      await mount(
        { onToast: homeToast, onRefetch: homeRefetch },
        { onToast: dialogToast, onRefetch: dialogRefetch },
      )
      await startRun({ total: 900 })
      await advance(FOLDER_BATCH_POLL_MS * 3)
      expect(homeRefetch).toHaveBeenCalledTimes(1)
      expect(dialogRefetch).toHaveBeenCalledTimes(1)
      expect(homeToast).not.toHaveBeenCalled()
      expect(dialogToast).toHaveBeenCalledTimes(1)
      expect(dialogToast).toHaveBeenCalledWith(t('shrFcBatchDoneOther', { count: 900 }), 'ok')
    })

    it('the host unmounts during a poll: nothing throws, the run is still polled to its end', async () => {
      const toast = vi.fn()
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      await mount({ onToast: toast, onRefetch: vi.fn() })
      const ended: string[] = []
      onFolderBatchSettled((batch) => ended.push(batch.phase))
      await startRun({ total: 900 })
      await advance(0)
      await act(async () => root.unmount())
      root = createRoot(host)
      await advance(FOLDER_BATCH_POLL_MS * 3)
      expect(ended).toEqual(['completed'])
      // the gone host heard nothing and no React warning came out of the poll
      expect(toast).not.toHaveBeenCalled()
      expect(errors).not.toHaveBeenCalled()
      errors.mockRestore()
    })
  })
})

describe('folder contents access layout (UNI-2244, CSS only)', () => {
  const css = readFileSync(
    join(__dirname, '../src/renderer/src/uniwork-share/share-dialog.css'),
    'utf8',
  )
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('the home row select takes the whole row; the picker row select grows with its longest label', () => {
    expect(rule('.uw-fca [data-fca-home] .uw-act-select')).toContain('width: 100%')
    const picker = rule('.uw-fca .uw-share-form-row > .uw-share-field')
    expect(picker).toContain('width: auto')
    expect(picker).toContain('min-width: 160px')
    expect(picker).toContain('max-width: 100%')
  })

  it('a warning notice fills the dialog body and keeps no margin of its own', () => {
    expect(rule('.uw-fca-warnings')).toContain('width: 100%')
    const notice = rule('.uw-fca-warnings > .uw-share-notice')
    expect(notice).toContain('width: 100%')
    expect(notice).toContain('margin: 0')
  })
})
