import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  collabMentionStrings,
  collabMentionText,
  collabPanelStrings,
  collabPanelText,
  collabStrings,
  type AnchorLabelStrings,
  type CollabComposerStrings,
  type CollabPickerStrings,
  type CollabStrings,
} from '../src/collab'

/**
 * The glue every host calls once: `collabStrings(lang)` merges the panel and the mention shard into the
 * one record the controller, panel, composer, picker and anchor label read (G8-20, W20F).
 */

// the keys each component type declares; the `satisfies` lines make a drifted interface a type error
const COMPOSER_KEYS = [
  'collabComposerComment',
  'collabComposerReply',
  'collabComposerDiscussion',
  'collabEdit',
  'collabSend',
  'collabSave',
  'collabCancel',
  'collabSendHint',
  'collabSending',
  'collabSendFailed',
  'collabDiscardTitle',
  'collabDiscardBody',
  'collabDiscard',
  'collabKeepWriting',
  'collabAiDraftLabel',
] as const satisfies readonly (keyof CollabComposerStrings)[]

const PICKER_KEYS = [
  'collabMentionLabel',
  'collabMentionSearching',
  'collabMentionCount',
  'collabMentionNoMatch',
  'collabMentionNoCandidates',
  'collabMentionError',
] as const satisfies readonly (keyof CollabPickerStrings)[]

const ANCHOR_KEYS = [
  'collabAnchorDocx',
  'collabAnchorCell',
  'collabAnchorSlide',
  'collabAnchorPage',
  'collabAnchorStale',
  'collabAnchorLost',
] as const satisfies readonly (keyof AnchorLabelStrings)[]

describe('collabStrings glue', () => {
  it.each(LANGS)('%s: the merged record has every key each component needs', (lang) => {
    const merged = collabStrings(lang)
    // the same record serves all four consumers
    const asController: CollabStrings = merged
    const asComposer: CollabComposerStrings = merged
    const asPicker: CollabPickerStrings = merged
    const asAnchor: AnchorLabelStrings = merged
    expect([asController, asComposer, asPicker, asAnchor]).toHaveLength(4)
    for (const key of [...COMPOSER_KEYS, ...PICKER_KEYS, ...ANCHOR_KEYS]) {
      expect(merged[key], `${lang}.${key}`).toBeTruthy()
    }
    // every panel and mention key is carried over unchanged
    for (const [key, value] of Object.entries(collabPanelStrings[lang])) {
      expect(merged[key], `${lang}.${key}`).toBe(value)
    }
    for (const [key, value] of Object.entries(collabMentionStrings[lang])) {
      expect(merged[key], `${lang}.${key}`).toBe(value)
    }
  })

  it.each(LANGS)('%s: the placeholders the components fill are present', (lang) => {
    const merged = collabStrings(lang)
    expect(merged.collabSendHint).toContain('{shortcut}')
    expect(merged.collabLabelCount).toContain('{count}')
    expect(merged.collabReplyCount).toContain('{count}')
    expect(merged.collabMentionCount).toContain('{count}')
    expect(merged.collabMentionNoMatch).toContain('{query}')
  })

  it('the panel and mention shards share no key, so the merge loses nothing', () => {
    const panel = new Set(Object.keys(collabPanelStrings.en))
    for (const key of Object.keys(collabMentionStrings.en)) expect(panel.has(key), key).toBe(false)
    expect(Object.keys(collabStrings('en')).length).toBe(
      Object.keys(collabPanelStrings.en).length + Object.keys(collabMentionStrings.en).length,
    )
  })

  it('an unknown language falls back to en', () => {
    expect(collabStrings('xx' as never)).toEqual(collabStrings('en'))
  })

  it('returns the same record for the same language (a stable prop for memoised children)', () => {
    expect(collabStrings('vi')).toBe(collabStrings('vi'))
  })

  it('re-exports both aggregators and text helpers from the collab entry', () => {
    expect(collabPanelText('en', 'collabComments')).toBe(collabPanelStrings.en.collabComments)
    expect(collabMentionText('en', 'collabMentionLabel')).toBe(
      collabMentionStrings.en.collabMentionLabel,
    )
  })
})
