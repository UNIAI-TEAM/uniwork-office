import { describe, expect, it } from 'vitest'
import { askUniEditorUrlRule, createEditorSenderCheck } from '../src/main/uniwork-askuni/doc-sender'

/**
 * UNI-2076 s7b: the temporary editor sender rule of `uniwork:askuni-doc:*`
 * (until the UNI-2073 guard gives the family policy `editor`): an editor tab
 * view or a detached editor window, its main frame, on an editor origin. The
 * shell page, a frame inside an editor and any other webContents are refused.
 */

function contents(id: number, url: string, destroyed = false) {
  const mainFrame = { name: `main-${id}`, url }
  return { id, mainFrame, isDestroyed: () => destroyed }
}

const shell = contents(1, 'file:///app/out/renderer/index.html')
const docsTab = contents(7, 'genoffice-app://docs/index.html')
const detached = contents(9, 'genoffice-app://sheets/index.html')
const unknown = contents(11, 'genoffice-app://docs/index.html')
const foreign = contents(12, 'https://evil.example/index.html')

const EDITORS = new Set([7, 9, 12])

function check(env: NodeJS.ProcessEnv = {}) {
  return createEditorSenderCheck({
    shellContents: () => shell as never,
    isEditorContents: (id) => EDITORS.has(id),
    isEditorUrl: askUniEditorUrlRule(env),
  })
}

const from = (wc: ReturnType<typeof contents>) => ({ sender: wc, senderFrame: wc.mainFrame })

describe('createEditorSenderCheck', () => {
  it('accepts the main frame of an editor tab view and of a detached editor window', () => {
    expect(check()(from(docsTab))).toBe(true)
    expect(check()(from(detached))).toBe(true)
  })

  it('refuses the shell page, even from its main frame', () => {
    const isEditor = createEditorSenderCheck({
      shellContents: () => shell as never,
      // a registry mix-up must not make the shell an editor
      isEditorContents: () => true,
      isEditorUrl: () => true,
    })
    expect(isEditor(from(shell))).toBe(false)
  })

  it('refuses a sub-frame of an editor', () => {
    expect(
      check()({ sender: docsTab, senderFrame: { name: 'iframe', url: docsTab.mainFrame.url } }),
    ).toBe(false)
    expect(check()({ sender: docsTab, senderFrame: null })).toBe(false)
  })

  it('refuses an unknown webContents, a foreign origin, a destroyed sender and junk', () => {
    expect(check()(from(unknown))).toBe(false)
    expect(check()(from(foreign))).toBe(false)
    const gone = contents(7, 'genoffice-app://docs/index.html', true)
    expect(check()(from(gone))).toBe(false)
    expect(check()(undefined)).toBe(false)
    expect(check()({})).toBe(false)
    expect(check()('x')).toBe(false)
  })

  it('refuses a frame whose url throws (disposed)', () => {
    const frame = {
      get url(): string {
        throw new Error('disposed')
      },
    }
    const wc = { id: 7, mainFrame: frame, isDestroyed: () => false }
    expect(check()({ sender: wc, senderFrame: frame })).toBe(false)
  })
})

describe('askUniEditorUrlRule', () => {
  it('packaged: the six editor hosts of the app scheme only', () => {
    const ok = askUniEditorUrlRule({})
    for (const host of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']) {
      expect(ok(`genoffice-app://${host}/index.html`)).toBe(true)
    }
    expect(ok('genoffice-app://shell/index.html')).toBe(false)
    expect(ok('genoffice-app://docs.evil/index.html')).toBe(false)
    expect(ok('genoffice-app://u@docs/index.html')).toBe(false)
    expect(ok('genoffice-app://docs:81/index.html')).toBe(false)
    expect(ok('file:///app/out/renderer/index.html')).toBe(false)
    expect(ok('https://docs/index.html')).toBe(false)
    expect(ok('about:blank')).toBe(false)
    expect(ok('not a url')).toBe(false)
  })

  it('dev: the origins of the six editor renderer URLs', () => {
    const ok = askUniEditorUrlRule({
      DOCS_RENDERER_URL: 'http://localhost:5174/',
      HTML_RENDERER_URL: 'http://localhost:5179',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    })
    expect(ok('http://localhost:5174/index.html?x=1')).toBe(true)
    expect(ok('http://localhost:5179/')).toBe(true)
    // the shell's dev server is not an editor
    expect(ok('http://localhost:5173/')).toBe(false)
    expect(ok('http://localhost:5175/')).toBe(false)
  })
})
