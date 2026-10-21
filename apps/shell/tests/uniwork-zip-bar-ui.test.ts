/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { ZipDownloadBar } from '../src/renderer/src/uniwork-zip-download/ZipDownloadBar'
import {
  resetZipDownloadStore,
  runZipDownload,
  zipRuns,
} from '../src/renderer/src/uniwork-zip-download/zip-download-store'
import { viewOf } from '../src/renderer/src/uniwork-zip-download/copy'
import { zipDownloadBridge } from '../src/renderer/src/uniwork-library-api'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import {
  attachFolderUploadStore,
  resetFolderUploadStore,
  startFolderUploadRun,
} from '../src/renderer/src/uniwork-folder-upload/folder-upload-store'
import { createFakeFolderUploadBridge } from './folder-upload-fake-bridge'
import { fakeZipBridge, type FakeZipBridge } from './uniwork-zip-fake-bridge'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const doc = (id: string, partial: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
  id,
  workspaceId: 'ws-1',
  title: `${id}.docx`,
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  ...partial,
})
const files = (n: number) => Array.from({ length: n }, (_, i) => doc(`f${i + 1}`))

describe('ZipDownloadBar (UNI-2068 ZB)', () => {
  let host: HTMLDivElement
  let root: Root
  let bridge: FakeZipBridge
  let reveal: ReturnType<typeof vi.fn>
  const bars = () => Array.from(host.querySelectorAll('[data-testid="zip-download-bar"]'))
  const text = () => host.textContent ?? ''
  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
  async function mount(lang: 'vi' | 'en' = 'en') {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: lang }, createElement(ZipDownloadBar)))
    })
  }
  async function start(docs: DocumentsHomeDoc[]) {
    await act(async () => {
      await runZipDownload({ bridge, workspaceId: 'ws-1', screen: 'workspace', docs })
    })
  }
  const push = async (event: Parameters<FakeZipBridge['push']>[0]) =>
    act(async () => {
      bridge.push(event)
    })

  beforeEach(() => {
    localStorage.setItem('genoffice.lang', 'en')
    reveal = vi.fn(async () => undefined)
    ;(window as unknown as { aiOffice: unknown }).aiOffice = { revealPath: reveal }
    bridge = fakeZipBridge()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    resetZipDownloadStore()
    host.remove()
    vi.useRealTimers()
  })

  it('draws nothing while there is no run', async () => {
    await mount()
    expect(bars()).toHaveLength(0)
  })

  it('preparing: a text and an indeterminate meter, with Cancel', async () => {
    await mount()
    await start(files(2))
    expect(text()).toContain('Preparing the zip file…')
    const meter = host.querySelector('progress')!
    expect(meter.hasAttribute('value')).toBe(false)
    expect(button('Cancel')).toBeTruthy()
    // no close mark and no Show in folder while it runs
    expect(button('Show in folder')).toBeUndefined()
    expect(host.querySelector('.zd-bar-close')).toBeNull()
  })

  it('downloading with a total: percent; without one: the bytes so far', async () => {
    await mount()
    await start(files(2))
    const id = zipRuns()[0]!.id
    await push({ runId: id, phase: 'downloading', bytes: 512, totalBytes: 2048 })
    expect(text()).toContain('Downloading… 25%')
    expect(host.querySelector('progress')!.value).toBe(25)
    await push({ runId: id, phase: 'downloading', bytes: 3 * 1024 * 1024, totalBytes: null })
    expect(text()).toMatch(/Downloading… 3(\.0)? ?MB/i)
    expect(host.querySelector('progress')!.hasAttribute('value')).toBe(false)
  })

  it('done: "Downloaded ok/total", at most 5 lines, "and N more", Show in folder', async () => {
    await mount()
    const pages = Array.from({ length: 7 }, (_, i) => doc(`p${i + 1}`, { kind: 'page' }))
    await start([...files(3), ...pages])
    const id = zipRuns()[0]!.id
    await push({ runId: id, phase: 'done', fileCount: 3, path: '/home/u/documents.zip' })
    expect(text()).toContain('Downloaded 3/10 documents')
    const lines = Array.from(host.querySelectorAll('[data-testid="zip-download-lines"] li'))
    expect(lines).toHaveLength(6)
    expect(lines[0]!.textContent).toBe('p1.docx: cannot be downloaded (not a file)')
    expect(lines[4]!.textContent).toBe('p5.docx: cannot be downloaded (not a file)')
    expect(lines[5]!.textContent).toBe('and 2 more documents')
    await act(async () => button('Show in folder')!.click())
    expect(reveal).toHaveBeenCalledWith('/home/u/documents.zip')
    // it has skipped lines, so the bar stays until it is closed
    expect(bars()).toHaveLength(1)
  })

  it('Show in folder keeps a bar that has skipped lines open (TVZ-4)', async () => {
    await mount()
    await start([...files(2), doc('p', { kind: 'page' })])
    await push({ runId: zipRuns()[0]!.id, phase: 'done', fileCount: 2, path: '/b.zip' })
    await act(async () => button('Show in folder')!.click())
    expect(reveal).toHaveBeenCalledWith('/b.zip')
    expect(bars()).toHaveLength(1)
  })

  it('wraps each line title in <bdi> and keeps the colon outside it (TVZ-5)', async () => {
    await mount()
    await start([...files(2), doc('p', { kind: 'page', title: 'Sprint retro' })])
    await push({ runId: zipRuns()[0]!.id, phase: 'done', fileCount: 2, path: '/b.zip' })
    const li = host.querySelector('[data-testid="zip-download-lines"] li')!
    expect(li.querySelector('bdi')!.textContent).toBe('Sprint retro')
    expect(li.textContent).toBe('Sprint retro: cannot be downloaded (not a file)')
    expect(li.firstChild!.nodeName).toBe('BDI')
  })

  const withPane = async (width: number, run: () => Promise<void>) => {
    const pane = document.createElement('div')
    pane.className = 'dh-main'
    pane.getBoundingClientRect = () =>
      ({ left: 0, right: width, width, top: 0, bottom: 600, height: 600 }) as DOMRect
    document.body.appendChild(pane)
    try {
      await run()
    } finally {
      pane.remove()
      resetFolderUploadStore()
    }
  }
  const zipStyle = () => (host.querySelector('.zd-bars') as HTMLElement).style

  it('splits a narrow pane with the folder-upload bars while both are on screen (TVZ-1)', async () =>
    withPane(750, async () => {
      const uploadBridge = createFakeFolderUploadBridge()
      attachFolderUploadStore(uploadBridge)
      await mount()
      await start(files(2))
      // alone, the zip bar keeps the old rule: min(380, 750 - 32)
      expect(zipStyle().width).toBe('380px')
      await act(async () => {
        startFolderUploadRun(uploadBridge, {
          runId: 'u1',
          mode: 'folder',
          name: 'Board',
          targetLabel: 'Library',
          phase: 'uploading',
          done: 0,
          failed: 0,
          total: 4,
          failures: [],
        })
      })
      // 750 pane: 16 + 351 + 16 + 351 + 16; the zip bar takes the right half
      expect(zipStyle().width).toBe('351px')
      expect(zipStyle().left).toBe('383px')
    }))

  it('keeps the whole 380px cap when it is the only bar stack in a 750 px pane', async () =>
    withPane(750, async () => {
      await mount()
      await start(files(2))
      expect(zipStyle().width).toBe('380px')
      expect(zipStyle().left).toBe('354px')
    }))

  it('a clean result leaves on its own after 10 s; one with lines waits for the close mark', async () => {
    vi.useFakeTimers()
    await mount()
    await start(files(2))
    await push({ runId: zipRuns()[0]!.id, phase: 'done', fileCount: 2, path: '/a.zip' })
    expect(bars()).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(10_001)
    })
    expect(bars()).toHaveLength(0)

    await start([...files(2), doc('p', { kind: 'page' })])
    await push({ runId: zipRuns()[0]!.id, phase: 'done', fileCount: 2, path: '/b.zip' })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(bars()).toHaveLength(1)
    await act(async () => host.querySelector<HTMLElement>('.zd-bar-close')!.click())
    expect(bars()).toHaveLength(0)
  })

  it('names the error of a failed run: too large, expired, busy, timeout, unavailable, save', async () => {
    await mount()
    const cases: Array<[Parameters<FakeZipBridge['push']>[0]['error'], string]> = [
      [
        { code: 'zip_too_large' },
        'The selected files add up to more than 1 GB. Choose fewer files.',
      ],
      [{ code: 'zip_expired' }, 'The download link has expired. Try again.'],
      [
        { code: 'zip_busy', retryAfterSeconds: 30 },
        'Two zip files are already being prepared. Wait for one to finish, then try again.',
      ],
      [{ code: 'zip_timeout' }, 'The zip file is not ready yet. Try again later.'],
      [{ code: 'zip_unavailable' }, 'This server cannot make zip files yet.'],
      [{ code: 'write_failed' }, 'The file could not be saved there. Choose another folder.'],
      [{ code: 'network' }, 'The zip file could not be made. Try again.'],
    ]
    for (const [error, message] of cases) {
      await start(files(2))
      await push({ runId: zipRuns().at(-1)!.id, phase: 'failed', error })
      expect(bars().at(-1)!.textContent).toContain(message)
      expect(bars().at(-1)!.className).toContain(
        error.code === 'zip_busy' ? 'zd-bar-warn' : 'zd-bar-error',
      )
      await act(async () => host.querySelector<HTMLElement>('.zd-bar-close')!.click())
    }
  })

  it('a failed single-file download reads "name: reason" and offers no Cancel', async () => {
    await mount()
    bridge.nextFile = { ok: false, path: null, code: 'too_large' }
    await start([doc('a')])
    expect(text()).toContain('a.docx: too large to download')
    expect(button('Cancel')).toBeUndefined()
  })

  it('a failed single-file save reads the save sentence and keeps the rows left out', async () => {
    await mount()
    bridge.nextFile = { ok: false, path: null, code: 'write_failed' }
    await start([doc('a'), doc('d', { kind: 'folder', title: 'Docs' })])
    expect(text()).toContain('The file could not be saved there. Choose another folder.')
    expect(text()).toContain('Docs: cannot be downloaded (not a file)')
  })

  it('places the bar inside the main pane with right auto, so rtl keeps it there', async () => {
    const pane = document.createElement('div')
    pane.className = 'dh-main'
    pane.getBoundingClientRect = () => ({ left: 0, right: 900, width: 900 }) as DOMRect
    document.body.appendChild(pane)
    try {
      await mount()
      await start(files(2))
      const wrap = host.querySelector<HTMLElement>('.zd-bars')!
      expect(wrap.style.right).toBe('auto')
      expect(wrap.style.left).not.toBe('')
      expect(wrap.style.width).not.toBe('')
    } finally {
      pane.remove()
    }
  })

  it('canceled run: says so, with no Show in folder', async () => {
    await mount()
    await start(files(2))
    await push({ runId: zipRuns()[0]!.id, phase: 'canceled' })
    expect(text()).toContain('Download canceled')
    expect(button('Show in folder')).toBeUndefined()
  })

  it('reads in Vietnamese with the web copy', async () => {
    localStorage.setItem('genoffice.lang', 'vi')
    await mount('vi')
    await start(files(2))
    expect(text()).toContain('Đang chuẩn bị tệp nén…')
    expect(button('Hủy')).toBeTruthy()
    await push({ runId: zipRuns()[0]!.id, phase: 'failed', error: { code: 'zip_expired' } })
    expect(text()).toContain('Liên kết tải đã hết hạn. Hãy thử lại.')
  })

  it('stays after a screen leaves: the runs belong to the store, not to the bar', async () => {
    await mount()
    await start(files(2))
    await act(async () => root.unmount())
    root = createRoot(host)
    await push({ runId: zipRuns()[0]!.id, phase: 'downloading', bytes: 1, totalBytes: 4 })
    await mount()
    expect(text()).toContain('Downloading… 25%')
  })
})

