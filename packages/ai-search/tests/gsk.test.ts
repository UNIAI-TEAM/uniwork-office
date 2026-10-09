import { describe, expect, it } from 'vitest'
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

// UniWork cloud seam is off: every cloud entry point is a stub that never leaves the machine
describe('UniWork cloud stub', () => {
  it('reports signed out', async () => {
    expect(hasGskAuth()).toBe(false)
    expect(await gskLoginInfo()).toBeNull()
  })

  it('rejects every cloud tool with the same message', async () => {
    const calls: Promise<unknown>[] = [
      gskWebSearch('q'),
      gskImageSearch('q'),
      gskGenerateImage({ prompt: 'p' }),
      gskAnalyzeMedia({ mediaUrls: ['https://x/a.png'], requirements: 'r' }),
      gskTranscribe({ audioUrls: ['https://x/a.mp3'] }),
      gskSlideGenerate({ brief: 'b' }),
    ]
    for (const call of calls) {
      await expect(call).rejects.toThrow('UniWork cloud is not available')
    }
  })
})
