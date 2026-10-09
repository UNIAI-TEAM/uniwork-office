import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/src/strings'

const OPENROUTER_KEYS = [
  'setAiOpenRouterHubHint',
  'setAiOpenRouterHubCheck',
  'setAiOpenRouterHubChecking',
  'setAiOpenRouterHubFail',
  'setAiOpenRouterCredits',
] as const

describe('Settings > AI Model OpenRouter copy', () => {
  it('shows no raw API endpoint in any locale', () => {
    for (const [lang, table] of Object.entries(strings)) {
      for (const key of OPENROUTER_KEYS) {
        expect(table[key], `${lang}.${key}`).not.toMatch(/\/api\/|GET |https?:/)
      }
    }
  })

  it('is translated in every locale except English', () => {
    for (const [lang, table] of Object.entries(strings)) {
      if (lang === 'en') continue
      for (const key of OPENROUTER_KEYS) {
        expect(table[key], `${lang}.${key}`).not.toBe(strings.en[key])
      }
    }
  })

  it('has the Vietnamese row title, check and top-up labels', () => {
    expect(strings.vi.setAiOpenRouterHub).toBe('Token Hub OpenRouter')
    expect(strings.vi.setAiOpenRouterHubCheck).toBe('Kiểm tra tín dụng')
    expect(strings.vi.setAiOpenRouterCredits).toBe('Nạp thêm / quản lý')
  })
})

describe('Settings > Integrations prose', () => {
  const PROSE_KEYS = [
    'intgStep2Note',
    'intgCliPartDesc',
    'intgMcpStdioDesc',
    'intgCliTitle',
    'intgCliReady',
    'intgCliNotOnPath',
  ] as const

  it('names the product, not the command, in every locale (the command stays in parentheses)', () => {
    for (const [lang, table] of Object.entries(strings)) {
      for (const key of PROSE_KEYS) {
        const text = table[key]
        // the only bare "genoffice" words left are the command in parentheses, a ~/.genoffice
        // path and the command the user is told to type
        const stripped = text
          .replace(/\(genoffice(?: mcp)?\)/g, '')
          .replace(/~\/\.genoffice\/\w+/g, '')
        if (key === 'intgCliNotOnPath') {
          expect(text, `${lang}.${key}`).toContain('UniWork Office (genoffice) {v}')
        } else {
          expect(stripped, `${lang}.${key}`).not.toMatch(/genoffice/i)
        }
      }
      expect(table.intgCliTitle, lang).toContain('UniWork Office')
    }
  })

  it('reads naturally in English and Vietnamese', () => {
    expect(strings.en.intgCliTitle).toBe('Advanced: UniWork Office command line')
    expect(strings.vi.intgCliTitle).toBe('Nâng cao: dòng lệnh UniWork Office')
    expect(strings.en.intgStep2Note).toContain('UniWork Office (genoffice) command line')
    expect(strings.vi.intgStep2Note).toContain('dòng lệnh UniWork Office (genoffice)')
  })
})
