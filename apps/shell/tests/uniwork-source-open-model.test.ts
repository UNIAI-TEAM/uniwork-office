import { describe, expect, it } from 'vitest'
import type { UniworkSourceFile } from '../src/shared/home-api'
import { openable, sourceOpenExtension } from '../src/renderer/src/uniwork-home/source-open-model'

/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.1 / test 6: a source row opens view-only in the app only when
 * the server says so (`canOpenInApp`) AND one of the six editor modules reads the file (docx, xlsx,
 * pptx, pdf, md, html; a txt goes to the markdown module). Anything else is the web's fallback:
 * Download.
 */

const row = (over: Partial<UniworkSourceFile> = {}): UniworkSourceFile => ({
  id: 's1',
  source: 'chat',
  parent: { kind: 'chat_channel', id: 'c1', title: 'Team' },
  name: 'File.docx',
  mimeType: '',
  extension: 'docx',
  sizeBytes: 10,
  updatedAt: '2026-10-18T08:00:00.000Z',
  owner: null,
  canOpenInApp: true,
  canSave: false,
  ...over,
})

describe('openable', () => {
  it.each(['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html'])(
    '%s opens when the server allows it',
    (ext) => {
      expect(openable(row({ extension: ext, name: `File.${ext}` }))).toBe(true)
    },
  )

  it('a txt opens through the markdown module when the server allows it', () => {
    expect(openable(row({ extension: 'txt', name: 'Notes.txt' }))).toBe(true)
    expect(sourceOpenExtension(row({ extension: 'txt', name: 'Notes.txt' }))).toBe('txt')
  })

  it.each(['doc', 'xls', 'ppt', 'htm', 'markdown'])(
    '.%s with canOpenInApp false is a download',
    (ext) => {
      expect(openable(row({ extension: ext, name: `Old.${ext}`, canOpenInApp: false }))).toBe(false)
    },
  )

  it('never opens what the server did not allow, whatever the extension', () => {
    for (const ext of ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt']) {
      expect(openable(row({ extension: ext, canOpenInApp: false }))).toBe(false)
    }
  })

  it('canOpenInApp true with an extension no module reads is still a download', () => {
    expect(openable(row({ extension: 'zip', name: 'a.zip' }))).toBe(false)
    expect(openable(row({ extension: 'doc', name: 'a.doc' }))).toBe(false)
    expect(openable(row({ extension: 'png', name: 'a.png' }))).toBe(false)
  })

  it('reads the extension case-insensitively and without a leading dot', () => {
    expect(openable(row({ extension: '.DOCX' }))).toBe(true)
    expect(openable(row({ extension: 'PDF' }))).toBe(true)
  })

  it('falls back to the file name, then the MIME type, when the extension is empty', () => {
    expect(openable(row({ extension: '', name: 'Plan.xlsx' }))).toBe(true)
    expect(openable(row({ extension: '', name: 'Plan', mimeType: 'application/pdf' }))).toBe(true)
    expect(
      openable(
        row({
          extension: '',
          name: 'Plan',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe(true)
    expect(openable(row({ extension: '', name: 'Plan', mimeType: '' }))).toBe(false)
    expect(sourceOpenExtension(row({ extension: '', name: 'Plan.xlsx' }))).toBe('xlsx')
    expect(
      sourceOpenExtension(row({ extension: '', name: 'Plan', mimeType: 'application/pdf' })),
    ).toBe('pdf')
  })
})
