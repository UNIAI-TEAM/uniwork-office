// Capability gating (UNI-1013 W4): one source (`window.desktop.capabilities`, read once by
// renderer/capabilities.ts) decides which desktop-only / AI entries the renderer declares.
// Desktop (no capabilities object) must keep every entry; the web set must hide them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { EditorContextMenu } from '../src/renderer/components/ContextMenu'
import { ProtectDialog } from '../src/renderer/components/ProtectDialog'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { cap, resetCapabilitiesForTest } from '../src/renderer/capabilities'
import type { DesktopCapabilities } from '../src/shared/ipc'
import { ribbonProps } from './helpers/ribbon-props'

/** the same values web/docs/bridge/hide.ts exports as `webCapabilities` */
const WEB: DesktopCapabilities = {
  platform: 'web',
  zotero: false,
  docPassword: false,
  tabs: false,
  autoSaveToDisk: false,
  ai: false,
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  createDocument: false,
  billing: false,
}

function useCapabilities(capabilities: DesktopCapabilities | undefined): void {
  Object.assign(window, {
    desktop: { onLanguageChanged: () => () => undefined, capabilities },
  })
  resetCapabilitiesForTest()
}

setModuleLang('en')

function makeEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hello world' }] }],
    },
  })
}

afterEach(() => {
  Object.assign(window, { desktop: undefined })
  resetCapabilitiesForTest()
})

describe('cap()', () => {
  it('is on for every key when the platform sets no capabilities (desktop)', () => {
    useCapabilities(undefined)
    for (const key of Object.keys(WEB).filter((k) => k !== 'platform')) {
      expect(cap(key as Exclude<keyof DesktopCapabilities, 'platform'>)).toBe(true)
    }
  })

  it('is off only for an explicit false', () => {
    useCapabilities({ zotero: false, ai: true })
    expect(cap('zotero')).toBe(false)
    expect(cap('ai')).toBe(true)
    expect(cap('tabs')).toBe(true)
  })

  it('reads window.desktop once: later changes do not flip an entry mid-session', () => {
    useCapabilities({ zotero: false })
    expect(cap('zotero')).toBe(false)
    Object.assign(window, { desktop: { capabilities: { zotero: true } } })
    expect(cap('zotero')).toBe(false)
  })

  it('does not throw before a bridge exists', () => {
    Object.assign(window, { desktop: undefined })
    resetCapabilitiesForTest()
    expect(cap('ai')).toBe(true)
  })
})

describe('Ribbon entries', () => {
  let editor: Editor
  let root: Root
  let container: HTMLElement

  beforeEach(() => {
    editor = makeEditor()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  })

  /** mount the real Ribbon, open a tab, return the visible control labels of that tab */
  function openTab(tabLabel: string): { labels: string[]; groups: string[] } {
    act(() =>
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(Ribbon, ribbonProps(editor, computeFormatState(editor))),
        }),
      ),
    )
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.ribbon-tab')]
    const tab = tabs.find((b) => b.textContent === tabLabel)
    if (!tab) throw new Error(`no ribbon tab "${tabLabel}"`)
    act(() => tab.click())
    return {
      labels: [...container.querySelectorAll('button.rb-big')].map((b) => b.textContent ?? ''),
      groups: [...container.querySelectorAll('.ribbon-group-label')].map(
        (g) => g.textContent ?? '',
      ),
    }
  }

  it('Home: the AI group exists on desktop and is gone on the web', () => {
    useCapabilities(undefined)
    expect(openTab(t('ribbonTabHome')).groups).toContain('AI')
    expect(container.querySelectorAll('.ai-entry').length).toBeGreaterThan(0)
    act(() => root.unmount())
    root = createRoot(container)

    useCapabilities(WEB)
    expect(openTab(t('ribbonTabHome')).groups).not.toContain('AI')
    expect(container.querySelectorAll('.ai-entry')).toHaveLength(0)
    // the rest of Home is untouched
    expect(container.textContent).toContain(t('ribbonPaste'))
  })

  it('References: the Zotero group is hidden on the web', () => {
    useCapabilities(undefined)
    expect(openTab(t('ribbonTabReferences')).groups).toContain(t('zoteroGroup'))
    act(() => root.unmount())
    root = createRoot(container)

    useCapabilities(WEB)
    const { labels, groups } = openTab(t('ribbonTabReferences'))
    expect(groups).not.toContain(t('zoteroGroup'))
    expect(labels).not.toContain(t('zoteroCitation'))
    expect(groups.length).toBeGreaterThan(0)
  })

  it('Review: Editor, Translate, AI comments and AI revisions are hidden; spellcheck stays', () => {
    useCapabilities(undefined)
    const desktop = openTab(t('ribbonTabReview')).labels
    for (const key of [
      'ribbonEditorBtn',
      'ribbonTranslate',
      'ribbonAiComments',
      'ribbonAiRevisions',
    ] as const) {
      expect(desktop).toContain(t(key))
    }
    act(() => root.unmount())
    root = createRoot(container)

    useCapabilities(WEB)
    const web = openTab(t('ribbonTabReview'))
    for (const key of [
      'ribbonEditorBtn',
      'ribbonTranslate',
      'ribbonAiComments',
      'ribbonAiRevisions',
    ] as const) {
      expect(web.labels).not.toContain(t(key))
    }
    expect(web.groups).not.toContain(t('ribbonGroupLanguage'))
    expect(web.labels.join('|')).toContain(t('ribbonSpellcheckBtn'))
    expect(web.labels).toContain(t('ribbonNewComment'))
  })

  it('View: AI panel, New Tab and Switch Tabs are hidden; Split and Dark Mode stay', () => {
    useCapabilities(undefined)
    const desktop = openTab(t('ribbonTabView')).labels
    for (const key of ['ribbonAiPanel', 'ribbonNewTab', 'ribbonSwitchTabs'] as const) {
      expect(desktop).toContain(t(key))
    }
    act(() => root.unmount())
    root = createRoot(container)

    useCapabilities(WEB)
    const web = openTab(t('ribbonTabView')).labels
    for (const key of ['ribbonAiPanel', 'ribbonNewTab', 'ribbonSwitchTabs'] as const) {
      expect(web).not.toContain(t(key))
    }
    expect(web).toContain(t('ribbonSplit'))
    expect(web).toContain(t('ribbonDarkMode'))
  })
})

