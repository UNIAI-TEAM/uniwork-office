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
  gskWebSearch,
  hasGskAuth,
} from '../src/gsk'
import { generateImageTool, analyzeMediaTool } from '../src/media-tools'
import { imageSearchTool, webSearchTool } from '../src/search-tools'

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
    setUniworkCloudStatus({ ...READY, tools: { ...READY.tools, image_search: false } })
    setUniworkCloudTransport(fakeTransport())
    const error = await gskImageSearch('q').catch((e) => e)
    expect(error.code).toBe('cloud_unavailable')
    expect(hasGskAuth('image_search')).toBe(false)
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

  it('analyze media sends bytes', async () => {
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

describe('the cloud tools answer for the editors, and only the cloud', () => {
  const SETTINGS = '/nonexistent/ai-settings.json'
  const OFF = 'Cloud tools are turned off. Turn them on under Settings (Account).'
  const SIGNED_OUT = new UniworkCloudError('signed_out').message

  function settingsFile(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'cloud-settings-'))
    const path = join(dir, 'ai-settings.json')
    writeFileSync(path, JSON.stringify(content))
    return path
  }

  it('cloud on: generate_image and analyze_media use the cloud', async () => {
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

  it('cloud on: web and image search answer from the cloud', async () => {
    setUniworkCloudStatus(READY)
    setUniworkCloudTransport(fakeTransport())
    expect(await webSearchTool(SETTINGS, 'q')).toEqual({
      results: [{ title: 'T', url: 'https://a.example/p', snippet: 'S' }],
      answer: 'A',
      method: 'gsk',
    })
    const images = await imageSearchTool(SETTINGS, 'q')
    expect(images.method).toBe('gsk')
    expect(images.images.map((i) => i.imageUrl)).toEqual(['https://a.example/i.png'])
  })

  it('signed out: every tool answers with the sign-in sentence and nothing is called', async () => {
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      expect(await webSearchTool(SETTINGS, 'q')).toMatchObject({
        method: 'error',
        error: SIGNED_OUT,
      })
      expect(await imageSearchTool(SETTINGS, 'q')).toMatchObject({
        method: 'error',
        error: SIGNED_OUT,
      })
      expect(await generateImageTool(SETTINGS, { prompt: 'icon' })).toEqual({ error: SIGNED_OUT })
      expect(
        await analyzeMediaTool(SETTINGS, {
          mediaUrls: ['data:image/png;base64,AAAA'],
          requirements: 'r',
        }),
      ).toEqual({ error: SIGNED_OUT })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(transport.search).not.toHaveBeenCalled()
      expect(transport.generateImage).not.toHaveBeenCalled()
      expect(transport.analyzeMedia).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('the cloud-tools switch off: every tool says so, even while signed in', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    const off = settingsFile({ provider: 'uniwork', providers: {}, gskToolsEnabled: false })
    expect(await webSearchTool(off, 'q')).toMatchObject({ method: 'error', error: OFF })
    expect(await imageSearchTool(off, 'q')).toMatchObject({ method: 'error', error: OFF })
    expect(await generateImageTool(off, { prompt: 'icon' })).toEqual({ error: OFF })
    expect(
      await analyzeMediaTool(off, { mediaUrls: ['data:image/png;base64,AAAA'], requirements: 'r' }),
    ).toEqual({ error: OFF })
    expect(
      await generateImageTool(off, { prompt: 'icon' }, { cloudToolsOffError: 'localized' }),
    ).toEqual({ error: 'localized' })
    expect(transport.search).not.toHaveBeenCalled()
    expect(transport.generateImage).not.toHaveBeenCalled()
  })

  it('a tool error from the cloud comes back as the tool error text', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    transport.generateImage.mockRejectedValueOnce(new UniworkCloudError('cloud_unavailable', 503))
    transport.search.mockRejectedValueOnce(new UniworkCloudError('rate_limited', 429))
    setUniworkCloudTransport(transport)
    expect((await generateImageTool(SETTINGS, { prompt: 'icon' })).error).toMatch(/unavailable/)
    const search = await webSearchTool(SETTINGS, 'q')
    expect(search.method).toBe('error')
    expect(search.error).toMatch(/Too many/)
  })

  it("no error sentence points at a provider of the user's own", () => {
    for (const code of [
      'entitlement_required',
      'subscription_inactive',
      'no_access',
      'credits_exhausted',
    ] as const) {
      expect(new UniworkCloudError(code).message).not.toMatch(/own provider|AI Media/)
    }
  })
})

describe('cloud media reads fail closed without media roots', () => {
  const SETTINGS = '/nonexistent/ai-settings.json'
  const SECRET = join(tmpdir(), 'passport.jpg')

  function ready() {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    return transport
  }

  it.each([undefined, []] as const)(
    'a bare local path is refused before any transport call (roots: %j)',
    async (roots) => {
      const transport = ready()
      writeFileSync(SECRET, PNG_1PX)
      const media = roots ? { mediaRoots: roots } : {}
      await expect(
        gskGenerateImage({ prompt: 'p', referenceImageUrls: [SECRET] }, undefined, media),
      ).rejects.toThrow(/Local files can only be sent/)
      await expect(
        gskAnalyzeMedia({ mediaUrls: [SECRET], requirements: 'r' }, undefined, media),
      ).rejects.toThrow(/Local files can only be sent/)
      expect(transport.generateImage).not.toHaveBeenCalled()
      expect(transport.analyzeMedia).not.toHaveBeenCalled()
    },
  )

  it('the tools return the refusal as a tool error and never upload the file', async () => {
    const transport = ready()
    writeFileSync(SECRET, PNG_1PX)
    const image = await generateImageTool(SETTINGS, { prompt: 'p', referenceImageUrls: [SECRET] })
    expect(image.error).toMatch(/Local files can only be sent/)
    const analysis = await analyzeMediaTool(SETTINGS, { mediaUrls: [SECRET], requirements: 'r' })
    expect(analysis.error).toMatch(/Local files can only be sent/)
    expect(transport.generateImage).not.toHaveBeenCalled()
    expect(transport.analyzeMedia).not.toHaveBeenCalled()
  })

  it('data URLs still pass with no roots, and a path under a root still works', async () => {
    const transport = ready()
    await gskAnalyzeMedia({ mediaUrls: ['data:image/png;base64,AAAA'], requirements: 'r' })
    expect(transport.analyzeMedia).toHaveBeenCalledTimes(1)
    const dir = mkdtempSync(join(tmpdir(), 'cloud-root-'))
    const inside = join(dir, 'ok.png')
    writeFileSync(inside, PNG_1PX)
    await gskGenerateImage({ prompt: 'p', referenceImageUrls: [inside] }, undefined, {
      mediaRoots: [dir],
    })
    expect(transport.generateImage).toHaveBeenCalledTimes(1)
  })
})

describe('cloud request shaping', () => {
  it('sends the image size only as WxH, so an aspect ratio is not cancelled by auto', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    await gskGenerateImage({ prompt: 'p', aspectRatio: '16:9', imageSize: 'auto' })
    expect(transport.generateImage.mock.calls[0]![0]).toEqual({ prompt: 'p', aspectRatio: '16:9' })
    await gskGenerateImage({ prompt: 'p', aspectRatio: '16:9', imageSize: '2k' })
    expect(transport.generateImage.mock.calls[1]![0]).toEqual({ prompt: 'p', aspectRatio: '16:9' })
    await gskGenerateImage({ prompt: 'p', imageSize: '1024x768' })
    expect(transport.generateImage.mock.calls[2]![0]).toEqual({
      prompt: 'p',
      imageSize: '1024x768',
    })
  })

  it('cuts at the cap without splitting a surrogate pair', async () => {
    setUniworkCloudStatus(READY)
    const transport = fakeTransport()
    setUniworkCloudTransport(transport)
    await gskWebSearch('a'.repeat(399) + '😀😀')
    const sent = transport.search.mock.calls[0]![0].query
    expect(Array.from(sent)).toHaveLength(400)
    expect(sent.endsWith('😀')).toBe(true)
    expect(sent).not.toContain('�')
    expect(sent.length).toBe(401)
  })

  it('an inactive subscription is its own tool error', async () => {
    setUniworkCloudStatus({
      state: 'subscription-inactive',
      enabled: false,
      tools: READY.tools,
      credits: null,
    })
    await expect(gskWebSearch('q')).rejects.toThrow(/subscription is not active/)
  })
})
