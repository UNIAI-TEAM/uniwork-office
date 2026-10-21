// @vitest-environment jsdom
/**
 * The IME / AltGr guard against Univer's real ShortcutService (UNI-2011, RS-sheets
 * L4): registerExcelShortcuts replaces `dispatch` on the instance, and the window
 * keydown listener the service registers in its constructor must reach that
 * replacement. A Univer upgrade that binds `dispatch` earlier would silently drop
 * the guard; this test fails then.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ICommandService } from '@univerjs/core'
import type { ICommand } from '@univerjs/core'
import { IShortcutService, KeyCode, MetaKeys, PlatformService, ShortcutService } from '@univerjs/ui'
import { registerExcelShortcuts } from '../src/renderer/excel-shortcuts'
import type { UniverRuntime } from '../src/renderer/univer-state'

const executed: string[] = []
const commandService = {
  registerCommand: (command: ICommand) => command,
  executeCommand: vi.fn((id: string) => {
    executed.push(id)
    return Promise.resolve(true)
  }),
}
const service = new ShortcutService(
  commandService as never,
  new PlatformService(),
  { getContextValue: () => true } as never,
  undefined,
)

const injector = {
  get: (token: unknown) => {
    if (token === ICommandService) return commandService
    if (token === IShortcutService) return service
    throw new Error('unexpected service')
  },
}
registerExcelShortcuts(
  { univer: { __getInjector: () => injector } } as unknown as UniverRuntime,
  undefined,
  undefined,
  () => {},
  { platform: 'win', surface: 'desktop' },
)

// plain Univer-style items for the keys an editor needs untouched
const PLAIN_KEYS: readonly [string, number][] = [
  ['plain.f2', KeyCode.F2],
  ['plain.enter', KeyCode.ENTER],
  ['plain.escape', KeyCode.ESC],
  ['plain.left', KeyCode.ARROW_LEFT],
  ['plain.undo', KeyCode.Z | MetaKeys.CTRL_COMMAND],
]
for (const [id, binding] of PLAIN_KEYS) service.registerShortcut({ id, binding })

function press(init: KeyboardEventInit & { keyCode: number }): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

afterEach(() => {
  executed.length = 0
  commandService.executeCommand.mockClear()
})

describe('guard in front of the real ShortcutService', () => {
  it('passes non-composing F2 / Enter / Esc / ArrowLeft / Ctrl+Z through to Univer', () => {
    press({ keyCode: KeyCode.F2, key: 'F2', code: 'F2' })
    press({ keyCode: KeyCode.ENTER, key: 'Enter', code: 'Enter' })
    press({ keyCode: KeyCode.ESC, key: 'Escape', code: 'Escape' })
    press({ keyCode: KeyCode.ARROW_LEFT, key: 'ArrowLeft', code: 'ArrowLeft' })
    press({ keyCode: KeyCode.Z, key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(executed).toEqual([
      'plain.f2',
      'plain.enter',
      'plain.escape',
      'plain.left',
      'plain.undo',
    ])
  })

  it('blocks the same keys while an IME composes (isComposing and keyCode 229)', () => {
    press({ keyCode: KeyCode.ENTER, key: 'Enter', code: 'Enter', isComposing: true })
    press({ keyCode: KeyCode.ESC, key: 'Escape', code: 'Escape', isComposing: true })
    press({ keyCode: 229, key: 'Process', code: 'Enter' })
    expect(executed).toEqual([])
  })

  it('does not preventDefault a blocked key, so the IME keeps it', () => {
    const event = new KeyboardEvent('keydown', {
      keyCode: KeyCode.ENTER,
      key: 'Enter',
      isComposing: true,
      cancelable: true,
      bubbles: true,
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
