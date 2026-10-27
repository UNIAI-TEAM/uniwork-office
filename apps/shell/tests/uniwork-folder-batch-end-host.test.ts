/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { resetLiveForTests, UniworkLiveHost } from '../src/renderer/src/uniwork-live'
import { FolderBatchEndHost } from '../src/renderer/src/uniwork-share/FolderBatchEndHost'
import { createFakeShareApi } from '../src/renderer/src/uniwork-share/fake-share-api'
import {
  FOLDER_BATCH_POLL_MS,
  resetFolderBatchesForTest,
  trackFolderBatch,
} from '../src/renderer/src/uniwork-share/folder-contents-access-store'
import { useFolderBatchEnd } from '../src/renderer/src/uniwork-share/use-folder-batch-end'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { UniworkShareApi } from '../src/shared/share-api'

/**
 * UNI-2244: the end of a background "share the documents inside a folder" run is told by ONE
 * listener the shell frame always mounts, not by the Documents screens (they unmount when the
 * person opens another module, and the end was lost). The screens only refetch.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkShareStrings.en as Record<string, string>
const t = (key: string, params?: Record<string, string | number>) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) =>
    params && n in params ? String(params[n]) : w,
  )

/** a Documents screen: it hears of an end to refetch its list, nothing more */
function DocumentsProbe(props: { onRefetch: () => void }) {
  useFolderBatchEnd(props)
  return null
}

describe('FolderBatchEndHost (UNI-2244): one app-level surface tells a batch end', () => {
  let shellHost: HTMLDivElement
  let screenHost: HTMLDivElement
  let shellRoot: Root
  let screenRoot: Root

  const shell = () =>
    createElement(
      LocaleProvider,
      { initial: 'en' },
      createElement('div', null, createElement(FolderBatchEndHost), createElement(UniworkLiveHost)),
    )
  const screens = (...refetches: Array<() => void>) =>
    createElement(
      LocaleProvider,
      { initial: 'en' },
      ...refetches.map((onRefetch, i) => createElement(DocumentsProbe, { key: i, onRefetch })),
    )

  const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('.uw-act-toast'))
  const live = () => document.querySelector('#uw-live-host [role="status"]')?.textContent ?? ''
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  const mountScreens = (...refetches: Array<() => void>) =>
    act(async () => screenRoot.render(screens(...refetches)))

  /** a fake that already holds one background run, followed by the store */
  async function startRun(options: { batchFails?: boolean; trackAs?: string } = {}) {
    const fake = createFakeShareApi({
      folderContents: { total: 900, batchSteps: 2, batchFails: options.batchFails },
    })
    const started = await fake.folderContentsAccess({
      folderId: 'fld_1',
      mode: 'merge',
      dryRun: false,
      items: [{ principalType: 'user', principalId: 'u_minh', level: 'view' }],
    })
    if (!started.ok || started.value.kind !== 'background') throw new Error('expected background')
    const api: UniworkShareApi = fake
    const batchId = started.value.batchId
    const input = { api, batchId, folderId: 'fld_1', folderTitle: 'Plans', total: 900 }
    trackFolderBatch(input)
    return input
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    resetFolderBatchesForTest()
    resetLiveForTests()
    shellHost = document.createElement('div')
    screenHost = document.createElement('div')
    document.body.append(shellHost, screenHost)
    shellRoot = createRoot(shellHost)
    screenRoot = createRoot(screenHost)
    await act(async () => shellRoot.render(shell()))
  })
  afterEach(async () => {
    vi.useRealTimers()
    resetFolderBatchesForTest()
    await act(async () => shellRoot.unmount())
    await act(async () => screenRoot.unmount())
    shellHost.remove()
    screenHost.remove()
    resetLiveForTests()
  })

  it('every Documents screen gone before the end: still exactly one done toast and one live line', async () => {
    const refetch = vi.fn()
    await mountScreens(refetch)
    await startRun()
    await advance(0)
    await act(async () => screenRoot.unmount())
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.textContent).toContain(t('shrFcBatchDoneOther', { count: 900 }))
    expect(toasts()[0]!.getAttribute('role')).toBeNull()
    expect(live()).toBe(t('shrFcBatchDoneOther', { count: 900 }))
    // the gone screen was not called
    expect(refetch).not.toHaveBeenCalled()
  })

  it('a failed run with no Documents screen mounted: one error toast that reads itself, no live line', async () => {
    await startRun({ batchFails: true })
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.textContent).toContain(t('shrFcBatchFailed'))
    expect(toasts()[0]!.getAttribute('role')).toBe('alert')
    expect(live()).not.toContain(t('shrFcBatchFailed'))
  })

  it('a screen mounted after the end does not tell it again', async () => {
    await startRun()
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(toasts()).toHaveLength(1)
    // the person dismisses it and comes back to Documents
    await act(async () => {
      toasts()[0]!.querySelector<HTMLElement>('.uw-act-toast-close')!.click()
    })
    expect(toasts()).toHaveLength(0)
    const refetch = vi.fn()
    await mountScreens(refetch)
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(toasts()).toHaveLength(0)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('two Documents screens mounted: both refetch, the shell alone toasts, once', async () => {
    const home = vi.fn()
    const browser = vi.fn()
    await mountScreens(home, browser)
    await startRun()
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(home).toHaveBeenCalledTimes(1)
    expect(browser).toHaveBeenCalledTimes(1)
    expect(toasts()).toHaveLength(1)
    expect(live()).toBe(t('shrFcBatchDoneOther', { count: 900 }))
  })

  it('following the same batch again after it ended does not toast it a second time', async () => {
    const input = await startRun()
    await advance(FOLDER_BATCH_POLL_MS * 3)
    await act(async () => {
      toasts()[0]!.querySelector<HTMLElement>('.uw-act-toast-close')!.click()
    })
    expect(toasts()).toHaveLength(0)
    trackFolderBatch(input)
    await advance(FOLDER_BATCH_POLL_MS * 3)
    expect(toasts()).toHaveLength(0)
  })
})
