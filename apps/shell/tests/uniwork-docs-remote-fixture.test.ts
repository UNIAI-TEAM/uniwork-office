/**
 * G5-03a W4 Part 2 (ADVISOR 01:05Z, D4 = a): the dev-only S6 display fixture.
 * With an unpackaged build and UNIWORK_DEV_REMOTE_FIXTURE naming a JSON file of
 * `{ "<abs path>": UniworkRemoteBar }`, docStatus shows that bar for a matching
 * path so tester_visual can reach every S6 state without a live server. It is
 * display only: no binding write, no reload, no request; and it is unreachable
 * in a packaged build, where the env is never looked at and the file is never
 * read. Never in product copy - code only.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'

// The proof that a packaged build never opens the fixture file: every sync fs
// touch is recorded (the real implementations still run).
const fsCalls = vi.hoisted(() => ({ reads: [] as string[], stats: [] as string[] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      fsCalls.reads.push(String(args[0]))
      return (actual.readFileSync as unknown as (...a: unknown[]) => unknown)(...args)
    },
    statSync: (...args: unknown[]) => {
      fsCalls.stats.push(String(args[0]))
      return (actual.statSync as unknown as (...a: unknown[]) => unknown)(...args)
    },
  }
})

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const sha256Hex = (bytes: string) => createHash('sha256').update(bytes).digest('hex')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-remote-fixture-'))
  fsCalls.reads.length = 0
  fsCalls.stats.length = 0
  delete process.env.UNIWORK_DEV_REMOTE_FIXTURE
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.UNIWORK_DEV_REMOTE_FIXTURE
})

/** one clean working copy of DOC, its binding on disk */
function seedCopy(): string {
  const documentDir = join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
  mkdirSync(documentDir, { recursive: true })
  const filePath = join(documentDir, 'Plan.docx')
  const bytes = `working copy of ${DOC}`
  writeFileSync(filePath, bytes)
  writeFileSync(
    join(documentDir, BINDING_FILE),
    `${JSON.stringify(
      {
        schema: 2,
        documentId: DOC,
        workspaceId: 'ws_1',
        orgId: 'org_a',
        title: 'Plan.docx',
        filename: 'Plan.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '9',
        baseVersion: 3,
        baseChecksum: sha256Hex(bytes),
        state: 'saved',
        min_store_level: 2,
        min_app_version: '0.11.0',
      },
      null,
      2,
    )}\n`,
  )
  return filePath
}

function fixtureFile(bars: unknown): string {
  const file = join(dir, 'remote-fixture.json')
  writeFileSync(file, typeof bars === 'string' ? bars : JSON.stringify(bars, null, 2))
  return file
}

const reloads: string[] = []
const clientCalls = { getDocument: 0, download: 0 }

function serviceFor(isPackaged: boolean): UniworkDocsService {
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  return new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.11.0',
    // ADVISOR D4: the gate the wiring injects (index.ts: app.isPackaged)
    isPackaged,
    profile: () => ({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable',
    }),
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('fake-token'),
    openPath: () => false,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: (path) => reloads.push(path),
    activePath: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
    client: {
      async getDocument() {
        clientCalls.getDocument += 1
        throw new Error('the fixture must never ask the server')
      },
      async download() {
        clientCalls.download += 1
        throw new Error('the fixture must never ask the server')
      },
    } as never,
  })
}

const fixtureReads = (file: string) => fsCalls.reads.filter((path) => path === file).length
const fixtureStats = (file: string) => fsCalls.stats.filter((path) => path === file).length

describe('the dev-only remote fixture (D4 = a)', () => {
  it('dev + env: overlays remote per path, display only', async () => {
    const path = seedCopy()
    const file = fixtureFile({
      [path]: { kind: 'updated', version: 7 },
      '/somewhere/else.docx': { kind: 'revoked' },
    })
    process.env.UNIWORK_DEV_REMOTE_FIXTURE = file
    const service = serviceFor(false)

    const status = await service.docStatus(path)
    expect(status?.remote).toEqual({ kind: 'updated', version: 7 })
    // display only: the binding is untouched, nothing reloads, nothing is asked
    const binding = JSON.parse(
      readFileSync(join(dir, 'uniwork-documents', 'default', 'acc_1', DOC, BINDING_FILE), 'utf8'),
    )
    expect(binding.remote).toBeUndefined()
    expect(binding).not.toHaveProperty('serverRevision')
    expect(reloads).toEqual([])
    expect(clientCalls.getDocument).toBe(0)
    expect(clientCalls.download).toBe(0)
    // the file was read once for the status (and its mtime watched)
    expect(fixtureReads(file)).toBe(1)
    expect(fixtureStats(file)).toBe(1)
    // a second call with an unchanged mtime reuses the parse: no second read
    expect((await service.docStatus(path))?.remote).toEqual({ kind: 'updated', version: 7 })
    expect(fixtureReads(file)).toBe(1)
  })

  it('packaged + env: inert, and the fixture file is never read', async () => {
    const path = seedCopy()
    const file = fixtureFile({ [path]: { kind: 'deleted' } })
    process.env.UNIWORK_DEV_REMOTE_FIXTURE = file
    const service = serviceFor(true)

    const status = await service.docStatus(path)
    expect(status?.remote).toBeUndefined()
    expect(fixtureReads(file)).toBe(0)
    expect(fixtureStats(file)).toBe(0)
  })

  it('a bad JSON file or a missing one is ignored, never thrown', async () => {
    const path = seedCopy()
    const bad = fixtureFile('{ not json')
    process.env.UNIWORK_DEV_REMOTE_FIXTURE = bad
    const service = serviceFor(false)
    expect((await service.docStatus(path))?.remote).toBeUndefined()

    process.env.UNIWORK_DEV_REMOTE_FIXTURE = join(dir, 'missing-fixture.json')
    expect((await service.docStatus(path))?.remote).toBeUndefined()

    // a JSON file that is not the `{ path: bar }` shape is ignored too
    const list = fixtureFile('[]')
    process.env.UNIWORK_DEV_REMOTE_FIXTURE = list
    expect((await service.docStatus(path))?.remote).toBeUndefined()
    // an unknown bar kind is dropped
    const unknownKind = fixtureFile({ [path]: { kind: 'nope' } })
    process.env.UNIWORK_DEV_REMOTE_FIXTURE = unknownKind
    expect((await service.docStatus(path))?.remote).toBeUndefined()
  })

  it('an unset env is inert even when a fixture file exists', async () => {
    const path = seedCopy()
    const file = fixtureFile({ [path]: { kind: 'newer-ai', version: 4 } })
    const service = serviceFor(false)
    expect((await service.docStatus(path))?.remote).toBeUndefined()
    expect(fixtureReads(file)).toBe(0)
  })
})
