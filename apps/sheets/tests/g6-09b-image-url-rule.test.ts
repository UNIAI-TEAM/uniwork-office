// G6-09b (UNI-1374) N3: under UniWork AI the sheets add_image operation accepts a URL source only
// when this run's image_search / generate_image returned it (signed policy Q5); the bound local-path
// rule (g6-12-add-image-guard.test.ts) stays. BYOK keeps today's rules (the registry still records).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '@genoffice/agent-core'
import { createImageSkill } from '../src/renderer/ai/image-skill'
import {
  executeWorkbookTool,
  type ActiveSheetInfo,
  type SheetsSkillDeps,
} from '../src/renderer/ai/tools'
import type { AttachmentMeta } from '../src/shared/desktop-api'

afterEach(() => vi.unstubAllGlobals())

const info: ActiveSheetInfo = {
  mode: 'demo',
  sheetId: 'sheet-1',
  sheetName: 'Sheet1',
  revision: 0,
  knownAddresses: ['A1'],
  sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
}

const FOUND = 'https://img.example/found.png'
const GENERATED = 'file:///store/generated/g1.png'
const STRANGER = 'https://img.example/stranger.png'
const attachment: AttachmentMeta = {
  path: '/home/u/Pictures/logo.png',
  name: 'logo.png',
  ext: 'png',
  sizeBytes: 1024,
}

function setup(uniwork: boolean, opts: { bound?: boolean; attachments?: AttachmentMeta[] } = {}) {
  const imageUrls = createImageUrlRegistry({ enforce: () => uniwork })
  const proposeOperations = vi.fn<SheetsSkillDeps['proposeOperations']>(() => ({
    ok: false,
    error: 'reached proposeOperations',
  }))
  const deps: SheetsSkillDeps = {
    getActiveSheetInfo: () => info,
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations,
    isUniworkBound: () => opts.bound === true,
    getAttachments: () => opts.attachments ?? [],
    imageUrls,
  }
  // the sheets vitest env is node: the image skill reaches the bridge through window.desktopApi
  vi.stubGlobal('window', {
    desktopApi: {
      imageSearch: async () => ({ method: 'ok', images: [{ imageUrl: FOUND, title: 't' }] }),
      generateImage: async () => ({ url: GENERATED }),
    },
  })
  const skill = createImageSkill(
    () => true,
    () => true,
    imageUrls,
  )
  const addImage = (...paths: string[]) =>
    executeWorkbookTool(
      {
        id: 'call-1',
        name: 'propose_operations',
        input: {
          summary: 'insert images',
          operations: paths.map((path, i) => ({
            op: 'add_image',
            sheetId: 'sheet-1',
            path,
            anchorCell: `B${i + 2}`,
          })),
        },
      },
      deps,
    )
  const search = () => skill.executeTool({ id: 's', name: 'image_search', input: { query: 'cat' } })
  const generate = () =>
    skill.executeTool({ id: 'g', name: 'generate_image', input: { prompt: 'a fox' } })
  return { addImage, search, generate, proposeOperations, imageUrls, skill }
}

describe('sheets image URL rule under UniWork AI', () => {
  it.each([STRANGER, 'http://img.example/a.png', 'data:image/png;base64,iVBORw0KGgo=', GENERATED])(
    'refuses the unregistered URL source %s and applies nothing',
    async (path) => {
      const { addImage, proposeOperations } = setup(true)
      const r = await addImage(path)
      expect(r.isError).toBe(true)
      expect(r.mutated).toBeFalsy()
      expect(r.output).toContain(IMAGE_URL_REFUSAL)
      expect(r.output).toContain('image_search')
      expect(proposeOperations).not.toHaveBeenCalled()
    },
  )

  it('accepts a URL image_search returned this run', async () => {
    const { addImage, search, proposeOperations } = setup(true)
    await search()
    await addImage(FOUND)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it('accepts the URL generate_image returned this run', async () => {
    const { addImage, generate, proposeOperations } = setup(true)
    await generate()
    await addImage(GENERATED)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it('refuses a URL from a PREVIOUS run', async () => {
    const { addImage, search, imageUrls, proposeOperations } = setup(true)
    await search()
    imageUrls.beginRun()
    const r = await addImage(FOUND)
    expect(r.isError).toBe(true)
    expect(proposeOperations).not.toHaveBeenCalled()
  })

  it('refuses the whole batch when one URL is unregistered (all-or-nothing)', async () => {
    const { addImage, search, proposeOperations } = setup(true)
    await search()
    const r = await addImage(FOUND, STRANGER)
    expect(r.isError).toBe(true)
    expect(proposeOperations).not.toHaveBeenCalled()
  })

  it('keeps the bound local-path rule: an attached path passes, another path is refused', async () => {
    const bound = setup(true, { bound: true, attachments: [attachment] })
    await bound.addImage(attachment.path)
    expect(bound.proposeOperations).toHaveBeenCalledTimes(1)
    const refused = await bound.addImage('/etc/passwd')
    expect(refused.isError).toBe(true)
    expect(refused.output).toMatch(/UniWork/)
    expect(bound.proposeOperations).toHaveBeenCalledTimes(1)
  })

  it("leaves a local path of a not-bound workbook to today's rules", async () => {
    const { addImage, proposeOperations } = setup(true)
    await addImage('/home/u/Pictures/chart.png')
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it('begins a new run from the skill context (one buildContext per loop.run)', () => {
    const { skill, imageUrls } = setup(true)
    imageUrls.register(FOUND, 'image_search')
    skill.buildContext?.()
    expect(imageUrls.isAllowed(FOUND)).toBe(false)
  })
})

describe('sheets image URL rule for BYOK', () => {
  it("keeps today's rules: an unregistered URL source is applied", async () => {
    const { addImage, proposeOperations } = setup(false)
    await addImage(STRANGER)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it('still records what image_search and generate_image returned', async () => {
    const { search, generate, imageUrls } = setup(false)
    await search()
    await generate()
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
    expect(imageUrls.isAllowed(GENERATED)).toBe(true)
  })
})
