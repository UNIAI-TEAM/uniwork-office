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
      // the compact density has no button of its own: the selected tab offers it too
      const offered = (home.getAttribute('aria-keyshortcuts') ?? '').split(' ')
      for (const chord of shortcuts.shortcutAria('ribbon-compact').split(' ')) {
        expect(offered, `ribbon-compact ${chord}`).toContain(chord)
      }
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

type TKey = Parameters<Loaded['t']>[0]

/**
 * Every row of the docs shortcut table is bound to a control here (the control
 * must carry the row's `aria-keyshortcuts`), is covered by a lock above or
 * below, or is named in NO_CONTROL with the reason it has none. A row added to
 * the table without a decision fails.
 */
interface Spec {
  /** the ribbon tab that shows the control (default: Home) */
  tab?: TKey
  /** the tooltip of the button that opens the dropdown holding the control */
  open?: TKey
  /** the control's tooltip (data-tip) */
  tip?: TKey
  /** the control's visible text or aria-label */
  text?: TKey | string
  /** a Quick Style card, by style id */
  styleId?: string
  /** the main button of a split button, not its caret */
  cls?: string
  /** Word for Windows only (the Editing group): the Mac ribbon has no such button */
  winOnly?: boolean
}

const CONTROLS: Record<string, Spec> = {
  paste: { text: 'ribbonPaste', cls: 'rb-big' },
  'paste-plain': { text: 'appPasteTextOnly' },
  'copy-format': { tip: 'ribbonPainterTip' },
  strike: { tip: 'ribbonStrikethrough' },
  subscript: { tip: 'ribbonSubscript' },
  superscript: { tip: 'ribbonSuperscript' },
  'grow-font': { tip: 'ribbonGrowFont' },
  'shrink-font': { tip: 'ribbonShrinkFont' },
  'change-case': { tip: 'ribbonChangeCase' },
  'clear-formatting': { tip: 'ribbonClearFormatting' },
  bullets: { tip: 'ribbonBullets', cls: 'rb-icon' },
  numbering: { tip: 'ribbonNumbering', cls: 'rb-icon' },
  indent: { tip: 'ribbonIncreaseIndent' },
  outdent: { tip: 'ribbonDecreaseIndent' },
  'formatting-marks': { tip: 'ribbonShowMarks' },
  'spacing-1': { open: 'ribbonLineSpacing', text: '1.0' },
  'spacing-15': { open: 'ribbonLineSpacing', text: '1.5' },
  'spacing-2': { open: 'ribbonLineSpacing', text: '2.0' },
  'style-normal': { styleId: 'Normal' },
  'style-h1': { styleId: 'Heading1' },
  'style-h2': { styleId: 'Heading2' },
  'style-h3': { styleId: 'Heading3' },
  'styles-pane': { tip: 'ribbonStylesPaneTip' },
  find: { tip: 'ribbonFindTip', winOnly: true },
  replace: { tip: 'ribbonReplaceTip', winOnly: true },
  'select-all': { tip: 'ribbonSelectAllTip', winOnly: true },
  'field-date': { tab: 'ribbonTabInsert', open: 'ribbonFieldTip', text: 'ribbonFieldDate' },
  'field-time': { tab: 'ribbonTabInsert', open: 'ribbonFieldTip', text: 'ribbonFieldTime' },
  footnote: { tab: 'ribbonTabReferences', tip: 'ribbonFootnoteTip' },
  endnote: { tab: 'ribbonTabReferences', tip: 'ribbonEndnoteTip' },
  comment: { tab: 'ribbonTabReview', tip: 'ribbonNewCommentSelectTip' },
  'track-changes': { tab: 'ribbonTabReview', tip: 'ribbonTrackChangesTip' },
  'print-preview': { tab: 'ribbonTabView', tip: 'ribbonPagePreviewTip' },
  'zoom-out': { tab: 'ribbonTabView', tip: 'ribbonZoomOut' },
  'zoom-in': { tab: 'ribbonTabView', tip: 'ribbonZoomIn' },
  'zoom-100': { tab: 'ribbonTabView', tip: 'ribbonZoom100Tip' },
}

/** rows whose control is locked by a test above or a source lock below */
const COVERED_ELSEWHERE = [
  // File menu, quick access
  'open',
  'save',
  'save-as',
  'print',
  'undo',
  'redo',
  // Home / shape / picture tabs
  'cut',
  'copy',
  'bold',
  'italic',
  'underline',
  'align-left',
  'align-center',
  'align-right',
  'align-justify',
  // Insert tab, Breaks menu, context menu
  'page-break',
  'column-break',
  'link',
  // the ribbon collapse buttons and tabs (packages/ui)
  'ribbon-toggle',
  'ribbon-compact',
  // status bar buttons, context menu rows (source lock below)
  'goto',
  'word-count',
  'font-dialog',
  'update-fields',
  'toggle-field-codes',
]

