// Slides capability gating (GO-B5 S3): with the web frame's capability object an entry the
// platform turned off is absent from the DOM; without one (Electron) everything stays as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cap, isViewOnly, isWeb, resetForTest } from '../src/renderer/capabilities'
import { save } from '../src/renderer/file-actions'
import type { ActionCtx } from '../src/renderer/action-context'

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { Ribbon } from '../src/renderer/components/Ribbon'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

const here = dirname(fileURLToPath(import.meta.url))

/** every prop name Ribbon destructures, so the test renders it like App does */
function ribbonProps(): Record<string, unknown> {
  const src = readFileSync(join(here, '../src/renderer/components/Ribbon.tsx'), 'utf8')
  const head = src.slice(src.indexOf('export function Ribbon({'), src.indexOf('}: Props) {'))
  const names = [...head.matchAll(/^ {2}([A-Za-z0-9]+),?$/gm)].map((m) => m[1]!)
  const props: Record<string, unknown> = {}
  for (const n of names) props[n] = /^on[A-Z]/.test(n) ? vi.fn() : undefined
  return {
    ...props,
    hasDoc: true,
    dirty: true,
    zoom: 1,
    selectedIds: [],
    collapsedGroups: [],
    autoSave: false,
    showThumbs: true,
    canUndo: true,
    canRedo: true,
  }
}

const WEB_DEFAULTS = {
  platform: 'web',
  ai: false,
  autoSave: false,
  autoSaveToDisk: false,
  open: false,
  recents: false,
  save: true,
  saveAs: true,
  fontDownload: false,
  fontInstallLocal: false,
  model3d: false,
  presenterWindow: false,
}

let root: Root | null = null
let container: HTMLElement | null = null

function mountRibbon(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  act(() =>
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(Ribbon as never, ribbonProps() as never),
      }),
    ),
  )
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

function clickTab(el: HTMLElement, label: string): void {
  const tab = [...el.querySelectorAll('button.ribbon-tab')].find((b) => b.textContent === label)
  if (!tab) throw new Error(`no ${label} tab`)
  act(() => (tab as HTMLButtonElement).click())
}

const texts = (el: HTMLElement) =>
  [...el.querySelectorAll('button, label')].map((b) => b.textContent ?? '')

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  setCaps(undefined)
})

describe('capability reader', () => {
  it('desktop (no capability object): everything on, not web, not view-only', () => {
    setCaps(undefined)
    expect(cap('ai') && cap('autoSave') && cap('save') && cap('model3d')).toBe(true)
    expect(isWeb()).toBe(false)
    expect(isViewOnly()).toBe(false)
  })

  it('web frame: off keys are off; no save grant = view-only', () => {
    setCaps({ ...WEB_DEFAULTS, save: false })
    expect(isWeb()).toBe(true)
    expect(cap('ai')).toBe(false)
    expect(isViewOnly()).toBe(true)
  })
})

describe('Ribbon gating', () => {
  it('desktop keeps AutoSave, AI, File > Open / Save / Save As and Insert > 3D', () => {
    setCaps(undefined)
    const el = mountRibbon()
    expect(el.querySelector('.autosave-toggle')).not.toBeNull()
    expect(el.querySelector('.ai-entry')).not.toBeNull()
    expect(el.querySelector('.qa-btn[aria-label]')).not.toBeNull()
  })

  it('web: no AutoSave toggle, no AI entries, no File > Open, no 3D model', () => {
    setCaps(WEB_DEFAULTS)
    const el = mountRibbon()
    expect(el.querySelector('.autosave-toggle')).toBeNull()
    expect(el.querySelector('.ai-entry')).toBeNull()
    // the File tab exists on every OS in the browser (no native menu bar)
    const file = el.querySelector('.ribbon-tab-file') as HTMLButtonElement
    expect(file).not.toBeNull()
    act(() => file.click())
    const menu = texts(el.querySelector('.file-menu') as HTMLElement)
    expect(menu.some((t) => /Ctrl\+O/.test(t))).toBe(false)
    expect(menu.some((t) => /Ctrl\+S$/.test(t))).toBe(true)
    act(() => file.click())
    clickTab(el, 'Insert')
    expect(texts(el).some((t) => /3D/.test(t))).toBe(false)
    clickTab(el, 'Review')
    expect(el.querySelector('.ai-feature-icon')).toBeNull()
  })

  it('web with the host grants: File > Open appears', () => {
    setCaps({ ...WEB_DEFAULTS, open: true })
    const el = mountRibbon()
    act(() => (el.querySelector('.ribbon-tab-file') as HTMLButtonElement).click())
    expect(
      texts(el.querySelector('.file-menu') as HTMLElement).some((t) => /Ctrl\+O/.test(t)),
    ).toBe(true)
  })

  it('view-only web frame: no save entries, only the tabs that do not edit', () => {
    setCaps({ ...WEB_DEFAULTS, save: false, saveAs: false })
    const el = mountRibbon()
    const tabs = [...el.querySelectorAll('button.ribbon-tab:not(.ribbon-tab-file)')].map(
      (b) => b.textContent,
    )
    expect(tabs).toEqual(['Slide Show', 'View'])
    expect(el.querySelector('.qa-btn[data-tip="Save"]')).toBeNull()
    act(() => (el.querySelector('.ribbon-tab-file') as HTMLButtonElement).click())
    const menu = texts(el.querySelector('.file-menu') as HTMLElement)
    expect(menu.some((t) => /Ctrl\+S/.test(t))).toBe(false)
  })
})

describe('save flow', () => {
  it('a view-only frame never reaches slidesApi.save', async () => {
    const spy = vi.fn()
    ;(window as unknown as { slidesApi: unknown }).slidesApi = fakeApi({
      capabilities: { ...WEB_DEFAULTS, save: false },
      save: spy,
    })
    resetForTest()
    expect(await save(() => ({}) as ActionCtx)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
