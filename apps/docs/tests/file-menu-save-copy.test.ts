// @vitest-environment jsdom
// RFSH-5 / UNI-1920: the ribbon File menu's "Save as a copy…" entry appears only on a web
// tab that cannot save (capabilities save:false + saveCopy:true and not the readOnly
// profile) and is wired to the bridge's saveDocxCopy (api.saveCopy over the live bytes).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'
import { ribbonProps } from './helpers/ribbon-props'

setModuleLang('en')
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLElement
let editor: Editor

const buttonByText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  )

function mount(caps: Record<string, unknown>): { onSaveCopy: Mock<() => void> } {
  Object.assign(window, {
    desktop: { capabilities: caps, onLanguageChanged: () => () => undefined },
  })
  resetCapabilitiesForTest()
  const onSaveCopy = vi.fn()
  act(() =>
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(Ribbon, {
          ...ribbonProps(editor, computeFormatState(editor)),
          onSaveCopy,
        } as never),
      }),
    ),
  )
  return { onSaveCopy }
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hi' }] }],
    },
  })
})

afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
  container.remove()
  Object.assign(window, { desktop: undefined })
  vi.unstubAllGlobals()
  resetCapabilitiesForTest()
  document.body.innerHTML = ''
})

describe('File > Save a copy… (locked-out tab only)', () => {
  it('shows on a web tab with saveCopy granted and save withheld; the click calls onSaveCopy', () => {
    const { onSaveCopy } = mount({ platform: 'web', save: false, saveCopy: true })
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    const entry = buttonByText('Save as a copy…')
    expect(entry).not.toBeNull()
    act(() => entry!.click())
    expect(onSaveCopy).toHaveBeenCalledTimes(1)
  })

  it('stays hidden when the tab can save (editors keep only the conflict-dialog copy)', () => {
    mount({ platform: 'web', save: true, saveCopy: true })
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    expect(buttonByText('Save as a copy…')).toBeUndefined()
  })

  it('stays hidden under the readOnly profile and when saveCopy is not granted', () => {
    mount({ platform: 'web', save: false, saveCopy: false, readOnlyProfile: true })
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    expect(buttonByText('Save as a copy…')).toBeUndefined()
  })

  it('stays hidden without the saveCopy grant even when save is withheld', () => {
    mount({ platform: 'web', save: false })
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    expect(buttonByText('Save as a copy…')).toBeUndefined()
  })
})