describe('EditorContextMenu', () => {
  function labels(): string[] {
    const editor = makeEditor()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const noop = () => {}
    act(() =>
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(EditorContextMenu, {
            editor,
            menu: { x: 10, y: 10 },
            onClose: noop,
            onFontDialog: noop,
            onParagraphDialog: noop,
            onLink: noop,
            onNewComment: noop,
            onAiPreset: noop,
          }),
        }),
      ),
    )
    const out = [...el.querySelectorAll('.ctx-item .ctx-label')].map((n) => n.textContent ?? '')
    act(() => root.unmount())
    el.remove()
    editor.destroy()
    return out
  }

  it('keeps Synonyms and Translate on desktop, drops them on the web (Cut/Copy stay)', () => {
    useCapabilities(undefined)
    expect(labels()).toEqual(expect.arrayContaining(['Synonyms', 'Translate', 'Cut', 'Copy']))
    useCapabilities(WEB)
    const web = labels()
    expect(web).not.toContain('Synonyms')
    expect(web).not.toContain('Translate')
    expect(web).toEqual(expect.arrayContaining(['Cut', 'Copy', 'New Comment']))
  })
})

describe('ProtectDialog', () => {
  function passwordLabels(): string[] {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const noop = () => {}
    act(() =>
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(ProtectDialog, {
            encrypted: false,
            writeProtection: null,
            protection: null,
            removePersonalInfo: false,
            onCancel: noop,
            onApply: noop,
          }),
        }),
      ),
    )
    const out = [...el.querySelectorAll('label.fld')].map((l) => l.textContent ?? '')
    act(() => root.unmount())
    el.remove()
    return out
  }

  it('drops the open-password fields on the web but keeps modify-password', () => {
    useCapabilities(undefined)
    const desktop = passwordLabels().join('|')
    expect(desktop).toContain('Password to open this document')
    expect(desktop).toContain('Password to modify this document')

    useCapabilities(WEB)
    const web = passwordLabels().join('|')
    expect(web).not.toContain('Password to open this document')
    expect(web).toContain('Password to modify this document')
  })
})

describe('AI agent tools', () => {
  const toolNames = (): string[] =>
    createDocsSkill(
      () => makeEditor(),
      () => ({ bullet: null, ordered: null }),
    ).tools.map((tool) => tool.name)

  it('web_search / image_search / generate_image / create_document exist on desktop', () => {
    useCapabilities(undefined)
    expect(toolNames()).toEqual(
      expect.arrayContaining(['web_search', 'image_search', 'generate_image', 'create_document']),
    )
  })

  it('each tool follows its own capability', () => {
    useCapabilities({ webSearch: false })
    expect(toolNames()).not.toContain('web_search')
    expect(toolNames()).toContain('image_search')
    useCapabilities({ imageSearch: false, imageGeneration: false, createDocument: false })
    const names = toolNames()
    expect(names).toContain('web_search')
    expect(names).not.toContain('image_search')
    expect(names).not.toContain('generate_image')
    expect(names).not.toContain('create_document')
    expect(names).toContain('insert_content')
  })
})
