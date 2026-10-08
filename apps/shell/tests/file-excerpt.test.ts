import { describe, expect, it } from 'vitest'
import {
  clipExcerpt,
  formatExcerptsForPrompt,
  type FileExcerpt,
} from '../src/shared/file-excerpt'

describe('file excerpts', () => {
  it('clips long text with an ellipsis', () => {
    const long = 'a'.repeat(2000)
    const clipped = clipExcerpt(long, 50)
    expect(clipped.length).toBe(50)
    expect(clipped.endsWith('…')).toBe(true)
  })

  it('formats a prompt pack and respects budget', () => {
    const items: FileExcerpt[] = [
      {
        path: '/a/Hop_dong.docx',
        name: 'Hop_dong.docx',
        ext: 'docx',
        status: 'ok',
        excerpt: 'Bên A cho thuê nhà tại 12 Lê Lợi, thời hạn 12 tháng, giá 15 triệu.',
        charCount: 70,
      },
      {
        path: '/a/scan.pdf',
        name: 'scan.pdf',
        ext: 'pdf',
        status: 'too_large',
      },
    ]
    const pack = formatExcerptsForPrompt(items, 400)
    expect(pack).toContain('Hop_dong.docx')
    expect(pack).toContain('15 triệu')
    expect(pack).toContain('scan.pdf')
    expect(pack).toContain('too_large')
  })
})
