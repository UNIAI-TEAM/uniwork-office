/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { WorkbenchIcon } from '../src/renderer/src/WorkbenchIcons'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type IconId = Parameters<typeof WorkbenchIcon>[0]['id']

function render(id: IconId): HTMLElement {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(WorkbenchIcon, { id, size: 18 })))
  return host
}

describe('WorkbenchIcon', () => {
  it('draws an 18px tile tinted from module-tones (Tasks = green)', () => {
    const tile = render('tasks').querySelector<HTMLElement>('.wb-icon-tile')!
    expect(tile.style.background).toBe('var(--tint-green)')
    expect(tile.style.color).toBe('var(--tint-green-fg)')
    expect(tile.style.width).toBe('18px')
  })

  it('tints the knowledge pillars blue and the add tile gray', () => {
    expect(render('skills').querySelector<HTMLElement>('.wb-icon-tile')!.style.background).toBe(
      'var(--tint-blue)',
    )
    expect(render('add').querySelector<HTMLElement>('.wb-icon-tile')!.style.background).toBe(
      'var(--tint-gray)',
    )
  })

  it.each([
    'desk',
    'tasks',
    'calendar',
    'forms',
    'notes',
    'personal',
    'knowledge',
    'materials',
    'skills',
    'compose',
    'add',
  ] as const)('%s carries no raw hex color', (id) => {
    expect(render(id).innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
