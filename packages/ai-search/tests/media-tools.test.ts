import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  UNIWORK_CLOUD_SIGNED_OUT,
  UniworkCloudError,
  setUniworkCloudRefresher,
  setUniworkCloudStatus,
  setUniworkCloudTransport,
  type UniworkCloudStatus,
  type UniworkCloudTransport,
} from '@genoffice/ai-provider'

import { generateImageTool, analyzeMediaTool, MEDIA_NOT_CONFIGURED_ERROR } from '../src/media-tools'

// nonexistent settings file → defaults: no BYOK media provider, and no cloud route while signed out
const SETTINGS = '/nonexistent/ai-settings.json'

describe('media tools without a BYOK provider', () => {
  it('generate_image reports that no media provider is configured', async () => {
    const r = await generateImageTool(SETTINGS, {
      prompt: 'red podcast icon',
      transparentBackground: true,
    })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })

  it('analyze_media reports that no media provider is configured', async () => {
    const r = await analyzeMediaTool(SETTINGS, {
      mediaUrls: ['https://cdn/x/a.png'],
      requirements: 'describe it',
    })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })

  it('uses the caller-supplied localized message', async () => {
    const r = await generateImageTool(
      SETTINGS,
      { prompt: 'red podcast icon' },
      { notLoggedInError: 'localized' },
    )
    expect(r).toEqual({ error: 'localized' })
  })

  it('still validates the input before routing', async () => {
    expect(await generateImageTool(SETTINGS, { prompt: '  ' })).toEqual({
      error: 'prompt must not be empty',
    })
    expect(await analyzeMediaTool(SETTINGS, { mediaUrls: [], requirements: 'x' })).toEqual({
      error: 'mediaUrls must not be empty',
    })
  })
})

describe('media tools after the plan changed on the server', () => {
  const ready: UniworkCloudStatus = {
    state: 'ready',
    enabled: true,
    tools: {
      web_search: true,
      image_search: true,
      image_generate: true,
      media_analyze: true,
      transcribe: true,
    },
    credits: null,
  }
  afterEach(() => {
    setUniworkCloudStatus(UNIWORK_CLOUD_SIGNED_OUT)
    setUniworkCloudRefresher(null)
    setUniworkCloudTransport(null)
  })

  it('a stale "not in your plan" snapshot is re-read before the image request is refused', async () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    const generateImage = vi.fn(() => Promise.reject(new UniworkCloudError('network')))
    setUniworkCloudTransport({ generateImage } as unknown as UniworkCloudTransport)
    const refresher = vi.fn(async () => setUniworkCloudStatus(ready))
    setUniworkCloudRefresher(refresher)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(refresher).toHaveBeenCalledTimes(1)
    // the cloud route was tried: the answer is no longer "no media provider is configured"
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(r.error).not.toBe(MEDIA_NOT_CONFIGURED_ERROR)
  })

  it('stays "not configured" when the re-read says the plan is still off', async () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    const refresher = vi.fn(async () => undefined)
    setUniworkCloudRefresher(refresher)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })
})
