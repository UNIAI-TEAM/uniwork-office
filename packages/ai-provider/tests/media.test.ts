import { describe, expect, it } from 'vitest'
import {
  imageGenerationAvailable,
  mediaAnalysisAvailable,
  videoAnalysisAvailable,
} from '../src/media'
import { defaultAiSettings } from '../src/providers'

describe('media tools: UniWork cloud only', () => {
  it('are available while signed in with the cloud tools on, on the main-process verdict', () => {
    const settings = defaultAiSettings()
    // gskLoggedIn is main's hasGskAuth(): signed in + entitled
    for (const available of [
      imageGenerationAvailable,
      mediaAnalysisAvailable,
      videoAnalysisAvailable,
    ]) {
      expect(available(settings, true)).toBe(true)
      expect(available(settings, false)).toBe(false)
      // no settings read yet: the main-process verdict alone decides
      expect(available(null, true)).toBe(true)
      expect(available(undefined, false)).toBe(false)
    }
  })

  it('are off when the user switched the cloud tools off, signed in or not', () => {
    const off = { ...defaultAiSettings(), gskToolsEnabled: false }
    for (const available of [
      imageGenerationAvailable,
      mediaAnalysisAvailable,
      videoAnalysisAvailable,
    ]) {
      expect(available(off, true)).toBe(false)
      expect(available(off, false)).toBe(false)
    }
  })
})
