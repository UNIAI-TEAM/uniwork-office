// The Mailings tab: the field list comes from the data source, clicking a
// field inserts a real MERGEFIELD, and the panel walks the records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { mergeFieldInstruction } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { t } from '../src/renderer/i18n/locale'
import { ribbonProps } from './helpers/ribbon-props'

function makeEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hello' }] }],
    },
  })
}

const source = {
  path: '/tmp/recipients.csv',
  name: 'recipients.csv',
  fields: ['FirstName', 'LastName'],
  records: [
    { FirstName: 'Ada', LastName: 'Lovelace' },
    { FirstName: 'Grace', LastName: 'Hopper' },
  ],
}

describe('the Mailings tab', () => {
  let editor: Editor
  let root: Root
  let container: HTMLElement
  const onInsertField = vi.fn()

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
    onInsertField.mockClear()
  })

  function renderMailings(overrides: Record<string, unknown> = {}) {
    act(() =>
      root.render(
        createElement(Ribbon, {
          ...ribbonProps(editor, computeFormatState(editor)),
          mergeSource: source,
          onInsertField,
          ...overrides,
        }),
      ),
    )
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.ribbon-tab')].find(
      (b) => b.textContent === t('ribbonTabMailings'),
    )!
    act(() => tab.click())
    return container
  }

  it('offers the fields of the data source in an anchored layout-menu popup', () => {
    const view = renderMailings()
    const fieldButton = [...view.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonMailingsInsertField'),
    )!
    expect(fieldButton.disabled).toBe(false)
    act(() => fieldButton.click())
    const menu = view.querySelector<HTMLElement>('.rb-field-list')!
    expect(menu).not.toBeNull()
    expect(menu.classList.contains('layout-menu')).toBe(true)
    expect(menu.classList.contains('layout-menu-scroll')).toBe(true)
    expect(menu.querySelector('.layout-menu-head.rb-drop-title')?.textContent).toBe(
      t('ribbonMailingsFields'),
    )
    const items = [...view.querySelectorAll<HTMLButtonElement>('button.rb-field-item')]
    expect(items.map((b) => b.textContent)).toEqual(['FirstName', 'LastName'])
    expect(document.activeElement).toBe(items[0])
  })

  it('supports keyboard opening, arrow navigation, Escape returning focus, and outside-click dismissal', () => {
    const view = renderMailings()
    const fieldButton = [...view.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonMailingsInsertField'),
    )!
    fieldButton.focus()
    act(() => {
      fieldButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    const menu = view.querySelector<HTMLElement>('.rb-field-list')!
    expect(menu).not.toBeNull()
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button.rb-field-item')]
    expect(document.activeElement).toBe(items[0])
    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(items[1])
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    expect(view.querySelector('.rb-field-list')).toBeNull()
    expect(document.activeElement).toBe(fieldButton)
    act(() => fieldButton.click())
    expect(view.querySelector('.rb-field-list')).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(view.querySelector('.rb-field-list')).toBeNull()
  })

  it('inserts the merge field of the field the user clicked', () => {
    const view = renderMailings()
    const fieldButton = [...view.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonMailingsInsertField'),
    )!
    act(() => fieldButton.click())
    const item = [...view.querySelectorAll<HTMLButtonElement>('button.rb-field-item')].find(
      (b) => b.textContent === 'FirstName',
    )!
    act(() => item.click())
    expect(onInsertField).toHaveBeenCalledWith(mergeFieldInstruction('FirstName'))
  })

  it('has no field list without a data source', () => {
    const view = renderMailings({ mergeSource: null })
    const fieldButton = [...view.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonMailingsInsertField'),
    )!
    expect(fieldButton.disabled).toBe(true)
  })

  it('shows the record the preview walks', () => {
    const view = renderMailings()
    expect(view.textContent).toContain(t('ribbonMailingsRecord', { n: 1, total: 2 }))
  })

  it('renders custom protect-check radios in the Mail Merge modal and singular/plural done copy', async () => {
    const onMerge = vi.fn().mockResolvedValueOnce({ ok: true, count: 1 })
    const view = renderMailings({ onMergeMailings: onMerge })
    const startButton = [...view.querySelectorAll<HTMLButtonElement>('button.rb-big')].find(
      (b) => b.textContent === t('ribbonMailingsStart'),
    )!
    act(() => startButton.click())
    const radios = [
      ...view.querySelectorAll<HTMLLabelElement>('label.protect-check.mailmerge-radio'),
    ]
    expect(radios).toHaveLength(2)
    for (const label of radios) {
      expect(label.querySelector('input[type="radio"]')).not.toBeNull()
      expect(label.querySelector('span.ctl')).not.toBeNull()
    }
    const finishButton = [
      ...view.querySelectorAll<HTMLButtonElement>('.modal button.btn-primary'),
    ][0]!
    await act(async () => {
      finishButton.click()
    })
    expect(view.querySelector('.mailmerge-done')?.textContent).toBe(
      t('ribbonMailingsMergedOne', { n: 1 }),
    )
  })
})
