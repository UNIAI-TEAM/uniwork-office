import type { Lang } from '@genoffice/i18n'
import { collabMentionStrings } from '../strings-collab-mention'
import { collabPanelStrings } from '../strings-collab-panel'
import type { AnchorLabelStrings } from './AnchorLabel'
import type { CollabComposerStrings } from './CollabComposer'
import type { CollabPickerStrings } from './MentionPicker'
import type { CollabPostSendStrings } from './PostSendMentionNotice'
import type { CollabStrings } from './use-collab-threads'

/** the one record every collab component reads: it carries each component's key set */
export type CollabAllStrings = CollabStrings &
  CollabComposerStrings &
  CollabPickerStrings &
  CollabPostSendStrings &
  AnchorLabelStrings

const merged = new Map<Lang, CollabAllStrings>()

/**
 * The panel and mention shards merged for one language (en when the language has none). The result is
 * cached per language, so it is a stable prop for memoised children.
 */
export function collabStrings(lang: Lang): CollabAllStrings {
  const cached = merged.get(lang)
  if (cached) return cached
  // the shards define the same keys in every locale, so the merge is complete for any language
  const panel = collabPanelStrings[lang] ?? collabPanelStrings.en
  const mention = collabMentionStrings[lang] ?? collabMentionStrings.en
  const record = { ...panel, ...mention } as CollabAllStrings
  merged.set(lang, record)
  return record
}
