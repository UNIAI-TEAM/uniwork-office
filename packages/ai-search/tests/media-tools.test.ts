import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// nonexistent settings file → defaults: the cloud-tools switch is on
const SETTINGS = '/nonexistent/ai-settings.json'

function switchedOffSettings(): string {
  const dir = mkdtempSync(join(tmpdir(), 'genoffice-media-tools-'))
  const path = join(dir, 'ai-settings.json')
  writeFileSync(
    path,
    JSON.stringify({ provider: 'uniwork', providers: {}, gskToolsEnabled: false }),
  )
  return path
}

describe('media tools with the cloud-tools switch off', () => {
  it('generate_image says the cloud tools are turned off', async () => {
    const r = await generateImageTool(switchedOffSettings(), { prompt: 'red podcast icon' })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })

  it('analyze_media says the cloud tools are turned off', async () => {
    const r = await analyzeMediaTool(switchedOffSettings(), {
      mediaUrls: ['https://cdn/x/a.png'],
      requirements: 'describe it',
    })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })

  it('names where to turn them back on', () => {
    expect(MEDIA_NOT_CONFIGURED_ERROR).toBe(
      'Cloud tools are turned off. Turn them on under Settings (Account).',
    )
  })

  it('uses the caller-supplied localized message', async () => {
    const r = await generateImageTool(
      switchedOffSettings(),
      { prompt: 'red podcast icon' },
      { cloudToolsOffError: 'localized' },
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

  it('signed out is the sign-in sentence, not the switch sentence', async () => {
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(r).toEqual({ error: new UniworkCloudError('signed_out').message })
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
    // the cloud route was tried: the answer is the transport's, not the entitlement refusal
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(r.error).toBe(new UniworkCloudError('network').message)
  })

  it('stays refused with the plan sentence when the re-read says the plan is still off', async () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    const refresher = vi.fn(async () => undefined)
    setUniworkCloudRefresher(refresher)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ error: new UniworkCloudError('entitlement_required').message })
  })
})
