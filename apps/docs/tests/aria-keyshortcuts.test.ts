/**
 * UNI-2060 lock: a Docs control's accessible name is the plain command name;
 * its chord goes into `aria-keyshortcuts` (ARIA notation, this platform) and
 * the tooltip, both from the docs table row. Rendered once per platform: the
 * renderer reads the platform when its modules load.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'

const RENDERER = join(__dirname, '../src/renderer')

/** The accessible name as a screen reader computes it for these controls: the
 * aria-label, else the text outside aria-hidden parts. */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label !== null) return label
  const clone = el.cloneNode(true) as Element
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

async function load(platform: ShortcutPlatform) {
  vi.resetModules()
  Object.defineProperty(window.navigator, 'platform', {
    value: platform === 'mac' ? 'MacIntel' : 'Win32',
    configurable: true,
  })
  // LocaleProvider subscribes to the shell's language switch on mount
  Object.assign(window, { desktop: { onLanguageChanged: () => () => undefined } })
  const react = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Editor } = await import('@tiptap/core')
  const { TextSelection } = await import('@tiptap/pm/state')
  const { editorExtensions } = await import('../src/renderer/editor/extensions')
  const { computeFormatState } = await import('../src/renderer/components/ribbon-format-state')
  const { Ribbon } = await import('../src/renderer/components/Ribbon')
  const { EditorContextMenu } = await import('../src/renderer/components/ContextMenu')
  const locale = await import('../src/renderer/i18n/locale')
  const shortcuts = await import('../src/renderer/shortcuts')
  const { docsShortcut } = await import('../src/shared/docs-shortcuts')
  const { sectionSettingsFromXml } = await import('@genoffice/docx-engine')
  const { ribbonProps } = await import('./helpers/ribbon-props')
  locale.setModuleLang('en')

  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hello world' }] }],
    },
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = (element: React.ReactElement) =>
    react.act(() =>
      root.render(react.createElement(locale.LocaleProvider, { initial: 'en', children: element })),
    )
  const click = (el: Element) => react.act(() => (el as HTMLElement).click())

  /** the table row a docs command answers to */
  const row = (id: string) => {
    const def = shortcuts.SHORTCUTS.find((d) => d.id === id)
    if (!def?.action) throw new Error(`no table row for ${id}`)
    return docsShortcut(def.action)
  }

  return {
    t: locale.t,
    shortcuts,
    row,
    container,
    click,
    renderRibbon: () =>
      render(
        react.createElement(Ribbon, {
          ...ribbonProps(editor, computeFormatState(editor)),
          // a page setup, so the Layout tab's Breaks menu is enabled
          section: sectionSettingsFromXml(
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440"' +
              ' w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
          ),
        }),
      ),
    renderMenu: () =>
      render(
        react.createElement(EditorContextMenu, {
          editor,
          menu: { x: 10, y: 10 },
          onClose: () => {},
          onFontDialog: () => {},
          onParagraphDialog: () => {},
          onLink: () => {},
          onNewComment: () => {},
          onViewImage: () => {},
          onSaveImageAs: () => {},
          onAiPreset: () => {},
        }),
      ),
    dispose: () => {
      react.act(() => root.unmount())
      container.remove()
      editor.destroy()
    },
  }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** no control on screen names a chord */
function expectPlainNames(container: Element) {
  for (const el of container.querySelectorAll('button, [role="menuitem"], [role="tab"]')) {
    const name = accessibleName(el)
    expect(findDisplayChord(name), `"${name}"`).toBeNull()
  }
}

let loaded: Loaded | null = null
afterEach(() => {
  loaded?.dispose()
  loaded = null
})

