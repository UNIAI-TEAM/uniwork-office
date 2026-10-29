import { describe, expect, it, vi } from 'vitest'
import { createLegacyOpener } from '../src/main/legacy-open'
import { tLegacyOpen, type LegacyOpenStringKey } from '../src/main/legacy-open-strings'
import {
  createLegacyProgress,
  LEGACY_PROGRESS_DELAY_MS,
  type LegacyProgressDeps,
  type LegacyProgressMessageBoxOptions,
  type LegacyProgressMessageBoxResult,
} from '../src/main/legacy-progress'
import type { ConvertLegacyResult } from '../src/main/legacy-converter'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface PendingBox {
  readonly options: LegacyProgressMessageBoxOptions
  resolve(res: LegacyProgressMessageBoxResult): void
}

interface FakeProgressHarness {
  readonly beginProgress: (fileName: string, cancel: () => void) => () => void
  readonly boxes: PendingBox[]
  readonly closedSignals: AbortSignal[]
  readonly progressBarCalls: Array<{ value: number; mode?: 'indeterminate' }>
  advance(ms: number): void
  pendingTimerCount(): number
}

function createFakeProgressHarness(lang: 'en' | 'vi' = 'en'): FakeProgressHarness {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { due: number; cb: () => void }>()
  const boxes: PendingBox[] = []
  const closedSignals: AbortSignal[] = []
  const progressBarCalls: Array<{ value: number; mode?: 'indeterminate' }> = []

  const deps: LegacyProgressDeps = {
    showMessageBox: (options) =>
      new Promise<LegacyProgressMessageBoxResult>((resolve) => {
        boxes.push({ options, resolve })
      }),
    closeBox: (signal) => {
      closedSignals.push(signal)
    },
    setProgressBar: (value, options) => {
      progressBarCalls.push(options ? { value, mode: options.mode } : { value })
    },
    t: (key: LegacyOpenStringKey, params) => tLegacyOpen(lang, key, params),
    cancelLabel: () => (lang === 'vi' ? 'Hủy' : 'Cancel'),
    setTimer: (cb, ms) => {
      const id = nextId++
      timers.set(id, { due: now + ms, cb })
      return id
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
  }

  return {
    beginProgress: createLegacyProgress(deps),
    boxes,
    closedSignals,
    progressBarCalls,
    advance(ms: number) {
      now += ms
      for (const [id, entry] of [...timers.entries()]) {
        if (entry.due <= now) {
          timers.delete(id)
          entry.cb()
        }
      }
    },
    pendingTimerCount() {
      return timers.size
    },
  }
}

describe('createLegacyProgress', () => {
  it('shows no box when a quick job finishes before LEGACY_PROGRESS_DELAY_MS', () => {
    const h = createFakeProgressHarness()
    const cancel = vi.fn()

    const end = h.beginProgress('Report.doc', cancel)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])
    expect(h.boxes).toHaveLength(0)
    expect(h.pendingTimerCount()).toBe(1)

    h.advance(LEGACY_PROGRESS_DELAY_MS - 1)
    end()
    expect(h.pendingTimerCount()).toBe(0)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])

    h.advance(1000)
    expect(h.boxes).toHaveLength(0)
    expect(h.closedSignals).toHaveLength(0)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('opens a single shared progress box for two concurrent jobs and completes both without cancelling either', async () => {
    const h = createFakeProgressHarness()
    const cancelA = vi.fn()
    const cancelB = vi.fn()

    const endA = h.beginProgress('vn-template.doc', cancelA)
    const endB = h.beginProgress('native-writer.odt', cancelB)

    // Taskbar set indeterminate once when the shared session starts
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    h.advance(LEGACY_PROGRESS_DELAY_MS)
    expect(h.boxes).toHaveLength(1)
    expect(h.boxes[0]!.options.message).toBe('Converting “vn-template.doc”…')
    expect(h.boxes[0]!.options.detail).toBe(
      'The older Office file is being converted so you can edit it here. The original file is not changed.',
    )
    expect(h.boxes[0]!.options.buttons).toEqual(['Cancel'])
    expect(h.boxes[0]!.options.cancelId).toBe(0)

    // A third job arriving while the box is already visible also joins the same box
    const cancelC = vi.fn()
    const endC = h.beginProgress('Deck.odp', cancelC)
    h.advance(LEGACY_PROGRESS_DELAY_MS * 2)
    expect(h.boxes).toHaveLength(1)

    endA()
    expect(h.boxes[0]!.options.signal.aborted).toBe(false)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    endB()
    expect(h.boxes[0]!.options.signal.aborted).toBe(false)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    endC()
    expect(h.boxes[0]!.options.signal.aborted).toBe(true)
    expect(h.closedSignals).toEqual([h.boxes[0]!.options.signal])
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])

    // When the box resolves after our own abort (even with response: 0), nothing is cancelled
    h.boxes[0]!.resolve({ response: 0 })
    await Promise.resolve()

    expect(cancelA).not.toHaveBeenCalled()
    expect(cancelB).not.toHaveBeenCalled()
    expect(cancelC).not.toHaveBeenCalled()
  })

  it('keeps the box open and taskbar indeterminate for job B when job A finishes first', () => {
    const h = createFakeProgressHarness('vi')
    const cancelA = vi.fn()
    const cancelB = vi.fn()

    const endA = h.beginProgress('First.odt', cancelA)
    const endB = h.beginProgress('Second.doc', cancelB)

    h.advance(LEGACY_PROGRESS_DELAY_MS)
    expect(h.boxes).toHaveLength(1)
    expect(h.boxes[0]!.options.message).toBe('Đang chuyển đổi “First.odt”…')
    expect(h.boxes[0]!.options.detail).toBe(
      'Tệp OpenDocument đang được chuyển đổi để bạn chỉnh sửa tại đây. Tệp gốc không bị thay đổi.',
    )

    // Job A finishes early: box stays open for B and taskbar stays indeterminate
    endA()
    expect(h.boxes[0]!.options.signal.aborted).toBe(false)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    // Calling endA again is idempotent
    endA()
    expect(h.boxes[0]!.options.signal.aborted).toBe(false)

    // Job B finishes: box aborts and taskbar clears
    endB()
    expect(h.boxes[0]!.options.signal.aborted).toBe(true)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])
    expect(cancelA).not.toHaveBeenCalled()
    expect(cancelB).not.toHaveBeenCalled()
  })

  it('shows the box with job B’s name if job A finishes before the delay expires', () => {
    const h = createFakeProgressHarness()
    const cancelA = vi.fn()
    const cancelB = vi.fn()

    const endA = h.beginProgress('Quick.doc', cancelA)
    const endB = h.beginProgress('Slow.odt', cancelB)

    h.advance(200)
    endA()
    expect(h.boxes).toHaveLength(0)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    h.advance(LEGACY_PROGRESS_DELAY_MS - 200)
    expect(h.boxes).toHaveLength(1)
    expect(h.boxes[0]!.options.message).toBe('Converting “Slow.odt”…')
    expect(h.boxes[0]!.options.detail).toBe(
      'The OpenDocument file is being converted so you can edit it here. The original file is not changed.',
    )

    endB()
    expect(h.boxes[0]!.options.signal.aborted).toBe(true)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])
  })

  it('does not cancel any job when the box resolves early without an explicit Cancel click', async () => {
    const h = createFakeProgressHarness()
    const cancelA = vi.fn()
    const cancelB = vi.fn()

    const endA = h.beginProgress('One.doc', cancelA)
    const endB = h.beginProgress('Two.odt', cancelB)

    h.advance(LEGACY_PROGRESS_DELAY_MS)
    expect(h.boxes).toHaveLength(1)

    // Non-cancel resolution (e.g. response -1 or 1 from platform dismissal) cancels nothing
    h.boxes[0]!.resolve({ response: -1 })
    await Promise.resolve()

    expect(cancelA).not.toHaveBeenCalled()
    expect(cancelB).not.toHaveBeenCalled()
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }])

    endA()
    endB()
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])
  })

  it('cancels all unfinished joined jobs when the user clicks Cancel (response === cancelId)', async () => {
    const h = createFakeProgressHarness()
    const cancelA = vi.fn()
    const cancelB = vi.fn()
    const cancelC = vi.fn()

    const endA = h.beginProgress('DoneEarly.doc', cancelA)
    const endB = h.beginProgress('Running1.doc', cancelB)
    const endC = h.beginProgress('Running2.odt', cancelC)

    // Job A finishes before user clicks Cancel
    endA()

    h.advance(LEGACY_PROGRESS_DELAY_MS)
    expect(h.boxes).toHaveLength(1)

    // User clicks Cancel (response === 0)
    h.boxes[0]!.resolve({ response: 0 })
    await Promise.resolve()

    expect(cancelA).not.toHaveBeenCalled()
    expect(cancelB).toHaveBeenCalledTimes(1)
    expect(cancelC).toHaveBeenCalledTimes(1)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])

    // Subsequent end calls from the cancelled jobs are no-ops
    endB()
    endC()
    expect(h.closedSignals).toHaveLength(0)
    expect(h.progressBarCalls).toEqual([{ value: 2, mode: 'indeterminate' }, { value: -1 }])
  })

  it('integrates with createLegacyOpener so opening .doc + .odt together opens both tabs with one box', async () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-progress-opener-'))
    try {
      const h = createFakeProgressHarness()
      const opened: string[] = []
      const notices: string[] = []
      const resolvers = new Map<string, (res: ConvertLegacyResult) => void>()

      const opener = createLegacyOpener({
        convert: (path, { sourceFormat }) =>
          new Promise<ConvertLegacyResult>((resolve) => {
            resolvers.set(path, resolve)
            void sourceFormat
          }),
        importRoot: () => join(root, 'imports'),
        openConverted: (doc) => {
          opened.push(doc.originalPath)
        },
        activateConverted: () => false,
        isPathOpen: () => true,
        openXlsValuesOnly: () => false,
        recordRecent: () => undefined,
        beginProgress: h.beginProgress,
        notice: (msg) => notices.push(msg),
        t: (k, p) => tLegacyOpen('en', k, p),
      })

      expect(opener.open('/work/vn-template.doc')).toBe(true)
      expect(opener.open('/work/native-writer.odt')).toBe(true)

      h.advance(LEGACY_PROGRESS_DELAY_MS)
      expect(h.boxes).toHaveLength(1)

      resolvers.get('/work/vn-template.doc')!({
        kind: 'converted',
        sourceFormat: 'doc',
        targetFormat: 'docx',
        bytes: new Uint8Array([80, 75, 3, 4]),
        suggestedSaveAsPath: '/work/vn-template.docx',
      })
      await vi.waitFor(() => expect(opened).toEqual(['/work/vn-template.doc']))
      expect(h.boxes[0]!.options.signal.aborted).toBe(false)

      resolvers.get('/work/native-writer.odt')!({
        kind: 'converted',
        sourceFormat: 'odt',
        targetFormat: 'docx',
        bytes: new Uint8Array([80, 75, 3, 4]),
        suggestedSaveAsPath: '/work/native-writer.docx',
      })
      await vi.waitFor(() =>
        expect(opened).toEqual(['/work/vn-template.doc', '/work/native-writer.odt']),
      )
      expect(h.boxes[0]!.options.signal.aborted).toBe(true)
      expect(notices).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
