import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  UNIWORK_CLOUD_SIGNED_OUT,
  UniworkCloudError,
  setUniworkCloudStatus,
  setUniworkCloudTransport,
  type UniworkCloudStatus,
  type UniworkCloudTransport,
} from '@genoffice/ai-provider'
import {
  gskAnalyzeMedia,
  gskGenerateImage,
  gskImageSearch,
  gskLoginInfo,
  gskSlideGenerate,
  gskTranscribe,
  gskWebSearch,
  hasGskAuth,
} from '../src/gsk'
import { generateImageTool, analyzeMediaTool, MEDIA_NOT_CONFIGURED_ERROR } from '../src/media-tools'
import { searchOptionsFromSettings } from '../src/search-tools'
import { defaultAiSettings } from '@genoffice/ai-provider'

const READY: UniworkCloudStatus = {
  state: 'ready',
  enabled: true,
  tools: {
    web_search: true,
    image_search: true,
    image_generate: true,
    media_analyze: true,
    transcribe: true,
  },
  credits: { unit: 'ai.tokens', used: 10, limit: 100, remaining: 90, periodEnd: null },
  email: 'lan@example.com',
  planName: 'Pro',
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

type FakeTransport = { [K in keyof UniworkCloudTransport]: Mock<UniworkCloudTransport[K]> }

function fakeTransport(): FakeTransport {
  return {
    search: vi.fn(async (req: { kind: string }) =>
      req.kind === 'web'
        ? { results: [{ title: 'T', url: 'https://a.example/p', snippet: 'S' }], answer: 'A' }
        : {
            results: [
              {
                title: 'I',
                url: 'https://a.example/p',
                snippet: '',
                imageUrl: 'https://a.example/i.png',
              },
              { title: 'no image', url: 'https://b.example/', snippet: '' },
            ],
          },
    ),
    generateImage: vi.fn(async () => ({
      images: [{ mime: 'image/png', dataBase64: PNG_1PX.toString('base64') }],
      model: 'img-1',
    })),
    analyzeMedia: vi.fn(async () => ({ text: 'a cat' })),
    transcribe: vi.fn(async () => ({ text: 'hello' })),
  } as never
}

afterEach(() => {
  setUniworkCloudStatus(UNIWORK_CLOUD_SIGNED_OUT)
  setUniworkCloudTransport(null)
})

describe('UniWork cloud tools, signed out', () => {
  it('reports signed out and rejects every tool without a transport call', async () => {
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    expect(hasGskAuth()).toBe(false)
    expect(await gskLoginInfo()).toBeNull()
    for (const call of [
      gskWebSearch('q'),
      gskImageSearch('q'),
      gskGenerateImage({ prompt: 'p' }),
      gskAnalyzeMedia({ mediaUrls: ['https://x.example/a.png'], requirements: 'r' }),
      gskTranscribe({ audioUrls: ['https://x.example/a.mp3'] }),
    ]) {
      const error = await call.catch((e) => e)
      expect(error).toBeInstanceOf(UniworkCloudError)
      expect(error.code).toBe('signed_out')
    }
    expect(transport.search).not.toHaveBeenCalled()
    expect(transport.generateImage).not.toHaveBeenCalled()
  })

  it('not entitled and unavailable tools reject with their own codes', async () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    expect((await gskWebSearch('q').catch((e) => e)).code).toBe('entitlement_required')
    setUniworkCloudStatus({ ...READY, tools: { ...READY.tools, transcribe: false } })
    setUniworkCloudTransport(fakeTransport())
    const error = await gskTranscribe({ audioUrls: ['data:audio/wav;base64,AAAA'] }).catch((e) => e)
    expect(error.code).toBe('cloud_unavailable')
    expect(hasGskAuth('transcribe')).toBe(false)
    expect(hasGskAuth('web_search')).toBe(true)
  })

  it('slides are never a cloud tool', async () => {
    setUniworkCloudStatus(READY)
    await expect(gskSlideGenerate({ brief: 'b' })).rejects.toThrow(/not available/)
  })
})