for (const platform of ['win', 'mac'] as const) {
  describe(`Docs controls (${platform})`, () => {
    it('Home tab: plain names, the table chord in aria-keyshortcuts, tooltips unchanged', async () => {
      const l = (loaded = await load(platform))
      const { t, shortcuts, container } = l
      l.renderRibbon()
      expectPlainNames(container)

      const bound: [id: string, name: Parameters<typeof t>[0], tip: Parameters<typeof t>[0]][] = [
        ['cut', 'appCut', 'ribbonCutTip'],
        ['copy', 'appCopy', 'ribbonCopyTip'],
        ['bold', 'appFontBold', 'ribbonBoldTip'],
        ['italic', 'appFontItalic', 'ribbonItalicTip'],
        ['underline', 'appUnderline', 'ribbonUnderlineTip'],
        ['align-left', 'appScAlignLeft', 'ribbonAlignLeftTip'],
        ['align-center', 'appScAlignCenter', 'ribbonAlignCenterTip'],
        ['align-right', 'appScAlignRight', 'ribbonAlignRightTip'],
        ['align-justify', 'appScJustify', 'ribbonJustifyTip'],
      ]
      for (const [id, name, tip] of bound) {
        const tipText = t(tip, { keys: shortcuts.shortcutHint(id) })
        const el = [...container.querySelectorAll('button')].find(
          (b) => b.getAttribute('data-tip') === tipText,
        )
        expect(el, `${id}: a button with the tooltip "${tipText}"`).toBeDefined()
        expect(accessibleName(el!)).toBe(t(name))
        expect(
          accessibleShortcutProblems(
            { name: accessibleName(el!), keyshortcuts: el!.getAttribute('aria-keyshortcuts') },
            l.row(id),
            platform,
            'desktop',
          ),
        ).toEqual([])
      }

      // the selected tab offers the collapse key, like its tooltip
      const home = [...container.querySelectorAll('.ribbon-tab')].find(
        (b) => b.textContent === t('ribbonTabHome'),
      )!
      expect(home.getAttribute('data-tip')).toContain(shortcuts.shortcutHint('ribbon-toggle'))
      expect(home.getAttribute('aria-keyshortcuts')?.split(' ')[0]).toBe(
        shortcuts.shortcutAria('ribbon-toggle'),
      )
    })

    it('Insert and Layout tabs: page break, link and the break menu', async () => {
      const l = (loaded = await load(platform))
      const { t, shortcuts, container, click } = l
      l.renderRibbon()
      const tab = (key: Parameters<typeof t>[0]) =>
        [...container.querySelectorAll('.ribbon-tab')].find((b) => b.textContent === t(key))!

      click(tab('ribbonTabInsert'))
      expectPlainNames(container)
      for (const [id, tip] of [
        ['page-break', 'ribbonPageBreakTip'],
        ['link', 'ribbonLinkTip'],
      ] as const) {
        const tipText = t(tip, { keys: shortcuts.shortcutHint(id) })
        const el = [...container.querySelectorAll('button')].find(
          (b) => b.getAttribute('data-tip') === tipText,
        )!
        expect(el, id).toBeDefined()
        expect(el.getAttribute('aria-keyshortcuts') ?? '').toBe(shortcuts.shortcutAria(id))
        expect(
          accessibleShortcutProblems(
            { name: accessibleName(el), keyshortcuts: el.getAttribute('aria-keyshortcuts') },
            l.row(id),
            platform,
            'desktop',
          ),
        ).toEqual([])
      }

      click(tab('ribbonTabLayout'))
      const breaks = [...container.querySelectorAll('button')].find(
        (b) => b.getAttribute('data-tip') === t('ribbonBreaksTip'),
      )!
      click(breaks)
      expectPlainNames(container)
      for (const [id, name] of [
        ['page-break', 'ribbonBreakPage'],
        ['column-break', 'ribbonBreakColumn'],
      ] as const) {
        const el = [...container.querySelectorAll('.layout-menu button')].find(
          (b) => b.querySelector('b')?.textContent === t(name),
        )!
        expect(accessibleName(el)).toBe(t(name))
        expect(
          accessibleShortcutProblems(
            { name: accessibleName(el), keyshortcuts: el.getAttribute('aria-keyshortcuts') },
            l.row(id),
            platform,
            'desktop',
          ),
        ).toEqual([])
        // the visible description keeps its chord
        expect(el.textContent).toContain(shortcuts.shortcutHint(id))
      }
    })

    if (platform === 'win') {
      it('File menu rows: plain names, the key stays visible', async () => {
        const l = (loaded = await load(platform))
        const { t, shortcuts, container, click } = l
        l.renderRibbon()
        click(container.querySelector('.ribbon-tab-file')!)
        const rows = [...container.querySelectorAll('.file-menu > button')]
        for (const [id, name] of [
          ['open', 'ribbonOpen'],
          ['save', 'ribbonSave'],
          ['save-as', 'ribbonSaveAs'],
        ] as const) {
          const el = rows.find((b) => b.textContent?.startsWith(t(name)))!
          expect(el, id).toBeDefined()
          expect(accessibleName(el)).toBe(t(name))
          expect(el.textContent).toContain(shortcuts.shortcutHint(id))
          expect(
            accessibleShortcutProblems(
              { name: accessibleName(el), keyshortcuts: el.getAttribute('aria-keyshortcuts') },
              l.row(id),
              platform,
              'desktop',
            ),
          ).toEqual([])
        }
        expectPlainNames(container)
      })
    }

    it('context menu items: plain names, the key stays visible', async () => {
      const l = (loaded = await load(platform))
      const { t, shortcuts, container } = l
      l.renderMenu()
      expectPlainNames(container)
      for (const [id, name] of [
        ['cut', 'appCut'],
        ['copy', 'appCopy'],
        ['paste', 'appPaste'],
      ] as const) {
        const el = [...container.querySelectorAll('.ctx-item')].find(
          (b) => b.querySelector('.ctx-label')?.textContent === t(name),
        )!
        expect(el, id).toBeDefined()
        expect(el.querySelector('.ctx-key')?.textContent).toBe(shortcuts.shortcutHint(id))
        expect(
          accessibleShortcutProblems(
            { name: accessibleName(el), keyshortcuts: el.getAttribute('aria-keyshortcuts') },
            l.row(id),
            platform,
            'desktop',
          ),
        ).toEqual([])
      }
    })
  })
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sources(path)
    return /\.tsx$/.test(name) ? [path] : []
  })
}

