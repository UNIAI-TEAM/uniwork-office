import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOfficeBridgeClient } from '../src/client'

const ORIGIN = 'https://uniwork.example'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('office bridge live HTTP client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exchanges token, downloads, prepares, uploads, and completes on live paths with Bearer', async () => {
    const calls: Array<{ url: string; method: string; auth?: string; body?: unknown }> = []
    vi.stubGlobal(
      'fetch',
      async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const auth = new Headers(init?.headers).get('Authorization') ?? undefined
        let body: unknown
        if (typeof init?.body === 'string') body = JSON.parse(init.body)
        calls.push({ url, method, auth, body })
        if (url.endsWith('/api/office/sessions/exchange')) {
          return jsonResponse({
            ok: true,
            sessionId: 'sess-1',
            sessionToken: 'ost_session',
            expiresAt: '2099-01-01T00:00:00.000Z',
            document: {
              id: 'doc-1',
              title: 'Proposal',
              fileName: 'proposal.docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              baseVersion: 4,
            },
            endpoints: {
              download: '/api/office/download',
              savePrepare: '/api/office/save/prepare',
              saveComplete: '/api/office/save/complete',
            },
          })
        }
        if (url.endsWith('/api/office/download')) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        }
        if (url.endsWith('/api/office/save/prepare')) {
          return jsonResponse({
            ok: true,
            saveOperationId: '11111111-1111-4111-8111-111111111111',
            baseVersion: 4,
            nextVersion: 5,
            upload: {
              url: 'https://storage.example/put',
              token: 'signed-upload',
              method: 'PUT',
            },
          })
        }
        if (url === 'https://storage.example/put') {
          return new Response(null, { status: 200 })
        }
        if (url.endsWith('/api/office/save/complete')) {
          return jsonResponse({
            ok: true,
            documentId: 'doc-1',
            version: 5,
            versionId: 'ver-5',
            createdAt: '2099-01-01T00:00:00.000Z',
          })
        }
        return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404)
      },
    )

    const client = createOfficeBridgeClient(ORIGIN)
    const exchanged = await client.exchange('olt_' + 'a'.repeat(40))
    expect(calls[0]?.body).toEqual({ token: 'olt_' + 'a'.repeat(40) })
    expect(exchanged.sessionToken).toBe('ost_session')
    expect(exchanged.document.baseVersion).toBe(4)

    await client.downloadContent(exchanged.sessionToken, exchanged.endpoints.download)
    expect(calls[1]?.url).toBe(`${ORIGIN}/api/office/download`)
    expect(calls[1]?.auth).toBe('Bearer ost_session')
    expect(calls[1]?.method).toBe('GET')

    const prepared = await client.prepareSave(
      exchanged.sessionToken,
      {
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        baseVersion: 4,
        sessionId: exchanged.sessionId,
      },
      exchanged.endpoints.savePrepare,
    )
    expect(calls[2]?.url).toBe(`${ORIGIN}/api/office/save/prepare`)
    expect(calls[2]?.auth).toBe('Bearer ost_session')
    expect(calls[2]?.body).toEqual({
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      baseVersion: 4,
      sessionId: 'sess-1',
    })

    await client.upload(prepared.upload.url, prepared.upload.token, new Uint8Array([9]))
    expect(calls[3]?.url).toBe('https://storage.example/put')
    expect(calls[3]?.auth).toBe('Bearer signed-upload')
    expect(calls[3]?.method).toBe('PUT')

    const saved = await client.completeSave(
      exchanged.sessionToken,
      {
        sessionId: exchanged.sessionId,
        saveOperationId: prepared.saveOperationId,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      },
      exchanged.endpoints.saveComplete,
    )
    expect(calls[4]?.url).toBe(`${ORIGIN}/api/office/save/complete`)
    expect(calls[4]?.auth).toBe('Bearer ost_session')
    expect(saved.version).toBe(5)
    expect(calls.some((c) => c.url.includes('/sessions/sess-1/'))).toBe(false)
    expect(JSON.stringify(calls)).not.toContain('launchToken')
    expect(JSON.stringify(calls)).not.toContain('Office ost_')
  })

  it('treats live VERSION_CONFLICT on HTTP 400 as a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        jsonResponse({ ok: false, error: 'VERSION_CONFLICT', baseVersion: 2, latestVersion: 4 }, 400),
    )
    const client = createOfficeBridgeClient(ORIGIN)
    await expect(
      client.prepareSave('tok', {
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        baseVersion: 2,
        sessionId: 'sess-1',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 400 })
  })
})
