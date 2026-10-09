import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UniworkCloudError } from '@genoffice/ai-provider'
import {
  STUB_CLIENT_ID,
  STUB_DEPLOYMENT_ID,
  STUB_ORG,
  STUB_REDIRECT_URI,
  startUniworkAuthStub,
  type UniworkAuthStub,
} from '../../../e2e/fixtures/uniwork-auth-stub'
import { UniworkCloudController, createUniworkCloudClient } from '../src/main/uniwork-auth/cloud'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { TransportError } from '../src/main/uniwork-auth/transport'

/** The real client against the e2e stub (the one tester_visual drives the app with). */

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let stub: UniworkAuthStub
let token = ''

/** signs in through the stub's PKCE flow and returns a live access token */
async function signIn(origin: string): Promise<string> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier, 'ascii').digest())
  const q = new URLSearchParams({
    client_id: STUB_CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st_1',
    redirect_uri: STUB_REDIRECT_URI,
    deployment_id: STUB_DEPLOYMENT_ID,
  })
  await fetch(`${origin}/api/v1/auth/desktop/start?${q}`)
  const code = new URL(stub.approve()).searchParams.get('code')!
  const res = await fetch(`${origin}/api/v1/auth/desktop/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STUB_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: STUB_REDIRECT_URI,
      deployment_id: STUB_DEPLOYMENT_ID,
    }),
  })
  return ((await res.json()) as { access_token: string }).access_token
}

beforeAll(async () => {
  stub = await startUniworkAuthStub()
  token = await signIn(stub.origin)
})

afterAll(async () => {
  await stub.close()
})

function client(bearer = () => token) {
  const profile: DeploymentProfile = {
    deploymentId: STUB_DEPLOYMENT_ID,
    apiOrigin: stub.origin,
    clientId: STUB_CLIENT_ID,
    channel: 'dev',
  }
  return createUniworkCloudClient({
    profile: () => profile,
    orgId: () => STUB_ORG.id,
    withAccessToken: async (call) => {
      try {
        return await call(bearer())
      } catch (error) {
        if (error instanceof TransportError && error.code === 'unauthorized') {
          return call(token)
        }
        throw error
      }
    },
  })
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof UniworkCloudError ? e.code : String(e)),
  )

describe('cloud client against the e2e stub', () => {
  it('ready: status, every tool, credits move', async () => {
    stub.setCloudMode('ready')
    const c = client()
    const before = await c.status()
    expect(before.enabled).toBe(true)
    expect(Object.values(before.tools).every(Boolean)).toBe(true)
    expect((await c.search({ query: 'q', kind: 'web', maxResults: 3 })).answer).toBe('Stub answer.')
    expect(
      (await c.search({ query: 'q', kind: 'image', maxResults: 3 })).results[0]?.imageUrl,
    ).toBeTruthy()
    expect((await c.generateImage({ prompt: 'p' })).images).toHaveLength(1)
    expect((await c.analyzeMedia({ requirements: 'r', media: [] })).text).toBeTruthy()
    expect(
      (await c.transcribe({ audio: { mime: 'audio/wav', dataBase64: 'AA' } })).text,
    ).toBeTruthy()
    const after = await c.status()
    expect(after.credits!.remaining!).toBeLessThan(before.credits!.remaining!)
  })

  it('a stale bearer is retried once with a fresh one', async () => {
    stub.setCloudMode('ready')
    const calls = stub.cloudCalls().length
    const s = await client(() => 'at_stale').status()
    expect(s.enabled).toBe(true)
    expect(
      stub
        .cloudCalls()
        .slice(calls)
        .map((x) => x.authorized),
    ).toEqual([false, true])
  })

  it.each([
    ['not_entitled', 'entitlement_required'],
    ['credits_exhausted', 'credits_exhausted'],
    ['unavailable', 'cloud_unavailable'],
    ['subscription_inactive', 'subscription_inactive'],
    ['not_configured', 'cloud_unavailable'],
  ] as const)(
    '%s: tools answer %s, the controller shows the matching state',
    async (mode, expected) => {
      stub.setCloudMode(mode)
      const c = client()
      expect(await code(c.generateImage({ prompt: 'p' }))).toBe(expected)
      const published: string[] = []
      const controller = new UniworkCloudController({
        client: c,
        account: () => ({ signedIn: true, orgId: STUB_ORG.id }),
        publish: (s) => published.push(s.state),
      })
      await controller.refresh()
      expect(published.at(-1)).toBe(
        mode === 'not_entitled'
          ? 'not-entitled'
          : mode === 'subscription_inactive'
            ? 'subscription-inactive'
            : mode === 'credits_exhausted'
              ? 'credits-exhausted'
              : 'unavailable',
      )
    },
  )
})
