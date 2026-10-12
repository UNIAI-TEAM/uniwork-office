// The image-generation entries in Slides (Home ribbon "AI Image" button, the selection popover's
// remove-background chip) are shown only while image generation is offered; the generate_image
// tool follows the same host grant. The offered rule itself (grant + live way to generate) is
// tested with the hook in packages/ui/tests/use-image-generation-offered.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cap, resetForTest } from '../src/renderer/capabilities'
import type { AskTarget } from '../src/renderer/components/AiAskPopover'

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { Ribbon } from '../src/renderer/components/Ribbon'
import { AiAskPopover } from '../src/renderer/components/AiAskPopover'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

const here = dirname(fileURLToPath(import.meta.url))

/** every prop name Ribbon destructures, so the test renders it like App does */
function ribbonProps(overrides: Record<string, unknown>): Record<string, unknown> {
  const src = readFileSync(join(here, '../src/renderer/components/Ribbon.tsx'), 'utf8')
  const head = src.slice(src.indexOf('export function Ribbon({'), src.indexOf('}: Props) {'))
  const names = [...head.matchAll(/^ {2}([A-Za-z0-9]+),?$/gm)].map((m) => m[1]!)
  const props: Record<string, unknown> = {}
  for (const n of names) props[n] = /^on[A-Z]/.test(n) ? vi.fn() : undefined
  return {
    ...props,
    hasDoc: true,
    deckEmpty: false,
    dirty: false,
    zoom: 1,
    selectedIds: [],
    collapsedGroups: [],
    autoSave: false,
    showThumbs: true,
    canUndo: true,
    canRedo: true,
    ...overrides,
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

function mount(node: (children: never) => unknown): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  act(() => root!.render(createElement(LocaleProvider, { initial: 'en', children: node as never })))
  return container
}

/** a preload stand-in: `capabilities` as given, every other member a no-op (on* -> disposer) */
function fakeApi(extra: Record<string, unknown>): unknown {
  return new Proxy(extra, {
    get: (obj, key: string) =>
      key in obj || key === 'capabilities'
        ? obj[key]
        : key.startsWith('on')
          ? () => () => {}
          : () => Promise.resolve(undefined),
  })
}

function setCaps(caps: Record<string, unknown> | undefined): void {
  ;(window as unknown as { slidesApi?: unknown }).slidesApi = fakeApi(
    caps ? { capabilities: caps } : {},
  )
  resetForTest()
}

const labels = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].map((b) => b.textContent ?? '')

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  setCaps(undefined)
})

describe('capability key', () => {
  it('desktop (no capability object) keeps image generation on', () => {
    setCaps(undefined)
    expect(cap('imageGeneration')).toBe(true)
  })

  it('a web frame without the host grant has it off', () => {
    setCaps({ platform: 'web', ai: true, imageGeneration: false })
    expect(cap('imageGeneration')).toBe(false)
  })

  it('a web frame with the host grant has it on', () => {
    setCaps({ platform: 'web', ai: true, imageGeneration: true })
    expect(cap('imageGeneration')).toBe(true)
  })
})

describe('Home ribbon "AI Image" button', () => {
  const mountRibbon = (overrides: Record<string, unknown>) => {
    setCaps(undefined)
    return mount(createElement(Ribbon as never, ribbonProps(overrides) as never) as never)
  }

  it('is hidden while image generation is off; the other AI buttons stay', () => {
    const el = mountRibbon({ imageGenerationOffered: false })
    const l = labels(el)
    expect(l.some((x) => x.includes('AI Image'))).toBe(false)
    expect(l.some((x) => x.includes('AI Fact Check'))).toBe(true)
  })

  it('is shown while image generation is offered', () => {
    const el = mountRibbon({ imageGenerationOffered: true })
    expect(labels(el).some((x) => x.includes('AI Image'))).toBe(true)
  })
})

describe('selection popover chips', () => {
  const picture: AskTarget = { id: 'p1', sourceId: 'p1', desc: { type: 'picture' } }
  const mountPopover = (offered: boolean | undefined) =>
    mount(
      createElement(
        AiAskPopover as never,
        {
          targets: [picture],
          getAnchorRect: () => ({
            left: 10,
            top: 10,
            right: 60,
            bottom: 60,
            viewTop: 0,
            viewBottom: 800,
          }),
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
          ...(offered === undefined ? {} : { imageGenerationOffered: offered }),
        } as never,
      ) as never,
    )

  it('drops "Remove background" (a generate_image run) while image generation is off', () => {
    const l = labels(mountPopover(false))
    expect(l).toContain('Replace image')
    expect(l).not.toContain('Remove background')
  })

  it('keeps it while image generation is offered, and by default', () => {
    expect(labels(mountPopover(true))).toContain('Remove background')
    act(() => root?.unmount())
    container?.remove()
    expect(labels(mountPopover(undefined))).toContain('Remove background')
  })
})
