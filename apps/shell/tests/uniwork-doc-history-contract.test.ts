import { describe, expect, it } from 'vitest'
import { asDocHistoryResult, DOC_HISTORY_CHANNELS } from '../src/shared/doc-history-api'
import { createFakeDocHistoryBridge, failure, versionOf } from './doc-history-fake-bridge'

/**
 * UNI-2077: the contract the two sheets build on - the preload's guard of a
 * main answer and the in-memory fake the renderer tests use.
 */

describe('asDocHistoryResult', () => {
  it('passes a success through with its value', () => {
    expect(asDocHistoryResult({ ok: true, value: { a: 1 } })).toEqual({ ok: true, value: { a: 1 } })
  })

  it('keeps only the known fields of a failure', () => {
    expect(
      asDocHistoryResult({
        ok: false,
        error: 'edit_locked',
        status: 423,
        editLock: { holderName: 'B', since: null, expiresAt: 'x', heldByMe: false, stray: 1 },
        stray: 'no',
      }),
    ).toEqual({
      ok: false,
      error: 'edit_locked',
      status: 423,
      editLock: { holderName: 'B', since: null, expiresAt: 'x', heldByMe: false },
    })
    expect(
      asDocHistoryResult({ ok: false, error: 'conflict', currentRevision: '42', retryable: true }),
    ).toEqual({ ok: false, error: 'conflict', currentRevision: '42', retryable: true })
  })

  it('reads an unknown code as server_error and a non-result as malformed_response', () => {
    expect(asDocHistoryResult({ ok: false, error: 'whatever' })).toEqual({
      ok: false,
      error: 'server_error',
    })
    expect(asDocHistoryResult(undefined)).toEqual({ ok: false, error: 'malformed_response' })
    expect(asDocHistoryResult({ ok: 'yes' })).toEqual({ ok: false, error: 'malformed_response' })
  })

  it('names one channel per bridge method under uniwork-doc-history:', () => {
    expect(
      Object.values(DOC_HISTORY_CHANNELS).every((c) => c.startsWith('uniwork-doc-history:')),
    ).toBe(true)
    expect(Object.keys(DOC_HISTORY_CHANNELS).sort()).toEqual(
      Object.keys(createFakeDocHistoryBridge()).sort(),
    )
  })
})

describe('createFakeDocHistoryBridge', () => {
  it('answers the happy defaults and records every call', async () => {
    const bridge = createFakeDocHistoryBridge({
      versions: [versionOf({ version: 2 }), versionOf({ version: 1 })],
    })
    const page = await bridge.versions({ documentId: 'doc-1' })
    expect(page).toMatchObject({ ok: true, value: { next_cursor: null } })
    const created = await bridge.createVersion({ documentId: 'doc-1', label: ' Gửi khách ' })
    expect(created).toMatchObject({ ok: true, value: { version: 3, label: 'Gửi khách' } })
    const restored = await bridge.restore({ documentId: 'doc-1', versionNo: 1 })
    expect(restored).toMatchObject({
      ok: true,
      value: { version: { reason: 'restore', restored_from: 1 } },
    })
    expect(bridge.restore).toHaveBeenCalledWith({ documentId: 'doc-1', versionNo: 1 })
    expect(await bridge.version({ documentId: 'doc-1', versionNo: 9 })).toMatchObject({
      ok: false,
      error: 'not_found',
    })
  })

  it('filters the access log by action and takes a scripted failure', async () => {
    const bridge = createFakeDocHistoryBridge()
    expect(await bridge.accessLogs({ documentId: 'doc-1', action: 'download' })).toEqual({
      ok: true,
      value: { logs: [], next_cursor: null },
    })
    bridge.accessLogs.mockResolvedValueOnce(failure('forbidden', { status: 403 }))
    expect(await bridge.accessLogs({ documentId: 'doc-1' })).toEqual({
      ok: false,
      error: 'forbidden',
      status: 403,
    })
  })
})
