import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  setUniworkAiAvailable,
  type AiSettings,
} from '@genoffice/ai-provider'
import {
  aiModelPickerGroups,
  aiModelPickerNeed,
  aiModelPickerSelection,
  withAiModelSelection,
} from '../src/ai-model-picker-options'

const anthropicModels = AI_PROVIDERS.find((m) => m.id === 'anthropic')!.models

afterEach(() => {
  setUniworkAiAvailable(false)
})

describe('aiModelPickerGroups', () => {
  it('lists nothing while signed out with no keys', () => {
    expect(aiModelPickerGroups(defaultAiSettings(), false)).toEqual([])
  })

  it('lists UniAI when signed in', () => {
    const ids = aiModelPickerGroups(defaultAiSettings(), true).map((g) => g.id)
    expect(ids).toEqual(['genspark'])
  })

  it('lists UniAI once a Token Hub key is set, from either key slot', () => {
    const own = defaultAiSettings()
    own.providers.genspark = { ...own.providers.genspark, apiKey: 'sk-or-1' }
    expect(aiModelPickerGroups(own, false).map((g) => g.id)).toContain('genspark')
    const shared = defaultAiSettings()
    shared.providers.openrouter = { ...shared.providers.openrouter, apiKey: 'sk-or-2' }
    expect(aiModelPickerGroups(shared, false).map((g) => g.id)).toContain('genspark')
  })

  it('adds a vendor once its key is set and puts an off-catalog model first', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic = { apiKey: 'k', model: 'claude-next' }
    const groups = aiModelPickerGroups(settings, false)
    expect(groups.map((g) => g.id)).toEqual(['anthropic'])
    expect(groups[0]!.models).toEqual(['claude-next', ...anthropicModels])
  })

  it('needs a base URL for custom endpoints', () => {
    const settings = defaultAiSettings()
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: '' }
    expect(aiModelPickerGroups(settings, false)).toEqual([])
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' }
    expect(aiModelPickerGroups(settings, false).map((g) => g.id)).toEqual(['custom'])
  })
})

describe('hosts without the UniAI pool (web frames)', () => {
  it('never lists UniAI nor names openrouter/auto, even while the cloud sign-in is reported', () => {
    const settings = { ...defaultAiSettings(), uniAiAvailable: false }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
    settings.providers.genspark = { ...settings.providers.genspark, apiKey: 'sk-or-1' }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
  })

  it('lists the viewer provider that carries a (masked) key and selects its model', () => {
    const settings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'anthropic' as const,
    }
    settings.providers.anthropic = { apiKey: '…wxyz', model: anthropicModels[1]! }
    expect(aiModelPickerGroups(settings, true).map((g) => g.id)).toEqual(['anthropic'])
    expect(aiModelPickerSelection(settings)).toEqual({
      provider: 'anthropic',
      model: anthropicModels[1],
    })
  })

  it('no stored key: the selection stays on the chosen vendor and nothing is listed, so the chip says Choose model', () => {
    const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider: 'openai' as const }
    expect(aiModelPickerGroups(settings, true)).toEqual([])
    expect(
      aiModelPickerGroups(settings, true).some(
        (g) => g.id === aiModelPickerSelection(settings).provider,
      ),
    ).toBe(false)
  })
})

describe('selection round trip', () => {
  it('switches provider and model in one write and reads back', () => {
    const settings = defaultAiSettings()
    settings.providers.anthropic = { apiKey: 'k', model: anthropicModels[0]! }
    const next = withAiModelSelection(settings, {
      provider: 'anthropic',
      model: anthropicModels[1]!,
    })
    expect(next.provider).toBe('anthropic')
    expect(next.providers.anthropic.apiKey).toBe('k')
    expect(aiModelPickerSelection(next)).toEqual({
      provider: 'anthropic',
      model: anthropicModels[1],
    })
    expect(settings.providers.anthropic.model).toBe(anthropicModels[0])
  })

  it('keeps an unusable stored provider selected instead of falling back to UniAI', () => {
    const settings = defaultAiSettings()
    settings.provider = 'anthropic'
    expect(aiModelPickerSelection(settings).provider).toBe('anthropic')
  })
})

describe('CLI vendors', () => {
  it('lists Codex only after the settings page stored a path or model', () => {
    const settings = defaultAiSettings()
    expect(aiModelPickerGroups(settings, false)).toEqual([])
    settings.providers.codex = { apiKey: '', model: '', cliPath: '/usr/local/bin/codex' }
    expect(aiModelPickerGroups(settings, false)).toEqual([
      { id: 'codex', label: 'Codex CLI', models: [], rowLabel: 'Codex CLI' },
    ])
  })
})