/** rows with no button in the app, and why */
const NO_CONTROL: Record<string, string> = {
  new: 'File > New is a native menu item and the Home screen card',
  close: 'the window frame owns the close button',
  'paste-format': 'the Format Painter button applies the copied formatting on click',
  shortcuts: 'opened from the native Help menu',
  'find-next': 'the Find panel Next button answers to Enter, not to this row',
  proofread: 'runs the AI proofreader; the Review tab Editor button sends its own prompt',
  'grow-font-1pt': 'keyboard only',
  'shrink-font-1pt': 'keyboard only',
  'all-caps': 'a Font dialog checkbox, not a button',
  'small-caps': 'a Font dialog checkbox, not a button',
  'hidden-text': 'a Font dialog checkbox, not a button',
  'hanging-indent': 'keyboard only',
  'hanging-indent-off': 'keyboard only',
  'clear-para': 'keyboard only',
  'line-break': 'keyboard only',
  nbsp: 'keyboard only',
  'nb-hyphen': 'keyboard only',
  'opt-hyphen': 'keyboard only',
  'move-up': 'editor keymap only',
  'move-down': 'editor keymap only',
  'list-demote': 'editor keymap only',
  'list-promote': 'editor keymap only',
}

describe('Docs shortcut table rows', () => {
  it('every row has a control or a stated reason for none', async () => {
    vi.resetModules()
    Object.assign(window, { desktop: { onLanguageChanged: () => () => undefined } })
    const { SHORTCUTS } = await import('../src/renderer/shortcuts')
    const known = new Set([
      ...Object.keys(CONTROLS),
      ...COVERED_ELSEWHERE,
      ...Object.keys(NO_CONTROL),
    ])
    expect(SHORTCUTS.map((d) => d.id).filter((id) => !known.has(id))).toEqual([])
    expect([...known].filter((id) => !SHORTCUTS.some((d) => d.id === id))).toEqual([])
  })

  for (const platform of ['win', 'mac'] as const) {
    it(`every bound control carries its row's aria-keyshortcuts (${platform})`, async () => {
      const l = (loaded = await load(platform))
      const { t, container, click } = l
      l.renderRibbon()
      const tab = (key: TKey) =>
        [...container.querySelectorAll('.ribbon-tab')].find((b) => b.textContent === t(key))!
      const buttons = () => [...container.querySelectorAll('button')]
      const offenders: string[] = []
      for (const [id, spec] of Object.entries(CONTROLS)) {
        if (!l.shortcuts.shortcutAria(id)) continue // no chord on this platform: nothing to announce
        click(tab(spec.tab ?? 'ribbonTabHome'))
        if (id === 'paste-plain') {
          click(container.querySelector('[data-testid="ribbon-paste-menu"]')!)
        } else if (spec.open) {
          click(buttons().find((b) => b.getAttribute('data-tip') === t(spec.open!))!)
        }
        const text =
          spec.text && /^(ribbon|app)[A-Z]/.test(spec.text) ? t(spec.text as TKey) : spec.text
        const el = buttons().find((b) => {
          if (spec.cls && !b.classList.contains(spec.cls)) return false
          if (spec.styleId) return b.getAttribute('data-style-id') === spec.styleId
          if (spec.tip) return b.getAttribute('data-tip') === t(spec.tip)
          return (
            text !== undefined &&
            ((b.textContent ?? '').trim() === text || b.getAttribute('aria-label') === text)
          )
        })
        if (!el) {
          if (!(spec.winOnly && platform === 'mac')) offenders.push(`${id}: no control found`)
          continue
        }
        const problems = accessibleShortcutProblems(
          { name: accessibleName(el), keyshortcuts: el.getAttribute('aria-keyshortcuts') },
          l.row(id),
          platform,
          'desktop',
        )
        if (problems.length) offenders.push(`${id}: ${problems.join('; ')}`)
        // close what the row opened so the next row starts from the tab
        click(tab(spec.tab ?? 'ribbonTabHome'))
      }
      expect(offenders).toEqual([])
    })
  }

  it('the status bar page and word count buttons and the context menu field-codes row carry theirs', () => {
    const app = readFileSync(join(RENDERER, 'App.tsx'), 'utf8')
    for (const [tip, id] of [
      ['appGoToTitle', 'goto'],
      ['appWordCountTitle', 'word-count'],
    ]) {
      const at = app.indexOf(`data-tip={t('${tip}')}`)
      expect(at, tip).toBeGreaterThan(0)
      const button = app.slice(at, app.indexOf('onClick', at))
      expect(button, tip).toContain(`aria-keyshortcuts={shortcutAria('${id}') || undefined}`)
    }
    const menu = readFileSync(join(RENDERER, 'components/ContextMenu.tsx'), 'utf8')
    expect(menu).toMatch(/item\(t\('appToggleFieldCodes'\), \{\s+shortcut: 'toggle-field-codes',/)
  })
})

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
