import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterAll, describe, expect, it } from 'vitest'
import { appForPath } from '../src/main/app-routing'
import { createBlankTxtFile } from '../src/main/new-txt-file'
import { statPathEntries } from '../src/main/recent-files'
import { HOME_CHANNELS } from '../src/shared/home-api'
import { strings } from '../src/renderer/src/strings'

/**
 * UNI-2046 TXT-ALWAYS-ON (desktop half): a .txt is a first-class file of the markdown module,
 * opened as plain source (UNI-1905), and the desktop New menu offers a blank one under Markdown.
 * The first block pins what UNI-1905 already shipped, the second what this card adds.
 */

const require = createRequire(import.meta.url)
const configModule = { exports: {} as ReturnType<typeof require> }
runInNewContext(readFileSync(resolve(import.meta.dirname, '../electron-builder.cjs'), 'utf8'), {
  module: configModule,
  __dirname: resolve(import.meta.dirname, '..'),
  process: { platform: 'linux', arch: 'x64', env: {} },
  require: (id: string) =>
    id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
})
const config = configModule.exports

const temp = mkdtempSync(join(tmpdir(), 'txt-always-on-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

describe('a .txt on the desktop (UNI-1905 behaviour)', () => {
  it('is a declared file association with a mimeType', () => {
    const association = config.fileAssociations.find(
      (entry: { ext: string }) => entry.ext === 'txt',
    )
    expect(association, 'no txt file association').toBeTruthy()
    expect(association.mimeType).toBe('text/plain')
  })

  it('is offered by the open dialog filter and the save dialog filter of the text app', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    expect(main).toMatch(
      /name: tm\('filterMarkdown'\), extensions: \['md', 'markdown', 'txt', 'json'\]/,
    )
    const markdownMain = readFileSync(
      resolve(import.meta.dirname, '../../markdown/src/main/markdown-main.ts'),
      'utf8',
    )
    expect(markdownMain).toMatch(/extensions: \['md', 'markdown', 'txt', 'json'\]/)
  })

  it('goes to the markdown module, which opens it as plain source', () => {
    expect(appForPath('/home/u/notes.txt')).toBe('markdown')
  })

  it('stays in the recent list under its own .txt name', () => {
    const path = join(temp, 'notes.txt')
    writeFileSync(path, 'a plain line\n')
    const [entry] = statPathEntries([path], new Set())
    expect(entry).toMatchObject({ path, name: 'notes.txt', ext: 'txt' })
  })

  it('has no feature flag gating it', () => {
    for (const rel of ['../src/main/index.ts', '../src/main/app-routing.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, rel), 'utf8')
      expect(source).not.toMatch(/office_txt|txt_open|txtOpen|TXT_ENABLED/)
    }
  })
})

describe('Plain text in the desktop New menu', () => {
  it('createBlankTxtFile writes an empty .txt and never reuses a taken name', () => {
    const first = createBlankTxtFile(temp, 'Untitled text')
    const second = createBlankTxtFile(temp, 'Untitled text')
    expect(first).toBe(join(temp, 'Untitled text.txt'))
    expect(second).toBe(join(temp, 'Untitled text-2.txt'))
    expect(statSync(first).size).toBe(0)
    expect(readdirSync(temp)).toEqual(expect.arrayContaining(['Untitled text.txt']))
  })

  it('has its own Home IPC channel', () => {
    expect(HOME_CHANNELS.newTxt).toBe('home:new-txt')
  })

  it('is labelled in vi and en, and in every other language', () => {
    expect(strings.vi.newTxt).toBe('Văn bản')
    expect(strings.en.newTxt).toBe('Plain text')
    for (const [lang, table] of Object.entries(strings)) {
      expect((table as Record<string, string>).newTxt, `${lang} newTxt`).toBeTruthy()
    }
  })

  it('sits right under Markdown on the Home New cards', () => {
    const home = readFileSync(resolve(import.meta.dirname, '../src/renderer/src/Home.tsx'), 'utf8')
    const md = home.indexOf("ext: 'md',")
    const txt = home.indexOf("ext: 'txt',")
    const html = home.indexOf("ext: 'html',")
    expect(md).toBeGreaterThan(-1)
    expect(txt).toBeGreaterThan(md)
    expect(txt).toBeLessThan(html)
    expect(home).toContain('window.aiOffice.newTxt(newFileOpts)')
  })
})
