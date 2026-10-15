import { describe, expect, it } from 'vitest'
import { RecoveryClearEpochs, recoveryEpochKey } from '../src/recovery-epochs'

describe('RecoveryClearEpochs (G5-11f d3-2, d3-3)', () => {
  it('a clear invalidates a write in flight', () => {
    const epochs = new RecoveryClearEpochs()
    const ticket = epochs.begin('/u/a.docx')
    expect(epochs.cleared(ticket)).toBe(false)
    epochs.bump('/u/a.docx')
    expect(epochs.cleared(ticket)).toBe(true)
    epochs.end(ticket)
  })

  it('a clear of another path leaves the write alone', () => {
    const epochs = new RecoveryClearEpochs()
    const ticket = epochs.begin('/u/a.docx')
    epochs.bump('/u/b.docx')
    expect(epochs.cleared(ticket)).toBe(false)
    epochs.end(ticket)
  })

  it('keys a path by its normalized spelling (separators, drive-letter case, dot segments)', () => {
    expect(recoveryEpochKey('/u/docs/../docs/a.docx')).toBe(recoveryEpochKey('/u/docs/a.docx'))
    expect(recoveryEpochKey('C:\\Users\\Me\\a.docx')).toBe(recoveryEpochKey('c:/users/me/./a.docx'))
    expect(recoveryEpochKey('/../a.docx')).toBe('/a.docx')
    expect(recoveryEpochKey('/u/a.docx')).not.toBe(recoveryEpochKey('/u/b.docx'))
    // a clear that spells the path differently still reaches the write
    const epochs = new RecoveryClearEpochs()
    const ticket = epochs.begin('/u/docs/a.docx')
    epochs.bump('/u/./docs//a.docx')
    expect(epochs.cleared(ticket)).toBe(true)
    epochs.end(ticket)
  })

  it('holds an entry only while a write is in flight', () => {
    const epochs = new RecoveryClearEpochs()
    epochs.bump('/u/never-written.docx')
    expect(epochs.size).toBe(0)
    const first = epochs.begin('/u/a.docx')
    const second = epochs.begin('/u/a.docx')
    expect(epochs.size).toBe(1)
    epochs.end(first)
    expect(epochs.size).toBe(1)
    epochs.end(second)
    expect(epochs.size).toBe(0)
    // a write that starts after a clear is not invalidated by it
    epochs.bump('/u/a.docx')
    const later = epochs.begin('/u/a.docx')
    expect(epochs.cleared(later)).toBe(false)
    epochs.end(later)
  })
})
