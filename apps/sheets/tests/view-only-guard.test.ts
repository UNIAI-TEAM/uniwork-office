// UNI-1016 SH3: the view-only grid lock of a web frame without the host's save grant.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetForTest } from '../src/renderer/capabilities'
import { installViewOnlyGuard, isViewOnlyBlocked } from '../src/renderer/view-only-guard'
import { journalSuppression, type UniverRuntime } from '../src/renderer/univer-state'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const previousWindow = g.window

function frame(capabilities?: Record<string, unknown>): void {
  g.window = { desktopApi: capabilities === undefined ? {} : { capabilities } }
  resetForTest()
}

afterEach(() => {
  if (hadWindow) g.window = previousWindow
  else delete g.window
  resetForTest()
  journalSuppression.active = false
  vi.useRealTimers()
})

type FakeEvent = { id?: string; params?: unknown; cancel?: boolean }

function fakeRuntime() {
  const listeners = new Map<string, (event: FakeEvent) => void>()
  const runtime = {
    univerAPI: {
      Event: {
        BeforeCommandExecute: 'BeforeCommandExecute',
        BeforeSheetEditStart: 'BeforeSheetEditStart',
      },
      addEvent: (name: string, fn: (event: FakeEvent) => void) => {
        listeners.set(name, fn)
        return { dispose: () => listeners.delete(name) }
      },
    },
  } as unknown as UniverRuntime
  const run = (id: string, params?: unknown) => {
    const event: FakeEvent = { id, params }
    listeners.get('BeforeCommandExecute')?.(event)
    return event.cancel === true
  }
  /** the formula bar / F2 / double click: an editor start that is not a known command */
  const startEdit = () => {
    const event: FakeEvent = {}
    listeners.get('BeforeSheetEditStart')?.(event)
    return event.cancel === true
  }
  return { runtime, run, startEdit, listeners }
}

describe('isViewOnlyBlocked', () => {
  it('refuses edits, formats, structure, sort/filter and sheet tabs; lets the editor close', () => {
    for (const id of [
      'sheet.command.set-range-values',
      'sheet.command.clear-selection-content',
      'sheet.command.paste',
      'sheet.command.set-bold',
      'sheet.command.insert-row',
      'sheet.command.remove-col',
      'sheet.command.sort-range',
      'sheet.command.insert-sheet',
      'sheet.command.set-worksheet-name',
    ]) {
      expect(isViewOnlyBlocked(id), id).toBe(true)
    }
    // opening the cell editor is an edit; closing it, selection and scrolling are not
    expect(isViewOnlyBlocked('sheet.operation.set-cell-edit-visible', { visible: true })).toBe(true)
    expect(isViewOnlyBlocked('sheet.operation.set-cell-edit-visible', { visible: false })).toBe(
      false,
    )
    expect(isViewOnlyBlocked('sheet.command.set-selections')).toBe(false)
    expect(isViewOnlyBlocked('sheet.command.set-scroll-relative')).toBe(false)
    expect(isViewOnlyBlocked('sheet.command.set-worksheet-active')).toBe(false)
  })
})

describe('installViewOnlyGuard', () => {
  it('cancels edits in a view-only frame, tells the user once per interval, passes loader writes', () => {
    vi.useFakeTimers()
    frame({ platform: 'web', save: false })
    const { runtime, run } = fakeRuntime()
    const notify = vi.fn()
    installViewOnlyGuard(runtime, notify)

    expect(run('sheet.command.set-range-values', { value: { v: 1 } })).toBe(true)
    expect(run('sheet.command.set-bold')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3_001)
    expect(run('sheet.command.paste')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(2)

    // a streamed range landing in the grid runs under journalSuppression: never blocked
    journalSuppression.active = true
    expect(run('sheet.command.set-range-values', { value: { v: 1 } })).toBe(false)
    journalSuppression.active = false

    // selection and scrolling are untouched
    expect(run('sheet.command.set-selections')).toBe(false)
    expect(run('sheet.operation.set-cell-edit-visible', { visible: false })).toBe(false)
  })

  it('still cancels edits but says nothing when the host banner owns view-only (viewOnlyChip off)', () => {
    frame({ platform: 'web', save: false, viewOnlyChip: false })
    const { runtime, run, startEdit } = fakeRuntime()
    const notify = vi.fn()
    installViewOnlyGuard(runtime, notify)
    expect(run('sheet.command.set-range-values', { value: { v: 1 } })).toBe(true)
    expect(startEdit()).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('refuses to open any cell editor (formula bar, F2, double click), so nothing turns dirty', () => {
    frame({ platform: 'web', save: false })
    const { runtime, startEdit } = fakeRuntime()
    const notify = vi.fn()
    installViewOnlyGuard(runtime, notify)
    expect(startEdit()).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does nothing on the desktop or with the save grant', () => {
    const { runtime, run, startEdit } = fakeRuntime()
    const notify = vi.fn()
    installViewOnlyGuard(runtime, notify)
    frame() // desktop
    expect(run('sheet.command.set-range-values')).toBe(false)
    expect(startEdit()).toBe(false)
    frame({ platform: 'web', save: true })
    expect(run('sheet.command.set-range-values')).toBe(false)
    expect(startEdit()).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('dispose removes both listeners', () => {
    frame({ platform: 'web', save: false })
    const { runtime, listeners } = fakeRuntime()
    installViewOnlyGuard(runtime, vi.fn()).dispose()
    expect(listeners.size).toBe(0)
  })
})
