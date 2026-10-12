// The selection popover's "Regenerate with AI" chip is a generate_image run: it is left out while
// image generation is not offered (host grant off, or no live way to generate).
import { describe, expect, it } from 'vitest'
import { chipKeysFor } from '../src/renderer/components/AiAskPopover'

describe('AiAskPopover image chips', () => {
  it('lists "Regenerate with AI" for an image only while image generation is offered', () => {
    expect(chipKeysFor('image', true)).toEqual([
      'aiChipReplaceImage',
      'aiChipRegenImage',
      'aiChipImageCaption',
    ])
    expect(chipKeysFor('image', false)).toEqual(['aiChipReplaceImage', 'aiChipImageCaption'])
  })

  it('leaves the other selections as they are', () => {
    expect(chipKeysFor('text', false)).toEqual(chipKeysFor('text', true))
  })
})
