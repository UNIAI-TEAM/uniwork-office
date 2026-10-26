import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  isProviderUsable,
  clampMaxOutputTokens,
  cloudToolsEnabled,
  defaultAiSettings,
  maxOutputTokensOf,
  providerNeed,
  resolveAiSettings,
  selectedProvider,
  setUniworkAiAvailable,
  uniAiOpenRouterKey,
  withUniAiOpenRouterAuth,
} from '../src/providers'
import type { AiProviderId } from '../src/types'

describe('defaultAiSettings', () => {
  it('gives every provider its default model and an empty key by default', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('genspark')
    for (const meta of AI_PROVIDERS) {
      expect(settings.providers[meta.id].apiKey).toBe('')
      expect(settings.providers[meta.id].model).toBe(meta.defaultModel)
    }
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(settings.providers.codex.cliPath).toBe('')
    expect(settings.providers.codex.model).toBe('')
    expect(settings.providers.anthropic.baseUrl).toBeUndefined()
  })

  it('applies caller-supplied default keys only to the listed providers', () => {
    const settings = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(settings.providers.anthropic.apiKey).toBe('sk-ant-preset')
    expect(settings.providers.gemini.apiKey).toBe('')
  })
})

describe('provider model catalog', () => {
  it("offers the vendor's own DeepSeek ids, not the Genspark pool spelling", () => {
    const genspark = AI_PROVIDERS.find((provider) => provider.id === 'genspark')!
    const deepseek = AI_PROVIDERS.find((provider) => provider.id === 'deepseek')!

    expect(deepseek.models).toContain('deepseek-flash')
    expect(deepseek.models).not.toContain('deep-seek-v4.1-flash')
    expect(deepseek.models).not.toContain('deepseek-v4-flash')
    expect(deepseek.models).not.toContain('deepseek-v4-flash-vision-exp')
    expect(genspark.models).not.toContain('deep-seek-v4-flash')
    expect(genspark.models).not.toContain('deep-seek-v4-flash-vision-exp-openrouter')
  })

  it('keeps Responses-only models out of the OpenCode tiers (no such protocol yet)', () => {
    for (const id of ['opencode-zen', 'opencode-go'] as const) {
      const meta = AI_PROVIDERS.find((provider) => provider.id === id)!
      expect(meta.models).toContain(meta.defaultModel)
      expect(meta.needsBaseUrl).toBeUndefined()
      for (const model of meta.models) {
        expect(model).not.toMatch(/^(gpt-|grok-|muse-spark-)/)
      }
    }
  })

  it('seeds Requesty with managed policy ids (short names, no vendor prefix)', () => {
    const requesty = AI_PROVIDERS.find((provider) => provider.id === 'requesty')!
    expect(requesty.models).toContain(requesty.defaultModel)
    expect(requesty.needsBaseUrl).toBeUndefined()
    for (const model of requesty.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Opper with pool ids (bare names, no vendor prefix)', () => {
    const opper = AI_PROVIDERS.find((provider) => provider.id === 'opper')!
    expect(opper.models).toContain(opper.defaultModel)
    expect(opper.needsBaseUrl).toBeUndefined()
    for (const model of opper.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Atlas Cloud with lab-namespaced model ids', () => {
    const atlas = AI_PROVIDERS.find((provider) => provider.id === 'atlascloud')!
    expect(atlas.models).toContain(atlas.defaultModel)
    expect(atlas.needsBaseUrl).toBeUndefined()
    for (const model of atlas.models) {
      expect(model).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/)
    }
  })

  it('seeds Cheaper Inference with bare model ids (no vendor prefix)', () => {
    const ci = AI_PROVIDERS.find((provider) => provider.id === 'cheaperinference')!
    expect(ci.models).toContain(ci.defaultModel)
    expect(ci.needsBaseUrl).toBeUndefined()
    for (const model of ci.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Kimi with the K3.1 flagship ahead of the still-sold K3', () => {
    const kimi = AI_PROVIDERS.find((provider) => provider.id === 'kimi')!
    expect(kimi.models).toEqual(['kimi-k3.1-pro', 'kimi-k3'])
    expect(kimi.defaultModel).toBe('kimi-k3.1-pro')
    expect(kimi.needsBaseUrl).toBeUndefined()
  })
})

describe('resolveAiSettings', () => {
  it('returns fresh defaults when nothing is stored', () => {
    const defaults = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(resolveAiSettings({}, defaults)).toEqual(defaults)
  })

  it('falls back to defaults for null and non-object settings roots', () => {
    for (const stored of [null, 'settings', 7, true, []]) {
      const defaults = defaultAiSettings()
      expect(resolveAiSettings(stored, defaults)).toEqual(defaults)
    }
  })

  it('falls back to defaults for null and non-object provider maps', () => {
    for (const providers of [null, 'providers', 7, true, []]) {
      const defaults = defaultAiSettings()
      expect(resolveAiSettings({ providers } as never, defaults)).toEqual(defaults)
    }
  })

  it('ignores null and non-object provider entries', () => {
    for (const entry of [null, 'provider', 7, true, []]) {
      const defaults = defaultAiSettings()
      const resolved = resolveAiSettings(
        { provider: 'anthropic', providers: { anthropic: entry } } as never,
        defaults,
      )
      expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
      expect(selectedProvider(resolved)).toBe('anthropic')
      expect(isProviderUsable(resolved, 'anthropic')).toBe(false)
    }
  })

  it('migrates the pre-provider single-endpoint shape into the custom provider', () => {
    const defaults = defaultAiSettings()
    const resolved = resolveAiSettings(
      { apiKey: 'legacy-key', model: 'legacy-model', baseUrl: 'https://legacy.example.com/v1' },
      defaults,
    )
    expect(resolved.providers.custom).toEqual({
      apiKey: 'legacy-key',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example.com/v1',
    })
    // untouched providers keep their defaults
    expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
  })

  it('defaults the legacy base URL to the OpenAI endpoint when omitted', () => {
    const resolved = resolveAiSettings({ apiKey: 'legacy-key' }, defaultAiSettings())
    expect(resolved.providers.custom.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('merges stored multi-provider settings over the defaults, provider by provider', () => {
    const defaults = defaultAiSettings({ anthropic: 'preset-key' })
    const resolved = resolveAiSettings(
      {
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' },
        } as never,
      },
      defaults,
    )
    expect(resolved.provider).toBe('gemini')
    expect(resolved.providers.gemini).toEqual({
      apiKey: 'stored-gemini-key',
      model: 'gemini-2.5-pro',
    })
    // provider not mentioned in stored.providers keeps the computed default
    expect(resolved.providers.anthropic.apiKey).toBe('preset-key')
  })

  it('rewrites a stored model id the vendor has retired', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: 'deepseek-reasoner' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek).toEqual({
      apiKey: 'sk-user',
      model: 'deepseek-flash',
    })
  })

  it('rewrites retired DeepSeek ids and the old pool spelling to the listed id', () => {
    for (const model of [
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-chat',
      'deepseek-reasoner',
      'deep-seek-v4.1-flash',
    ]) {
      const resolved = resolveAiSettings(
        { providers: { deepseek: { apiKey: 'sk-user', model } } as never },
        defaultAiSettings(),
      )
      expect(resolved.providers.deepseek.model).toBe('deepseek-flash')
    }
  })

  it('rewrites legacy UniAI proxy model ids onto OpenRouter slugs', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          genspark: { apiKey: '', model: 'gemini-3.7-flash' },
        } as never,
      },
      defaultAiSettings(),
    )
<<<<<<< ours
    expect(resolved.providers.genspark.model).toBe('openrouter/auto')
=======
    expect(resolved.providers.genspark.model).toBe('claude-opus-5-5')
>>>>>>> theirs

    const gpt = resolveAiSettings(
      {
        providers: {
          genspark: { apiKey: '', model: 'gpt-5.6' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(gpt.providers.genspark.model).toBe('openai/gpt-5.6-terra')
  })

  it('mirrors an OpenRouter Token Hub key into the empty UniAI slot', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          openrouter: { apiKey: 'sk-or-hub', model: 'openrouter/auto' },
          genspark: { apiKey: '', model: 'openrouter/auto' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.genspark.apiKey).toBe('sk-or-hub')
    expect(resolved.providers.openrouter.apiKey).toBe('sk-or-hub')

    const glm = resolveAiSettings(
      { providers: { glm: { apiKey: '', model: 'glm-5-turbo' } } as never },
      defaultAiSettings(),
    )
    expect(glm.providers.glm.model).toBe('glm-5.3-flash')
  })

  it('leaves a still-supported model id alone', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: 'deepseek-v4-pro' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
  })

  it('trims whitespace pasted around stored keys and base URLs', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: ' sk-user\n', model: ' deepseek-v4-pro ' },
          custom: { apiKey: 'k', model: ' m ', baseUrl: ' http://localhost:1234/v1 ' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.apiKey).toBe('sk-user')
    expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
    expect(resolved.providers.deepseek.baseUrl).toBeUndefined()
    expect(resolved.providers.custom.model).toBe('m')
    expect(resolved.providers.custom.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('still remaps retired model ids padded with whitespace', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: ' deepseek-reasoner ' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.model).toBe('deepseek-flash')
  })

  it('trims the legacy single-endpoint key and base URL too', () => {
    const resolved = resolveAiSettings(
      {
        apiKey: ' legacy-key ',
        model: ' legacy-model ',
        baseUrl: ' https://legacy.example.com/v1 ',
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.custom.apiKey).toBe('legacy-key')
    expect(resolved.providers.custom.model).toBe('legacy-model')
    expect(resolved.providers.custom.baseUrl).toBe('https://legacy.example.com/v1')
  })

  it('carries a stored output cap and clamps a hand-edited one', () => {
    // a multi-provider file (the legacy single-endpoint shape returns defaults wholesale)
    const stored = { providers: {} as never }
    expect(
      resolveAiSettings({ ...stored, maxOutputTokens: 32768 }, defaultAiSettings()).maxOutputTokens,
    ).toBe(32768)
    // a settings file edited by hand must not forward an absurd budget to the endpoint
    expect(
      resolveAiSettings({ ...stored, maxOutputTokens: 1 }, defaultAiSettings()).maxOutputTokens,
    ).toBe(MIN_MAX_OUTPUT_TOKENS)
    expect(
      resolveAiSettings({ ...stored, maxOutputTokens: 1e9 }, defaultAiSettings()).maxOutputTokens,
    ).toBe(MAX_MAX_OUTPUT_TOKENS)
    // absent stays absent: pre-existing settings files keep the default behaviour
    expect('maxOutputTokens' in resolveAiSettings(stored, defaultAiSettings())).toBe(false)
  })
})

