import { describe, expect, it } from 'vitest'
import {
  formatAttachmentSize,
  isImageAttachment,
  mergeAttachmentResult,
} from '../src/renderer/src/my-ai-attachments'

describe('My AI attachments helpers', () => {
  it('detects image exts', () => {
    expect(isImageAttachment({ path: '/a.png', name: 'a.png', ext: 'png', sizeBytes: 1 })).toBe(
      true,
    )
    expect(isImageAttachment({ path: '/a.docx', name: 'a.docx', ext: 'docx', sizeBytes: 1 })).toBe(
      false,
    )
  })

  it('formats sizes', () => {
    expect(formatAttachmentSize(500)).toBe('500 B')
    expect(formatAttachmentSize(2048)).toBe('2 KB')
  })

  it('merges accepted paths and reports rejects', () => {
    const { next, notice } = mergeAttachmentResult(
      [{ path: '/a.png', name: 'a.png', ext: 'png', sizeBytes: 1 }],
      {
        accepted: [
          { path: '/a.png', name: 'a.png', ext: 'png', sizeBytes: 1 },
          { path: '/b.pdf', name: 'b.pdf', ext: 'pdf', sizeBytes: 2 },
        ],
        rejected: ['c.exe: unsupported'],
      },
    )
    expect(next).toHaveLength(2)
    expect(next[1]?.path).toBe('/b.pdf')
    expect(notice).toContain('unsupported')
  })
})
