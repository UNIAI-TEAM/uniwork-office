import { describe, it, expect } from 'vitest'

import { generateImageTool, analyzeMediaTool, MEDIA_NOT_CONFIGURED_ERROR } from '../src/media-tools'

// nonexistent settings file → defaults: no BYOK media provider, and no cloud route while the seam is off
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
