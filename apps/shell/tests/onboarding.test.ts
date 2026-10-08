/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Onboarding } from '../src/renderer/src/Onboarding'
import { LocaleProvider } from '../src/renderer/src/locale'
import { strings } from '../src/renderer/src/strings'
// @ts-expect-error plain .mjs module without type declarations
import { ONBOARDING_COPY } from '../../../tools/rebrand/onboarding-copy.mjs'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function renderOnboarding(onDone: () => Promise<boolean>): void {
  act(() => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(Onboarding, { onDone })),
    )
  })
}

async function click(selector: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
  })
}

describe('first-run welcome dialog', () => {
  it('has no GitHub, star, usage-statistics or pricing call to action on any step', () => {
    renderOnboarding(vi.fn(async () => true))
    expect(host.querySelector('[role="switch"]')).toBeNull()
    // every slide stays mounted (inert) so one read covers all three steps
    const text = host.textContent ?? ''
    expect(text).toContain('Documents, spreadsheets, slides and PDFs in one app')
    expect(text).not.toMatch(/github|star on|open source|google analytics|usage statistics/i)
    expect(text).not.toMatch(/free for everyone|no license|no ads|no watermark/i)
    expect(host.querySelectorAll('a, .onb-star, .onb-offer')).toHaveLength(0)
  })

  it('shows the app logo on step 1 and an AI mark on step 2', () => {
    renderOnboarding(vi.fn(async () => true))
    const slides = host.querySelectorAll('.onb-slide')
    expect(slides).toHaveLength(3)
    expect(slides[0].querySelector('img.onb-art-logo')).not.toBeNull()
    expect(slides[1].querySelector('.onb-art-ai svg')).not.toBeNull()
    expect(host.querySelector('.onb-art-gift')).toBeNull()
  })

  it('carries the neutral step-3 copy in every locale', () => {
    for (const [lang, table] of Object.entries(strings)) {
      const copy = ONBOARDING_COPY[lang as keyof typeof ONBOARDING_COPY]
      expect(copy, lang).toBeDefined()
      expect(table.onbTitle3, lang).toBe(copy.onbTitle3)
      expect(table.onbBody3, lang).toBe(copy.onbBody3)
    }
  })

  it('lets Skip and Escape finish', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding(onDone)

    await click('.onb-skip')
    expect(onDone).toHaveBeenLastCalledWith()

    onDone.mockClear()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })
    expect(onDone).toHaveBeenLastCalledWith()
  })

  it('finishes on the final slide', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding(onDone)

    await click('.onb-next')
    await click('.onb-next')
    await click('.onb-next')
    expect(onDone).toHaveBeenCalledWith()
  })
})
