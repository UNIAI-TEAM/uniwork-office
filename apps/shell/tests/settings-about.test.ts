/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'
import { strings } from '../src/renderer/src/strings'
import legal from '../src/shared/legal.json'

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

const openLegalDoc = vi.fn(async (_doc: string) => true)

async function openAbout(lang: Lang, aboutLabel: string): Promise<void> {
  openLegalDoc.mockClear()
  window.aiOffice = {
    openLegalDoc,
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'beta',
    getAppVersion: async () => '1.2.3',
    getUpdateState: async () => null,
  } as unknown as HomeApi

  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SettingsModal, {
          status: null,
          loggingOut: false,
          loginWaiting: false,
          loginUrl: null,
          urlCopied: false,
          onOpenLoginUrl: vi.fn(),
          onCopyLoginUrl: vi.fn(),
          onClose: vi.fn(),
          onLogin: vi.fn(),
          onLogout: vi.fn(),
        }),
      ),
    )
    await Promise.resolve()
  })
  const about = Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item')).find(
    (button) => button.textContent?.includes(aboutLabel),
  )
  expect(about, `About nav item (${lang})`).toBeDefined()
  await act(async () => {
    about!.click()
    await Promise.resolve()
  })
}

describe('Settings > About', () => {
  it('shows the product name, logo, version, channel and a copyright line, in English', async () => {
    await openAbout('en', 'About')
    const pane = host.querySelector('.set-pane')!
    expect(pane.querySelector('.set-about-name')?.textContent).toBe('UniWork Office')
    expect(pane.querySelector<HTMLImageElement>('img.set-about-logo')?.getAttribute('src')).toMatch(
      /app-icon/,
    )
    expect(pane.textContent).toContain('1.2.3')
    expect(pane.textContent).toContain('Update Channel')
    expect(pane.querySelector('.set-about-copyright')?.textContent).toBe(
      `© ${legal.copyrightYear} ${legal.company}`,
    )
  })

  it('credits the upstream project under its license and opens the shipped legal files', async () => {
    await openAbout('en', 'About')
    const pane = host.querySelector('.set-pane')!
    expect(pane.querySelector('.set-about-attribution')?.textContent).toBe(
      `UniWork Office is a modified version of GenOffice (Copyright 2026 Mainfunc, Inc.), used under the Apache License, Version 2.0.`,
    )
    const buttons = Array.from(pane.querySelectorAll<HTMLButtonElement>('.set-about-legal-btn'))
    expect(buttons.map((b) => b.textContent)).toEqual([
      'License',
      'Legal notices',
      'Third-party licenses',
    ])
    await act(async () => {
      for (const button of buttons) button.click()
      await Promise.resolve()
    })
    expect(openLegalDoc.mock.calls).toEqual([['license'], ['notice'], ['thirdParty']])
    expect(pane.querySelector('a[href]')).toBeNull()
    expect(pane.querySelector('.set-about-legal-error')).toBeNull()
  })

  it('says so inline when a legal file cannot be opened', async () => {
    await openAbout('en', 'About')
    openLegalDoc.mockResolvedValueOnce(false)
    const pane = host.querySelector('.set-pane')!
    await act(async () => {
      pane.querySelector<HTMLButtonElement>('.set-about-legal-btn')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pane.querySelector('.set-about-legal-error')?.textContent).toBe(
      'Could not open this file.',
    )
  })

  it('keeps brand words out of the catalog: the attribution is placeholders only', () => {
    for (const [lang, table] of Object.entries(strings)) {
      for (const key of [
        'setAboutCopyright',
        'setAboutAttribution',
        'setAboutLegalNotices',
        'setAboutThirdPartyLicenses',
        'setAboutLicense',
        'setAboutLegalOpenFailed',
      ] as const) {
        expect(table[key], `${lang}.${key}`).not.toMatch(/GenOffice|Genspark|Mainfunc|Apache|github/i)
      }
      for (const p of ['{product}', '{upstream}', '{upstreamCopyright}', '{license}']) {
        expect(table.setAboutAttribution, lang).toContain(p)
      }
    }
  })

  it('has no GitHub or star row, in English and Vietnamese', async () => {
    await openAbout('en', 'About')
    expect(host.querySelector('.set-pane')!.textContent).not.toMatch(/github|star|open source/i)
    act(() => root.unmount())
    root = createRoot(host)
    await openAbout('vi', strings.vi.setSecAbout)
    const pane = host.querySelector('.set-pane')!
    expect(pane.querySelector('.set-about-name')?.textContent).toBe('UniWork Office')
    expect(pane.textContent).not.toMatch(/github|gắn sao|mã nguồn mở/i)
    expect(pane.textContent).toContain('Phiên bản')
  })

  it('has a copyright line in every locale', () => {
    for (const [lang, table] of Object.entries(strings)) {
      expect(table.setAboutCopyright, lang).toContain('{year}')
      expect(table.setAboutCopyright, lang).toContain('{company}')
    }
  })
})
