import { vi } from 'vitest'
import type {
  DocAccessLog,
  DocHistoryResult,
  DocVersion,
  UniworkDocHistoryApi,
} from '../src/shared/doc-history-api'

/** A version row the way main answers it, with the parts a test does not care about filled in */
export function versionOf(overrides: Partial<DocVersion> = {}): DocVersion {
  return {
    id: 'ver-3',
    document_id: 'doc-1',
    version: 3,
    kind: 'file',
    reason: 'manual',
    label: null,
    file_id: 'file-3',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size_bytes: 24_576,
    checksum_sha256: null,
    restored_from: null,
    created_by: 'user-1',
    created_by_kind: 'human',
    created_at: '2099-01-02T03:04:05Z',
    ...overrides,
  }
}

/** An access log row the way main answers it */
export function accessLogOf(overrides: Partial<DocAccessLog> = {}): DocAccessLog {
  return {
    id: 'log-1',
    action: 'view',
    via: 'member',
    version: 3,
    actor_kind: 'human',
    actor_id: 'user-1',
    actor: { id: 'user-1', kind: 'human', display_name: 'Nguyễn Văn A' },
    share_link_id: null,
    occurred_at: '2099-01-02T03:04:05Z',
    ...overrides,
  }
}

type Method = keyof UniworkDocHistoryApi
type Spy<K extends Method> = ReturnType<typeof vi.fn<UniworkDocHistoryApi[K]>>

export type FakeDocHistoryBridge = UniworkDocHistoryApi & { [K in Method]: Spy<K> }

/** a failure result, for `bridge.restore.mockResolvedValueOnce(failure('edit_locked', {...}))` */
export function failure(
  error: Extract<DocHistoryResult<never>, { ok: false }>['error'],
  extra: Omit<Extract<DocHistoryResult<never>, { ok: false }>, 'ok' | 'error'> = {},
): DocHistoryResult<never> {
  return { ok: false, error, ...extra }
}

/**
 * In-memory bridge: every channel is a spy with a happy default (one page of
 * `versions` / `logs`, no next page; a create answers version N+1; a restore
 * answers a `restore` row; open and download succeed). Override per test with
 * `mockResolvedValueOnce`.
 */
export function createFakeDocHistoryBridge(
  opts: { versions?: DocVersion[]; logs?: DocAccessLog[] } = {},
): FakeDocHistoryBridge {
  const versions = opts.versions ?? [versionOf()]
  const logs = opts.logs ?? [accessLogOf()]
  const newest = versions.reduce((max, v) => Math.max(max, v.version), 0)
  return {
    versions: vi.fn<UniworkDocHistoryApi['versions']>(async () => ({
      ok: true,
      value: { versions, next_cursor: null },
    })),
    version: vi.fn<UniworkDocHistoryApi['version']>(async (input) => {
      const found = versions.find((v) => v.version === input.versionNo)
      return found ? { ok: true, value: found } : { ok: false, error: 'not_found', status: 404 }
    }),
    createVersion: vi.fn<UniworkDocHistoryApi['createVersion']>(async (input) => ({
      ok: true,
      value: versionOf({
        id: `ver-${newest + 1}`,
        document_id: input.documentId,
        version: newest + 1,
        label: input.label?.trim() || null,
      }),
    })),
    restore: vi.fn<UniworkDocHistoryApi['restore']>(async (input) => ({
      ok: true,
      value: {
        document: {
          id: input.documentId,
          kind: 'file',
          title: 'Báo cáo.docx',
          revision: String(newest + 10),
          current_version: newest + 1,
        },
        version: versionOf({
          id: `ver-${newest + 1}`,
          document_id: input.documentId,
          version: newest + 1,
          reason: 'restore',
          restored_from: input.versionNo,
        }),
      },
    })),
    openVersion: vi.fn<UniworkDocHistoryApi['openVersion']>(async (input) => ({
      ok: true,
      value: { path: `/tmp/fake/${input.documentId}@v${input.versionNo}.docx`, title: 'Báo cáo' },
    })),
    downloadVersion: vi.fn<UniworkDocHistoryApi['downloadVersion']>(async (input) => ({
      ok: true,
      value: { path: `/tmp/fake/${input.suggestedName ?? 'download'}` },
    })),
    accessLogs: vi.fn<UniworkDocHistoryApi['accessLogs']>(async (input) => ({
      ok: true,
      value: {
        logs: input.action ? logs.filter((l) => l.action === input.action) : logs,
        next_cursor: null,
      },
    })),
  }
}
