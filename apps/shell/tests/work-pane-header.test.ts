/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { WorkPaneHeader, type WorkPaneHeaderProps } from '../src/renderer/src/WorkPaneHeader'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function render(props: WorkPaneHeaderProps): HTMLElement {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(WorkPaneHeader, props)))
  return host.querySelector<HTMLElement>('header.wb-pane-head')!
}

describe('WorkPaneHeader', () => {
  it('leads with the 20px module tile, then the title, the meta line and the aside', () => {
    const head = render({
      module: 'tasks',
      title: 'Tasks',
      meta: 'Your UniWork tasks',
      aside: 'Open: 3',
    })
    const tile = head.firstElementChild as HTMLElement
    expect(tile.className).toBe('wb-icon-tile')
    expect(tile.style.background).toBe('var(--tint-green)')
    expect(tile.style.width).toBe('20px')
    expect(head.querySelector('h2.wb-pane-title')?.textContent).toBe('Tasks')
    expect(head.querySelector('.wb-pane-text > p.wb-pane-meta')?.textContent).toBe(
      'Your UniWork tasks',
    )
    expect(head.lastElementChild?.className).toBe('wb-pane-aside')
    expect(head.lastElementChild?.textContent).toBe('Open: 3')
  })

  it('a pillar takes its own tint; no meta or aside renders nothing for them', () => {
    const head = render({ module: 'skills', title: 'Skills' })
    expect((head.firstElementChild as HTMLElement).style.background).toBe('var(--tint-blue)')
    expect(head.querySelector('.wb-pane-meta')).toBeNull()
    expect(head.querySelector('.wb-pane-aside')).toBeNull()
    expect(head.children).toHaveLength(2)
  })
})
