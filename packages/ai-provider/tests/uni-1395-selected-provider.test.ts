import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS } from '../src/providers'
import * as providers from '../src/providers'
import { sanitizeAiSettings } from '../src/ai-settings-guard'

const { defaultAiSettings, resolveAiSettings } = providers
// the helpers under test do not exist on the base commit: read them off the module so the
// failure is an assertion, not a missing-export compile error
const selectedProvider = (s: unknown): string =>
  (providers as unknown as Record<string, (s: unknown) => string>).selectedProvider!(s)
const providerNeed = (s: unknown, id: string): string | null =>
  (providers as unknown as Record<string, (s: unknown, id: string) => string | null>).providerNeed!(
    s,
    id,
  )

const openaiDefault = AI_PROVIDERS.find((m) => m.id === 'openai')!.defaultModel

describe('UNI-1395: a stored provider choice is never replaced by UniAI', () => {
  it('keeps an unusable provider selected and says what is missing', () => {
    const settings = defaultAiSettings()
    settings.provider = 'openai'
    // blank key: needs a key
    expect(selectedProvider(settings)).toBe('openai')
    expect(providerNeed(settings, 'openai')).toBe('key')
    // key but a blank model (in-memory, not yet healed): needs a model
    settings.providers.openai = { apiKey: 'sk-user', model: '' }
    expect(selectedProvider(settings)).toBe('openai')
    expect(providerNeed(settings, 'openai')).toBe('model')
    settings.providers.openai = { apiKey: 'sk-user', model: openaiDefault }
    expect(providerNeed(settings, 'openai')).toBeNull()
  })

  it('custom endpoints need a base URL, then a model; the key stays optional', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: '' }
    expect(selectedProvider(settings)).toBe('custom')
    expect(providerNeed(settings, 'custom')).toBe('base-url')
    settings.providers.custom = { apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1' }
    expect(providerNeed(settings, 'custom')).toBe('model')
    settings.providers.custom = { apiKey: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' }
    expect(providerNeed(settings, 'custom')).toBeNull()
  })

  it('a fresh install and a hand-edited unknown id still land on UniAI', () => {
    expect(selectedProvider(defaultAiSettings())).toBe('genspark')
    const settings = defaultAiSettings()
    settings.provider = 'nonsense' as never
    expect(selectedProvider(settings)).toBe('genspark')
  })

  it('reading a stored file keeps the provider and heals a blank model to the default', () => {
    const resolved = resolveAiSettings(
      { provider: 'openai', providers: { openai: { apiKey: 'sk-user', model: '' } } },
      defaultAiSettings(),
    )
    expect(resolved.provider).toBe('openai')
    expect(resolved.providers.openai.model).toBe(openaiDefault)
    expect(providerNeed(resolved, 'openai')).toBeNull()
  })

  it('reading a stored file with no key keeps the provider (needs-key, not UniAI)', () => {
    const resolved = resolveAiSettings(
      { provider: 'openai', providers: { openai: { apiKey: '', model: openaiDefault } } },
      defaultAiSettings(),
    )
    expect(resolved.provider).toBe('openai')
    expect(providerNeed(resolved, 'openai')).toBe('key')
  })

  it('a provider without a default model keep a blank model as a choose-model state', () => {
    const resolved = resolveAiSettings(
      {
        provider: 'custom',
        providers: { custom: { apiKey: '', model: '', baseUrl: 'http://localhost:1234/v1' } },
      },
      defaultAiSettings(),
    )
    expect(resolved.provider).toBe('custom')
    expect(providerNeed(resolved, 'custom')).toBe('model')
  })

  it('load + save round trip never writes a coerced provider or a blank default-able model', () => {
    const loaded = resolveAiSettings(
      { provider: 'openai', providers: { openai: { apiKey: '', model: '' } } },
      defaultAiSettings(),
    )
    const saved = sanitizeAiSettings(loaded)
    expect(saved?.provider).toBe('openai')
    expect(saved?.providers.openai.model).toBe(openaiDefault)
    // a renderer that still sends a blank model gets the default on write
    const blank = sanitizeAiSettings({
      ...loaded,
      providers: { ...loaded.providers, openai: { apiKey: 'k', model: '  ' } },
    })
    expect(blank?.providers.openai.model).toBe(openaiDefault)
  })
})