describe('UniWork cloud tools, signed in + entitled', () => {
  it('reports the account and remaining credits', async () => {
    setUniworkCloudStatus(READY)
    expect(hasGskAuth()).toBe(true)
    expect(await gskLoginInfo()).toEqual({
      email: 'lan@example.com',
      plan: 'Pro',
      creditBalance: 90,
    })
  })

  it('web and image search map the cloud results and clamp the request', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    expect(await gskWebSearch('x'.repeat(900), 50)).toEqual({
      results: [{ title: 'T', url: 'https://a.example/p', snippet: 'S' }],
      answer: 'A',
    })
    expect(transport.search.mock.calls[0]![0]).toEqual({
      query: 'x'.repeat(400),
      kind: 'web',
      maxResults: 10,
    })
    expect(await gskImageSearch('cats', 3)).toEqual([
      {
        title: 'I',
        imageUrl: 'https://a.example/i.png',
        sourceUrl: 'https://a.example/p',
        source: 'a.example',
      },
    ])
  })

  it('image generation sends reference bytes and returns a local file URL', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    const dir = mkdtempSync(join(tmpdir(), 'cloud-ref-'))
    const ref = join(dir, 'ref.png')
    writeFileSync(ref, PNG_1PX)
    const out = await gskGenerateImage(
      { prompt: 'a red icon', aspectRatio: '1:1', referenceImageUrls: [ref] },
      undefined,
      { mediaRoots: [dir] },
    )
    expect(out.url.startsWith('file:')).toBe(true)
    expect(readFileSync(fileURLToPath(out.url))).toEqual(PNG_1PX)
    expect(transport.generateImage.mock.calls[0]![0]).toEqual({
      prompt: 'a red icon',
      aspectRatio: '1:1',
      referenceImages: [{ mime: 'image/png', dataBase64: PNG_1PX.toString('base64') }],
    })
  })

  it('caps media at 4 items before anything is sent', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    const five = Array.from({ length: 5 }, () => 'data:image/png;base64,AAAA')
    await expect(gskAnalyzeMedia({ mediaUrls: five, requirements: 'r' })).rejects.toThrow(
      /Too many/,
    )
    await expect(gskGenerateImage({ prompt: 'p', referenceImageUrls: five })).rejects.toThrow(
      /Too many/,
    )
    expect(transport.analyzeMedia).not.toHaveBeenCalled()
    expect(transport.generateImage).not.toHaveBeenCalled()
  })

  it('caps media at 25 MiB in total before anything is sent', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    const big = `data:video/mp4;base64,${'A'.repeat(Math.ceil((26 * 1024 * 1024 * 4) / 3))}`
    await expect(gskAnalyzeMedia({ mediaUrls: [big], requirements: 'r' })).rejects.toThrow(
      /too large/,
    )
    expect(transport.analyzeMedia).not.toHaveBeenCalled()
  })

  it('analyze media and transcribe send bytes (one transcription per clip)', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    expect(
      await gskAnalyzeMedia({
        mediaUrls: ['data:image/png;base64,AAAA'],
        requirements: 'what is it',
      }),
    ).toBe('a cat')
    expect(transport.analyzeMedia.mock.calls[0]![0]).toEqual({
      requirements: 'what is it',
      media: [{ mime: 'image/png', dataBase64: 'AAAA' }],
    })
    expect(
      await gskTranscribe({
        audioUrls: ['data:audio/wav;base64,AAAA', 'data:audio/wav;base64,BBBB'],
        prompt: 'names',
      }),
    ).toBe('hello\n\nhello')
    expect(transport.transcribe).toHaveBeenCalledTimes(2)
  })

  it('a 402 surfaces as the out-of-credits message', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    transport.analyzeMedia.mockRejectedValueOnce(new UniworkCloudError('credits_exhausted', 402))
    setUniworkCloudTransport(transport)
    await expect(
      gskAnalyzeMedia({ mediaUrls: ['data:image/png;base64,AAAA'], requirements: 'r' }),
    ).rejects.toThrow(/out of credits/)
  })
})

describe('media tools and search options route to the cloud only while it is on', () => {
  const SETTINGS = '/nonexistent/ai-settings.json'

  it('no BYOK + cloud on: generate_image and analyze_media use the cloud', async () => {
    setUniworkCloudStatus(READY)
    setUniworkCloudTransport(fakeTransport())
    const image = await generateImageTool(SETTINGS, { prompt: 'icon' })
    expect(image.url?.startsWith('file:')).toBe(true)
    expect(
      await analyzeMediaTool(SETTINGS, {
        mediaUrls: ['data:image/png;base64,AAAA'],
        requirements: 'r',
      }),
    ).toEqual({ text: 'a cat' })
  })

  it('no BYOK + cloud off: still "not configured"', async () => {
    expect(await generateImageTool(SETTINGS, { prompt: 'icon' })).toEqual({
      error: MEDIA_NOT_CONFIGURED_ERROR,
    })
  })

  it('a tool error from the cloud comes back as the tool error text', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    transport.generateImage.mockRejectedValueOnce(new UniworkCloudError('cloud_unavailable', 503))
    setUniworkCloudTransport(transport)
    const r = await generateImageTool(SETTINGS, { prompt: 'icon' })
    expect(r.error).toMatch(/unavailable/)
  })

  it('auto search tries the cloud only while it is on and the toggle allows it', () => {
    const settings = defaultAiSettings()
    expect(searchOptionsFromSettings(settings)).toEqual({ useGsk: false })
    setUniworkCloudStatus(READY)
    expect(searchOptionsFromSettings(settings)).toEqual({ useGsk: true })
    expect(searchOptionsFromSettings({ ...settings, gskToolsEnabled: false })).toEqual({
      useGsk: false,
    })
  })
})
