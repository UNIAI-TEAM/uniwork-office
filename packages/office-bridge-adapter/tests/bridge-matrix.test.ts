import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createOfficeBridgeClient, OfficeBridgeApiError } from '@uniwork/office-bridge'
import { createOfficeBridgeStore, listenOfficeBridgeAdapter } from '../src/index'

const bytes = (label: string) => new TextEncoder().encode(`fixture-${label}`)

describe('office bridge adapter security and versioning', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
      ),
    )
  })

  async function boot() {
    const store = createOfficeBridgeStore()
    const alice = store.addUser('alice')
    const bob = store.addUser('bob')
    store.addMembership({ userId: alice.id, tenantId: 'ten-a', workspaceId: 'ws-a' })
    store.addMembership({ userId: bob.id, tenantId: 'ten-b', workspaceId: 'ws-b' })
    const docA = store.addWorkProduct({
      tenantId: 'ten-a',
      workspaceId: 'ws-a',
      title: 'ACME Proposal',
      fileName: 'proposal.docx',
      bytes: bytes('a-v1'),
    })
    const docB = store.addWorkProduct({
      tenantId: 'ten-b',
      workspaceId: 'ws-b',
      title: 'Secret',
      fileName: 'secret.docx',
      bytes: bytes('b-v1'),
    })
    const { server, origin } = await listenOfficeBridgeAdapter(store)
    servers.push(server)
    const client = createOfficeBridgeClient(origin)
    return { store, alice, bob, docA, docB, client, origin }
  }

  it('creates a one-time launch token without user JWT in the URL', async () => {
    const { alice, docA, client } = await boot()
    const created = await client.createSession(alice.token, docA.id)
    expect(created.launchUrl.startsWith('uniwork://office/open?token=')).toBe(true)
    expect(created.launchUrl.toLowerCase()).not.toContain('jwt')
    expect(created.launchUrl).not.toContain(alice.token)
    const token = new URL(created.launchUrl).searchParams.get('token')!
    const first = await client.exchange(token)
    await expect(client.exchange(token)).rejects.toMatchObject({ code: 'TOKEN_REPLAY' })
    expect(first.sessionToken).not.toBe(token)
  })

  it('rejects expired, forged, and other-user sessions', async () => {
    const { store, alice, docA, client } = await boot()
    const created = await client.createSession(alice.token, docA.id)
    const token = new URL(created.launchUrl).searchParams.get('token')!
    store.expireLaunch(created.sessionId)
    await expect(client.exchange(token)).rejects.toMatchObject({ code: 'EXPIRED' })
    await expect(client.exchange('olt_' + 'z'.repeat(40))).rejects.toBeInstanceOf(OfficeBridgeApiError)

    const live = await client.createSession(alice.token, docA.id)
    const liveToken = new URL(live.launchUrl).searchParams.get('token')!
    const exchanged = await client.exchange(liveToken)
    store.revokeSession(live.sessionId)
    await expect(client.downloadContent(exchanged.sessionToken, exchanged.endpoints.download)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    })
  })

  it('denies cross-tenant Work Product ids without leaking titles', async () => {
    const { alice, docB, origin } = await boot()
    const res = await fetch(`${origin}/api/office/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: docB.id }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(JSON.stringify(body).toLowerCase()).not.toContain('secret')
    expect(body.error).toBe('NOT_FOUND')
  })

  it('saves a new version, is idempotent, and conflicts when base is stale', async () => {
    const { store, alice, docA, client } = await boot()
    const created = await client.createSession(alice.token, docA.id)
    const token = new URL(created.launchUrl).searchParams.get('token')!
    const session = await client.exchange(token)
    const downloaded = await client.downloadContent(session.sessionToken, session.endpoints.download)
    expect(new TextDecoder().decode(downloaded)).toContain('a-v1')

    const v2 = bytes('a-v2')
    const idempotencyKey = randomUUID()
    const prepared = await client.prepareSave(
      session.sessionToken,
      {
        idempotencyKey,
        baseVersion: session.document.baseVersion,
        sessionId: session.sessionId,
      },
      session.endpoints.savePrepare,
    )
    await client.upload(prepared.upload.url, prepared.upload.token, v2)
    const saved = await client.completeSave(
      session.sessionToken,
      {
        sessionId: session.sessionId,
        saveOperationId: prepared.saveOperationId,
        idempotencyKey,
      },
      session.endpoints.saveComplete,
    )
    expect(saved.version).toBe(2)
    const replay = await client.completeSave(
      session.sessionToken,
      {
        sessionId: session.sessionId,
        saveOperationId: prepared.saveOperationId,
        idempotencyKey,
      },
      session.endpoints.saveComplete,
    )
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.versionId).toBe(saved.versionId)
    expect(store.listVersions(docA.id)).toHaveLength(2)
    expect(store.outbox.some((e) => e.type === 'WORK_PRODUCT_VERSION_CREATED')).toBe(true)

    await expect(
      client.prepareSave(
        session.sessionToken,
        {
          idempotencyKey: randomUUID(),
          baseVersion: session.document.baseVersion,
          sessionId: session.sessionId,
        },
        session.endpoints.savePrepare,
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('denies save after membership revocation and leaves no new version', async () => {
    const { store, alice, docA, client } = await boot()
    const created = await client.createSession(alice.token, docA.id)
    const token = new URL(created.launchUrl).searchParams.get('token')!
    const session = await client.exchange(token)
    store.removeMembership(alice.id, 'ws-a')
    await expect(
      client.prepareSave(
        session.sessionToken,
        {
          idempotencyKey: randomUUID(),
          baseVersion: session.document.baseVersion,
          sessionId: session.sessionId,
        },
        session.endpoints.savePrepare,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(store.listVersions(docA.id)).toHaveLength(1)
  })

  it('supports xlsx, pptx, and pdf download through the same session APIs', async () => {
    const { store, alice, client } = await boot()
    const files: Array<[string, string]> = [
      ['sheet.xlsx', 'xlsx'],
      ['deck.pptx', 'pptx'],
      ['scan.pdf', 'pdf'],
    ]
    for (const [fileName] of files) {
      const wp = store.addWorkProduct({
        tenantId: 'ten-a',
        workspaceId: 'ws-a',
        title: fileName,
        fileName,
        bytes: bytes(fileName),
      })
      const created = await client.createSession(alice.token, wp.id)
      const token = new URL(created.launchUrl).searchParams.get('token')!
      const session = await client.exchange(token)
      expect(session.descriptor.fileName).toBe(fileName)
      const downloaded = await client.downloadContent(session.sessionToken, session.endpoints.download)
      expect(downloaded.byteLength).toBeGreaterThan(0)
    }
  })
})
