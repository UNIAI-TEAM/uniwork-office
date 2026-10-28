/**
 * Renderer disk-watch coverage (UNI-2282 X2):
 * - Clean document + external change -> reloads in place, keeps dirty=false, acknowledges change.
 * - Dirty document + external change -> shows .disk-notice ('changed': Reload / Keep mine),
 *   does not reload, does not acknowledge until user acts, blocks autosave/save with conflict bar.
 * - Save returning conflict:true -> shows .disk-notice ('conflict': Reload / Overwrite anyway),
 *   Overwrite anyway saves with overwrite:true.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

const PATH = '/tmp/notes.md'
const INITIAL = '---\ntitle: Initial\n---\n\nHello world\n'

interface Harness {
  container: HTMLElement
  api: Record<string, Mock>
  setDiskFile: (raw: string) => void
  setSaveResult: (res: unknown) => void
  emitDiskChanged: (p?: string) => Promise<void>
  triggerSaveRequest: (mode?: 'save' | 'saveAs') => Promise<void>
  unmount: () => void
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

async function mount(): Promise<Harness> {
  let diskContent = INITIAL
  let saveResult: unknown = { ok: true, path: PATH }
  const handlers: Record<string, (...args: never[]) => void> = {}
  const stubs: Record<string, Mock> = {
    consumePending: vi.fn(async () => PATH),
    readFile: vi.fn(async () => diskContent),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    ackFileChangedOnDisk: vi.fn(),
    setDirty: vi.fn(),
    sendSaveRequestAck: vi.fn(),
    save: vi.fn(async () => saveResult),
    getAutoSaveDefault: vi.fn(async () => ({ on: true, updatedAt: 1 })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities' || prop === 'consumeRecovered' || prop === 'provideText')
        return undefined
      if (prop in target) return target[prop]
      if (/^on[A-Z]/.test(prop)) {
        target[prop] = vi.fn((cb: (...args: never[]) => void) => {
          handlers[prop] = cb
          return () => {}
        })
      } else {
        target[prop] = vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
  vi.stubGlobal('markdownApi', api)
  Object.assign(window, { markdownApi: api })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  await settle()
  return {
    container,
    api: stubs,
    setDiskFile: (raw) => {
      diskContent = raw
    },
    setSaveResult: (res) => {
      saveResult = res
    },
    emitDiskChanged: async (p = PATH) => {
      const cb = handlers.onFileChangedOnDisk as ((changedPath: string) => void) | undefined
      cb?.(p)
      await settle()
    },
    triggerSaveRequest: async (mode = 'save') => {
      const cb = handlers.onSaveRequest as ((m: string) => void) | undefined
      cb?.(mode)
      await settle()
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const open: Harness[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
afterEach(() => {
  open.splice(0).forEach((h) => h.unmount())
  vi.unstubAllGlobals()
})

describe('markdown App disk-watch behavior', () => {
  it('clean document + external change: reloads in place, keeps dirty=false, and acknowledges', async () => {
    const h = await mount()
    open.push(h)
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: Initial',
    )

    // Touch with identical bytes is ignored and acknowledged
    await h.emitDiskChanged()
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.api.ackFileChangedOnDisk).toHaveBeenCalledTimes(1)

    // External change while clean reloads content in place, keeps dirty=false, acknowledges
    h.setDiskFile('---\ntitle: Updated Externally\n---\n\nExternal body\n')
    await h.emitDiskChanged()
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: Updated Externally',
    )
    expect(h.container.querySelector('.doc-editor')?.textContent).toContain('External body')
    expect(h.api.setDirty.mock.calls.at(-1)).toEqual([false])
    expect(h.api.ackFileChangedOnDisk).toHaveBeenCalledTimes(2)
  })

  it('dirty document + external change: shows changed notice bar, does not reload, blocks save/autosave with conflict, and resolves on Keep mine or Reload', async () => {
    const h = await mount()
    open.push(h)

    // Make document dirty by editing frontmatter
    const fm = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    await typeInto(fm, 'title: My Local Edit')
    expect(h.api.setDirty.mock.calls.at(-1)).toEqual([true])

    // External change arrives while dirty
    h.setDiskFile('---\ntitle: Outside Edit\n---\n\nOutside body\n')
    await h.emitDiskChanged()

    // Shows 'changed' notice bar, does NOT reload or acknowledge yet
    const notice = h.container.querySelector('.disk-notice')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain('This file was changed by another program.')
    const buttons = notice!.querySelectorAll('button')
    expect(buttons[0]?.textContent).toBe('Reload')
    expect(buttons[1]?.textContent).toBe('Keep mine')
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: My Local Edit',
    )
    expect(h.api.ackFileChangedOnDisk).not.toHaveBeenCalled()

    // Window blur (autosave trigger) or save request while bar is open flips bar to 'conflict' and returns false without calling api.save
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    await settle()
    expect(h.api.save).not.toHaveBeenCalled()
    expect(h.container.querySelector('.disk-notice')?.textContent).toContain(
      'This file changed on disk; saving will overwrite those changes.',
    )

    // Menu save request also returns false while unchosen
    await h.triggerSaveRequest('save')
    expect(h.api.save).not.toHaveBeenCalled()
    expect(h.api.sendSaveRequestAck).toHaveBeenLastCalledWith(false)

    // Clicking "Overwrite anyway" sets overwrite:true, hides notice, and saves
    const overwriteBtn = h.container.querySelectorAll<HTMLButtonElement>('.disk-notice button')[1]!
    expect(overwriteBtn.textContent).toBe('Overwrite anyway')
    await act(async () => {
      overwriteBtn.click()
    })
    await settle()
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.save.mock.calls[0]?.[0]).toMatchObject({ overwrite: true })
  })

  it('Keep mine acknowledges and sets overwrite for next save; Reload replaces with disk text and clears dirty', async () => {
    const h = await mount()
    open.push(h)

    const fm = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    await typeInto(fm, 'title: Dirty 1')
    h.setDiskFile('---\ntitle: Disk 1\n---\n\nDisk body 1\n')
    await h.emitDiskChanged()

    // Click "Keep mine"
    const keepBtn = h.container.querySelectorAll<HTMLButtonElement>('.disk-notice button')[1]!
    expect(keepBtn.textContent).toBe('Keep mine')
    await act(async () => {
      keepBtn.click()
    })
    await settle()
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.api.ackFileChangedOnDisk).toHaveBeenCalledTimes(1)

    // Next save sends overwrite:true
    await h.triggerSaveRequest('save')
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.save.mock.calls[0]?.[0]).toMatchObject({ overwrite: true })

    // Dirty again, then external change, then click "Reload"
    await typeInto(
      h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!,
      'title: Dirty 2',
    )
    h.setDiskFile('---\ntitle: Disk 2\n---\n\nDisk body 2\n')
    await h.emitDiskChanged()
    const reloadBtn = h.container.querySelectorAll<HTMLButtonElement>('.disk-notice button')[0]!
    expect(reloadBtn.textContent).toBe('Reload')
    await act(async () => {
      reloadBtn.click()
    })
    await settle()
    expect(h.container.querySelector('.disk-notice')).toBeNull()
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: Disk 2',
    )
    expect(h.api.setDirty.mock.calls.at(-1)).toEqual([false])
  })

  it('save returning conflict:true from main shows conflict notice bar', async () => {
    const h = await mount()
    open.push(h)

    const fm = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    await typeInto(fm, 'title: Local change')
    h.setSaveResult({ ok: false, error: 'markdown: file changed on disk', conflict: true })

    await h.triggerSaveRequest('save')
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.sendSaveRequestAck).toHaveBeenLastCalledWith(false)
    const notice = h.container.querySelector('.disk-notice')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain(
      'This file changed on disk; saving will overwrite those changes.',
    )
    const buttons = notice!.querySelectorAll('button')
    expect(buttons[0]?.textContent).toBe('Reload')
    expect(buttons[1]?.textContent).toBe('Overwrite anyway')
  })
})
