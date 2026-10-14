/**
 * G8-15 (UNI-1410, V15c-02): a note-tool click on a bound PDF whose open version is unknown
 * opens the comments panel, and the panel footer already says "save the document first"
 * (server-comments-panel.test.ts pins that line). The click must not also raise it as a
 * toast; any other refusal keeps the generic unavailable toast.
 */
import { describe, expect, it } from 'vitest'
import { startFailureNotice } from '../src/renderer/server-comments/start-notice'

describe('startFailureNotice (V15c-02)', () => {
  it('needs a save: no toast, the panel footer says it', () => {
    expect(startFailureNotice(true)).toBeNull()
  })

  it('any other refusal keeps the generic unavailable toast', () => {
    expect(startFailureNotice(false)).toBe('serverCommentStartUnavailable')
  })
})