describe('maxOutputTokensOf', () => {
  it('falls back to the default when the setting is absent or unusable', () => {
    expect(maxOutputTokensOf({})).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(maxOutputTokensOf(undefined)).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(maxOutputTokensOf({ maxOutputTokens: Number.NaN })).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(maxOutputTokensOf({ maxOutputTokens: '8192' as unknown as number })).toBe(
      DEFAULT_MAX_OUTPUT_TOKENS,
    )
  })

  it('honors a stored cap inside the bounds', () => {
    expect(maxOutputTokensOf({ maxOutputTokens: 16384 })).toBe(16384)
    expect(maxOutputTokensOf({ maxOutputTokens: 3.7 })).toBe(MIN_MAX_OUTPUT_TOKENS)
    expect(maxOutputTokensOf({ maxOutputTokens: 20000 })).toBe(20000)
  })
})

describe('clampMaxOutputTokens', () => {
  it('floors, bounds and defaults whatever the settings field or the input box held', () => {
    expect(clampMaxOutputTokens(16384.9)).toBe(16384)
    expect(clampMaxOutputTokens(0)).toBe(MIN_MAX_OUTPUT_TOKENS)
    expect(clampMaxOutputTokens(5e6)).toBe(MAX_MAX_OUTPUT_TOKENS)
    expect(clampMaxOutputTokens(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(clampMaxOutputTokens(undefined)).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })
})

describe('selectedProvider / isProviderUsable', () => {
  it('keeps the chosen provider while its config is incomplete and reports it unusable', () => {
    const settings = defaultAiSettings()
    expect(selectedProvider(settings)).toBe('genspark')

    settings.provider = 'kimi'
    settings.providers.kimi.apiKey = ''
    expect(selectedProvider(settings)).toBe('kimi')
    expect(isProviderUsable(settings, 'kimi')).toBe(false) // no key yet
    settings.providers.kimi.apiKey = 'sk-user'
    expect(isProviderUsable(settings, 'kimi')).toBe(true)
  })

  it('requires a base URL for providers that declare needsBaseUrl', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom.apiKey = 'k'
    expect(isProviderUsable(settings, 'custom')).toBe(false)
    settings.providers.custom.baseUrl = 'http://localhost:1234/v1'
    expect(isProviderUsable(settings, 'custom')).toBe(false) // custom's default model is empty
    settings.providers.custom.model = 'my-model'
    expect(isProviderUsable(settings, 'custom')).toBe(true)
    expect(selectedProvider(settings)).toBe('custom')
  })

  it('allows keyless custom endpoints for local servers', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom.apiKey = ''
    settings.providers.custom.baseUrl = 'http://localhost:11434/v1'
    settings.providers.custom.model = 'llama3'
    expect(isProviderUsable(settings, 'custom')).toBe(true)
  })

  it('auto-discovers Codex without an API key and preserves an optional override', () => {
    const settings = defaultAiSettings()
    settings.provider = 'codex'
    expect(isProviderUsable(settings, 'codex')).toBe(true)
    settings.providers.codex.cliPath = ' C:\\Tools\\codex.exe '
    expect(isProviderUsable(settings, 'codex')).toBe(true)

    const resolved = resolveAiSettings(
      { providers: { codex: settings.providers.codex } as never },
      defaultAiSettings(),
    )
    expect(resolved.providers.codex.cliPath).toBe('C:\\Tools\\codex.exe')
    expect(resolved.providers.codex.apiKey).toBe('')
  })

  it('treats whitespace-only keys, URLs, and models as unconfigured', () => {
    const settings = defaultAiSettings()
    settings.provider = 'kimi'
    settings.providers.kimi.apiKey = '   '
    expect(isProviderUsable(settings, 'kimi')).toBe(false)
    settings.providers.kimi.apiKey = 'sk-user'
    settings.providers.kimi.model = '  '
    expect(isProviderUsable(settings, 'kimi')).toBe(false)
    settings.providers.kimi.model = 'kimi-k2'
    expect(isProviderUsable(settings, 'kimi')).toBe(true)

    const custom = defaultAiSettings()
    custom.provider = 'custom'
    custom.providers.custom.baseUrl = '   '
    custom.providers.custom.model = 'my-model'
    expect(isProviderUsable(custom, 'custom')).toBe(false)
  })

  it('falls back to genspark for unknown ids from a hand-edited settings file', () => {
    const settings = defaultAiSettings()
    settings.provider = 'nonsense' as AiProviderId
    expect(selectedProvider(settings)).toBe('genspark')
  })

  it('keeps a saved uniwork whether or not it is offered: never a silent switch to UniAI', () => {
    const settings = defaultAiSettings()
    settings.provider = 'uniwork'
    setUniworkAiAvailable(false)
    expect(selectedProvider(settings)).toBe('uniwork')
    setUniworkAiAvailable(true)
    expect(selectedProvider(settings)).toBe('uniwork')
    setUniworkAiAvailable(false)
  })

  it('UniAI stays selectable without a key (Token Hub key is required at request time)', () => {
    const settings = defaultAiSettings()
    settings.provider = 'genspark'
    expect(selectedProvider(settings)).toBe('genspark')
    expect(isProviderUsable(settings, 'genspark')).toBe(true)
  })

  it('treats origin: org on modelSources as configured without a local key or base URL, leaving absent/local unchanged', () => {
    const settings = defaultAiSettings()
    settings.provider = 'openai'
    expect(settings.providers.openai.apiKey).toBe('')
    expect(providerNeed(settings, 'openai')).toBe('key')
    expect(isProviderUsable(settings, 'openai')).toBe(false)

    // origin absent or 'local' still requires a local key
    settings.modelSources = {
      openai: { chosen: 'gpt-5.6-sol' },
      anthropic: { chosen: 'claude-sonnet-5', origin: 'local' },
    }
    expect(providerNeed(settings, 'openai')).toBe('key')
    expect(isProviderUsable(settings, 'openai')).toBe(false)
    expect(providerNeed(settings, 'anthropic')).toBe('key')
    expect(isProviderUsable(settings, 'anthropic')).toBe(false)

    // origin: 'org' is usable without copying any key_hint into providers[id].apiKey
    settings.modelSources = {
      openai: { chosen: 'gpt-5.6-sol', origin: 'org' },
    }
    expect(settings.providers.openai.apiKey).toBe('')
    expect(providerNeed(settings, 'openai')).toBeNull()
    expect(isProviderUsable(settings, 'openai')).toBe(true)

    // custom with origin: 'org' needs no local baseUrl or apiKey once a model is chosen
    settings.modelSources = {
      custom: { chosen: '', origin: 'org' },
    }
    expect(providerNeed(settings, 'custom')).toBe('model')
    expect(isProviderUsable(settings, 'custom')).toBe(false)

    settings.modelSources = {
      custom: { chosen: 'org-hosted-model', origin: 'org' },
    }
    expect(settings.providers.custom.apiKey).toBe('')
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(providerNeed(settings, 'custom')).toBeNull()
    expect(isProviderUsable(settings, 'custom')).toBe(true)
  })
})

