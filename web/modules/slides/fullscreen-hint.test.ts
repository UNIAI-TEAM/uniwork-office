// Slide show full screen on the web: granted request = no hint; refused request = hint, then the
// next click / key press asks again (a real gesture); Escape is not that gesture; leaving clears it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFullscreenControl } from './fullscreen-hint'

const hint = () => document.querySelector('.ow-fs-hint')
let request: ReturnType<typeof vi.fn>
let exit: ReturnType<typeof vi.fn>
let fullscreenElement: Element | null

beforeEach(() => {
  fullscreenElement = null
  request = vi.fn(async () => {
    fullscreenElement = document.documentElement
  })
  exit = vi.fn(async () => {
    fullscreenElement = null
  })
  document.documentElement.requestFullscreen = request as never
  document.exitFullscreen = exit as never
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('createFullscreenControl', () => {
  it('a granted request shows no hint', async () => {
    const fs = createFullscreenControl(() => 'Click to go full screen')
    await fs.enter()
    expect(request).toHaveBeenCalledTimes(1)
    expect(hint()).toBeNull()
  })

  it('a refused request shows the hint; the next click requests again and clears it', async () => {
    request.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
    const fs = createFullscreenControl(() => 'Click to go full screen')
    await fs.enter()
    expect(hint()?.textContent).toBe('Click to go full screen')
    expect(hint()?.getAttribute('role')).toBe('status')
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(request).toHaveBeenCalledTimes(2)
    expect(hint()).toBeNull()
  })

  it('a key press counts, Escape does not', async () => {
    request.mockRejectedValueOnce(new Error('refused'))
    const fs = createFullscreenControl(() => 'Press a key')
    await fs.enter()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(hint()).not.toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(request).toHaveBeenCalledTimes(2)
    expect(hint()).toBeNull()
  })

  it('full screen engaged by another route clears the hint; leaving clears it too', async () => {
    request.mockRejectedValue(new Error('refused'))
    const fs = createFullscreenControl(() => 'hint')
    await fs.enter()
    await fs.enter() // a second refusal does not stack a second hint
    expect(document.querySelectorAll('.ow-fs-hint')).toHaveLength(1)
    fullscreenElement = document.documentElement
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(hint()).toBeNull()

    fullscreenElement = null
    await fs.enter()
    expect(hint()).not.toBeNull()
    await fs.leave()
    expect(hint()).toBeNull()
  })

  it('leave exits full screen when it is on', async () => {
    const fs = createFullscreenControl(() => 'hint')
    await fs.enter()
    await fs.leave()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
