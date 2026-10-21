/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { announce } from '../src/renderer/src/uniwork-live'
import { FolderUploadLayer } from '../src/renderer/src/uniwork-folder-upload/FolderUploadLayer'
import {
  useFolderUpload,
  type FolderUploadController,
} from '../src/renderer/src/uniwork-folder-upload/use-folder-upload'
import type { FolderUploadBridge } from '../src/renderer/src/uniwork-folder-upload/bridge'
import {
  createFakeFolderUploadBridge,
  preflightOf,
  progressOf,
  type FakeFolderUploadBridge,
} from './folder-upload-fake-bridge'

vi.mock('../src/renderer/src/uniwork-live', () => ({ announce: vi.fn() }))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const MIB = 1024 * 1024
const TARGET = { workspaceId: 'ws-1', folderId: 'f-board' }

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('folder / multi-file upload screens', () => {
  let host: HTMLDivElement
  let root: Root
  let bridge: FakeFolderUploadBridge
  let controller: FolderUploadController
  let onFinished: ReturnType<typeof vi.fn>
  let onOpenFolder: ReturnType<typeof vi.fn>

  function Harness({ lang }: { lang: 'vi' | 'en' }) {
    // the bridge is the fake unless a test mounts without one
    controller = useFolderUpload({
      bridge: bridgeInUse,
      onFinished: onFinished as () => void,
      onOpenFolder: onOpenFolder as (id: string) => void,
    })
    void lang
    return createElement(FolderUploadLayer, { controller })
  }
  let bridgeInUse: FolderUploadBridge | null

  async function mount(lang: 'vi' | 'en' = 'vi'): Promise<void> {
    await act(async () => {
      root.render(
        createElement(LocaleProvider, { initial: lang }, createElement(Harness, { lang })),
      )
    })
    await flush()
  }

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const buttonNamed = (name: string | RegExp, within: ParentNode = document) =>
    Array.from(within.querySelectorAll<HTMLElement>('button')).find((b) =>
      typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? ''),
    )
  const click = async (el: Element | undefined | null) => {
    expect(el, 'element to click').toBeTruthy()
    await act(async () => {
      ;(el as HTMLElement).click()
    })
    await flush()
  }
  const stage = async (...sdos: ReturnType<typeof preflightOf>[]) => {
    bridge.preflight.mockResolvedValueOnce(sdos)
    await act(async () => {
      await controller.drop(TARGET, ['/disk/x'])
    })
    await flush()
  }
  const bars = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="folder-upload-bar"]'))

  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    bridge = createFakeFolderUploadBridge()
    bridgeInUse = bridge
    onFinished = vi.fn()
    onOpenFolder = vi.fn()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  describe('availability', () => {
    it('no bridge = the feature is not available at all', async () => {
      bridgeInUse = null
      await mount()
      expect(controller.available).toBe(false)
      expect(controller.foldersAvailable).toBe(false)
    })

    it('folders are offered when the bridge says so', async () => {
      await mount()
      expect(controller.available).toBe(true)
      expect(controller.foldersAvailable).toBe(true)
      expect(bridge.foldersAvailable).toHaveBeenCalledTimes(1)
    })

    it('a bridge whose availability call fails offers no folders (files still work)', async () => {
      bridgeInUse = createFakeFolderUploadBridge()
      ;(bridgeInUse as FakeFolderUploadBridge).foldersAvailable.mockRejectedValueOnce(
        new Error('x'),
      )
      await mount()
      expect(controller.available).toBe(true)
      expect(controller.foldersAvailable).toBe(false)
    })

    it('hides folders when the server has no folder-upload block', async () => {
      bridgeInUse = createFakeFolderUploadBridge({ folders: false })
      await mount()
      expect(controller.available).toBe(true)
      expect(controller.foldersAvailable).toBe(false)
    })

    it('subscribes to progress once and keeps listening after unmount (the store outlives the screen)', async () => {
      await mount()
      expect(bridge.listeners).toBe(1)
      await act(async () => {
        root.unmount()
      })
      expect(bridge.listeners).toBe(1)
      root = createRoot(host)
    })
  })

  describe('pick and drop stage a pre-flight', () => {
    it('pick asks main for the picker of that target and mode, and shows the pre-flight', async () => {
      bridge.pick.mockResolvedValueOnce(preflightOf())
      await mount()
      let staged = false
      await act(async () => {
        staged = await controller.pick(TARGET, 'folder')
      })
      await flush()
      expect(staged).toBe(true)
      expect(bridge.pick).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        folderId: 'f-board',
        mode: 'folder',
      })
      expect(dialog()).not.toBeNull()
    })

    it('a canceled picker stages nothing and says nothing', async () => {
      await mount()
      let staged = true
      await act(async () => {
        staged = await controller.pick(TARGET, 'files')
      })
      await flush()
      expect(staged).toBe(false)
      expect(dialog()).toBeNull()
      expect(document.querySelector('[role="alert"]')).toBeNull()
    })

    it('a picker that fails says so', async () => {
      bridge.pick.mockRejectedValueOnce(new Error('boom'))
      await mount()
      await act(async () => {
        await controller.pick(TARGET, 'folder')
      })
      await flush()
      expect(dialog()).toBeNull()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'Không đọc được mục vừa chọn.',
      )
    })

    it('a drop sends the absolute paths with the target and stages every answer in order', async () => {
      bridge.preflight.mockResolvedValueOnce([
        preflightOf({
          preflightId: 'pf-files',
          mode: 'files',
          rootName: undefined,
          totals: { files: 12, bytes: 30 * MIB },
        }),
        preflightOf({ preflightId: 'pf-a', rootName: 'A' }),
      ])
      await mount()
      await act(async () => {
        await controller.drop({ workspaceId: 'ws-1', folderId: null }, [
          '/d/a.docx',
          '/d/b.md',
          '/d/A',
        ])
      })
      await flush()
      expect(bridge.preflight).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        folderId: null,
        paths: ['/d/a.docx', '/d/b.md', '/d/A'],
      })
      expect(controller.queue.map((q) => q.preflightId)).toEqual(['pf-files', 'pf-a'])
      // the files group is the first dialog, the folder waits behind it
      expect(
        dialog()?.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
      ).toBe('files')
      expect(dialog()?.textContent).toContain('Còn 1 lượt tải lên đang chờ.')
    })
  })

  describe('pre-flight dialog', () => {
    it('folder mode: root name, target, "40 tệp · 125,3 MB", share OFF, Hủy / Tải lên', async () => {
      await mount()
      await stage(preflightOf())
      const d = dialog()!
      expect(d.querySelector('h3')?.textContent).toBe('Tải lên thư mục')
      expect(d.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe('Hồ sơ 2052')
      expect(d.querySelector('[data-testid="folder-upload-target"]')?.textContent).toBe(
        'Báo cáo HĐQT Q4',
      )
      expect(d.querySelector('[data-testid="folder-upload-summary"]')?.textContent).toBe(
        '40 tệp · 125,3 MB',
      )
      const share = d.querySelector<HTMLElement>('[role="switch"]')!
      expect(share.getAttribute('aria-checked')).toBe('false')
      expect(d.textContent).toContain('Thư mục vẫn riêng tư.')
      expect(buttonNamed('Hủy', d)).toBeTruthy()
      expect(buttonNamed('Tải lên', d)).toBeTruthy()
      expect(d.querySelector('[data-testid="folder-upload-renamed"]')).toBeNull()
    })

    it('files mode: no root row, "12 tệp · 30 MB" into the target, files wording', async () => {
      await mount()
      await stage(
        preflightOf({
          mode: 'files',
          rootName: undefined,
          totals: { files: 12, bytes: 30 * MIB },
          target: { workspaceId: 'ws-1', folderId: null, label: 'Thư mục của tôi' },
        }),
      )
      const d = dialog()!
      expect(d.querySelector('h3')?.textContent).toBe('Tải lên tệp')
      expect(d.querySelector('[data-testid="folder-upload-root"]')).toBeNull()
      expect(d.querySelector('[data-testid="folder-upload-summary"]')?.textContent).toBe(
        '12 tệp · 30 MB',
      )
      expect(d.querySelector('[data-testid="folder-upload-target"]')?.textContent).toBe(
        'Thư mục của tôi',
      )
      expect(d.textContent).not.toContain('Thư mục vẫn riêng tư.')
      expect(d.textContent).toContain('Áp dụng cho mọi tệp trong lần tải lên này.')
    })

    it.each([
      ['vi', 'Thư mục của tôi'],
      ['en', 'My Folder'],
    ] as const)(
      'FU-V2: a My Folder destination shows the localised name, not the stored title (%s)',
      async (lang, expected) => {
        await mount(lang)
        await stage(
          preflightOf({
            mode: 'files',
            rootName: undefined,
            target: {
              workspaceId: 'ws-1',
              folderId: 'my1',
              label: 'my-folder-raw',
              myFolder: true,
            },
          }),
        )
        expect(dialog()?.querySelector('[data-testid="folder-upload-target"]')?.textContent).toBe(
          expected,
        )
        expect(dialog()?.textContent).not.toContain('my-folder-raw')
      },
    )

    it('FU-V2: a plain destination keeps its own title', async () => {
      await mount('en')
      await stage(preflightOf())
      expect(
        dialog()?.querySelector('[data-testid="folder-upload-target"]')?.textContent,
      ).toBe('Báo cáo HĐQT Q4')
    })

    it('en reads "1 file" at exactly one', async () => {
      await mount('en')
      await stage(preflightOf({ totals: { files: 1, bytes: 2900 } }))
      expect(dialog()?.querySelector('[data-testid="folder-upload-summary"]')?.textContent).toBe(
        '1 file · 2.8 KB',
      )
    })

    it('shows the title the folder will get when its name is taken, and says why', async () => {
      await mount()
      await stage(preflightOf({ rootName: 'Hồ sơ 2052', rootNamePreview: 'Hồ sơ 2052 (1)' }))
      const d = dialog()!
      expect(d.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe(
        'Hồ sơ 2052 (1)',
      )
      expect(d.querySelector('[data-testid="folder-upload-renamed"]')?.textContent).toBe(
        'Đã có “Hồ sơ 2052” ở đây, nên thư mục này sẽ thành “Hồ sơ 2052 (1)”.',
      )
    })

    it('lists skipped files grouped by reason, collapsed until opened', async () => {
      await mount()
      await stage(
        preflightOf({
          skipped: [
            { path: 'Hồ sơ/.hidden-notes.txt', reason: 'hidden' },
            { path: 'Hồ sơ/skip-me.dat', reason: 'unsupported_format' },
            { path: 'Hồ sơ/.DS_Store', reason: 'hidden' },
            { path: 'Hồ sơ/lối-tắt', reason: 'link' },
          ],
        }),
      )
      const d = dialog()!
      const section = d.querySelector('section')!
      expect(section.getAttribute('aria-label')).toBe('Bỏ qua 4 tệp')
      const rows = Array.from(section.querySelectorAll('.fu-skipped-row')).map(
        (r) => r.querySelector('span')?.textContent,
      )
      expect(rows).toEqual([
        'Tệp ẩn hoặc tệp hệ thống · 2',
        'Định dạng chưa được hỗ trợ · 1',
        'Liên kết hoặc lối tắt (không theo) · 1',
      ])
      expect(section.querySelector('.fu-paths')).toBeNull()
      const toggle = section.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.textContent).toBe('Ẩn danh sách')
      const listId = toggle.getAttribute('aria-controls')!
      expect(
        Array.from(document.getElementById(listId)!.querySelectorAll('li')).map(
          (li) => li.textContent,
        ),
      ).toEqual(['Hồ sơ/.hidden-notes.txt', 'Hồ sơ/.DS_Store'])
      await click(toggle)
      expect(section.querySelector('.fu-paths')).toBeNull()
    })

    it('a refusal shows the numbers and takes the run away: no summary, no share switch, Upload does nothing', async () => {
      await mount()
      await stage(
        preflightOf({
          refusal: { code: 'too_many_files', limit: 500, actual: 612 },
          totals: { files: 612, bytes: 5 * MIB },
        }),
      )
      const d = dialog()!
      const banner = d.querySelector('[data-testid="folder-upload-refusal"]')!
      expect(banner.getAttribute('role')).toBe('alert')
      expect(banner.textContent).toContain('Chưa tải lên được thư mục này')
      expect(banner.textContent).toContain('612 tệp — tối đa 500')
      expect(d.querySelector('[data-testid="folder-upload-summary"]')).toBeNull()
      expect(d.querySelector('[role="switch"]')).toBeNull()
      const upload = buttonNamed('Tải lên', d)!
      expect(upload.getAttribute('aria-disabled')).toBe('true')
      await click(upload)
      expect(bridge.start).not.toHaveBeenCalled()
      // the safe answer holds the focus
      expect(document.activeElement?.textContent).toBe('Hủy')
    })

    it('opens with the focus on Upload and names every control', async () => {
      await mount()
      await stage(preflightOf())
      const d = dialog()!
      expect(document.activeElement?.textContent).toBe('Tải lên')
      expect(d.getAttribute('aria-modal')).toBe('true')
      expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe(
        'Tải lên thư mục',
      )
      expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toContain(
        'Chưa có gì được ghi',
      )
      const share = d.querySelector<HTMLElement>('[role="switch"]')!
      expect(document.getElementById(share.getAttribute('aria-labelledby')!)?.textContent).toBe(
        'Chia sẻ với workspace',
      )
      expect(
        document.getElementById(share.getAttribute('aria-describedby')!)?.textContent,
      ).toContain('Áp dụng cho mọi tệp')
    })

    it('Cancel and Esc drop only this pre-flight and show the next one', async () => {
      await mount()
      await stage(
        preflightOf({ preflightId: 'pf-1', rootName: 'Một' }),
        preflightOf({ preflightId: 'pf-2', rootName: 'Hai' }),
      )
      expect(dialog()?.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe('Một')
      await click(buttonNamed('Hủy', dialog()!))
      expect(dialog()?.querySelector('[data-testid="folder-upload-root"]')?.textContent).toBe('Hai')
      expect(dialog()?.textContent).not.toContain('đang chờ')
      await act(async () => {
        dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(dialog()).toBeNull()
      expect(bridge.start).not.toHaveBeenCalled()
    })
  })

  describe('starting a run', () => {
    it('sends the share switch: OFF by default, ON when switched', async () => {
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      expect(bridge.start).toHaveBeenLastCalledWith({
        preflightId: 'pf-1',
        shareWithWorkspace: false,
      })

      await stage(preflightOf({ preflightId: 'pf-2' }))
      const share = dialog()!.querySelector<HTMLElement>('[role="switch"]')!
      await click(share)
      expect(share.getAttribute('aria-checked')).toBe('true')
      await click(buttonNamed('Tải lên', dialog()!))
      expect(bridge.start).toHaveBeenLastCalledWith({
        preflightId: 'pf-2',
        shareWithWorkspace: true,
      })
    })

    it('each staged pre-flight starts private again', async () => {
      await mount()
      await stage(preflightOf({ preflightId: 'pf-1' }), preflightOf({ preflightId: 'pf-2' }))
      await click(dialog()!.querySelector('[role="switch"]'))
      await click(buttonNamed('Hủy', dialog()!))
      expect(dialog()!.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    })

    it('while the run starts the button reads "Đang chuẩn bị…" and the dialog cannot be dismissed', async () => {
      let resolveStart!: (v: { ok: true; runId: string }) => void
      bridge.start.mockImplementationOnce(() => new Promise((resolve) => (resolveStart = resolve)))
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      const submit = dialog()!.querySelector<HTMLElement>('[data-fu-submit]')!
      expect(submit.textContent).toBe('Đang chuẩn bị…')
      expect(submit.getAttribute('aria-busy')).toBe('true')
      // a second press and Esc do nothing
      await click(submit)
      await act(async () => {
        dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(bridge.start).toHaveBeenCalledTimes(1)
      expect(dialog()).not.toBeNull()
      await act(async () => {
        resolveStart({ ok: true, runId: 'run-1' })
      })
      await flush()
      expect(dialog()).toBeNull()
      expect(bars()).toHaveLength(1)
    })

    it('a start that fails keeps the dialog and says so', async () => {
      bridge.start.mockRejectedValueOnce(new Error('busy'))
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      const d = dialog()!
      expect(d.querySelector('[role="alert"]')?.textContent).toBe(
        'Không bắt đầu tải lên được. Thử lại sau ít phút.',
      )
      expect(buttonNamed('Tải lên', d)?.getAttribute('aria-busy')).toBeNull()
      // and the person may try again
      await click(buttonNamed('Tải lên', d))
      expect(bridge.start).toHaveBeenCalledTimes(2)
      expect(dialog()).toBeNull()
    })
  })

  describe('the overall progress bar', () => {
    const start = async (sdo = preflightOf()) => {
      await stage(sdo)
      await click(buttonNamed('Tải lên', dialog()!))
    }

    it('shows one bar for the run: preparing, then "12/40 tệp" with a meter and "Hủy tất cả"', async () => {
      await mount()
      await start()
      expect(bars()).toHaveLength(1)
      expect(bars()[0]!.textContent).toContain('Đang chuẩn bị “Hồ sơ 2052”…')
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 12 })))
      const bar = bars()[0]!
      expect(bar.textContent).toContain('Đang tải lên “Hồ sơ 2052” — 12/40 tệp')
      const meter = bar.querySelector('progress')!
      expect(meter.value).toBe(30)
      expect(meter.getAttribute('aria-label')).toBe('Đang tải lên “Hồ sơ 2052” — 12/40 tệp')
      expect(buttonNamed('Hủy tất cả', bar)).toBeTruthy()
      // never one bar per file
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 13 })))
      expect(bars()).toHaveLength(1)
    })

    it('files mode names no folder while it runs', async () => {
      await mount()
      await start(
        preflightOf({ mode: 'files', rootName: undefined, totals: { files: 12, bytes: 30 * MIB } }),
      )
      await act(async () => bridge.emit(progressOf({ done: 3, total: 12 })))
      expect(bars()[0]!.textContent).toContain('Đang tải lên — 3/12 tệp')
    })

    it('FU-V3: the bars sit in the main pane, not over the sidebar, and keep the 380px / 16px rules', async () => {
      const main = document.createElement('div')
      main.className = 'dh-main'
      const rect = { left: 300, right: 900, top: 0, bottom: 700, width: 600, height: 700 }
      main.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect })
      document.body.appendChild(main)
      await mount()
      await start()
      const region = document.querySelector<HTMLElement>('.fu-bars')!
      expect(region.style.left).toBe('316px')
      expect(region.style.width).toBe('380px')
      // a narrow pane: the bar shrinks to the pane minus the two gutters
      rect.width = 300
      rect.right = 600
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })
      expect(region.style.width).toBe('268px')
      main.remove()
    })

    it('applies progress that arrives before the start call has answered', async () => {
      let resolveStart!: (v: { ok: true; runId: string }) => void
      bridge.start.mockImplementationOnce(() => new Promise((resolve) => (resolveStart = resolve)))
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () =>
        bridge.emit(progressOf({ runId: 'run-9', phase: 'uploading', done: 7 })),
      )
      await act(async () => {
        resolveStart({ ok: true, runId: 'run-9' })
      })
      await flush()
      expect(bars()[0]!.textContent).toContain('7/40 tệp')
    })

    it('ignores the progress of a run this screen did not start', async () => {
      await mount()
      await start()
      await act(async () =>
        bridge.emit(progressOf({ runId: 'someone-else', done: 40, phase: 'done' })),
      )
      expect(bars()).toHaveLength(1)
      expect(bars()[0]!.getAttribute('data-phase')).toBe('planning')
    })

    it('"Hủy tất cả" cancels the run; the bar then says what was kept', async () => {
      await mount()
      await start()
      await act(async () => bridge.emit(progressOf({ done: 12 })))
      await click(buttonNamed('Hủy tất cả', bars()[0]!))
      expect(bridge.cancel).toHaveBeenCalledWith({ runId: 'run-1' })
      // the bar stays until main says it stopped
      expect(bars()[0]!.getAttribute('data-phase')).toBe('uploading')
      await act(async () => bridge.emit(progressOf({ phase: 'canceled', done: 12 })))
      expect(bars()[0]!.textContent).toContain('Đã hủy — 12 tệp đã tải lên được giữ lại')
      expect(buttonNamed('Hủy tất cả', bars()[0]!)).toBeUndefined()
      expect(onFinished).toHaveBeenCalledTimes(1)
    })

    it('a canceled run with nothing up says so, and the bar leaves by itself', async () => {
      vi.useFakeTimers()
      await mount()
      await start()
      await act(async () => bridge.emit(progressOf({ phase: 'canceled', done: 0 })))
      expect(bars()[0]!.textContent).toContain('Đã hủy tải lên')
      await act(async () => {
        vi.advanceTimersByTime(6100)
      })
      expect(bars()).toHaveLength(0)
    })

    it('done: "Đã tải lên 40 tệp vào “Tên”" with the real title, "Mở thư mục" opens it, then the bar goes', async () => {
      await mount()
      await start()
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 40,
            rootTitle: 'Hồ sơ 2052 (1)',
            rootFolderId: 'f-new',
          }),
        ),
      )
      const bar = bars()[0]!
      expect(bar.textContent).toContain('Đã tải lên 40 tệp vào “Hồ sơ 2052 (1)”')
      expect(onFinished).toHaveBeenCalledTimes(1)
      await click(buttonNamed('Mở thư mục', bar))
      expect(onOpenFolder).toHaveBeenCalledWith('f-new')
      expect(bars()).toHaveLength(0)
      // the end state was done: nothing to dismiss on the server
      expect(bridge.dismiss).not.toHaveBeenCalled()
    })

    it('done in files mode: "Đã tải lên 12 tệp" and no folder to open', async () => {
      await mount()
      await start(
        preflightOf({ mode: 'files', rootName: undefined, totals: { files: 12, bytes: 30 * MIB } }),
      )
      await act(async () =>
        bridge.emit(progressOf({ phase: 'done', done: 12, total: 12, rootFolderId: 'f-board' })),
      )
      const bar = bars()[0]!
      expect(bar.textContent).toContain('Đã tải lên 12 tệp')
      expect(buttonNamed('Mở thư mục', bar)).toBeUndefined()
    })

    it('a finished upload leaves by itself after ten seconds', async () => {
      vi.useFakeTimers()
      await mount()
      await start()
      await act(async () => bridge.emit(progressOf({ phase: 'done', done: 40 })))
      await act(async () => {
        vi.advanceTimersByTime(9000)
      })
      expect(bars()).toHaveLength(1)
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      expect(bars()).toHaveLength(0)
    })

    it('en reads "Uploaded 1 file to “Name”"', async () => {
      await mount('en')
      await stage(preflightOf({ totals: { files: 1, bytes: 10 } }))
      await click(buttonNamed('Upload', dialog()!))
      await act(async () =>
        bridge.emit(progressOf({ phase: 'done', done: 1, total: 1, rootTitle: 'Notes' })),
      )
      expect(bars()[0]!.textContent).toContain('Uploaded 1 file to “Notes”')
    })

    it('a run that failed as a whole stays until closed', async () => {
      vi.useFakeTimers()
      await mount()
      await start()
      await act(async () => bridge.emit(progressOf({ phase: 'failed' })))
      expect(bars()[0]!.textContent).toContain('Không tải lên được “Hồ sơ 2052”')
      await act(async () => {
        vi.advanceTimersByTime(60_000)
      })
      expect(bars()).toHaveLength(1)
      await click(bars()[0]!.querySelector('.fu-bar-close'))
      expect(bars()).toHaveLength(0)
      // nothing finished, so the server has nothing to dismiss either
      expect(bridge.dismiss).not.toHaveBeenCalled()
    })

    it('says each end state once to assistive technology and names the close button', async () => {
      await mount()
      await start()
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 38,
            failed: 2,
            failures: [{ path: 'a', code: 'network', retryable: true }],
          }),
        ),
      )
      const close = bars()[0]!.querySelector('.fu-bar-close')!
      expect(close.getAttribute('aria-label')).toBe('Đóng')
      expect(document.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Tải lên')
    })
  })

  describe('failures: report, retry and dismiss', () => {
    const failures = [
      { path: 'Hồ sơ/Hợp đồng/a.docx', code: 'network', retryable: true },
      { path: 'Hồ sơ/b.xlsx', code: 'unsupported_media', retryable: false },
    ]
    const partial = async () => {
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () =>
        bridge.emit(
          progressOf({ phase: 'done', done: 38, failed: 2, failures, rootTitle: 'Hồ sơ 2052' }),
        ),
      )
    }

    it('"38/40 tệp · 2 lỗi" with "Xem"; the bar stays until a decision', async () => {
      vi.useFakeTimers()
      await partial()
      const bar = bars()[0]!
      expect(bar.textContent).toContain('38/40 tệp đã tải lên · 2 lỗi')
      expect(buttonNamed('Xem', bar)).toBeTruthy()
      await act(async () => {
        vi.advanceTimersByTime(60_000)
      })
      expect(bars()).toHaveLength(1)
    })

    it('"Xem" opens the report: each file with its reason, and "Thử lại các tệp lỗi"', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      const d = dialog()!
      expect(d.querySelector('h3')?.textContent).toBe('Tệp chưa tải lên được')
      expect(d.textContent).toContain('“Hồ sơ 2052”: 2 tệp bị lỗi.')
      const items = Array.from(d.querySelectorAll('[data-testid="folder-upload-failures"] li')).map(
        (li) => Array.from(li.querySelectorAll('span')).map((s) => s.textContent),
      )
      expect(items).toEqual([
        ['Hồ sơ/Hợp đồng/a.docx', 'Mất kết nối khi tải tệp này.'],
        ['Hồ sơ/b.xlsx', 'Nội dung tệp không đúng định dạng.'],
      ])
      expect(
        d.querySelector('[data-testid="folder-upload-failures"]')?.getAttribute('aria-label'),
      ).toBe('Danh sách tệp lỗi')
      expect(buttonNamed('Thử lại các tệp lỗi', d)).toBeTruthy()
      expect(buttonNamed('Đóng', d)).toBeTruthy()
    })

    it('retry runs only the failed files again: the report closes and the bar is a progress line again', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      await click(buttonNamed('Thử lại các tệp lỗi', dialog()!))
      expect(bridge.retry).toHaveBeenCalledWith({ runId: 'run-1' })
      expect(dialog()).toBeNull()
      expect(bridge.dismiss).not.toHaveBeenCalled()
      expect(bars()[0]!.getAttribute('data-phase')).toBe('uploading')
      await act(async () =>
        bridge.emit(progressOf({ phase: 'done', done: 40, rootTitle: 'Hồ sơ 2052' })),
      )
      expect(bars()[0]!.textContent).toContain('Đã tải lên 40 tệp vào “Hồ sơ 2052”')
      expect(onFinished).toHaveBeenCalledTimes(2)
    })

    it('"Đóng" on the report only closes the report: the bar and the batch stay (RV-FE #7)', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      await click(buttonNamed('Đóng', dialog()!))
      expect(dialog()).toBeNull()
      expect(bridge.dismiss).not.toHaveBeenCalled()
      expect(bridge.retry).not.toHaveBeenCalled()
      expect(bars()).toHaveLength(1)
      // the report can be opened again, and still offers the retry
      await click(buttonNamed('Xem', bars()[0]!))
      expect(buttonNamed('Thử lại các tệp lỗi', dialog()!)).toBeTruthy()
    })

    it('Esc on the report only closes it', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      await act(async () => {
        dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(dialog()).toBeNull()
      expect(bridge.dismiss).not.toHaveBeenCalled()
      expect(bars()).toHaveLength(1)
    })

    it('a click on the overlay only closes the report', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      await click(document.querySelector('.uw-act-overlay'))
      expect(dialog()).toBeNull()
      expect(bridge.dismiss).not.toHaveBeenCalled()
      expect(bars()).toHaveLength(1)
    })

    it('× on the bar of a run that ended with failures dismisses it too', async () => {
      await partial()
      await click(bars()[0]!.querySelector('.fu-bar-close'))
      expect(bridge.dismiss).toHaveBeenCalledWith({ runId: 'run-1' })
      expect(bars()).toHaveLength(0)
    })

    it('a report whose failures are all final has no retry, and says what to do', async () => {
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 39,
            failed: 1,
            failures: [{ path: 'b.xlsx', code: 'storage_quota_exceeded', retryable: false }],
          }),
        ),
      )
      await click(buttonNamed('Xem', bars()[0]!))
      const d = dialog()!
      expect(buttonNamed('Thử lại các tệp lỗi', d)).toBeUndefined()
      expect(d.textContent).toContain('Sửa các tệp này rồi tải lên lại.')
      expect(d.textContent).toContain('Đã hết dung lượng lưu trữ.')
    })

    it('a mixed report keeps the retry and still says what to do about the final failures (RV-FE #10)', async () => {
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      const d = dialog()!
      expect(buttonNamed('Thử lại các tệp lỗi', d)).toBeTruthy()
      expect(d.textContent).toContain('Sửa các tệp này rồi tải lên lại.')
    })

    it('a report whose failures are all retryable has no final hint', async () => {
      await mount()
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 39,
            failed: 1,
            failures: [{ path: 'a.docx', code: 'network', retryable: true }],
          }),
        ),
      )
      await click(buttonNamed('Xem', bars()[0]!))
      expect(dialog()!.textContent).not.toContain('Sửa các tệp này rồi tải lên lại.')
    })

    it('a retry that cannot start says so and drops the bar', async () => {
      bridge.retry.mockRejectedValueOnce(new Error('gone'))
      await partial()
      await click(buttonNamed('Xem', bars()[0]!))
      await click(buttonNamed('Thử lại các tệp lỗi', dialog()!))
      expect(bars()).toHaveLength(0)
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        'Không bắt đầu tải lên được.',
      )
    })

    it('files with the same name are all listed', async () => {
      await mount()
      await stage(preflightOf({ mode: 'files', rootName: undefined }))
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 0,
            failed: 2,
            total: 2,
            failures: [
              { path: 'report.docx', code: 'network', retryable: true },
              { path: 'report.docx', code: 'network', retryable: true },
            ],
          }),
        ),
      )
      await click(buttonNamed('Xem', bars()[0]!))
      expect(dialog()!.querySelectorAll('[data-testid="folder-upload-failures"] li')).toHaveLength(
        2,
      )
    })
  })

  describe('one file starts at once (UNI-2052 Q2)', () => {
    const one = (over: Partial<ReturnType<typeof preflightOf>> = {}) =>
      preflightOf({
        preflightId: 'pf-one',
        mode: 'files',
        rootName: undefined,
        totals: { files: 1, bytes: 2900 },
        ...over,
      })

    it('a pre-flight of exactly one file with no refusal is started without a dialog or a share choice', async () => {
      await mount()
      await stage(one())
      expect(dialog()).toBeNull()
      expect(bridge.start).toHaveBeenCalledTimes(1)
      expect(bridge.start).toHaveBeenCalledWith({
        preflightId: 'pf-one',
        shareWithWorkspace: false,
      })
      expect(controller.queue).toHaveLength(0)
      expect(bars()).toHaveLength(1)
    })

    it('a picked single file is the same: pick answers true and the bar shows the overall run', async () => {
      bridge.pick.mockResolvedValueOnce(one())
      await mount()
      let staged = false
      await act(async () => {
        staged = await controller.pick(TARGET, 'files')
      })
      await flush()
      expect(staged).toBe(true)
      expect(dialog()).toBeNull()
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 0, total: 1 })))
      expect(bars()[0]!.textContent).toContain('0/1 tệp')
    })

    it('still asks when something was skipped, the run is refused, or it is a folder', async () => {
      await mount()
      await stage(one({ skipped: [{ path: 'x.exe', reason: 'unsupported_format' }] }))
      expect(dialog()).not.toBeNull()
      await click(buttonNamed('Hủy', dialog()!))
      await stage(one({ refusal: { code: 'too_large_total', limit: 10, actual: 20 } }))
      expect(dialog()).not.toBeNull()
      await click(buttonNamed('Hủy', dialog()!))
      await stage(one({ mode: 'folder', rootName: 'A' }))
      expect(dialog()).not.toBeNull()
      expect(bridge.start).not.toHaveBeenCalled()
    })

    it('a file dropped next to a folder starts at once while the folder waits for its dialog', async () => {
      await mount()
      await stage(
        one(),
        preflightOf({ preflightId: 'pf-folder', mode: 'folder', rootName: 'Case' }),
      )
      expect(bridge.start).toHaveBeenCalledTimes(1)
      expect(controller.queue.map((q) => q.preflightId)).toEqual(['pf-folder'])
      expect(
        dialog()?.querySelector('[data-testid="folder-upload-dialog"]')?.getAttribute('data-mode'),
      ).toBe('folder')
    })

    it('a single file that cannot start says so as a notice, not a dialog', async () => {
      bridge.start.mockResolvedValueOnce({ ok: false, error: 'unknown_preflight' })
      await mount()
      await stage(one())
      expect(dialog()).toBeNull()
      expect(bars()).toHaveLength(0)
      expect(document.body.textContent).toContain('Không bắt đầu tải lên được.')
    })
  })

  describe('what main answers to start and to the pre-flight (FU-C shapes)', () => {
    it('hides the share switch and its hint when the share choice does not reach the server', async () => {
      await mount()
      await stage(preflightOf({ shareAvailable: false }))
      const d = dialog()!
      expect(d.querySelector('[role="switch"]')).toBeNull()
      expect(d.textContent).not.toContain('Thư mục vẫn riêng tư.')
      await click(buttonNamed('Tải lên', d))
      expect(bridge.start).toHaveBeenCalledWith({
        preflightId: 'pf-1',
        shareWithWorkspace: false,
      })
    })

    for (const error of ['refused', 'unknown_preflight', 'invalid_input'] as const) {
      it(`start answering ${error} keeps the dialog with an error line and starts no run`, async () => {
        bridge.start.mockResolvedValueOnce({ ok: false, error })
        await mount()
        await stage(preflightOf())
        await click(buttonNamed('Tải lên', dialog()!))
        const d = dialog()!
        expect(d.querySelector('[role="alert"]')?.textContent).toBe(
          'Không bắt đầu tải lên được. Thử lại sau ít phút.',
        )
        expect(bars()).toHaveLength(0)
        expect(controller.queue).toHaveLength(1)
        expect(buttonNamed('Tải lên', d)?.getAttribute('aria-busy')).toBeNull()
      })
    }
  })

  describe('a run that failed as a whole says why (RV-FE #4)', () => {
    const failedWith = async (
      error: { code: string; retryAfterSeconds?: number },
      extra: Partial<ReturnType<typeof progressOf>> = {},
      sdo = preflightOf(),
      lang: 'vi' | 'en' = 'vi',
    ) => {
      await mount(lang)
      await stage(sdo)
      await click(buttonNamed(lang === 'vi' ? 'Tải lên' : 'Upload', dialog()!))
      await act(async () => bridge.emit(progressOf({ phase: 'failed', error, ...extra })))
      return bars()[0]!.textContent ?? ''
    }

    it('too many uploads running reads as the busy sentence, folder and files', async () => {
      expect(await failedWith({ code: 'folder_uploads_busy', retryAfterSeconds: 30 })).toContain(
        'Đang có quá nhiều lượt tải thư mục. Hãy thử lại sau ít phút.',
      )
    })

    it('files mode has its own busy sentence', async () => {
      const text = await failedWith(
        { code: 'folder_uploads_busy' },
        {},
        preflightOf({ mode: 'files', rootName: undefined, totals: { files: 3, bytes: 3 } }),
        'en',
      )
      expect(text).toContain('Too many uploads are running. Try again in a few minutes.')
    })

    it('an expired batch says how many went up, from the run', async () => {
      const text = await failedWith(
        { code: 'folder_upload_expired' },
        { done: 12, total: 40, rootTitle: 'Hồ sơ 2052' },
      )
      expect(text).toContain(
        'Lượt tải lên “Hồ sơ 2052” đã hết hạn — 12/40 tệp đã lên. Hãy tải lại thư mục.',
      )
    })

    it('403 on the destination reads as the permission sentence', async () => {
      expect(await failedWith({ code: 'http_403' })).toContain(
        'Bạn không có quyền tải lên thư mục đích.',
      )
    })

    it('404 on the destination reads as the not-found sentence', async () => {
      expect(await failedWith({ code: 'http_404' })).toContain('Không tìm thấy thư mục đích.')
    })

    it('any other error keeps the plain sentence', async () => {
      expect(await failedWith({ code: 'start_failed' })).toContain(
        'Không tải lên được “Hồ sơ 2052”',
      )
    })

    it('a failed run that carries failures offers "Xem" and lists them', async () => {
      const text = await failedWith(
        { code: 'start_failed' },
        { failures: [{ path: 'Hồ sơ/a.docx', code: 'unreadable', retryable: true }] },
      )
      expect(text).toContain('Xem')
      await click(buttonNamed('Xem', bars()[0]!))
      expect(dialog()!.textContent).toContain('Hồ sơ/a.docx')
      // nothing finished at the server, so there is nothing for "retry" to run
      expect(buttonNamed('Thử lại các tệp lỗi', dialog()!)).toBeUndefined()
    })

    it('a failed run without failures has no "Xem"', async () => {
      await failedWith({ code: 'folder_uploads_busy' })
      expect(buttonNamed('Xem', bars()[0]!)).toBeUndefined()
    })
  })

  describe('one set of bars and one announcement per end state (RV-FE #8)', () => {
    const startRun = async () => {
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
    }

    function TwoLayers() {
      const first = useFolderUpload({ bridge: bridgeInUse })
      const second = useFolderUpload({ bridge: bridgeInUse })
      firstController = first
      return createElement(
        'div',
        null,
        createElement(FolderUploadLayer, { controller: first }),
        showFirst ? createElement(FolderUploadLayer, { controller: first }) : null,
        createElement(FolderUploadLayer, { controller: second }),
      )
    }
    let firstController: FolderUploadController
    let showFirst = true

    const mountTwo = async () => {
      showFirst = true
      await act(async () => {
        root.render(createElement(LocaleProvider, { initial: 'vi' }, createElement(TwoLayers)))
      })
      await flush()
    }

    it('two mounted layers show one bar per run', async () => {
      await mountTwo()
      await act(async () => {
        bridge.preflight.mockResolvedValueOnce([preflightOf()])
        await firstController.drop(TARGET, ['/disk/x'])
      })
      await flush()
      await click(buttonNamed('Tải lên', dialog()!))
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 5 })))
      expect(bars()).toHaveLength(1)
    })

    it('the bars move to the layer that is left when the owner goes', async () => {
      await mountTwo()
      await act(async () => {
        bridge.preflight.mockResolvedValueOnce([preflightOf()])
        await firstController.drop(TARGET, ['/disk/x'])
      })
      await flush()
      await click(buttonNamed('Tải lên', dialog()!))
      showFirst = false
      await act(async () => {
        root.render(createElement(LocaleProvider, { initial: 'vi' }, createElement(TwoLayers)))
      })
      expect(bars()).toHaveLength(1)
      expect(bars()[0]!.textContent).toContain('Đang chuẩn bị')
    })

    it('announces an end state once, even when a screen mounts again', async () => {
      await mount()
      await startRun()
      vi.mocked(announce).mockClear()
      await act(async () => bridge.emit(progressOf({ phase: 'done', done: 40, rootTitle: 'X' })))
      expect(announce).toHaveBeenCalledTimes(1)
      await act(async () => root.unmount())
      root = createRoot(host)
      await mount()
      expect(bars()).toHaveLength(1)
      expect(announce).toHaveBeenCalledTimes(1)
    })

    it('a retry that settles again is announced again', async () => {
      await mount()
      await startRun()
      const failures = [{ path: 'a', code: 'network', retryable: true }]
      await act(async () =>
        bridge.emit(progressOf({ phase: 'done', done: 39, failed: 1, failures })),
      )
      vi.mocked(announce).mockClear()
      await act(async () => controller.retry('run-1'))
      await act(async () => bridge.emit(progressOf({ phase: 'done', done: 40 })))
      expect(announce).toHaveBeenCalledTimes(1)
    })
  })

  describe('the share switch of the pre-flight (RV-FE #11, #14)', () => {
    it('a destination already shared with the workspace shows the switch ON and locked, with its sentence', async () => {
      await mount()
      await stage(preflightOf({ parentShared: true }))
      const d = dialog()!
      const share = d.querySelector<HTMLElement>('[role="switch"]')!
      expect(share.getAttribute('aria-checked')).toBe('true')
      expect(share.getAttribute('aria-disabled')).toBe('true')
      expect(d.textContent).toContain(
        'Thư mục đích đang chia sẻ với workspace nên các tệp cũng vậy.',
      )
      expect(d.textContent).not.toContain('Thư mục vẫn riêng tư.')
      await click(share)
      expect(share.getAttribute('aria-checked')).toBe('true')
      await click(buttonNamed('Tải lên', d))
      // the destination's own sharing covers the files: nothing is sent
      expect(bridge.start).toHaveBeenLastCalledWith({
        preflightId: 'pf-1',
        shareWithWorkspace: false,
      })
    })

    it('a destination that is not shared keeps the switch free', async () => {
      await mount()
      await stage(preflightOf({ parentShared: false }))
      const share = dialog()!.querySelector<HTMLElement>('[role="switch"]')!
      expect(share.getAttribute('aria-checked')).toBe('false')
      expect(share.getAttribute('aria-disabled')).toBeNull()
    })

    it('a click on the words of the share row toggles the switch', async () => {
      await mount()
      await stage(preflightOf())
      const d = dialog()!
      const share = d.querySelector<HTMLElement>('[role="switch"]')!
      expect(share.closest('label')).not.toBeNull()
      await click(share.closest('label')!.querySelector('span'))
      expect(share.getAttribute('aria-checked')).toBe('true')
      await click(share.closest('label')!.querySelector('span'))
      expect(share.getAttribute('aria-checked')).toBe('false')
    })
  })

  describe('the runs outlive the screen (UNI-2052 Q6)', () => {
    const startRun = async () => {
      await stage(preflightOf())
      await click(buttonNamed('Tải lên', dialog()!))
    }
    const remount = async () => {
      await act(async () => {
        root.unmount()
      })
      root = createRoot(host)
    }

    it('a running run is still there, with its latest count, when the screen comes back', async () => {
      await mount()
      await startRun()
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 5 })))
      await remount()
      // main kept sending while nothing was mounted
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 12 })))
      await mount()
      expect(bars()).toHaveLength(1)
      expect(bars()[0]!.textContent).toContain('12/40 tệp')
      // and it goes on from there
      await act(async () => bridge.emit(progressOf({ phase: 'uploading', done: 20 })))
      expect(bars()[0]!.textContent).toContain('20/40 tệp')
    })

    it('a run that finished while the screen was away shows its end state, with its report', async () => {
      await mount()
      await startRun()
      await remount()
      await act(async () =>
        bridge.emit(
          progressOf({
            phase: 'done',
            done: 38,
            failed: 2,
            failures: [{ path: 'a.docx', code: 'network', retryable: true }],
          }),
        ),
      )
      await mount()
      expect(bars()[0]!.textContent).toContain('38/40 tệp đã tải lên · 2 lỗi')
      await click(buttonNamed('Xem', bars()[0]!))
      expect(dialog()!.textContent).toContain('a.docx')
    })

    it('the host is told when a run settles even though a screen mounted later started listening', async () => {
      await mount()
      await startRun()
      onFinished.mockClear()
      await act(async () => bridge.emit(progressOf({ phase: 'done', done: 40 })))
      expect(onFinished).toHaveBeenCalledTimes(1)
    })
  })
})
