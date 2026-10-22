import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { askUniUiStrings } from '@genoffice/ui'
import { askUniStrings } from '../src/renderer/src/i18n/strings-askuni'

// Home and the editors show the same Ask UNI words: the shared core (packages/ui) reads its own
// shard, Home's shell shard must say the same for every key both define. The editor-only keys
// (askUniDoc*) live in the ui shard alone.

describe('Ask UNI shell shard vs the shared ui shard', () => {
  it.each(LANGS)('%s: every key both shards define has the same text', (lang) => {
    const ui = askUniUiStrings[lang] as Record<string, string>
    const shell = askUniStrings[lang] as Record<string, string>
    const differing = Object.keys(ui).filter(
      (k) => !k.startsWith('askUniDoc') && shell[k] !== undefined && shell[k] !== ui[k],
    )
    expect(differing).toEqual([])
  })

  it('zh, en and vi define in the shell every shared key (the editor-only ones aside)', () => {
    for (const lang of ['zh', 'en', 'vi'] as const) {
      const ui = askUniUiStrings[lang] as Record<string, string>
      const shell = askUniStrings[lang] as Record<string, string>
      const missing = Object.keys(ui).filter((k) => !k.startsWith('askUniDoc') && !(k in shell))
      expect(missing, lang).toEqual([])
    }
  })
})
