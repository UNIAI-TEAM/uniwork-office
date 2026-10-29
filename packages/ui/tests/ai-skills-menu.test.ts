/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSkillChips, AiSkillsMenu, MAX_ATTACHED_SKILLS } from '../src/AiSkillsMenu'
import { AI_SKILLS_LABELS } from '../src/strings-ai-skills'

const actEnv: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
actEnv.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const SKILLS = [
  { name: 'tables', description: 'Header rows and totals' },
  { name: 'tone', description: 'Write plainly' },
  { name: 'citations', description: 'Footnotes and sources' },
  { name: 'summary', description: 'Executive summary' },
]

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  if (el instanceof HTMLElement) act(() => el.click())
}

function mount(over: Partial<Parameters<typeof AiSkillsMenu>[0]> = {}) {
  const onToggle = vi.fn()
  const listSkills = vi.fn(async () => SKILLS)
  act(() => {
    root.render(
      createElement(AiSkillsMenu, {
        lang: 'en',
        listSkills,
        selected: [],
        onToggle,
        ...over,
      }),
    )
  })
  return { onToggle, listSkills }
}

describe('AiSkillsMenu', () => {
  it('opens on a root menu with Add file and Skills when the app takes files', async () => {
    const onAddFile = vi.fn()
    const { listSkills } = mount({ onAddFile })
    click(host.querySelector('.ai-plus-btn'))
    const items = [...host.querySelectorAll('.ai-plus-item')].map((b) => b.textContent)
    expect(items).toEqual(['Add file', 'Skills'])
    // the list is not fetched until the skills page opens
    expect(listSkills).not.toHaveBeenCalled()
    click(host.querySelectorAll('.ai-plus-item')[0])
    expect(onAddFile).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ai-plus-pop')).toBeNull()
  })

  it('opens straight on the skills page when the app takes no files', async () => {
    const { listSkills } = mount()
    click(host.querySelector('.ai-plus-btn'))
    await settle()
    expect(listSkills).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ai-plus-back')).toBeNull()
    expect([...host.querySelectorAll('.ai-plus-skill-name')].map((n) => n.textContent)).toEqual([
      'tables',
      'tone',
      'citations',
      'summary',
    ])
  })

  it('filters by name or description and toggles a skill without closing', async () => {
    const { onToggle } = mount()
    click(host.querySelector('.ai-plus-btn'))
    await settle()
    const search = host.querySelector<HTMLInputElement>('.ai-plus-search')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'plain')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect([...host.querySelectorAll('.ai-plus-skill-name')].map((n) => n.textContent)).toEqual([
      'tone',
    ])
    click(host.querySelector('.ai-plus-skill'))
    expect(onToggle).toHaveBeenCalledWith('tone')
    expect(host.querySelector('.ai-plus-pop')).not.toBeNull()
  })

  it('marks selected skills and offers Manage only when a handler is given', async () => {
    const onManage = vi.fn()
    mount({ selected: ['tables'], onManage })
    click(host.querySelector('.ai-plus-btn'))
    await settle()
    expect(host.querySelector('.ai-plus-skill.on .ai-plus-skill-name')?.textContent).toBe('tables')
    click(host.querySelector('.ai-plus-manage'))
    expect(onManage).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ai-plus-pop')).toBeNull()
  })

  it('says when nothing is installed', async () => {
    mount({ listSkills: async () => [] })
    click(host.querySelector('.ai-plus-btn'))
    await settle()
    expect(host.querySelector('.ai-plus-empty')?.textContent).toBe('No skills installed yet')
  })

  it('caps selection at 3 skills: disables unselected rows and shows a localized hint while keeping selected rows removable', async () => {
    expect(MAX_ATTACHED_SKILLS).toBe(3)
    const { onToggle } = mount({ selected: ['tables', 'tone', 'citations'] })
    click(host.querySelector('.ai-plus-btn'))
    await settle()
    expect(host.querySelector('.ai-plus-limit-hint')?.textContent).toBe(
      AI_SKILLS_LABELS.en.maxSkillsHint,
    )
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    expect(rows).toHaveLength(4)
    expect(rows[0]!.disabled).toBe(false)
    expect(rows[1]!.disabled).toBe(false)
    expect(rows[2]!.disabled).toBe(false)
    expect(rows[3]!.disabled).toBe(true)
    expect(rows[3]!.title).toBe(AI_SKILLS_LABELS.en.maxSkillsHint)
    click(rows[3])
    expect(onToggle).not.toHaveBeenCalled()
    click(rows[0])
    expect(onToggle).toHaveBeenCalledWith('tables')
  })
})

describe('AiSkillChips', () => {
  it('renders nothing for an empty list', () => {
    act(() => root.render(createElement(AiSkillChips, { lang: 'en', names: [] })))
    expect(host.textContent).toBe('')
  })

  it('is removable only when given a handler', () => {
    const onRemove = vi.fn()
    act(() => root.render(createElement(AiSkillChips, { lang: 'en', names: ['tables'], onRemove })))
    click(host.querySelector('.ai-skill-chip-remove'))
    expect(onRemove).toHaveBeenCalledWith('tables')
    act(() => root.render(createElement(AiSkillChips, { lang: 'en', names: ['tables'] })))
    expect(host.querySelector('.ai-skill-chip-remove')).toBeNull()
    expect(host.querySelector('.ai-skill-chips-sent')).not.toBeNull()
  })
})

describe('AI_SKILLS_LABELS', () => {
  it('covers all 21 UI locales with non-empty labels and no tr locale', () => {
    const langs = Object.keys(AI_SKILLS_LABELS)
    expect(langs).toHaveLength(21)
    expect(langs).not.toContain('tr')
    for (const [lang, labels] of Object.entries(AI_SKILLS_LABELS)) {
      for (const [key, value] of Object.entries(labels)) {
        expect(value.length, `${lang}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})
