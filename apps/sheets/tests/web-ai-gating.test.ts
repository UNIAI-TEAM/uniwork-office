// UNI-1016 (SH4): the AI tools the web frame cannot run are not offered to the model.
import { afterEach, describe, expect, it } from 'vitest'

import { resetForTest } from '../src/renderer/capabilities'
import { createImageSkill } from '../src/renderer/ai/image-skill'
import { gateSkill } from '../src/renderer/ai/skill-gate'
import { createSearchSkill } from '../src/renderer/ai/search-skill'
import { createWorkbookSkill } from '../src/renderer/ai/workbook-skill'
import type { SheetsSkillDeps } from '../src/renderer/ai/tools'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const previousWindow = g.window

function web(capabilities: Record<string, unknown>): void {
  g.window = { desktopApi: { capabilities } }
  resetForTest()
}

afterEach(() => {
  if (hadWindow) g.window = previousWindow
  else delete g.window
  resetForTest()
})

const names = (skill: { tools: readonly { name: string }[] }) => skill.tools.map((t) => t.name)
const workbook = () => createWorkbookSkill({} as SheetsSkillDeps)

describe('create_document (desktop-only)', () => {
  it('desktop: the tool and its prompt bullet are offered', () => {
    g.window = { desktopApi: {} }
    resetForTest()
    expect(names(workbook())).toContain('create_document')
    expect(workbook().systemPrompt).toContain('tool create_document')
  })

  it('web without the capability: neither the tool nor the prompt mentions it', () => {
    web({ platform: 'web', createDocument: false })
    expect(names(workbook())).not.toContain('create_document')
    expect(names(workbook())).toContain('propose_operations')
    expect(workbook().systemPrompt).not.toContain('tool create_document')
    // the rest of the prompt is intact
    expect(workbook().systemPrompt).toContain('Preserve the existing column structure')
  })
})

describe('gateSkill', () => {
  it('contributes nothing while off and follows the capability live', () => {
    const caps: Record<string, unknown> = { platform: 'web', webSearch: false }
    web(caps)
    const skill = gateSkill(createSearchSkill(), () => (caps.webSearch as boolean) === true)
    expect(skill.tools).toEqual([])
    expect(skill.systemPrompt).toBe('')
    caps.webSearch = true
    expect(names(skill)).toEqual(['web_search'])
    expect(skill.systemPrompt).toContain('web_search')
  })
})

describe('image skill per capability', () => {
  const both = createImageSkill(
    () => true,
    () => true,
  )
  const searchOnly = createImageSkill(
    () => false,
    () => true,
  )
  const genOnly = createImageSkill(
    () => true,
    () => false,
  )
  const none = createImageSkill(
    () => false,
    () => false,
  )

  it('offers exactly the granted tools', () => {
    expect(names(both)).toEqual(['image_search', 'generate_image'])
    expect(names(searchOnly)).toEqual(['image_search'])
    expect(names(genOnly)).toEqual(['generate_image'])
    expect(names(none)).toEqual([])
  })

  it('the prompt never names a tool that is not offered', () => {
    expect(searchOnly.systemPrompt).not.toContain('generate_image')
    expect(genOnly.systemPrompt).not.toContain('image_search')
    expect(none.systemPrompt).toBe('')
  })
})
