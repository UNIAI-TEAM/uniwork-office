// @vitest-environment jsdom
/**
 * SIZE-F1 (UNI-1861), desktop app half: `documents.limits` from
 * `GET /api/v1/config` (contract `contract-size-frame-v0.1` r4), the pre-upload
 * check in `UniworkDocsService.uploadDocument` (§5.2 item 2), the pre-enqueue
 * check and warn band in `SaveCoordinator.save` (§5.2 item 3), the `413`
 * `fields.max_bytes` carried into the queue record, and the signed copy (§6.2).
 */
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Fragment, act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_WARN_BYTES,
  DEFAULT_WARN_RATIO,
  MB_BYTES,
  formatSizeMB,
} from '../src/shared/size-format'
import type { UniworkDocStatus } from '../src/shared/home-api'
import type {
  SyncCenterActionResult,
  SyncCenterIntentFact,
  SyncCenterSnapshot,
  UniworkSyncCenterApi,
} from '../src/shared/sync-center'
import {
  DEFAULT_DOCUMENT_LIMITS,
  createDocumentLimitsCache,
  parseDocumentLimits,
  type DocumentLimits,
} from '../src/main/uniwork-docs/limits'
import { UniworkDocError, errorFromResponse } from '../src/main/uniwork-docs/errors'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import type { Binding, BoundDocument } from '../src/main/uniwork-docs/binding-store'
import { sha256Hex } from '../src/main/uniwork-docs/formats'
import {
  SaveCoordinator,
  type SaveCoordinatorDeps,
} from '../src/main/uniwork-docs/save-coordinator'
import { UniworkDocsService } from '../src/main/uniwork-docs/service'
import { QueueDispatcher } from '../src/main/uniwork-sync/queue/dispatcher'
import { transition } from '../src/main/uniwork-sync/queue/machine'
import { buildSyncCenterSnapshot, type SyncCenterFacts } from '../src/main/uniwork-sync/sync-center'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import type { IntentStore, PendingIntentValue } from '../src/main/uniwork-sync/intent-store'
import {
  chipCopy,
  chipModelOf,
  saveBlockCopyOf,
  sizeWarnTextOf,
  uploadTooLargeTextOf,
} from '../src/renderer/src/uniwork-docs-model'
import { failedReasonKeyOf, queuePopoverModelOf } from '../src/renderer/src/queue-popover-model'
import { failedReasonKey, rowView } from '../src/renderer/src/sync-center-model'
import { UploadDocDialog } from '../src/renderer/src/UniworkDocActions'
import { SyncCenterPane } from '../src/renderer/src/SyncCenterPane'
import { UniworkStatusChip } from '../src/renderer/src/UniworkChrome'
import { LIVE_HOST_ID, UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { setTopInsetPart } from '../src/renderer/src/uniwork-top-inset'
import { LocaleProvider, type StringKey } from '../src/renderer/src/locale'
import { vi as viDocs } from '../src/renderer/src/i18n/uniwork-documents/vi'
import { en as enDocs } from '../src/renderer/src/i18n/uniwork-documents/en'
import { zh as zhDocs } from '../src/renderer/src/i18n/uniwork-documents/zh'
import { vi as syncVi } from '../src/renderer/src/i18n/sync/vi'
import { en as syncEn } from '../src/renderer/src/i18n/sync/en'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const DOC_ID = '01J8X4DOC0N1P2Q3R4S5T6U7'
const ORG_ID = 'org_a'
const WS_ID = 'ws_1'
const ISO = '2026-10-16T12:00:00.000Z'
const enc = (text: string) => new TextEncoder().encode(text)

/** the real translator over the app's shards, for the copy assertions (contract §6.2) */
function makeT(...dicts: Array<Record<string, string>>) {
  const dict = Object.assign({}, ...dicts) as Record<string, string>
  return ((key: StringKey, params?: Record<string, string | number>) => {
    let text = dict[key] ?? String(key)
    for (const [k, v] of Object.entries(params ?? {})) text = text.replaceAll(`{${k}}`, String(v))
    return text
  }) as Parameters<typeof chipCopy>[1]
}

describe('SIZE-F1 desktop document size limits', () => {
  describe('1. documents.limits (contract r4)', () => {
    it('formats a byte count as MB with one locale-correct decimal and the boundary rules', () => {
      expect(DEFAULT_MAX_DOCUMENT_BYTES).toBe(209_715_200)
      expect(DEFAULT_WARN_RATIO).toBe(0.9)
      expect(DEFAULT_WARN_BYTES).toBe(188_743_680)

      expect(formatSizeMB(DEFAULT_MAX_DOCUMENT_BYTES, 'vi')).toBe('200 MB')
      expect(formatSizeMB(DEFAULT_WARN_BYTES, 'en')).toBe('180 MB')

      // 185.5 MiB + 1 byte, exactly representable: 1 decimal, locale separator,
      // and the mode decides which way the last digit may go
      const halfPast = 185 * MB_BYTES + MB_BYTES / 2 + 1
      expect(formatSizeMB(halfPast, 'vi', 'exact')).toBe('185,5 MB')
      expect(formatSizeMB(halfPast, 'en', 'exact')).toBe('185.5 MB')
      // over the cap: never under-state (round up)
      expect(formatSizeMB(halfPast, 'vi', 'over')).toBe('185,6 MB')
      // inside the band: never over-state (round down)
      expect(formatSizeMB(halfPast, 'vi', 'warn')).toBe('185,5 MB')
      // 200 MiB + 1 B is over the cap: it must never read as "200 MB"
      expect(formatSizeMB(DEFAULT_MAX_DOCUMENT_BYTES + 1, 'vi', 'over')).toBe('200,1 MB')
      expect(formatSizeMB(DEFAULT_MAX_DOCUMENT_BYTES + 1, 'en', 'over')).toBe('200.1 MB')
      // at the cap in the warn band the size must never exceed the max
      expect(formatSizeMB(DEFAULT_MAX_DOCUMENT_BYTES - 1, 'vi', 'warn')).toBe('199,9 MB')
    })

    it('parses the r4 config shape, mapping upload_max_bytes / save_warn_ratio', () => {
      const parsed = parseDocumentLimits({
        office_deployment_id: 'prod',
        documents: {
          limits: {
            upload_max_bytes: 100 * MB_BYTES,
            save_warn_ratio: 0.85,
            web_open: { docx: { warn_bytes: 30 * MB_BYTES } },
            chunked_upload_threshold_bytes: 40 * MB_BYTES,
          },
        },
      })
      expect(parsed).toEqual({
        max_bytes: 100 * MB_BYTES,
        warn_ratio: 0.85,
        warn_bytes: Math.floor(100 * MB_BYTES * 0.85),
        // BIGUP-A1: the chunked-upload threshold rides along, so the upload
        // path knows when to open a session instead of one big request
        chunked_upload_threshold_bytes: 40 * MB_BYTES,
      })

      // every field is optional and falls back on its own
      expect(parseDocumentLimits(null)).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(parseDocumentLimits({})).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(parseDocumentLimits({ documents: {} })).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: -5, save_warn_ratio: 1.5 } },
        }),
      ).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: 150 * MB_BYTES, save_warn_ratio: 'nope' } },
        }),
      ).toEqual({
        max_bytes: 150 * MB_BYTES,
        warn_ratio: DEFAULT_WARN_RATIO,
        warn_bytes: Math.floor(150 * MB_BYTES * DEFAULT_WARN_RATIO),
      })
      // a non-config body is not a limits object
      expect(parseDocumentLimits('nope')).toEqual(DEFAULT_DOCUMENT_LIMITS)

      // d1-6: fractional (0.5, 100.5), zero, or unsafe integer upload_max_bytes fall back
      // to DEFAULT_DOCUMENT_LIMITS rather than flooring 0.5 to a zero cap
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: 0.5 } },
        }),
      ).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: 100.5 } },
        }),
      ).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: 0 } },
        }),
      ).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(
        parseDocumentLimits({
          documents: { limits: { upload_max_bytes: Number.MAX_SAFE_INTEGER + 1 } },
        }),
      ).toEqual(DEFAULT_DOCUMENT_LIMITS)
    })

    it('reads once per deployment origin, and again on a deployment switch', async () => {
      let origin = 'https://a.uniwork.example'
      const configOf = (maxBytes: number) => ({
        documents: { limits: { upload_max_bytes: maxBytes, save_warn_ratio: 0.8 } },
      })
      const fetchSpy = vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.startsWith('https://a.uniwork.example')
            ? configOf(120 * MB_BYTES)
            : configOf(250 * MB_BYTES),
      }))

      const cache = createDocumentLimitsCache({ origin: () => origin, fetch: fetchSpy })
      expect((await cache.get()).max_bytes).toBe(120 * MB_BYTES)
      expect((await cache.get()).warn_ratio).toBe(0.8)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy.mock.calls[0]![0]).toBe('https://a.uniwork.example/api/v1/config')

      // the deployment switch: a different origin is a different entry
      origin = 'https://b.uniwork.example'
      expect(cache.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect((await cache.get()).max_bytes).toBe(250 * MB_BYTES)
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      // not signed in / unreachable: the defaults, and nothing pinned to be stale
      const empty = createDocumentLimitsCache({
        origin: () => origin,
        fetchLimits: () => null,
      })
      expect(await empty.get()).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(empty.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)

      // the app's own client reads the same document
      const client = createUniworkDocsClient({
        apiOrigin: 'https://a.uniwork.example',
        authorized: (call) => call('tok'),
        isSignedIn: () => true,
        fetch: (async (input: string) => ({
          ok: true,
          status: 200,
          json: async () =>
            configOf(
              input.startsWith('https://a.uniwork.example') ? 120 * MB_BYTES : 250 * MB_BYTES,
            ),
        })) as unknown as FetchLike,
      })
      expect(await client.getDocumentLimits!()).toEqual({
        max_bytes: 120 * MB_BYTES,
        warn_ratio: 0.8,
        warn_bytes: Math.floor(120 * MB_BYTES * 0.8),
      })
    })

    it('drops in-flight reads across reset() and origin switches so stale limits never commit (d1-4)', async () => {
      let origin = 'https://a.uniwork.example'
      const pending: Array<{
        startedOrigin: string | null | undefined
        resolve: (value: unknown) => void
      }> = []
      const cache = createDocumentLimitsCache({
        origin: () => origin,
        fetchLimits: (startedOrigin) =>
          new Promise((resolve) => {
            pending.push({ startedOrigin, resolve })
          }),
      })

      // 1. Start a read before reset(), call reset(), then resolve the pre-reset read:
      //    it must NOT commit into the cache nor satisfy a post-reset get()
      const preResetPromise = cache.get()
      expect(pending).toHaveLength(1)
      cache.reset()

      const postResetPromise = cache.get()
      expect(pending).toHaveLength(2)

      // Resolve the stale pre-reset read with 50 MiB
      pending[0]!.resolve({
        documents: { limits: { upload_max_bytes: 50 * MB_BYTES, save_warn_ratio: 0.8 } },
      })
      expect(await preResetPromise).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(cache.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)

      // Resolve the post-reset read with 140 MiB: only this one commits
      pending[1]!.resolve({
        documents: { limits: { upload_max_bytes: 140 * MB_BYTES, save_warn_ratio: 0.8 } },
      })
      expect((await postResetPromise).max_bytes).toBe(140 * MB_BYTES)
      expect(cache.peek().max_bytes).toBe(140 * MB_BYTES)

      // 2. Origin switch while a read for origin A is in flight (including A -> B -> A):
      cache.reset()
      const inFlightA1 = cache.refresh()
      expect(pending).toHaveLength(3)
      expect(pending[2]!.startedOrigin).toBe('https://a.uniwork.example')

      origin = 'https://b.uniwork.example'
      const inFlightB = cache.get()
      expect(pending).toHaveLength(4)
      expect(pending[3]!.startedOrigin).toBe('https://b.uniwork.example')

      // Switch back to A before A's first read settles; resolve A's first read: must not commit
      origin = 'https://a.uniwork.example'
      pending[2]!.resolve({
        documents: { limits: { upload_max_bytes: 60 * MB_BYTES, save_warn_ratio: 0.75 } },
      })
      expect(await inFlightA1).toEqual(DEFAULT_DOCUMENT_LIMITS)
      expect(cache.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)

      // B's earlier read also cannot commit while active origin is A
      pending[3]!.resolve({
        documents: { limits: { upload_max_bytes: 80 * MB_BYTES, save_warn_ratio: 0.75 } },
      })
      expect(await inFlightB).toEqual(DEFAULT_DOCUMENT_LIMITS)
      origin = 'https://b.uniwork.example'
      expect(cache.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)
    })

    it('drives limits refresh/reset end to end through noteSessionIdentity, noteSelectedOrg, and lockSession (d1-9)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'uw-size-lifecycle-'))
      try {
        let currentIdentity: {
          accountId: string
          deviceSessionId: string
          deploymentId: string
        } | null = {
          accountId: 'acc_1',
          deviceSessionId: 'dev_1',
          deploymentId: 'default',
        }
        let currentOrigin = 'https://a.uniwork.example'
        let currentOrg: { id: string; slug: string } | null = { id: 'org_a', slug: 'acme' }

        const configGraduates: Array<(maxBytes: number) => void> = []
        let configCalls = 0

        const service = new UniworkDocsService({
          userDataDir: tmp,
          profile: () => ({
            deploymentId: currentIdentity?.deploymentId ?? 'default',
            apiOrigin: currentOrigin,
            clientId: 'uniwork-office',
            channel: 'stable',
          }),
          channel: () => 'stable',
          applyProfile: async () => 'unchanged',
          identity: () => currentIdentity,
          selectedOrg: () => currentOrg,
          authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
          fetch: (async (url: string) => {
            if (url.endsWith('/api/v1/config')) {
              configCalls += 1
              const maxBytes = await new Promise<number>((resolve) => {
                configGraduates.push(resolve)
              })
              return new Response(
                JSON.stringify({
                  documents: { limits: { upload_max_bytes: maxBytes, save_warn_ratio: 0.9 } },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              )
            }
            return new Response('{}', { status: 404 })
          }) as unknown as FetchLike,
          syncStore: {
            scope: () =>
              currentIdentity
                ? {
                    deploymentId: currentIdentity.deploymentId,
                    accountId: currentIdentity.accountId,
                  }
                : null,
            open: async () => ({
              kind: 'ok' as const,
              records: () => ({
                read: async () => ({ kind: 'missing' as const }),
                write: async () => ({ kind: 'ok' as const }),
                delete: async () => undefined,
                listKeys: async () => [],
              }),
              lock: async () => undefined,
            }),
            lock: async () => undefined,
          } as never,
          openPath: () => true,
          isPathOpen: () => false,
          requestModuleSave: () => false,
          reloadPath: () => undefined,
          activePath: () => undefined,
          ui: { chooseUnsavedClose: async () => 'cancel' },
          pushStatus: () => undefined,
          pushLaunch: () => undefined,
          reveal: () => undefined,
        })

        // 1. Session boot via noteSessionIdentity triggers a refresh
        service.noteSessionIdentity()
        expect(configCalls).toBe(1)
        configGraduates.shift()!(1000)
        expect((await service.limitsCache.get()).max_bytes).toBe(1000)

        // 2. Upload observes the refreshed 1000-byte limit from session boot
        const candidatePath = join(tmp, 'Candidate.docx')
        writeFileSync(candidatePath, new Uint8Array(1200).fill(65))
        const blockedUpload = await service.uploadDocument({
          workspaceId: WS_ID,
          folderId: null,
          path: candidatePath,
          uploadId: 'up-candidate',
        })
        expect(blockedUpload).toEqual({
          ok: false,
          error: 'too_large',
          name: 'Candidate.docx',
          sizeBytes: 1200,
          maxBytes: 1000,
        })

        // 3. noteSelectedOrg refreshes when the selected org changes, and ignores duplicate calls
        service.noteSelectedOrg('org_a')
        expect(configCalls).toBe(2)
        configGraduates.shift()!(1500)
        expect((await service.limitsCache.get()).max_bytes).toBe(1500)

        service.noteSelectedOrg('org_a')
        expect(configCalls).toBe(2)

        service.noteSelectedOrg('org_b')
        expect(configCalls).toBe(3)

        // 4. While org_b's refresh is still in flight, lockSession runs (account boundary):
        //    the cache resets and the stale in-flight read from before lockSession cannot commit
        await service.lockSession({
          deploymentId: 'default',
          accountId: 'acc_1',
        })
        configGraduates.shift()!(500)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(service.limitsCache.peek()).toEqual(DEFAULT_DOCUMENT_LIMITS)

        // 5. Sign in to a new session/origin and verify save enforces the new session's limit
        currentOrigin = 'https://b.uniwork.example'
        currentIdentity = {
          accountId: 'acc_2',
          deviceSessionId: 'dev_2',
          deploymentId: 'default',
        }
        currentOrg = { id: 'org_b', slug: 'beta' }
        service.noteSessionIdentity()
        expect(configCalls).toBe(4)
        configGraduates.shift()!(800)
        expect((await service.limitsCache.get()).max_bytes).toBe(800)

        const docDir = service.store.dirFor('default', 'acc_2', DOC_ID)
        const baseBytes = enc('small')
        await service.store.write(docDir, {
          schema: 2,
          documentId: DOC_ID,
          orgId: 'org_b',
          workspaceId: WS_ID,
          title: 'Bound.docx',
          filename: 'Bound.docx',
          format: 'docx',
          access: 'edit',
          baseRevision: '10',
          baseVersion: 1,
          baseChecksum: sha256Hex(baseBytes),
          state: 'saved',
          minStoreLevel: 1,
          minAppVersion: '0.0.0',
        })
        const workingPath = await service.store.writeWorkingCopy(docDir, 'Bound.docx', baseBytes)
        writeFileSync(workingPath, new Uint8Array(900).fill(66))
        const savedStatus = await service.save(workingPath)
        expect(savedStatus).toMatchObject({
          state: 'failed',
          error: 'too_large',
          sizeBytes: 900,
          maxBytes: 800,
        })
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('2. pre-upload check (UniworkDocsService.uploadDocument)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'uw-size-upload-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    /** the one limit this case works at, small enough to write real bytes */
    const MAX = MB_BYTES

    function uploadService(requests: string[]) {
      return new UniworkDocsService({
        userDataDir: dir,
        profile: () => ({
          deploymentId: 'default',
          apiOrigin: 'https://uniwork.example',
          clientId: 'uniwork-office',
          channel: 'stable',
        }),
        channel: () => 'stable',
        applyProfile: async () => 'unchanged',
        identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
        selectedOrg: () => ({ id: ORG_ID, slug: 'acme' }),
        authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
        limits: () => parseDocumentLimits({ upload_max_bytes: MAX, save_warn_ratio: 0.9 }),
        // the server refuses every request: what the two cases below pin is
        // whether the bytes were read and the POST was attempted at all
        fetch: (async (url: string) => {
          requests.push(url)
          return new Response('{}', { status: 404 })
        }) as unknown as FetchLike,
        openPath: () => true,
        isPathOpen: () => false,
        requestModuleSave: () => false,
        reloadPath: () => undefined,
        activePath: () => undefined,
        ui: { chooseUnsavedClose: async () => 'cancel' },
        pushStatus: () => undefined,
        pushLaunch: () => undefined,
        reveal: () => undefined,
      })
    }

    it('refuses a pick of max_bytes + 1 before reading it, and sends exactly max_bytes', async () => {
      const requests: string[] = []
      const service = uploadService(requests)
      // mode 000: any read of this file fails (and would surface as `not_found`),
      // so a `too_large` verdict proves the bytes were never read
      const over = join(dir, 'báo-cáo-Q4.pptx')
      writeFileSync(over, '')
      truncateSync(over, MAX + 1)
      chmodSync(over, 0o000)

      const refused = await service.uploadDocument({
        workspaceId: WS_ID,
        folderId: null,
        path: over,
        uploadId: 'up-over',
      })
      expect(refused).toEqual({
        ok: false,
        error: 'too_large',
        name: 'báo-cáo-Q4.pptx',
        sizeBytes: MAX + 1,
        maxBytes: MAX,
      })
      // nothing was sent for the refused pick
      expect(requests).toEqual([])

      // exactly max_bytes is not over the cap: it is read and uploaded (the
      // fake server's own refusal is the only failure left)
      const exact = join(dir, 'exact.docx')
      writeFileSync(exact, new Uint8Array(MAX).fill(65))
      const sent = await service.uploadDocument({
        workspaceId: WS_ID,
        folderId: null,
        path: exact,
        uploadId: 'up-exact',
      })
      expect(sent.ok === false && sent.error).toBe('server_error')
      expect(
        requests.some((url) => url.endsWith(`/api/v1/workspaces/${WS_ID}/documents/files`)),
      ).toBe(true)
    })

    it('saveLocalCopy refuses an unbound or foreign-account path before any read or picker, and revalidates after the picker (d1-1)', async () => {
      let currentIdentity: {
        accountId: string
        deviceSessionId: string
        deploymentId: string
      } | null = {
        accountId: 'acc_1',
        deviceSessionId: 'dev_1',
        deploymentId: 'default',
      }
      let pickerImpl: (defaultName: string) => Promise<string | null> = async (name) =>
        join(dir, `exported-${name}`)
      const pickDownloadPath = vi.fn((defaultName: string) => pickerImpl(defaultName))

      const service = new UniworkDocsService({
        userDataDir: dir,
        profile: () => ({
          deploymentId: 'default',
          apiOrigin: 'https://uniwork.example',
          clientId: 'uniwork-office',
          channel: 'stable',
        }),
        channel: () => 'stable',
        applyProfile: async () => 'unchanged',
        identity: () => currentIdentity,
        selectedOrg: () => ({ id: ORG_ID, slug: 'acme' }),
        authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
        fetch: (async () => new Response('{}', { status: 404 })) as unknown as FetchLike,
        openPath: () => true,
        isPathOpen: () => false,
        requestModuleSave: () => false,
        reloadPath: () => undefined,
        activePath: () => undefined,
        pickDownloadPath,
        ui: { chooseUnsavedClose: async () => 'cancel' },
        pushStatus: () => undefined,
        pushLaunch: () => undefined,
        reveal: () => undefined,
      })

      // (a) an unbound readable file path: refused before reading or calling the picker
      const plainPath = join(dir, 'secret-plain.docx')
      writeFileSync(plainPath, enc('secret-local-file'))
      expect(await service.saveLocalCopy(plainPath)).toBe(false)
      expect(pickDownloadPath).not.toHaveBeenCalled()
      expect(existsSync(join(dir, 'exported-secret-plain.docx'))).toBe(false)

      const seedBound = async (
        deploymentId: string,
        accountId: string,
        docId: string,
        text: string,
      ) => {
        const docDir = service.store.dirFor(deploymentId, accountId, docId)
        const bytes = enc(text)
        await service.store.write(docDir, {
          schema: 2,
          documentId: docId,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          title: 'Report.docx',
          filename: 'Report.docx',
          format: 'docx',
          access: 'edit',
          baseRevision: '10',
          baseVersion: 1,
          baseChecksum: sha256Hex(bytes),
          state: 'failed',
          error: 'too_large',
          minStoreLevel: 1,
          minAppVersion: '0.0.0',
        })
        return await service.store.writeWorkingCopy(docDir, 'Report.docx', bytes)
      }

      // (b) a bound working copy belonging to another account or deployment: refused
      const foreignAccountPath = await seedBound(
        'default',
        'acc_2',
        'doc_foreign_acc',
        'foreign-acc',
      )
      const foreignDepPath = await seedBound('other_dep', 'acc_1', 'doc_foreign_dep', 'foreign-dep')
      expect(await service.saveLocalCopy(foreignAccountPath)).toBe(false)
      expect(await service.saveLocalCopy(foreignDepPath)).toBe(false)
      expect(pickDownloadPath).not.toHaveBeenCalled()

      // (c) an owned bound working copy: exported byte-for-byte
      const ownedPath = await seedBound('default', 'acc_1', DOC_ID, 'owned-working-copy')
      const dest1 = join(dir, 'copy-owned.docx')
      pickerImpl = async () => dest1
      expect(await service.saveLocalCopy(ownedPath)).toBe(true)
      expect(pickDownloadPath).toHaveBeenCalledTimes(1)
      expect(readFileSync(dest1, 'utf8')).toBe('owned-working-copy')

      // (d) ownership lost while the picker is open (account switch): refused after the picker returns
      const dest2 = join(dir, 'copy-after-switch.docx')
      pickerImpl = async () => {
        currentIdentity = {
          accountId: 'acc_2',
          deviceSessionId: 'dev_2',
          deploymentId: 'default',
        }
        return dest2
      }
      expect(await service.saveLocalCopy(ownedPath)).toBe(false)
      expect(existsSync(dest2)).toBe(false)
    })

    it('saveLocalCopy refuses a target identical to the working copy (path, realpath, dev+ino) and reads bytes after the picker returns (d1-3)', async () => {
      let pickerImpl: () => Promise<string | null> = async () => null
      const service = new UniworkDocsService({
        userDataDir: dir,
        profile: () => ({
          deploymentId: 'default',
          apiOrigin: 'https://uniwork.example',
          clientId: 'uniwork-office',
          channel: 'stable',
        }),
        channel: () => 'stable',
        applyProfile: async () => 'unchanged',
        identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
        selectedOrg: () => ({ id: ORG_ID, slug: 'acme' }),
        authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
        fetch: (async () => new Response('{}', { status: 404 })) as unknown as FetchLike,
        openPath: () => true,
        isPathOpen: () => false,
        requestModuleSave: () => false,
        reloadPath: () => undefined,
        activePath: () => undefined,
        pickDownloadPath: () => pickerImpl(),
        ui: { chooseUnsavedClose: async () => 'cancel' },
        pushStatus: () => undefined,
        pushLaunch: () => undefined,
        reveal: () => undefined,
      })

      const docDir = service.store.dirFor('default', 'acc_1', DOC_ID)
      const initialBytes = enc('before-picker')
      await service.store.write(docDir, {
        schema: 2,
        documentId: DOC_ID,
        orgId: ORG_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        filename: 'Report.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '10',
        baseVersion: 1,
        baseChecksum: sha256Hex(initialBytes),
        state: 'failed',
        error: 'too_large',
        minStoreLevel: 1,
        minAppVersion: '0.0.0',
      })
      const workingPath = await service.store.writeWorkingCopy(docDir, 'Report.docx', initialBytes)

      // 1. Hold the picker open, rewrite the working copy with newer edits, then resolve the picker
      //    with the working copy path itself: must refuse and preserve the newer edits on disk
      pickerImpl = async () => {
        writeFileSync(workingPath, enc('newer-edits-during-dialog'))
        return workingPath
      }
      expect(await service.saveLocalCopy(workingPath)).toBe(false)
      expect(readFileSync(workingPath, 'utf8')).toBe('newer-edits-during-dialog')

      // 2. Symlink and hardlink aliases to the working copy are also refused without writing
      const symlinkPath = join(dir, 'symlink-to-working.docx')
      symlinkSync(workingPath, symlinkPath)
      pickerImpl = async () => {
        writeFileSync(workingPath, enc('edits-before-symlink-refusal'))
        return symlinkPath
      }
      expect(await service.saveLocalCopy(workingPath)).toBe(false)
      expect(readFileSync(workingPath, 'utf8')).toBe('edits-before-symlink-refusal')

      const hardlinkPath = join(dir, 'hardlink-to-working.docx')
      linkSync(workingPath, hardlinkPath)
      pickerImpl = async () => {
        writeFileSync(workingPath, enc('edits-before-hardlink-refusal'))
        return hardlinkPath
      }
      expect(await service.saveLocalCopy(workingPath)).toBe(false)
      expect(readFileSync(workingPath, 'utf8')).toBe('edits-before-hardlink-refusal')

      // 3. A distinct destination reads the snapshot AFTER the picker returns (post-dialog edits)
      const distinctDest = join(dir, 'distinct-export.docx')
      pickerImpl = async () => {
        writeFileSync(workingPath, enc('latest-bytes-at-picker-return'))
        return distinctDest
      }
      expect(await service.saveLocalCopy(workingPath)).toBe(true)
      expect(readFileSync(distinctDest, 'utf8')).toBe('latest-bytes-at-picker-return')
    })
  })

  describe('3. pre-enqueue check and warn band (SaveCoordinator.save)', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'uw-size-save-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    function harness(limits: DocumentLimits) {
      const docPath = join(dir, 'Report.docx')
      const base = enc('initial')
      writeFileSync(docPath, base)
      const binding: Binding = {
        schema: 2,
        documentId: DOC_ID,
        orgId: ORG_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        filename: 'Report.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '10',
        baseVersion: 1,
        baseChecksum: sha256Hex(base),
        state: 'saved',
        minStoreLevel: 1,
        minAppVersion: '0.0.0',
      }
      const docs = new Map<string, BoundDocument>([
        [
          docPath,
          {
            path: docPath,
            dir,
            deploymentId: 'default',
            userId: 'acc_1',
            key: DOC_ID,
            binding,
          },
        ],
      ])

      /** the store's records, in the `{intent, payload}` shape `IntentStore.read` returns */
      const stored = new Map<string, { intent: IntentRecordV2; payload: Uint8Array }>()
      let putResult: 'ok' | 'store_full' | 'interrupted' = 'ok'
      const put = vi.fn(async (key: string, intent: IntentRecordV2, payload: Uint8Array) => {
        if (putResult !== 'ok') return { kind: putResult }
        stored.set(key, { intent, payload })
        return { kind: 'ok' as const }
      })
      const remove = vi.fn(async (key: string) => {
        stored.delete(key)
      })
      const intents: IntentStore = {
        async get(key) {
          // this store only ever holds v2 records; a v2 record reads as the
          // pending shape (`parseStoredIntent` upgrades v1 with the binding facts)
          return (stored.get(key) ?? null) as unknown as PendingIntentValue | null
        },
        async read(key) {
          return stored.get(key) ?? null
        },
        put,
        delete: remove,
      }
      const supersede = vi.fn(async () => 'cancelled' as const)
      const statuses: UniworkDocStatus[] = []
      let allowStoreWrite = true
      const storeWrite = vi.fn(async (writtenDir: string, next: Binding) => {
        if (!allowStoreWrite) return false
        for (const [path, doc] of docs) {
          if (doc.dir === writtenDir) docs.set(path, { ...doc, binding: next })
        }
        return true
      })

      let lastUploadedChecksum = ''
      const upload = vi.fn(async (input: { bytes: Uint8Array }) => {
        lastUploadedChecksum = sha256Hex(input.bytes)
        return {
          uploadId: 'up_1',
          checksumSha256: lastUploadedChecksum,
          claimExpiresAt: null,
        }
      })

      const deps: SaveCoordinatorDeps = {
        store: {
          classify: (path: string) =>
            docs.has(path)
              ? { kind: 'bound' as const, doc: docs.get(path)! }
              : { kind: 'plain' as const },
          lookup: (path: string) => docs.get(path) ?? null,
          write: storeWrite,
        } as never,
        client: {
          upload,
          commit: async (input) => ({
            documentId: input.documentId,
            revision: '11',
            versionId: 'v2',
            version: 2,
            checksumSha256: lastUploadedChecksum || sha256Hex(readFileSync(docPath)),
            savedAt: ISO,
          }),
          getDocument: async () => {
            throw new UniworkDocError('not_found')
          },
        },
        isSignedIn: () => true,
        ownsBinding: () => true,
        intents: async () => ({ kind: 'ok', intents }),
        publish: (status) => statuses.push(status),
        limits: () => limits,
        now: () => new Date(ISO),
        uuid: () => 'u1',
        dispatcher: { supersede } as never,
      }
      return {
        coordinator: new SaveCoordinator(deps),
        docPath,
        docs,
        put,
        remove,
        supersede,
        upload,
        statuses,
        stored,
        storeWrite,
        setPutResult: (next: 'ok' | 'store_full' | 'interrupted') => {
          putResult = next
        },
        setAllowStoreWrite: (next: boolean) => {
          allowStoreWrite = next
        },
      }
    }

    const OVER = parseDocumentLimits({ upload_max_bytes: 1000, save_warn_ratio: 0.9 })

    it('refuses over max_bytes before intents.put and publishes the block request', async () => {
      const h = harness(OVER)
      h.stored.set(DOC_ID, {
        intent: {
          v: 2,
          intentId: 'old',
          idempotencyKey: 'old_key',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(enc('older')),
          length: 5,
          generation: 1,
          state: 'queued',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
        payload: enc('older'),
      })
      writeFileSync(h.docPath, new Uint8Array(1001).fill(65))

      const status = await h.coordinator.save(h.docPath)

      expect(h.put).not.toHaveBeenCalled()
      expect(
        h.supersede,
        `published: ${JSON.stringify(h.statuses.map((status) => `${status.state}${status.error ? `:${status.error}` : ''}`))}`,
      ).toHaveBeenCalledTimes(1)
      expect(h.remove).toHaveBeenCalledWith(DOC_ID)
      expect(status!.binding).toMatchObject({
        state: 'failed',
        error: 'too_large',
        sizeBytes: 1001,
        maxBytes: 1000,
      })
      // the published status asks the shell for the save-block dialog with a monotonic sequence id
      expect(h.statuses.at(-1)).toMatchObject({
        state: 'failed',
        error: 'too_large',
        sizeBytes: 1001,
        maxBytes: 1000,
        saveTooLargePrompt: true,
        saveTooLargePromptSeq: 1,
      })
      // a second over-cap save increments saveTooLargePromptSeq so the renderer can distinguish it
      await h.coordinator.save(h.docPath)
      expect(h.statuses.at(-1)).toMatchObject({
        state: 'failed',
        error: 'too_large',
        sizeBytes: 1001,
        maxBytes: 1000,
        saveTooLargePrompt: true,
        saveTooLargePromptSeq: 2,
      })
      // the local working copy keeps the user's bytes
      expect(readFileSync(h.docPath).byteLength).toBe(1001)
    })

    it('saves an unchanged copy over the cap as saved, never as failed', async () => {
      const h = harness(parseDocumentLimits({ upload_max_bytes: 3, save_warn_ratio: 0.9 }))
      // the working copy still holds the base bytes: nothing to send
      const status = await h.coordinator.save(h.docPath)
      expect(status!.binding.state).toBe('saved')
      expect(h.put).not.toHaveBeenCalled()
      expect(h.statuses.some((push) => push.error === 'too_large')).toBe(false)
    })

    it('never marks an unchanged copy failed as too_large when a pending intent exists under a lowered cap (d1-7)', async () => {
      // Base is 7 bytes ('initial'), max_bytes is lowered to 5 bytes while the pending payload is 5 bytes
      const h = harness(parseDocumentLimits({ upload_max_bytes: 5, save_warn_ratio: 0.9 }))
      const olderBytes = enc('older')
      h.stored.set(DOC_ID, {
        intent: {
          v: 2,
          intentId: 'old',
          idempotencyKey: 'old_key',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(olderBytes),
          length: olderBytes.byteLength,
          generation: 1,
          state: 'queued',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
        payload: olderBytes,
      })

      // 1. User save with pending intent + working copy equal to base:
      //    must NOT fail as too_large or supersede the pending intent; runs pending userSave handling
      const userStatus = await h.coordinator.save(h.docPath, { userSave: true })
      expect(userStatus!.binding.error).not.toBe('too_large')
      expect(h.supersede).not.toHaveBeenCalled()
      expect(h.put).not.toHaveBeenCalled()
      expect(h.stored.has(DOC_ID)).toBe(true)

      // 2. Non-user save with pending intent + working copy equal to base:
      //    replays and settles the under-cap pending intent without failing the unchanged base as too_large
      const replayed = await h.coordinator.save(h.docPath)
      expect(h.upload).toHaveBeenCalledTimes(1)
      expect(replayed!.binding.state).not.toBe('failed')
      expect(replayed!.binding.error).toBeUndefined()
      expect(replayed!.binding.baseChecksum).toBe(sha256Hex(olderBytes))
      expect(h.stored.has(DOC_ID)).toBe(false)
      expect(h.supersede).not.toHaveBeenCalled()
      expect(h.put).not.toHaveBeenCalled()
      expect(h.statuses.some((push) => push.error === 'too_large')).toBe(false)
    })

    it('supersedes a non-in-flight over-cap pending intent and marks the binding saved when the working copy equals base (d2-2)', async () => {
      // Base is 7 bytes ('initial'), queued intent payload is 5 bytes ('older'), max_bytes lowered to 3 bytes
      const h = harness(parseDocumentLimits({ upload_max_bytes: 3, save_warn_ratio: 0.9 }))
      const olderBytes = enc('older')
      h.stored.set(DOC_ID, {
        intent: {
          v: 2,
          intentId: 'old_over_cap',
          idempotencyKey: 'old_over_cap_key',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(olderBytes),
          length: olderBytes.byteLength,
          generation: 1,
          state: 'queued',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
        payload: olderBytes,
      })

      const settled = await h.coordinator.save(h.docPath)
      expect(h.upload).not.toHaveBeenCalled()
      expect(h.put).not.toHaveBeenCalled()
      expect(h.supersede).toHaveBeenCalledTimes(1)
      expect(h.remove).toHaveBeenCalledWith(DOC_ID)
      expect(h.stored.has(DOC_ID)).toBe(false)
      expect(settled!.binding.state).toBe('saved')
      expect(settled!.binding.error).toBeUndefined()
      expect(settled!.binding.baseChecksum).toBe(sha256Hex(enc('initial')))
      expect(h.statuses.some((push) => push.error === 'too_large')).toBe(false)
    })

    it('warns once per bound session in the 90..100% band and still saves', async () => {
      const h = harness(OVER)
      /** the warn chip payload of every published status that carried one */
      const warnPayloads = (): Array<{ sizeBytes: number; maxBytes: number } | undefined> =>
        h.statuses.filter((push) => push.sizeWarn).map((push) => push.sizeWarn)

      writeFileSync(h.docPath, new Uint8Array(950).fill(66))
      const first = await h.coordinator.save(h.docPath)
      expect(
        first!.binding.state,
        `published: ${JSON.stringify(h.statuses.map((status) => `${status.state}${status.error ? `:${status.error}` : ''}`))}`,
      ).toBe('saved')
      expect(h.put).toHaveBeenCalledTimes(1)
      expect(warnPayloads()).toContainEqual({ sizeBytes: 950, maxBytes: 1000 })

      // a second warn-band save in the same session says nothing new
      writeFileSync(h.docPath, new Uint8Array(960).fill(67))
      await h.coordinator.save(h.docPath)
      expect(warnPayloads()).not.toContainEqual({ sizeBytes: 960, maxBytes: 1000 })

      // dropping back below the band re-arms the latch
      writeFileSync(h.docPath, new Uint8Array(500).fill(68))
      await h.coordinator.save(h.docPath)
      writeFileSync(h.docPath, new Uint8Array(920).fill(69))
      await h.coordinator.save(h.docPath)
      expect(warnPayloads()).toContainEqual({ sizeBytes: 920, maxBytes: 1000 })
    })

    it('does not consume the warn latch on an unpublished userSave or store refusal, and guards supersede cleanup by generation (d1-5)', async () => {
      const h = harness(OVER)
      const warnPayloads = (): Array<{ sizeBytes: number; maxBytes: number } | undefined> =>
        h.statuses.filter((push) => push.sizeWarn).map((push) => push.sizeWarn)

      // 1. A userSave with a pending intent whose checksum matches the working copy
      //    returns through requestPopover without publishing a status: latch must NOT be consumed
      const warnBytes1 = new Uint8Array(940).fill(70)
      writeFileSync(h.docPath, warnBytes1)
      h.stored.set(DOC_ID, {
        intent: {
          v: 2,
          intentId: 'pend_1',
          idempotencyKey: 'key_1',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(warnBytes1),
          length: warnBytes1.byteLength,
          generation: 1,
          state: 'paused_user',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
        payload: warnBytes1,
      })
      await h.coordinator.save(h.docPath, { userSave: true })
      expect(h.statuses).toHaveLength(0)

      // 2. Clear the pending intent and simulate store_full on the next warn-band save:
      //    error status is published without sizeWarn and latch is still NOT consumed
      h.stored.delete(DOC_ID)
      h.setPutResult('store_full')
      await h.coordinator.save(h.docPath)
      expect(warnPayloads()).toHaveLength(0)

      // 3. Simulate store.write refusal (sweep holds the copy): no status published, latch NOT consumed
      h.setPutResult('ok')
      h.stored.delete(DOC_ID)
      h.setAllowStoreWrite(false)
      await h.coordinator.save(h.docPath)
      expect(warnPayloads()).toHaveLength(0)

      // 4. Now allow the save to proceed in the 90..100% band: sizeWarn IS published!
      h.stored.delete(DOC_ID)
      h.setAllowStoreWrite(true)
      const warnBytes2 = new Uint8Array(955).fill(71)
      writeFileSync(h.docPath, warnBytes2)
      const saved = await h.coordinator.save(h.docPath)
      expect(saved!.binding.state).toBe('saved')
      expect(warnPayloads()).toContainEqual({ sizeBytes: 955, maxBytes: 1000 })

      // 5. Over-cap supersede uses generation-checked cleanupIntent: if a newer generation
      //    record is installed while supersede runs, cleanupIntent preserves the newer record
      const olderPayload = enc('older-gen-2')
      h.stored.set(DOC_ID, {
        intent: {
          v: 2,
          intentId: 'old_gen_2',
          idempotencyKey: 'key_gen_2',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(olderPayload),
          length: olderPayload.byteLength,
          generation: 2,
          state: 'queued',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
        payload: olderPayload,
      })
      const newerPayload = enc('newer-gen-3')
      h.supersede.mockImplementationOnce(async () => {
        h.stored.set(DOC_ID, {
          intent: {
            v: 2,
            intentId: 'new_gen_3',
            idempotencyKey: 'key_gen_3',
            documentId: DOC_ID,
            orgId: ORG_ID,
            workspaceId: WS_ID,
            baseRevision: '10',
            baseVersion: 1,
            checksum: sha256Hex(newerPayload),
            length: newerPayload.byteLength,
            generation: 3,
            state: 'queued',
            attempt: 0,
            createdAt: ISO,
            updatedAt: ISO,
          },
          payload: newerPayload,
        })
        return 'cancelled' as const
      })
      writeFileSync(h.docPath, new Uint8Array(1050).fill(72))
      await h.coordinator.save(h.docPath)
      expect(h.supersede).toHaveBeenCalledTimes(1)
      expect(h.stored.get(DOC_ID)?.intent.intentId).toBe('new_gen_3')
      expect(h.stored.get(DOC_ID)?.intent.generation).toBe(3)
    })

    it('does not publish sizeWarn or consume the warn latch when a paused warn-band save refuses the binding write (d2-1)', async () => {
      const h = harness(OVER)
      const warnPayloads = (): Array<{ sizeBytes: number; maxBytes: number } | undefined> =>
        h.statuses.filter((push) => push.sizeWarn).map((push) => push.sizeWarn)

      // 1. Paused warn-band save (forceOffline -> state = paused_offline) where store.write is refused
      //    inside commitState/writeBinding: must clear activeSizeWarns before publishing doc
      const warnBytes1 = new Uint8Array(940).fill(70)
      writeFileSync(h.docPath, warnBytes1)
      h.setAllowStoreWrite(false)
      await h.coordinator.save(h.docPath, { forceOffline: true })
      expect(warnPayloads()).toHaveLength(0)

      // 2. Later permitted warn-band save emits sizeWarn (latch was not consumed by the refused write)
      h.stored.delete(DOC_ID)
      h.setAllowStoreWrite(true)
      const warnBytes2 = new Uint8Array(955).fill(71)
      writeFileSync(h.docPath, warnBytes2)
      const saved = await h.coordinator.save(h.docPath)
      expect(saved!.binding.state).toBe('saved')
      expect(warnPayloads()).toContainEqual({ sizeBytes: 955, maxBytes: 1000 })
    })
  })

  describe('4. the 413 and the too_large reason', () => {
    it('carries fields.max_bytes into the error, the queue record and the Sync Center row', () => {
      const error = errorFromResponse(413, {
        error: {
          code: 'file_too_large',
          message: 'tệp vượt quá dung lượng cho phép',
          fields: { max_bytes: 209_715_200, size_bytes: 220_000_000 },
        },
      })
      expect(error).toBeInstanceOf(UniworkDocError)
      expect(error.code).toBe('too_large')
      expect(error.maxBytes).toBe(209_715_200)
      expect(error.sizeBytes).toBe(220_000_000)

      // the queue records the limit the server named, terminally (no retry)
      const record: IntentRecordV2 = {
        v: 2,
        intentId: 'i1',
        idempotencyKey: 'k1',
        documentId: DOC_ID,
        orgId: ORG_ID,
        workspaceId: WS_ID,
        baseRevision: '10',
        baseVersion: 1,
        checksum: 'h',
        length: 220_000_000,
        generation: 1,
        state: 'uploading',
        attempt: 0,
        createdAt: ISO,
        updatedAt: ISO,
      }
      const step = transition(
        record,
        { type: 'commitFailed', error: 'too_large', maxBytes: 209_715_200 },
        { now: Date.parse(ISO), random: () => 0.5 },
      )
      expect(step.record).toMatchObject({
        state: 'failed',
        lastError: 'too_large',
        maxBytes: 209_715_200,
      })

      // an old record without maxBytes still reads (fallback copy)
      const legacy = transition(
        record,
        { type: 'commitFailed', error: 'too_large' },
        { now: Date.parse(ISO), random: () => 0.5 },
      )
      expect(legacy.record).toMatchObject({ state: 'failed', lastError: 'too_large' })
      expect(legacy.record!.maxBytes).toBeUndefined()

      // the Sync Center row takes the limit from the fact, else from the record
      const fact = (
        id: string,
        over: Partial<SyncCenterIntentFact> = {},
      ): SyncCenterIntentFact => ({
        id,
        documentKey: DOC_ID,
        documentId: DOC_ID,
        orgId: ORG_ID,
        title: 'Report.docx',
        ext: 'docx',
        record: step.record!,
        failedReason: 'too_large',
        canEdit: true,
        ...over,
      })
      const facts: SyncCenterFacts = {
        nowMs: Date.parse(ISO),
        sessionState: 'signed_in',
        online: true,
        paused: false,
        adminPaused: false,
        intents: [fact('from_fact', { maxBytes: 209_715_200 }), fact('from_record')],
      }
      const snapshot = buildSyncCenterSnapshot(facts)
      const rows = snapshot.tabs.attention
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.id === 'from_fact')?.maxBytes).toBe(209_715_200)
      expect(rows.find((row) => row.id === 'from_record')?.maxBytes).toBe(209_715_200)
    })

    it('names the limit in the reason, and falls back without one (vi + en)', () => {
      const tVi = makeT(syncVi, viDocs)
      const tEn = makeT(syncEn, enDocs)
      const withLimit: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'failed',
        error: 'too_large',
        maxBytes: 209_715_200,
      }
      const withoutLimit: UniworkDocStatus = { ...withLimit, maxBytes: undefined }

      // the save pill / queue popover: `uwReasonTooLargeWithLimit`, else the short fallback
      expect(chipModelOf(withLimit).reasonKey).toBe('uwReasonTooLargeWithLimit')
      expect(chipCopy(chipModelOf(withLimit), tVi, 'vi-VN').tip).toContain('vượt giới hạn 200 MB')
      expect(chipCopy(chipModelOf(withLimit), tEn, 'en-US').tip).toContain('over the 200 MB limit')
      expect(chipModelOf(withoutLimit).reasonKey).toBe('uwReasonTooLarge')
      expect(chipCopy(chipModelOf(withoutLimit), tVi, 'vi-VN').tip).toContain('tệp quá lớn')
      expect(chipCopy(chipModelOf(withoutLimit), tEn, 'en-US').tip).toContain('file too large')

      const row = {
        id: 'r1',
        documentId: DOC_ID,
        documentKey: DOC_ID,
        title: 'Report.docx',
        ext: 'docx',
        state: 'failed' as const,
        failedReason: 'too_large' as const,
        savedAt: ISO,
        canEdit: true,
        maxBytes: 209_715_200,
      }
      expect(failedReasonKeyOf(withoutLimit, row)).toBe('uwReasonTooLargeWithLimit')
      expect(queuePopoverModelOf(withoutLimit, row, 'pill').line1.maxBytes).toBe(209_715_200)
      expect(failedReasonKeyOf(withoutLimit, { ...row, maxBytes: undefined })).toBe(
        'uwReasonTooLarge',
      )

      // the Sync Center row: the same reason, with `{max}` passed through
      expect(failedReasonKey(row)).toBe('uwReasonTooLargeWithLimit')
      expect(rowView(row, { online: true }).sub).toEqual({
        key: 'uwRowFailed',
        keyParams: { reason: 'uwReasonTooLargeWithLimit' },
        reasonMaxBytes: 209_715_200,
      })
      expect(failedReasonKey({ ...row, maxBytes: undefined })).toBe('uwReasonTooLarge')
    })

    it('EL1A-FE-5: an edit_locked failed save reads as "someone else is editing" in the popover and the row', () => {
      // the queue parked the intent `failed` with lastError edit_locked (a 423 document_locked)
      const status: UniworkDocStatus = {
        path: 'C:\\data\\uw\\Report.docx',
        documentId: DOC_ID,
        workspaceId: 'ws_1',
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'failed',
        error: 'edit_locked',
      }
      const row = {
        id: 'r-lock',
        documentId: DOC_ID,
        documentKey: DOC_ID,
        title: 'Report.docx',
        ext: 'docx',
        state: 'failed' as const,
        failedReason: 'edit_locked' as const,
        savedAt: ISO,
        canEdit: true,
      }
      // the popover's `{reason}` and the sync center row's, both from the row's failed reason
      expect(failedReasonKeyOf(status, row)).toBe('uwReasonEditLocked')
      expect(failedReasonKey(row)).toBe('uwReasonEditLocked')
      expect(rowView(row, { online: true }).sub).toEqual({
        key: 'uwRowFailed',
        keyParams: { reason: 'uwReasonEditLocked' },
      })
      // without a row the status' own error code answers, never the generic fragment
      expect(failedReasonKeyOf(status, undefined)).toBe('uwReasonEditLocked')
      expect(viDocs.uwReasonEditLocked).toBeTruthy()
      expect(viDocs.uwReasonEditLocked.toLowerCase()).not.toContain('khóa')
      expect(viDocs.uwReasonEditLocked.toLowerCase()).not.toContain('khoá')
    })

    it('keeps the intent record and payload as failed/too_large on an inline 413, never auto-replays it, and guards against overwriting a newer generation (d1-2)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'uw-size-413-'))
      try {
        const docPath = join(tmp, 'Report.docx')
        const baseBytes = enc('base')
        const bodyBytes = enc('updated-payload-under-client-cap')
        writeFileSync(docPath, bodyBytes)

        const binding: Binding = {
          schema: 2,
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          title: 'Report.docx',
          filename: 'Report.docx',
          format: 'docx',
          access: 'edit',
          baseRevision: '10',
          baseVersion: 1,
          baseChecksum: sha256Hex(baseBytes),
          state: 'saved',
          minStoreLevel: 1,
          minAppVersion: '0.0.0',
        }
        const docs = new Map<string, BoundDocument>([
          [
            docPath,
            {
              path: docPath,
              dir: tmp,
              deploymentId: 'default',
              userId: 'acc_1',
              key: DOC_ID,
              binding,
            },
          ],
        ])
        const stored = new Map<string, { intent: IntentRecordV2; payload: Uint8Array }>()
        const put = vi.fn(async (key: string, intent: IntentRecordV2, payload: Uint8Array) => {
          stored.set(key, { intent, payload })
          return { kind: 'ok' as const }
        })
        const remove = vi.fn(async (key: string) => {
          stored.delete(key)
        })
        const intents: IntentStore = {
          async get(key) {
            return (stored.get(key) ?? null) as unknown as PendingIntentValue | null
          },
          async read(key) {
            return stored.get(key) ?? null
          },
          put,
          delete: remove,
        }

        let uploadCalls = 0
        let uploadImpl: (input: { bytes: Uint8Array }) => Promise<{
          uploadId: string
          checksumSha256: string
          claimExpiresAt: null
        }> = async () => {
          uploadCalls += 1
          throw errorFromResponse(413, {
            error: {
              code: 'file_too_large',
              message: 'tệp vượt quá dung lượng cho phép',
              fields: { max_bytes: 500, size_bytes: bodyBytes.byteLength },
            },
          })
        }

        const coordinator = new SaveCoordinator({
          store: {
            classify: (path: string) =>
              docs.has(path)
                ? { kind: 'bound' as const, doc: docs.get(path)! }
                : { kind: 'plain' as const },
            lookup: (path: string) => docs.get(path) ?? null,
            write: async (writtenDir: string, next: Binding) => {
              for (const [path, doc] of docs) {
                if (doc.dir === writtenDir) docs.set(path, { ...doc, binding: next })
              }
              return true
            },
          } as never,
          client: {
            upload: (input) => uploadImpl(input),
            commit: async () => {
              throw new UniworkDocError('server_error')
            },
            getDocument: async () => {
              throw new UniworkDocError('not_found')
            },
          },
          isSignedIn: () => true,
          ownsBinding: () => true,
          intents: async () => ({ kind: 'ok', intents }),
          publish: () => undefined,
          now: () => new Date(ISO),
          uuid: () => 'u413',
        })

        const ended = await coordinator.save(docPath)
        expect(ended!.binding).toMatchObject({
          state: 'failed',
          error: 'too_large',
          sizeBytes: bodyBytes.byteLength,
          maxBytes: 500,
        })
        expect(remove).not.toHaveBeenCalled()
        const parked = stored.get(DOC_ID)
        expect(parked).toBeDefined()
        expect(parked!.intent).toMatchObject({
          state: 'failed',
          lastError: 'too_large',
          maxBytes: 500,
          generation: 1,
        })
        expect(Array.from(parked!.payload)).toEqual(Array.from(bodyBytes))

        // Dispatcher poll does NOT auto-replay a failed record; dispatcher path on a queued
        // record hitting 413 is unchanged and parks failed/too_large with maxBytes too
        const dispatcher = new QueueDispatcher({
          intents: async () => ({ kind: 'ok', intents: intents as never }),
          client: {
            upload: (input: { bytes: Uint8Array }) => uploadImpl(input),
            commit: async () => {
              throw new UniworkDocError('server_error')
            },
            lookupCommit: async () => ({ outcome: 'not_committed' as const }),
          },
          capability: {
            get: async () => ({ kind: 'ok', capabilities: { sync_write: true }, source: 'live' }),
          },
          lock: {
            acquire: async () => ({ kind: 'held', generation: 1 }),
            check: async () => true,
            heartbeat: async () => true,
            release: async () => undefined,
          },
          pause: {
            isPaused: async () => false,
            setPaused: async () => ({ kind: 'ok' as const }),
          },
          drafts: { keep: async () => 'ok' as const },
          clock: () => Date.parse(ISO),
          uuid: () => 'd413',
          publish: () => undefined,
        } as never)

        uploadCalls = 0
        const pollFailed = await dispatcher.dispatchAll([
          {
            key: DOC_ID,
            path: docPath,
            filename: 'Report.docx',
            format: 'docx',
            orgId: ORG_ID,
            workspaceId: WS_ID,
            baseVersion: 1,
            record: parked!.intent,
            payload: parked!.payload,
          },
        ])
        expect(pollFailed.dispatched).toBe(0)
        expect(uploadCalls).toBe(0)

        const queuedRecord: IntentRecordV2 = {
          ...parked!.intent,
          state: 'queued',
          lastError: undefined,
          maxBytes: undefined,
        }
        stored.set(DOC_ID, { intent: queuedRecord, payload: bodyBytes })
        const dispatched413 = await dispatcher.dispatchAll([
          {
            key: DOC_ID,
            path: docPath,
            filename: 'Report.docx',
            format: 'docx',
            orgId: ORG_ID,
            workspaceId: WS_ID,
            baseVersion: 1,
            record: queuedRecord,
            payload: bodyBytes,
          },
        ])
        expect(dispatched413.outcomes.get(DOC_ID)).toBe('failed')
        expect(stored.get(DOC_ID)?.intent).toMatchObject({
          state: 'failed',
          lastError: 'too_large',
          maxBytes: 500,
        })

        // Generation guard (settleRecord): if a newer intent (generation 2) took the document
        // key while the inline 413 was in flight, settleRecord leaves generation 2 untouched
        stored.clear()
        const newerIntent: IntentRecordV2 = {
          v: 2,
          intentId: 'office-intent-newer',
          idempotencyKey: 'office-key-newer',
          documentId: DOC_ID,
          orgId: ORG_ID,
          workspaceId: WS_ID,
          baseRevision: '10',
          baseVersion: 1,
          checksum: sha256Hex(enc('newer')),
          length: 5,
          generation: 2,
          state: 'queued',
          attempt: 0,
          createdAt: ISO,
          updatedAt: ISO,
        }
        uploadImpl = async () => {
          stored.set(DOC_ID, { intent: newerIntent, payload: enc('newer') })
          throw errorFromResponse(413, {
            error: {
              code: 'file_too_large',
              message: 'tệp vượt quá dung lượng cho phép',
              fields: { max_bytes: 500 },
            },
          })
        }
        await coordinator.save(docPath)
        expect(stored.get(DOC_ID)?.intent).toEqual(newerIntent)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('5. renderer and copy (contract §6.2)', () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
      localStorage.setItem('ai-office:lang', 'vi')
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })
    afterEach(() => {
      act(() => root.unmount())
      container.remove()
      resetLiveForTests()
      setTopInsetPart('bar', 0)
      setTopInsetPart('popover', 0)
      setTopInsetPart('saveBlock', 0)
      vi.unstubAllGlobals()
    })

    async function render(node: ReactElement): Promise<void> {
      await act(async () => {
        root.render(createElement(LocaleProvider, { initial: 'vi' as Lang }, node))
      })
    }
    const buttonWith = (text: string): HTMLButtonElement =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)!

    it('shows the over-limit upload sentence at the file field', async () => {
      const tVi = makeT(viDocs)
      const tEn = makeT(enDocs)
      // 245.5 MiB exactly: over the cap, so `over` rounds up and stays exact
      const sizeBytes = 245 * MB_BYTES + MB_BYTES / 2
      const maxBytes = 200 * MB_BYTES
      expect(
        uploadTooLargeTextOf({ name: 'báo-cáo-Q4.pptx', sizeBytes, maxBytes }, tVi, 'vi-VN'),
      ).toBe(
        'báo-cáo-Q4.pptx nặng 245,5 MB, vượt giới hạn 200 MB. Giảm dung lượng ảnh hoặc chia nhỏ tệp rồi tải lên lại.',
      )
      expect(
        uploadTooLargeTextOf({ name: 'báo-cáo-Q4.pptx', sizeBytes, maxBytes }, tEn, 'en-US'),
      ).toBe(
        'báo-cáo-Q4.pptx is 245.5 MB, which is over the 200 MB limit. Reduce image sizes or split the file, then upload again.',
      )

      await render(
        createElement(UploadDocDialog, {
          workspaces: [{ id: WS_ID, name: 'Workspace', slug: 'ws', isDefault: true }],
          initialTarget: { workspaceId: WS_ID, folderId: null },
          loadFolders: async () => [],
          pickFile: async () => ({ path: '/tmp/báo-cáo-Q4.pptx', name: 'báo-cáo-Q4.pptx' }),
          onUpload: async () => ({
            ok: false,
            error: { kind: 'too_large', name: 'báo-cáo-Q4.pptx', sizeBytes, maxBytes },
          }),
          progress: null,
          onCancel: () => undefined,
        }),
      )
      await act(async () => {
        buttonWith(viDocs.uwDocUploadPick).click()
      })
      expect(container.querySelector('.uw-act-file-name')?.textContent).toBe('báo-cáo-Q4.pptx')
      await act(async () => {
        buttonWith(viDocs.uwDocUpload).click()
      })
      expect(container.querySelector('.uw-act-error[role="alert"]')?.textContent).toBe(
        'báo-cáo-Q4.pptx nặng 245,5 MB, vượt giới hạn 200 MB. Giảm dung lượng ảnh hoặc chia nhỏ tệp rồi tải lên lại.',
      )
    })

    it('renders the 90% warn chip and the save-block dialog, whose CTA saves a local copy', async () => {
      const saveLocal = vi.fn(async () => true)
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
        uniworkSaveLocalCopy: saveLocal,
      } as never

      const tVi = makeT(viDocs)
      // 185.5 MiB exactly, inside the band: `warn` floors and stays exact
      const warn = { sizeBytes: 185 * MB_BYTES + MB_BYTES / 2, maxBytes: 209_715_200 }
      expect(sizeWarnTextOf(warn, tVi, 'vi-VN')).toBe('Sắp chạm giới hạn 200 MB (đang 185,5 MB).')
      expect(saveBlockCopyOf(209_715_200, tVi, 'vi-VN')).toEqual({
        title: 'Chưa lưu được lên UniWork',
        body: 'Tài liệu đã vượt 200 MB. Thay đổi của bạn vẫn ở đây. Tải bản của bạn về máy rồi giảm dung lượng ảnh hoặc chia nhỏ tài liệu.',
        saveLocal: 'Lưu bản sao về máy',
        close: 'Đóng',
      })

      const base: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'saved',
      }
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, sizeWarn: warn },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-size-warn')?.textContent).toContain(
        'Sắp chạm giới hạn 200 MB (đang 185,5 MB).',
      )

      await render(
        createElement(UniworkStatusChip, {
          status: {
            ...base,
            state: 'failed',
            error: 'too_large',
            sizeBytes: 220_000_000,
            maxBytes: 209_715_200,
            saveTooLargePrompt: true,
          },
          onStatus: () => undefined,
        }),
      )
      const modal = container.querySelector('.uw-save-block-modal')
      expect(modal?.textContent).toContain('Chưa lưu được lên UniWork')
      expect(modal?.textContent).toContain('Tài liệu đã vượt 200 MB.')
      await act(async () => {
        buttonWith('Lưu bản sao về máy').click()
      })
      expect(saveLocal).toHaveBeenCalledWith('/tmp/Report.docx')
    })

    it('reserves top-inset band height above the editor WebContentsView while the save-block dialog is open and releases it on close (d2-1)', async () => {
      const setBarInset = vi.fn(async () => undefined)
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
        uniworkSaveLocalCopy: async () => true,
        uniworkSetBarInset: setBarInset,
      } as never
      const rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const height = this.hasAttribute('data-uw-save-block-band') ? 164 : 0
          return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: height,
            width: 0,
            height,
          } as DOMRect
        })
      try {
        setTopInsetPart('bar', 36)
        expect(setBarInset).toHaveBeenLastCalledWith(36)

        const base: UniworkDocStatus = {
          path: '/tmp/Report.docx',
          documentId: DOC_ID,
          workspaceId: WS_ID,
          title: 'Report.docx',
          format: 'docx',
          access: 'edit',
          state: 'failed',
          error: 'too_large',
          sizeBytes: 220_000_000,
          maxBytes: 209_715_200,
          saveTooLargePrompt: true,
        }
        await render(createElement(UniworkStatusChip, { status: base, onStatus: () => undefined }))

        const band = container.querySelector<HTMLElement>('[data-uw-save-block-band]')
        const modal = container.querySelector<HTMLElement>('.uw-save-block-modal')
        expect(band).not.toBeNull()
        expect(band?.contains(modal)).toBe(true)
        expect(band?.style.top).toContain('36px')
        expect(band?.style.getPropertyValue('--uw-save-block-room')).toBe('364px')
        expect(setBarInset).toHaveBeenLastCalledWith(36 + 164)

        await act(async () => {
          buttonWith('Đóng').click()
        })
        expect(container.querySelector('[data-uw-save-block-band]')).toBeNull()
        expect(setBarInset).toHaveBeenLastCalledWith(36)
      } finally {
        rectSpy.mockRestore()
      }
    })

    it('latches the save-block dialog across non-prompt statuses, does not re-open on the same prompt after Close, re-opens on a new over-cap save, and closes on local copy / document switch / saved state (d2-2)', async () => {
      const saveLocal = vi.fn(async () => true)
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
        uniworkSaveLocalCopy: saveLocal,
      } as never

      const base: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'failed',
        error: 'too_large',
        sizeBytes: 220_000_000,
        maxBytes: 209_715_200,
      }

      // 1. Prompt arrives (seq 1): dialog latches open
      const prompt1: UniworkDocStatus = {
        ...base,
        saveTooLargePrompt: true,
        saveTooLargePromptSeq: 1,
      }
      await render(createElement(UniworkStatusChip, { status: prompt1, onStatus: () => undefined }))
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()

      // 2. Subsequent status without saveTooLargePrompt (e.g. edit/queue/account refresh): stays open
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: undefined },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()

      // 3. Close dismisses the dialog; neither a status without prompt nor re-applying the same prompt (seq 1) re-opens it
      await act(async () => {
        buttonWith('Đóng').click()
      })
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()

      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: undefined },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()

      await render(
        createElement(UniworkStatusChip, {
          status: { ...prompt1 },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()

      // 4. A NEW over-cap save after Close (seq 2) opens the dialog again
      const prompt2: UniworkDocStatus = {
        ...base,
        saveTooLargePrompt: true,
        saveTooLargePromptSeq: 2,
      }
      await render(createElement(UniworkStatusChip, { status: prompt2, onStatus: () => undefined }))
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()

      // 5. A successful local copy closes the latched dialog
      await act(async () => {
        buttonWith('Lưu bản sao về máy').click()
      })
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()

      // 6. Another new prompt (seq 3) opens, then a later `saved` state closes it
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 3 },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, state: 'saved', error: undefined },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()

      // 7. Another new prompt (seq 4) opens, then a document switch closes it
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 4 },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, path: '/tmp/Other.docx', documentId: 'doc_other', state: 'saved' },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()
    })

    it('focuses the primary "Lưu bản sao về máy" button on open and returns focus to the editor on close (d2-10)', async () => {
      const saveLocal = vi.fn(async () => true)
      const focusActive = vi.fn()
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
        uniworkSaveLocalCopy: saveLocal,
      } as never
      window.aiOfficeTabs = { focusActive } as never

      const base: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'failed',
        error: 'too_large',
        sizeBytes: 220_000_000,
        maxBytes: 209_715_200,
      }

      // 1. Open dialog (seq 1): initial focus lands on primary "Lưu bản sao về máy", not "Đóng"
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 1 },
          onStatus: () => undefined,
        }),
      )
      const primary = buttonWith('Lưu bản sao về máy')
      expect(document.activeElement).toBe(primary)

      // 2. Close via "Đóng" returns focus to the editor via window.aiOfficeTabs.focusActive()
      await act(async () => {
        buttonWith('Đóng').click()
      })
      expect(focusActive).toHaveBeenCalledTimes(1)

      // 3. Re-open on a new prompt (seq 2) and close via Escape: also returns focus to the editor
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 2 },
          onStatus: () => undefined,
        }),
      )
      expect(document.activeElement).toBe(buttonWith('Lưu bản sao về máy'))
      await act(async () => {
        container
          .querySelector('.uw-save-block-modal')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(focusActive).toHaveBeenCalledTimes(2)

      // 4. Re-open on a new prompt (seq 3) and save a local copy: also returns focus to the editor
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 3 },
          onStatus: () => undefined,
        }),
      )
      await act(async () => {
        buttonWith('Lưu bản sao về máy').click()
      })
      expect(saveLocal).toHaveBeenCalledTimes(1)
      expect(focusActive).toHaveBeenCalledTimes(3)
    })

    it('returns focus to the open queue popover or pill button instead of the editor when closing the save-block dialog while the popover is open (SIZE-v1-7)', async () => {
      const saveLocal = vi.fn(async () => true)
      const focusActive = vi.fn()
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
        uniworkSaveLocalCopy: saveLocal,
        uniworkSetBarInset: async () => undefined,
      } as never
      window.aiOfficeTabs = { focusActive } as never

      const base: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'failed',
        error: 'too_large',
        sizeBytes: 220_000_000,
        maxBytes: 209_715_200,
      }

      // 1. Mount failed pill and open the queue popover via the pill's "Chi tiết" button
      await render(createElement(UniworkStatusChip, { status: base, onStatus: () => undefined }))
      const pillBtn = buttonWith('Chi tiết')
      await act(async () => {
        pillBtn.click()
      })
      const pop = document.querySelector<HTMLElement>('.uw-queue-pop')
      expect(pop).not.toBeNull()
      expect(document.activeElement).toBe(pop)

      // 2. Over-cap prompt arrives (seq 1) while the queue popover is open: dialog takes focus
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 1 },
          onStatus: () => undefined,
        }),
      )
      expect(container.querySelector('.uw-save-block-modal')).not.toBeNull()
      expect(document.activeElement).toBe(buttonWith('Lưu bản sao về máy'))

      // 3. First Escape closes the save-block dialog and returns focus to the open popover (NOT the editor)
      await act(async () => {
        container
          .querySelector('.uw-save-block-modal')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()
      expect(document.querySelector('.uw-queue-pop')).not.toBeNull()
      expect(focusActive).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(document.querySelector('.uw-queue-pop'))

      // 4. Re-open save-block dialog (seq 2) while popover is still open, then click "Đóng"
      await render(
        createElement(UniworkStatusChip, {
          status: { ...base, saveTooLargePrompt: true, saveTooLargePromptSeq: 2 },
          onStatus: () => undefined,
        }),
      )
      await act(async () => {
        buttonWith('Đóng').click()
      })
      expect(container.querySelector('.uw-save-block-modal')).toBeNull()
      expect(document.querySelector('.uw-queue-pop')).not.toBeNull()
      expect(focusActive).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(document.querySelector('.uw-queue-pop'))

      // 5. Second Escape now closes the queue popover and returns focus to the pill's "Chi tiết" button
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(document.querySelector('.uw-queue-pop')).toBeNull()
      expect(document.activeElement).toBe(pillBtn)
    })

    it('gives the size-warn chip dismiss button a distinct aria-label and announces the warning via the live host (d2-11)', async () => {
      window.aiOffice = {
        accountStatus: async () => ({ loggedIn: true, state: 'signed-in' }),
        onAccountStatus: () => () => undefined,
        onUniworkQueuePopover: () => () => undefined,
      } as never

      const warn = { sizeBytes: 185 * MB_BYTES + MB_BYTES / 2, maxBytes: 209_715_200 }
      const base: UniworkDocStatus = {
        path: '/tmp/Report.docx',
        documentId: DOC_ID,
        workspaceId: WS_ID,
        title: 'Report.docx',
        format: 'docx',
        access: 'edit',
        state: 'saved',
      }

      await render(
        createElement(
          Fragment,
          null,
          createElement(UniworkLiveHost),
          createElement(UniworkStatusChip, {
            status: { ...base, sizeWarn: warn },
            onStatus: () => undefined,
          }),
        ),
      )

      const warnChip = container.querySelector('.uw-size-warn')
      expect(warnChip).not.toBeNull()
      // No mount-time role="status" on the newly inserted chip node
      expect(warnChip?.querySelector('[role="status"]')).toBeNull()

      // Dismiss button has a distinct aria-label naming what is being closed
      const closeBtn = warnChip?.querySelector<HTMLButtonElement>('.uw-pill-close')
      expect(closeBtn?.getAttribute('aria-label')).toBe(viDocs.uwSizeWarnDismiss)
      expect(closeBtn?.getAttribute('aria-label')).not.toBe(viDocs.uwClose)

      // Announced through the persistent #uw-live-host [role="status"] live region
      const livePolite = document.querySelector(`#${LIVE_HOST_ID} [role="status"]`)
      expect(livePolite?.textContent).toBe('Sắp chạm giới hạn 200 MB (đang 185,5 MB).')

      await act(async () => {
        closeBtn?.click()
      })
      expect(container.querySelector('.uw-size-warn')).toBeNull()
    })

    it('renders the Sync Center failed row with and without a limit', async () => {
      const snapshot: SyncCenterSnapshot = {
        header: {
          status: 'online',
          online: true,
          paused: false,
          adminPaused: false,
          otherOrgHasIntents: false,
          resyncFailed: false,
          feedOff: false,
          resynced: false,
          account: { name: 'Minh', email: 'minh@example.test' },
          org: { id: ORG_ID, name: 'Vietants' },
          storeBudget: { used: MB_BYTES, cap: 1024 * MB_BYTES },
        },
        storeError: false,
        tabs: {
          attention: [
            {
              id: 'with_max',
              documentId: DOC_ID,
              documentKey: DOC_ID,
              title: 'WithMax.docx',
              ext: 'docx',
              state: 'failed',
              failedReason: 'too_large',
              maxBytes: 209_715_200,
              savedAt: ISO,
              canEdit: true,
            },
            {
              id: 'without_max',
              documentId: 'doc_2',
              documentKey: 'doc_2',
              title: 'WithoutMax.docx',
              ext: 'docx',
              state: 'failed',
              failedReason: 'too_large',
              savedAt: ISO,
              canEdit: true,
            },
          ],
          pending: [],
          recent: [],
        },
        defaultTab: 'attention',
      }
      const ok = async (): Promise<SyncCenterActionResult> => ({ ok: true })
      const api = {
        getSnapshot: async () => snapshot,
        subscribe: () => () => undefined,
        syncNow: ok,
        setSendingPaused: ok,
        sendNow: ok,
        cancelSave: ok,
        recheck: ok,
        copySupportCode: ok,
        discardSave: ok,
        openDocument: ok,
        openDraft: ok,
        discardDraft: ok,
        saveAgain: ok,
        saveMyCopy: ok,
        retryStore: ok,
      } as unknown as UniworkSyncCenterApi

      await render(createElement(SyncCenterPane, { api }))
      const subs = Array.from(container.querySelectorAll('.sc-sub')).map(
        (el) => el.textContent ?? '',
      )
      expect(subs.some((text) => text.includes('vượt giới hạn 200 MB'))).toBe(true)
      expect(subs.some((text) => text.includes('tệp quá lớn'))).toBe(true)
    })

    it('has the whole SIZE-F1 key set in zh/vi/en, with no internal code in the copy', () => {
      const keys = [
        'uwSizeWarnChip',
        'uwSizeWarnDismiss',
        'uwSaveBlockTitle',
        'uwSaveBlockBody',
        'uwSaveBlockSaveCopyLocal',
        'uwClose',
        'uwErrUploadTooLarge',
        'uwReasonTooLargeWithLimit',
      ] as const
      const forbidden = /UNI-\d+|SIZE-F1|SIZE-W1|D-S1|G5-\d+|LAG-F1|BIGUP-A1/
      for (const dict of [zhDocs, viDocs, enDocs]) {
        for (const key of keys) {
          const text = (dict as Record<string, string>)[key]
          expect(typeof text).toBe('string')
          expect(text!.length).toBeGreaterThan(0)
          expect(text).not.toMatch(forbidden)
        }
      }
    })
  })
})
