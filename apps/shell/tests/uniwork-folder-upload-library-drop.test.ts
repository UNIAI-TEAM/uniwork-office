/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLibraryDrop } from '../src/renderer/src/uniwork-folder-upload/use-library-drop'

/**
 * RV-FE #9: leaving the window mid-drag can eat the dragleave. While the zone
 * shows its hover, a window-level drop / dragend / blur ends it, so the list is
 * never left dimmed until the next drag.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], dropEffect: 'none', items: [], files: [] },
  })
  return event
}

describe('the library drop zone resets when the drag leaves the window (RV-FE #9)', () => {
  let host: HTMLDivElement
  let root: Root
  let zone: HTMLElement
  let overShown: () => boolean

  function Zone() {
    const { over, handlers } = useLibraryDrop({ enabled: true, onDrop: () => undefined })
    overShown = () => over !== null
    return createElement('div', { id: 'zone', ...handlers }, over ? 'over' : 'idle')
  }

  const hovering = () => zone.textContent === 'over'
  const enter = async () => {
    await act(async () => {
      zone.dispatchEvent(dragEvent('dragenter'))
    })
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(createElement(Zone)))
    zone = host.querySelector('#zone') as HTMLElement
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  for (const type of ['drop', 'dragend', 'blur']) {
    it(`a window ${type} ends the hover even when no dragleave came`, async () => {
      await enter()
      expect(hovering()).toBe(true)
      await act(async () => {
        window.dispatchEvent(new Event(type))
      })
      expect(hovering()).toBe(false)
      expect(overShown()).toBe(false)
    })
  }

  it('the depth restarts after such a reset: one enter and one leave end the next hover', async () => {
    await enter()
    await enter()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    await enter()
    expect(hovering()).toBe(true)
    await act(async () => {
      zone.dispatchEvent(dragEvent('dragleave'))
    })
    expect(hovering()).toBe(false)
  })

  it('listens on the window only while the hover is shown, and lets go on unmount', async () => {
    const added: string[] = []
    const removed: string[] = []
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    window.addEventListener = ((type: string, ...rest: never[]) => {
      added.push(type)
      return add(type, ...(rest as [never]))
    }) as typeof window.addEventListener
    window.removeEventListener = ((type: string, ...rest: never[]) => {
      removed.push(type)
      return remove(type, ...(rest as [never]))
    }) as typeof window.removeEventListener
    try {
      expect(added).toEqual([])
      await enter()
      expect(added.sort()).toEqual(['blur', 'dragend', 'drop'])
      await act(async () => root.unmount())
      expect(removed.sort()).toEqual(['blur', 'dragend', 'drop'])
    } finally {
      window.addEventListener = add
      window.removeEventListener = remove
    }
    root = createRoot(host)
  })
})
