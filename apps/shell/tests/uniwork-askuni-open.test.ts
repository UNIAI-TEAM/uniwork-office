import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  createAskUniOpener,
  registerAskUniOpenIpc,
  type AskUniOpenDeps,
} from '../src/main/uniwork-askuni/open-citation'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import { ASKUNI_CHANNELS } from '../src/shared/askuni-api'
import type { UniworkResult } from '../src/shared/home-api'

/**
 * UNI-2069 s4: `uniwork:askuni:open-citation` - a document citation opens in the app through the
 * existing open-by-id path, every other kind opens as the signed-in deployment's web page, and
 * anything that could leave that origin (or is not a server path) opens nothing.
 */

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const PROFILE: DeploymentProfile = {
  deploymentId: 'prod',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const DEV_PROFILE: DeploymentProfile = {
  deploymentId: 'dev',
  apiOrigin: 'http://localhost:3000',
  clientId: 'uniwork-office-dev',
  channel: 'dev',
}

function setup(over: Partial<AskUniOpenDeps> = {}) {
  const openDocument = vi.fn(async (_id: string): Promise<UniworkResult<{ path: string }>> => ({
    ok: true,
    value: { path: '/tmp/doc.docx' },
  }))
  const openExternal = vi.fn(async (_url: string): Promise<void> => undefined)
  const deps: AskUniOpenDeps = {
    isSignedIn: () => true,
    profile: () => PROFILE,
    openDocument,
    openExternal,
    ...over,
  }
  return { opener: createAskUniOpener(deps), openDocument, openExternal }
}

describe('document citations', () => {
  it('opens the id of /{org}/{ws}/documents/{id} through the open-document path', async () => {
    const { opener, openDocument, openExternal } = setup()
    expect(await opener.open({ kind: 'document', href: `/acme/team-1/documents/${DOC}` })).toEqual({
      ok: true,
    })
    expect(openDocument).toHaveBeenCalledTimes(1)
    expect(openDocument).toHaveBeenCalledWith(DOC)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    '',
    '/',
    `/acme/team/tasks/${DOC}`,
    `/acme/documents/${DOC}`,
    `/acme/team/documents/${DOC}/extra`,
    `/acme/team/documents/${DOC}?x=1`,
    `/acme/team/documents/${DOC}#h`,
    `/acme/team/documents/${DOC}/`,
    '/acme/team/documents/',
    '/acme/team/documents/a%2Fb',
    '/acme/team/documents/a b',
    `//acme/team/documents/${DOC}`,
    `https://evil.example/acme/team/documents/${DOC}`,
    `/acme/team/documents/${'x'.repeat(129)}`,
    '/acme/team/documents/..',
    '/acme/team/documents/a.b',
  ])('refuses the document href %j and opens nothing', async (href) => {
    const { opener, openDocument, openExternal } = setup()
    expect(await opener.open({ kind: 'document', href })).toEqual({ ok: false, code: 'error' })
    expect(openDocument).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    [new UniworkDocError('not_signed_in'), 'signed_out'],
    [new UniworkDocError('session_expired'), 'session'],
    [new UniworkDocError('network'), 'offline'],
    [new UniworkDocError('forbidden'), 'forbidden'],
    [new UniworkDocError('not_found'), 'error'],
  ] as const)('maps an open failure to a code', async (failure, code) => {
    const { opener } = setup({
      openDocument: async () => ({ ok: false, error: failure.code }),
    })
    expect(await opener.open({ kind: 'document', href: `/a/b/documents/${DOC}` })).toEqual({
      ok: false,
      code,
    })
  })

  it('a throw inside the open path is an error result', async () => {
    const { opener } = setup({
      openDocument: async () => {
        throw new Error('boom')
      },
    })
    expect(await opener.open({ kind: 'document', href: `/a/b/documents/${DOC}` })).toEqual({
      ok: false,
      code: 'error',
    })
  })
})

describe('other kinds open the web page of the signed-in deployment', () => {
  it.each(['task', 'meeting', 'chat', 'member', 'other'] as const)(
    'a %s citation opens its path on the web origin',
    async (kind) => {
      const { opener, openDocument, openExternal } = setup()
      expect(await opener.open({ kind, href: '/acme/team/tasks/42' })).toEqual({ ok: true })
      expect(openExternal).toHaveBeenCalledWith(`${ORIGIN}/acme/team/tasks/42`)
      expect(openDocument).not.toHaveBeenCalled()
    },
  )

  it('keeps a query and a fragment of a server path', async () => {
    const { opener, openExternal } = setup()
    await opener.open({ kind: 'task', href: '/acme/team/tasks/42?tab=notes#c1' })
    expect(openExternal).toHaveBeenCalledWith(`${ORIGIN}/acme/team/tasks/42?tab=notes#c1`)
  })

  it.each([
    '',
    'tasks/42',
    '//evil.example/x',
    '//uniwork.example/x',
    '///evil.example',
    '/\\evil.example/x',
    '\\\\evil.example',
    'https://evil.example/x',
    `${ORIGIN}/acme/team/tasks/42`,
    'https://uniwork.example:8443/x',
    '//uniwork.example:8443/x',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'mailto:a@b.c',
    '/acme/%2F%2Fevil.example',
    '/acme/%2fevil',
    '/acme/%5Cevil',
    '/acme/team\r\n/tasks/1',
    '/acme/team/tasks/1 2',
    ' /acme/team/tasks/1',
  ])('refuses the href %j and opens nothing', async (href) => {
    const { opener, openExternal, openDocument } = setup()
    expect(await opener.open({ kind: 'task', href })).toEqual({ ok: false, code: 'error' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('refuses a web origin that is not https (an http profile of a stable channel)', async () => {
    const { opener, openExternal } = setup({
      profile: () => ({ ...PROFILE, apiOrigin: 'http://uniwork.example' }),
    })
    expect(await opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual({
      ok: false,
      code: 'error',
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('allows plain http to localhost on the dev channel only', async () => {
    const dev = setup({ profile: () => DEV_PROFILE })
    expect(await dev.opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual({ ok: true })
    expect(dev.openExternal).toHaveBeenCalledWith('http://localhost:3000/a/b/tasks/1')
    const stable = setup({ profile: () => ({ ...DEV_PROFILE, channel: 'stable' }) })
    expect(await stable.opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual({
      ok: false,
      code: 'error',
    })
    expect(stable.openExternal).not.toHaveBeenCalled()
  })

  it('keeps the port of the profile origin', async () => {
    const { opener, openExternal } = setup({
      profile: () => ({ ...PROFILE, apiOrigin: 'https://uniwork.example:8443' }),
    })
    await opener.open({ kind: 'task', href: '/a/b/tasks/1' })
    expect(openExternal).toHaveBeenCalledWith('https://uniwork.example:8443/a/b/tasks/1')
  })

  it('an openExternal failure is an error result', async () => {
    const { opener } = setup({
      openExternal: async () => {
        throw new Error('no handler')
      },
    })
    expect(await opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual({
      ok: false,
      code: 'error',
    })
  })
})

describe('signed out and bad input', () => {
  it('signed out opens nothing for either path', async () => {
    const { opener, openDocument, openExternal } = setup({ isSignedIn: () => false })
    const out = { ok: false, code: 'signed_out' }
    expect(await opener.open({ kind: 'document', href: `/a/b/documents/${DOC}` })).toEqual(out)
    expect(await opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual(out)
    expect(openDocument).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('no deployment profile is signed out', async () => {
    const { opener, openExternal } = setup({ profile: () => null })
    expect(await opener.open({ kind: 'task', href: '/a/b/tasks/1' })).toEqual({
      ok: false,
      code: 'signed_out',
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    null,
    'x',
    7,
    [],
    {},
    { kind: 'task' },
    { href: '/a/b' },
    { kind: 'hologram', href: '/a/b/tasks/1' },
    { kind: 'task', href: 5 },
    { kind: 'constructor', href: '/a/b' },
  ])('a malformed request %j is refused', async (input) => {
    const { opener, openDocument, openExternal } = setup()
    expect(await opener.open(input)).toEqual({ ok: false, code: 'error' })
    expect(openDocument).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('ignores any extra field the renderer sends, such as a url', async () => {
    const { opener, openExternal } = setup()
    await opener.open({ kind: 'task', href: '/a/b/tasks/1', url: 'https://evil.example' })
    expect(openExternal).toHaveBeenCalledWith(`${ORIGIN}/a/b/tasks/1`)
  })
})

describe('registration', () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      void handlers.set(channel, fn),
  } as unknown as IpcMain
  beforeEach(() => handlers.clear())

  it('has its own channel name', () => {
    expect(ASKUNI_CHANNELS.openCitation).toBe('uniwork:askuni:open-citation')
  })

  it('registers one channel that answers an open result', async () => {
    const { opener, openExternal } = setup()
    registerAskUniOpenIpc(ipcMain, opener)
    expect([...handlers.keys()]).toEqual([ASKUNI_CHANNELS.openCitation])
    const handler = handlers.get(ASKUNI_CHANNELS.openCitation)!
    expect(await handler({}, { kind: 'task', href: '/a/b/tasks/1' })).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(await handler({})).toEqual({ ok: false, code: 'error' })
  })

  it('registerUniworkAskUni wires the opener to the shell open paths', async () => {
    const openDocument = vi.fn(async (_id: string): Promise<UniworkResult<{ path: string }>> => ({
      ok: true,
      value: { path: '/tmp/d.docx' },
    }))
    const openExternal = vi.fn(async (_url: string): Promise<void> => undefined)
    const wiring: UniworkAskUniWiring = {
      profile: () => PROFILE,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      scopeKey: () => 'acc:org',
      selectedOrgId: () => 'org_a',
      activeWorkspaceId: () => null,
      packaged: true,
      env: {},
      openDocument,
      openExternal,
    }
    registerUniworkAskUni(ipcMain, wiring)
    const handler = handlers.get(ASKUNI_CHANNELS.openCitation)!
    expect(await handler({}, { kind: 'document', href: `/a/b/documents/${DOC}` })).toEqual({
      ok: true,
    })
    expect(openDocument).toHaveBeenCalledWith(DOC)
    expect(await handler({}, { kind: 'meeting', href: '/a/b/meetings/9' })).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith(`${ORIGIN}/a/b/meetings/9`)
  })
})
