// G6-09 N-5: "edits are paused" also shows during a read-only run, where nothing is edited. The
// wording must hold for both kinds of run, in every language shard.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setModuleLang, t } from '../src/renderer/i18n/locale'

describe('aiEditsPaused wording', () => {
  it('en and vi do not say the assistant is editing', () => {
    setModuleLang('en')
    expect(t('aiEditsPaused')).toBe(
      'The assistant is working on this document. Your edits are paused; stop the assistant to continue.',
    )
    setModuleLang('vi')
    expect(t('aiEditsPaused')).toBe(
      'Trợ lý đang làm việc với tài liệu này. Bạn tạm thời không sửa được; hãy dừng trợ lý để tiếp tục.',
    )
    setModuleLang('en')
  })

  it('every shard sets the key (zh defines it) and none keeps the English editing claim', () => {
    const dir = join(__dirname, '../src/renderer/i18n/ai')
    const files = readdirSync(dir).filter((f) => /^[a-zA-Z-]+\.ts$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(19)
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).toMatch(/aiEditsPaused:/)
    }
    expect(readFileSync(join(dir, 'en.ts'), 'utf8')).not.toMatch(/is editing this document/)
  })
})