describe('zipDownloadBridge accessor (UNI-2068 ZB)', () => {
  afterEach(() => {
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  it('is null for an older main without the bridge, and for a half bridge', () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
    expect(zipDownloadBridge()).toBeNull()
    ;(window as unknown as { aiOffice: unknown }).aiOffice = { zipDownload: { start: () => {} } }
    expect(zipDownloadBridge()).toBeNull()
  })

  it('is the preload object when it has start and downloadFile', () => {
    const bridge = fakeZipBridge()
    ;(window as unknown as { aiOffice: unknown }).aiOffice = { zipDownload: bridge }
    expect(zipDownloadBridge()).toBe(bridge)
  })
})

describe('viewOf (UNI-2068 ZB)', () => {
  const t = ((key: string) => key) as never
  const run = {
    kind: 'zip' as const,
    phase: 'done' as const,
    bytes: 0,
    totalBytes: null,
    total: 2,
    ok: 2,
    lines: [],
    fileName: null,
    path: '/a.zip',
    error: null,
  }

  it('a result with lines is warn when something went, error when nothing did', () => {
    const lines = [{ documentId: 'x', title: 'x', reason: 'not_found' as const }]
    expect(viewOf(t, { ...run, lines }, String).tone).toBe('warn')
    expect(viewOf(t, { ...run, lines, ok: 0 }, String).tone).toBe('error')
    expect(viewOf(t, run, String).tone).toBe('ok')
  })

  it('zip_busy is a warning, other failures stay errors (TVZ-3)', () => {
    const failed = { ...run, phase: 'failed' as const, ok: 0 }
    expect(viewOf(t, { ...failed, error: 'zip_busy' }, String).tone).toBe('warn')
    expect(viewOf(t, { ...failed, error: 'zip_failed' }, String).tone).toBe('error')
  })

  it('a done run without a saved path has no Show in folder', () => {
    expect(viewOf(t, { ...run, path: null }, String).revealable).toBe(false)
    expect(viewOf(t, run, String).revealable).toBe(true)
  })
})
