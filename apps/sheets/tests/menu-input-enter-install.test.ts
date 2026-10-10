// Visual round 2, S-09: opening a workbook logged "Component UI_PLUGIN_SHEETS_MENU_ITEM_INPUT_COMPONENT
// already exists." (the Enter wrapper overwrote the registry entry through register()). The wrapper
// replaces the entry without a warning and is installed once, however often the runtime mounts.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installMenuInputEnter } from '../src/renderer/menu-input-enter'
import type { UniverRuntime } from '../src/renderer/univer-state'

vi.mock('@univerjs/ui', () => {
  class ComponentManager {}
  return { ComponentManager }
})

const KEY = 'UI_PLUGIN_SHEETS_MENU_ITEM_INPUT_COMPONENT'

/** the registry semantics of Univer's ComponentManager (register warns on an existing key) */
function fakeManager(initial?: unknown) {
  const components = new Map<string, unknown>()
  if (initial) components.set(KEY, initial)
  return {
    components,
    get: (name: string) => components.get(name),
    delete: (name: string) => void components.delete(name),
    register: vi.fn((name: string, component: unknown) => {
      if (components.has(name)) console.warn(`Component ${name} already exists.`)
      components.set(name, component)
    }),
  }
}

function runtimeOf(manager: ReturnType<typeof fakeManager>): UniverRuntime {
  return { univer: { __getInjector: () => ({ get: () => manager }) } } as unknown as UniverRuntime
}

afterEach(() => vi.restoreAllMocks())

describe('installMenuInputEnter', () => {
  it('wraps the registered input without a console warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = () => null
    const manager = fakeManager(original)
    installMenuInputEnter(runtimeOf(manager))
    expect(warn).not.toHaveBeenCalled()
    expect(manager.register).toHaveBeenCalledTimes(1)
    expect(manager.components.get(KEY)).not.toBe(original)
  })

  it('installs once when the runtime mounts twice (StrictMode / HMR)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const manager = fakeManager(() => null)
    installMenuInputEnter(runtimeOf(manager))
    const wrapped = manager.components.get(KEY)
    installMenuInputEnter(runtimeOf(manager))
    expect(manager.register).toHaveBeenCalledTimes(1)
    expect(manager.components.get(KEY)).toBe(wrapped)
    expect(warn).not.toHaveBeenCalled()
  })
})