describe('uniAi OpenRouter Token Hub key', () => {
  it('prefers the UniAI slot, then the openrouter slot', () => {
    const settings = defaultAiSettings()
    expect(uniAiOpenRouterKey(settings)).toBe('')
    settings.providers.openrouter.apiKey = 'sk-or-from-hub'
    expect(uniAiOpenRouterKey(settings)).toBe('sk-or-from-hub')
    settings.providers.genspark.apiKey = 'sk-or-uniai'
    expect(uniAiOpenRouterKey(settings)).toBe('sk-or-uniai')
  })

  it('injects the shared key only for UniAI configs', () => {
    const settings = defaultAiSettings()
    settings.providers.openrouter.apiKey = 'sk-or-shared'
    const injected = withUniAiOpenRouterAuth(settings, 'genspark', settings.providers.genspark)
    expect(injected?.apiKey).toBe('sk-or-shared')
    const anthropic = withUniAiOpenRouterAuth(settings, 'anthropic', {
      apiKey: '',
      model: 'claude-sonnet-5',
    })
    expect(anthropic?.apiKey).toBe('')
  })
})

describe('gskToolsEnabled', () => {
  it('keeps the stored toggle but stays off while the UniWork cloud seam is off', () => {
    expect(defaultAiSettings().gskToolsEnabled).toBe(true)
    expect(cloudToolsEnabled(defaultAiSettings())).toBe(false)
    // pre-toggle settings file (field absent) keeps the default on
    const legacy = resolveAiSettings({ providers: {} as never }, defaultAiSettings())
    expect(legacy.gskToolsEnabled).toBe(true)
    expect(cloudToolsEnabled(legacy)).toBe(false)
    const off = resolveAiSettings(
      { providers: {} as never, gskToolsEnabled: false },
      defaultAiSettings(),
    )
    expect(off.gskToolsEnabled).toBe(false)
    expect(cloudToolsEnabled(off)).toBe(false)
  })
})
