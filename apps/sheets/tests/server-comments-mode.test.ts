/**
 * G8-13 tail fix (UNI-1408): a Sheets workbook that is not in server-comment mode tells the web
 * frame there is no editor owner to wait for (`noEditor`), so a reveal of a non-discussion id
 * answers at once instead of waiting out the reveal timeout. Desktop has no `noEditor`.
 */
import { describe, expect, it, vi } from 'vitest'
import { readContext, resolveServerMode } from '../src/renderer/server-comments/mode'
import type { ServerCommentsApi } from '../src/renderer/server-comments/seam'

const withHook = (context: unknown) => {
  const noEditor = vi.fn()
  return {
    api: {
      context: vi.fn(() => Promise.resolve(context)),
      noEditor,
    } as unknown as ServerCommentsApi,
    noEditor,
  }
}

describe('resolveServerMode tells the frame when there is no editor owner', () => {
  it('calls noEditor once for an unbound workbook, a not-ok context and a malformed answer', async () => {
    for (const context of [
      { ok: false, error: { code: 'not_found' } },
      { ok: true, value: { nope: 1 } },
    ]) {
      const { api, noEditor } = withHook(context)
      expect(await resolveServerMode(api, '')).toBeNull()
      expect(noEditor).toHaveBeenCalledTimes(1)
    }
  })

  it('calls noEditor once when the context call throws', async () => {
    const noEditor = vi.fn()
    const api = {
      context: () => Promise.reject(new Error('x')),
      noEditor,
    } as unknown as ServerCommentsApi
    expect(await resolveServerMode(api, '')).toBeNull()
    expect(noEditor).toHaveBeenCalledTimes(1)
  })

  it('does not call noEditor in server mode', async () => {
    const { api, noEditor } = withHook({ ok: true, value: { documentId: 'd1', versionId: 'v1' } })
    expect(await resolveServerMode(api, '')).not.toBeNull()
    expect(noEditor).not.toHaveBeenCalled()
  })

  it('DOC5-W04: the comment level reaches the mode; an unknown level is dropped, never raised', async () => {
    expect(readContext({ documentId: 'd1', versionId: 'v1', level: 'comment' })?.level).toBe(
      'comment',
    )
    expect(readContext({ documentId: 'd1', versionId: 'v1', level: 'owner' })).not.toHaveProperty(
      'level',
    )
  })

  it('desktop (no noEditor member) is unchanged', async () => {
    const api = {
      context: () => Promise.resolve({ ok: false, error: { code: 'not_found' } }),
    } as unknown as ServerCommentsApi
    expect(await resolveServerMode(api, '')).toBeNull()
    expect(await resolveServerMode(undefined, '')).toBeNull()
  })
})
