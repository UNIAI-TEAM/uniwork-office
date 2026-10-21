/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { DocRow, type DocRowProps } from '../src/renderer/src/doclist/DocRow'
import { formatBytes, formatListDate } from '../src/renderer/src/doclist/format'
import { docListText } from '../src/renderer/src/doclist/text'
import { LocaleProvider, useI18n } from '../src/renderer/src/locale'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// UNI-2047 A-FIX2: a list must never crash on a missing locale (Home renders
// without a language in some hosts/tests), it reads as the app's default one

const NOW = new Date('2099-03-18T09:05:00')
const MISSING = undefined as unknown as string

describe('the list formats without a locale', () => {
  it('formatListDate reads as the default locale instead of throwing', () => {
    expect(formatListDate('2099-03-10T12:00:00', NOW, MISSING)).toBe('Mar 10')
    expect(formatListDate('2099-03-17T16:30:00', NOW, MISSING)).toBe('Yesterday, 16:30')
    expect(formatListDate('2099-03-18T08:00:00', NOW, null as unknown as string)).toBe('08:00')
  })

  it('formatBytes and docListText read as the default locale too', () => {
    expect(formatBytes(2048, MISSING)).toBe('2 KB')
    expect(docListText(MISSING)('dlDateYesterday')).toBe('Yesterday')
  })
})

describe('useI18n without a language', () => {
  it('always hands out a date locale, so every caller has one to format with', () => {
    const seen: string[] = []
    const Probe = () => {
      seen.push(useI18n().dateLocale)
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => {
      root.render(createElement(LocaleProvider, null, createElement(Probe)))
    })
    act(() => root.unmount())
    expect(seen.length).toBeGreaterThan(0)
    for (const locale of seen) expect(typeof locale).toBe('string')
  })
})

describe('DocRow without a language', () => {
  it('renders the date and size of a row instead of crashing', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const doc: DocumentsHomeDoc = {
      id: 'd1',
      workspaceId: 'ws',
      title: 'Báo cáo.docx',
      format: 'docx',
      kind: 'file',
      parentId: null,
      updatedAt: new Date(2020, 0, 2, 10, 0).toISOString(),
      sizeBytes: 4096,
    }
    const props: DocRowProps = {
      doc,
      screen: 'workspace',
      columns: ['name', 'updated', 'size'],
      now: NOW,
      selected: false,
      onSelectedChange: () => undefined,
      opening: false,
      subline: null,
      rename: null,
      menu: [],
      menuOpen: false,
      onMenuOpenChange: () => undefined,
      onOpen: () => undefined,
    }
    act(() => {
      root.render(createElement(LocaleProvider, null, createElement(DocRow, props)))
    })
    expect(host.textContent).toContain('4 KB')
    act(() => root.unmount())
  })
})