describe('model sources (G6-05m)', () => {
  function anthropicWith(sources: AiSettings['modelSources'], model = 'claude-chosen'): AiSettings {
    const settings = defaultAiSettings()
    settings.providers.anthropic = { apiKey: 'k', model }
    return { ...settings, modelSources: sources }
  }
  const catalogFirst = anthropicModels[0]!
  const catalogSecond = anthropicModels[1]!

  it('puts the Settings pick first, then the live list: catalog ids it confirms, then the rest A to Z', () => {
    const settings = anthropicWith({
      anthropic: {
        chosen: 'claude-chosen',
        listed: ['zeta-1', catalogSecond, 'alpha-1', catalogFirst, 'claude-chosen'],
      },
    })
    const models = aiModelPickerGroups(settings, false)[0]!.models
    const confirmed = anthropicModels.filter((m) => m === catalogFirst || m === catalogSecond)
    expect(models).toEqual(['claude-chosen', ...confirmed, 'alpha-1', 'zeta-1'])
  })

  it('keeps a chosen id the live list does not contain (the person Settings win)', () => {
    const settings = anthropicWith({ anthropic: { chosen: 'claude-chosen', listed: ['a', 'b'] } })
    expect(aiModelPickerGroups(settings, false)[0]!.models).toEqual(['claude-chosen', 'a', 'b'])
  })

  it('shows the model the host selected when it differs from the Settings pick', () => {
    const settings = anthropicWith(
      { anthropic: { chosen: 'from-settings', listed: ['a', 'b'] } },
      'local-pick',
    )
    expect(aiModelPickerGroups(settings, false)[0]!.models).toEqual([
      'from-settings',
      'local-pick',
      'a',
      'b',
    ])
  })

  it('does not list the stored model twice when it is the Settings pick or in the live list', () => {
    const same = anthropicWith({ anthropic: { chosen: 'claude-chosen', listed: ['a'] } })
    expect(aiModelPickerGroups(same, false)[0]!.models).toEqual(['claude-chosen', 'a'])
    const inList = anthropicWith({ anthropic: { chosen: '', listed: ['a', 'claude-chosen'] } })
    expect(aiModelPickerGroups(inList, false)[0]!.models).toEqual(['claude-chosen', 'a'])
  })

  it('caps the live ids at 25 per group, the Settings pick not counted', () => {
    const listed = Array.from({ length: 80 }, (_, i) => `model-${String(i).padStart(2, '0')}`)
    const settings = anthropicWith({ anthropic: { chosen: 'claude-chosen', listed } })
    const models = aiModelPickerGroups(settings, false)[0]!.models
    expect(models).toHaveLength(26)
    expect(models.slice(0, 3)).toEqual(['claude-chosen', 'model-00', 'model-01'])
    expect(models.at(-1)).toBe('model-24')
  })

  it('applies the cap after the catalog ids that the live list confirms', () => {
    const listed = [...Array.from({ length: 30 }, (_, i) => `aa-${i}`), catalogSecond]
    const settings = anthropicWith({ anthropic: { chosen: '', listed } }, catalogFirst)
    const models = aiModelPickerGroups(settings, false)[0]!.models
    expect(models[0]).toBe(catalogFirst)
    expect(models[1]).toBe(catalogSecond)
    expect(models).toHaveLength(26)
  })

  it('drops blank and repeated live ids', () => {
    const settings = anthropicWith({
      anthropic: { chosen: 'claude-chosen', listed: ['a', ' ', '', 'a', ' b '] },
    })
    expect(aiModelPickerGroups(settings, false)[0]!.models).toEqual(['claude-chosen', 'a', 'b'])
  })

  it.each([
    ['no entry for the provider', {}],
    ['a source without a list', { anthropic: { chosen: 'claude-chosen' } }],
    ['an empty list', { anthropic: { chosen: 'claude-chosen', listed: [] } }],
    [
      'a failed listing',
      { anthropic: { chosen: 'claude-chosen', listed: ['a'], listState: 'error' as const } },
    ],
  ])('falls back to the catalog (off-catalog pick first) for %s', (_name, sources) => {
    const settings = anthropicWith(sources)
    expect(aiModelPickerGroups(settings, false)[0]!.models).toEqual([
      'claude-chosen',
      ...anthropicModels,
    ])
  })

  it('without modelSources the groups are the catalog, as before', () => {
    const settings = anthropicWith(undefined, catalogSecond)
    expect(aiModelPickerGroups(settings, false)[0]!.models).toEqual(anthropicModels)
  })

  it('passes the list state to the group so the chip can say it', () => {
    const loading = anthropicWith({ anthropic: { chosen: 'claude-chosen', listState: 'loading' } })
    expect(aiModelPickerGroups(loading, false)[0]).toMatchObject({
      models: ['claude-chosen', ...anthropicModels],
      listState: 'loading',
    })
    const failed = anthropicWith({ anthropic: { chosen: '', listState: 'error' } }, catalogFirst)
    expect(aiModelPickerGroups(failed, false)[0]!.listState).toBe('error')
    expect(aiModelPickerGroups(anthropicWith({}), false)[0]!.listState).toBeUndefined()
  })

  it('ignores sources of unknown providers and of providers that are not usable', () => {
    const settings = anthropicWith({
      anthropic: { chosen: 'claude-chosen', listed: ['a'] },
      openai: { chosen: 'gpt-x', listed: ['gpt-x'] },
      nonsense: { chosen: 'x', listed: ['x'] },
    } as unknown as AiSettings['modelSources'])
    const groups = aiModelPickerGroups(settings, false)
    expect(groups.map((g) => g.id)).toEqual(['anthropic'])
  })
})

