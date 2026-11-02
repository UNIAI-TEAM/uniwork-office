import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strings } from '../src/renderer/src/strings'

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
        // the command is the {cmd} the app fills in (uniwork-office-cli); the only bare
        // "genoffice" left is the ~/.genoffice path
        const stripped = text.replace(/~\/\.genoffice\/\w+/g, '')
        expect(stripped, `${lang}.${key}`).not.toMatch(/genoffice/i)
        if (key === 'intgCliNotOnPath' || key === 'intgCliReady') {
          expect(text, `${lang}.${key}`).toContain('UniWork Office ({cmd}) {v}')
        }
      }
      expect(table.intgCliTitle, lang).toContain('UniWork Office')
    }
  })

  it('reads naturally in English and Vietnamese', () => {
    expect(strings.en.intgCliTitle).toBe('Advanced: UniWork Office command line')
    expect(strings.vi.intgCliTitle).toBe('Nâng cao: dòng lệnh UniWork Office')
    expect(strings.en.intgStep2Note).toContain('UniWork Office ({cmd}) command line')
    expect(strings.vi.intgStep2Note).toContain('dòng lệnh UniWork Office ({cmd})')
  })

  it('never spells the command out where the app knows it: {cmd} is filled with uniwork-office-cli', () => {
    for (const [lang, table] of Object.entries(strings)) {
      for (const key of ['intgStep2Note', 'intgCliPartDesc', 'intgMcpStdioDesc'] as const) {
        expect(table[key], `${lang}.${key}`).not.toContain('uniwork-office')
        expect(table[key], `${lang}.${key}`).toContain('{cmd}')
      }
    }
    expect(strings.en.intgMcpStdioDesc).toContain('UniWork Office ({cmd} mcp)')
    expect(strings.vi.intgMcpStdioDesc).toContain('UniWork Office ({cmd} mcp)')
  })
})

describe('UniAI (PWA) pane and the AI probe copy (en, vi)', () => {
  const SOURCES = ['../src/renderer/src/UniAiPwaPane.tsx'] as const

  it('names no internal provider or wallet product', () => {
    for (const file of SOURCES) {
      const source = readFileSync(join(__dirname, file), 'utf8')
      expect(source, file).not.toMatch(/token hub|genspark|credit wallet/i)
    }
  })
})
