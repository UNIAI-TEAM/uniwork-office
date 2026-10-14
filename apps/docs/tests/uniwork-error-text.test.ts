// A UniWork error chunk shows the localized S9 text chosen by its code (G6-05 S2 gap 1), not the
// chunk's fallback line: the docs transport hands createIpcTransport a uniworkErrorText that maps
// uniworkErrorKey(code, 'desktop') through aiUniworkText in the current UI language.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aiUniworkText } from '@genoffice/ui'
import { createElectronTransport } from '../src/renderer/ai/transport'
import { setModuleLang } from '../src/renderer/i18n/locale'
import type { AiSettings } from '../src/shared/ipc'

const FALLBACK = 'fallback line from main'

describe('docs transport: UniWork error text by code', () => {
  let listener: ((chunk: any) => void) | undefined
  let requestId = ''

  beforeEach(() => {
    listener = undefined
    ;(window as any).uniworkAiRun = undefined
    ;(window as any).desktop = {
      onAiStream: (l: (chunk: unknown) => void) => {
        listener = l
        return () => {
          listener = undefined
        }
      },
      aiStream: async (request: { requestId: string }) => {
        requestId = request.requestId
      },
      aiStreamCancel: async () => {},
    }
  })
  afterEach(() => setModuleLang('zh'))

  /** run one turn, push `chunk`, return the text the transport reported as the error */
  const errorFor = async (chunk: Record<string, unknown>): Promise<string> => {
    const transport = createElectronTransport(
      () => ({ provider: 'uniwork', providers: {} }) as unknown as AiSettings,
    )
    let text = ''
    transport.stream(
      { system: '', messages: [{ role: 'user', content: 'hi' }], tools: [] } as any,
      {
        onDelta: () => {},
        onToolCall: () => {},
        onDone: () => {},
        onError: (message: string) => {
          text = message
        },
      } as any,
    )
    await Promise.resolve()
    listener?.({ requestId, type: 'error', error: FALLBACK, ...chunk })
    return text
  }

  it.each([
    ['vi', 'session_expired', 'aiErrSession'],
    ['en', 'session_expired', 'aiErrSession'],
    ['vi', 'credits_exhausted', 'aiErrCredits'],
    ['en', 'ai_rate_limited', 'aiErrRateLimitedNoWait'],
  ] as const)('%s: %s shows the S9 text, not the chunk fallback', async (lang, code, key) => {
    setModuleLang(lang)
    const text = await errorFor({ uniworkCode: code, retryAfterSec: 120 })
    expect(text).toBe(aiUniworkText(lang, key))
    expect(text).not.toBe(FALLBACK)
    expect(text).not.toContain(code)
  })

  it('en: the 413 code is the desktop "unavailable" text (Q-5)', async () => {
    setModuleLang('en')
    expect(await errorFor({ uniworkCode: 'payload_too_large' })).toBe(
      'UniWork AI isn’t responding right now. Your document and Save still work.',
    )
  })

  it('a chunk without a uniworkCode keeps its own text', async () => {
    setModuleLang('en')
    expect(await errorFor({})).toBe(FALLBACK)
  })
})