describe('Docs sources', () => {
  it('no aria-label is a string that names a chord, in any locale', async () => {
    const locale = await import('../src/renderer/i18n/locale')
    const keys = new Set<string>()
    for (const file of sources(RENDERER)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/aria-label=\{t\('(\w+)'\)\}/g)) keys.add(match[1]!)
    }
    expect(keys.size).toBeGreaterThan(50)
    const offenders: string[] = []
    for (const lang of LANGS) {
      locale.setModuleLang(lang)
      for (const key of keys) {
        const name = locale.t(key as Parameters<typeof locale.t>[0])
        // the English key names (Enter, Esc) are the ones a hand-written tip spells out
        if (findDisplayChord(name) || /\((?:Shift\+)?Enter\)/.test(name)) {
          offenders.push(`${lang} ${key}: ${name}`)
        }
      }
    }
    locale.setModuleLang('en')
    expect(offenders.join('\n')).toBe('')
  })

  it('no aria-label is built from a hint or a {keys} tooltip', () => {
    const offenders: string[] = []
    for (const file of sources(RENDERER)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/aria-label=\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
        if (/shortcutHint\(|shortcutTip\(|keys:/.test(match[1]!)) {
          offenders.push(`${file.slice(RENDERER.length + 1)}: ${match[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the quick access Save / Undo / Redo name the command, chord in aria-keyshortcuts', () => {
    const app = readFileSync(join(RENDERER, 'App.tsx'), 'utf8')
    const quick = app.slice(app.indexOf('const quickActions = useMemo('))
    const block = quick.slice(0, quick.indexOf('autoSaveToggleVisible('))
    for (const [id, name] of [
      ['save', 'appSave'],
      ['undo', 'appUndo'],
      ['redo', 'appRedo'],
    ]) {
      expect(block).toContain(`aria-label={t('${name}')}`)
      expect(block).toContain(`aria-keyshortcuts={shortcutAria('${id}') || undefined}`)
    }
  })
})