describe('UniWork AI row', () => {
  function withUniwork(uniworkModel?: string): AiSettings {
    return { ...defaultAiSettings(), provider: 'uniwork', uniworkModel }
  }

  it('lists the row while the grant is on, labelled with the served model when known', () => {
    setUniworkAiAvailable(true)
    try {
      const known = aiModelPickerGroups(withUniwork('claude-opus-5'), false)
      const row = known.find((g) => g.id === 'uniwork')!
      expect(row.models).toEqual([])
      expect(row.rowLabel).toBe('claude-opus-5')
      expect(aiModelPickerSelection(withUniwork('claude-opus-5'))).toEqual({
        provider: 'uniwork',
        model: '',
      })
    } finally {
      setUniworkAiAvailable(false)
    }
  })

  it.each([undefined, '', '  '])('reads UniWork AI when the model is %j', (model) => {
    setUniworkAiAvailable(true)
    try {
      const row = aiModelPickerGroups(withUniwork(model), false).find((g) => g.id === 'uniwork')!
      expect(row.rowLabel).toBe('UniWork AI')
    } finally {
      setUniworkAiAvailable(false)
    }
  })

  it('is not listed while the grant is off', () => {
    setUniworkAiAvailable(false)
    expect(aiModelPickerGroups(withUniwork('claude-opus-5'), false)).toEqual([])
  })

  it('other groups keep their own label as the row text of an empty model', () => {
    const settings = defaultAiSettings()
    settings.providers.codex = { apiKey: '', model: '', cliPath: '/usr/local/bin/codex' }
    expect(aiModelPickerGroups(settings, false)).toEqual([
      { id: 'codex', label: 'Codex CLI', models: [], rowLabel: 'Codex CLI' },
    ])
  })
})

<<<<<<< ours
describe('UniWork AI provider (uniwork)', () => {
  it('lists UniWork AI when the availability flag is on and hides it when off', () => {
    const settings = defaultAiSettings()
    setUniworkAiAvailable(false)
    expect(aiModelPickerGroups(settings, false).map((g) => g.id)).not.toContain('uniwork')

    setUniworkAiAvailable(true)
    const groups = aiModelPickerGroups(settings, false)
    expect(groups).toContainEqual({
      id: 'uniwork',
      label: 'UniWork AI',
      models: [],
      rowLabel: 'UniWork AI',
    })

    settings.provider = 'uniwork'
    expect(aiModelPickerSelection(settings)).toEqual({ provider: 'uniwork', model: '' })
    expect(aiModelPickerNeed(settings)).toBeNull()
  })

  it('keeps a saved uniwork choice selected and reports need "model" when the availability flag is off instead of falling back to UniAI', () => {
    setUniworkAiAvailable(false)
    const settings = defaultAiSettings()
    settings.provider = 'uniwork'
    expect(aiModelPickerSelection(settings)).toEqual({ provider: 'uniwork', model: '' })
    expect(aiModelPickerNeed(settings)).toBe('model')
=======
describe('custom endpoints', () => {
  const settings = () => ({
    ...defaultAiSettings(),
    customEndpoints: [
      {
        id: 'a',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3',
      },
      {
        id: 'b',
        name: '',
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'k',
        model: 'gpt-x',
        models: ['gpt-y'],
      },
      { id: 'c', name: 'Empty', baseUrl: '', apiKey: '', model: 'm' },
    ],
    customEndpoint: 'a',
  })

  it('lists one group per configured endpoint with its cached models', () => {
    const groups = aiModelPickerGroups(settings(), false)
    expect(groups).toEqual([
      { id: 'custom', endpoint: 'a', label: 'Ollama', models: ['llama3'] },
      { id: 'custom', endpoint: 'b', label: 'gw.example.com', models: ['gpt-x', 'gpt-y'] },
    ])
  })

  it('picking a model on another endpoint activates that endpoint', () => {
    const start = { ...settings(), provider: 'custom' as const }
    expect(aiModelPickerSelection(start)).toEqual({
      provider: 'custom',
      endpoint: 'a',
      model: 'llama3',
    })
    const next = withAiModelSelection(start, { provider: 'custom', endpoint: 'b', model: 'gpt-y' })
    expect(aiModelPickerSelection(next)).toEqual({
      provider: 'custom',
      endpoint: 'b',
      model: 'gpt-y',
    })
    expect(next.providers.custom).toEqual({
      apiKey: 'k',
      model: 'gpt-y',
      baseUrl: 'https://gw.example.com/v1',
    })
    expect(next.customEndpoints!.find((e) => e.id === 'a')!.model).toBe('llama3')
>>>>>>> theirs
  })
})
