// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DOCUMENT_LIMITS,
  DEFAULT_DOCUMENT_MAX_BYTES,
  DEFAULT_DOCUMENT_WARN_RATIO,
  type ApiDownloadResult,
  type Capabilities,
  type DocumentSizeLimits,
} from '../../docs/protocol/types'
import type { PortSession } from '../../docs/bridge/frame-port'
import { webText } from './i18n/strings-web'
import {
  SAVE_BLOCKED_MARKER,
  SIZE_WARN_MARKER,
  createSaveSizeGate,
  evaluateSaveSize,
  formatSizeMB,
  type SaveSizeGatePort,
} from './save-size-gate'

const MB = 1024 * 1024

interface MockGateEnv {
  port: SaveSizeGatePort
  session: PortSession
  events: Array<{ type: string; payload: unknown }>
  requests: Array<{ type: string; payload: unknown }>
  dirtyCalls: Array<{ dirty: boolean; force?: boolean }>
  invokeHostDownload: () => Promise<ApiDownloadResult>
  saveWithGate: (
    gate: ReturnType<typeof createSaveSizeGate>,
    bytes: Uint8Array,
  ) => Promise<{ ok: boolean }>
}

function createMockGateEnv(opts?: {
  documentId?: string
  limits?: DocumentSizeLimits
  capabilities?: Capabilities
}): MockGateEnv {
  const session: PortSession = {
    documentId: opts?.documentId ?? 'doc-1',
    capabilities: opts?.capabilities ?? { save: true, download: true },
    limits: opts?.limits ?? { ...DEFAULT_DOCUMENT_LIMITS },
  }
  const events: Array<{ type: string; payload: unknown }> = []
  const requests: Array<{ type: string; payload: unknown }> = []
  const dirtyCalls: Array<{ dirty: boolean; force?: boolean }> = []
  let downloadHandler: (() => Promise<ApiDownloadResult>) | null = null

  const port: SaveSizeGatePort = {
    whenInitialized: () => Promise.resolve(session),
    emit(type, payload) {
      events.push({ type, payload })
    },
    request: (async (type: string, payload: unknown) => {
      requests.push({ type, payload })
      if (type === 'api.download') return { delivered: true }
      if (type === 'api.save') {
        return {
          ok: true,
          file: { fileId: session.documentId, name: 'Report.docx', etag: '"2"' },
        }
      }
      return {}
    }) as SaveSizeGatePort['request'],
    handleDownload(handler) {
      downloadHandler = handler
    },
    setDirty(dirty, options) {
      dirtyCalls.push({ dirty, ...(options?.force ? { force: true } : {}) })
    },
  }

  return {
    port,
    session,
    events,
    requests,
    dirtyCalls,
    async invokeHostDownload() {
      if (!downloadHandler) throw new Error('doc.download handler not registered')
      return downloadHandler()
    },
    async saveWithGate(gate, bytes) {
      const check = await gate.checkBeforeSave(bytes)
      if (!check.allowed) return { ok: false }
      await port.request('api.save', {
        fileId: session.documentId,
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      })
      return { ok: true }
    },
  }
}

describe('evaluateSaveSize (§3.2 threshold maths)', () => {
  const maxBytes = DEFAULT_DOCUMENT_MAX_BYTES // 209,715,200 (200 MiB)
  const warnBytes = Math.floor(maxBytes * DEFAULT_DOCUMENT_WARN_RATIO) // 188,743,680 (180 MiB)

  it('classifies warnBytes - 1, warnBytes, maxBytes, and maxBytes + 1 accurately', () => {
    expect(evaluateSaveSize(warnBytes - 1)).toEqual({
      band: 'normal',
      bytes: warnBytes - 1,
      warnBytes,
      maxBytes,
      warnRatio: 0.9,
    })

    expect(evaluateSaveSize(warnBytes)).toEqual({
      band: 'warn',
      bytes: warnBytes,
      warnBytes,
      maxBytes,
      warnRatio: 0.9,
    })

    expect(evaluateSaveSize(maxBytes)).toEqual({
      band: 'warn',
      bytes: maxBytes,
      warnBytes,
      maxBytes,
      warnRatio: 0.9,
    })

    expect(evaluateSaveSize(maxBytes + 1)).toEqual({
      band: 'block',
      bytes: maxBytes + 1,
      warnBytes,
      maxBytes,
      warnRatio: 0.9,
    })
  })
})

describe('formatSizeMB (§6.1 deterministic binary formatter)', () => {
  const limits: DocumentSizeLimits = {
    max_bytes: 200 * MB,
    warn_ratio: 0.9,
  }

  it('formats boundary strings in vi and en (180 MB, 185,4 MB / 185.4 MB, 200 MB, 200,1 MB / 200.1 MB)', () => {
    // Whole numbers -> 0 decimals
    expect(formatSizeMB(180 * MB, 'vi', { limits })).toBe('180 MB')
    expect(formatSizeMB(180 * MB, 'en', { limits })).toBe('180 MB')
    expect(formatSizeMB(200 * MB, 'vi', { limits })).toBe('200 MB')
    expect(formatSizeMB(200 * MB, 'en', { limits })).toBe('200 MB')

    // Non-whole in warn band -> floor to 0.1 MB, localized separator
    const warnMidBytes = Math.round(185.48 * MB)
    expect(formatSizeMB(warnMidBytes, 'vi', { limits })).toBe('185,4 MB')
    expect(formatSizeMB(warnMidBytes, 'en', { limits })).toBe('185.4 MB')

    // Just below max_bytes in warn band -> floors to 199.9 MB so {size} never equals/exceeds {max}
    expect(formatSizeMB(200 * MB - 1, 'vi', { limits })).toBe('199,9 MB')
    expect(formatSizeMB(200 * MB - 1, 'en', { limits })).toBe('199.9 MB')

    // 1 byte above max_bytes -> ceils to 0.1 MB so {size} is strictly > {max} (200,1 MB / 200.1 MB)
    expect(formatSizeMB(200 * MB + 1, 'vi', { limits })).toBe('200,1 MB')
    expect(formatSizeMB(200 * MB + 1, 'en', { limits })).toBe('200.1 MB')
  })
})

describe('createSaveSizeGate (warn latch, save_blocked, doc.download, fallback UI, 413)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'vi'
    document.body.replaceChildren()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('emits size_warning once across two warn-band saves BEFORE api.save, and re-arms after a save below warnBytes', async () => {
    const limits: DocumentSizeLimits = { max_bytes: 1000, warn_ratio: 0.9 }
    const callOrder: string[] = []
    const env = createMockGateEnv({
      limits,
      capabilities: { save: true, sizeUi: true },
    })
    const origEmit = env.port.emit!
    env.port.emit = ((type: string, payload: unknown) => {
      callOrder.push(`event:${type}`)
      origEmit(type as never, payload as never)
    }) as SaveSizeGatePort['emit']
    const origRequest = env.port.request
    env.port.request = (async (type: string, payload: unknown) => {
      callOrder.push(`request:${type}`)
      return origRequest(type as never, payload as never)
    }) as SaveSizeGatePort['request']

    const gate = createSaveSizeGate({ port: env.port, lang: () => 'vi' })

    // 1st warn-band save (900 B): emits size_warning BEFORE api.save
    expect((await env.saveWithGate(gate, new Uint8Array(900))).ok).toBe(true)
    expect(callOrder).toEqual(['event:size_warning', 'request:api.save'])
    expect(env.events).toEqual([
      {
        type: 'size_warning',
        payload: { bytes: 900, max_bytes: 1000, warn_ratio: 0.9 },
      },
    ])

    // 2nd warn-band save (950 B): latched -> no second size_warning
    expect((await env.saveWithGate(gate, new Uint8Array(950))).ok).toBe(true)
    expect(env.events).toHaveLength(1)
    expect(env.requests.filter((r) => r.type === 'api.save')).toHaveLength(2)

    // Save below warnBytes (899 B): re-arms the latch
    expect((await env.saveWithGate(gate, new Uint8Array(899))).ok).toBe(true)
    expect(env.events).toHaveLength(1)

    // Next warn-band save (920 B): emits size_warning again
    expect((await env.saveWithGate(gate, new Uint8Array(920))).ok).toBe(true)
    expect(env.events).toHaveLength(2)
    expect(env.events[1]).toEqual({
      type: 'size_warning',
      payload: { bytes: 920, max_bytes: 1000, warn_ratio: 0.9 },
    })
  })

  it('save_blocked emits save_blocked INSTEAD of api.save (zero api.save requests), keeps draft, and doc.download sends api.download with the blocked bytes', async () => {
    const limits: DocumentSizeLimits = { max_bytes: 1000, warn_ratio: 0.9 }
    const env = createMockGateEnv({
      limits,
      capabilities: { save: true, download: true, sizeUi: true },
    })
    const persistedDrafts: ArrayBuffer[] = []
    const gate = createSaveSizeGate({
      port: env.port,
      persistDraft: (bytes) => {
        persistedDrafts.push(bytes)
      },
    })

    const overCap = new Uint8Array(1001)
    overCap[0] = 0xde
    overCap[1000] = 0xad

    const res = await env.saveWithGate(gate, overCap)
    expect(res.ok).toBe(false)
    // Zero api.save requests sent
    expect(env.requests.filter((r) => r.type === 'api.save')).toHaveLength(0)
    expect(env.events).toEqual([
      {
        type: 'save_blocked',
        payload: { bytes: 1001, max_bytes: 1000 },
      },
    ])
    expect(env.dirtyCalls).toContainEqual({ dirty: true, force: true })
    expect(persistedDrafts).toHaveLength(1)
    expect(persistedDrafts[0]!.byteLength).toBe(1001)

    // Host requests doc.download -> frame forwards blocked bytes to api.download
    const dlRes = await env.invokeHostDownload()
    expect(dlRes).toEqual({ delivered: true })
    const dlCalls = env.requests.filter((r) => r.type === 'api.download')
    expect(dlCalls).toHaveLength(1)
    const sentBytes = new Uint8Array((dlCalls[0]!.payload as { data: ArrayBuffer }).data)
    expect(sentBytes.byteLength).toBe(1001)
    expect(sentBytes[0]).toBe(0xde)
    expect(sentBytes[1000]).toBe(0xad)
  })

  it('suppresses frame warn chip and block dialog when capabilities.sizeUi === true, and renders them when sizeUi is false/absent', async () => {
    const limits: DocumentSizeLimits = {
      max_bytes: 2 * MB,
      warn_ratio: 0.9,
    }

    // 1. sizeUi: true -> no frame chip or dialog rendered
    const hostUiEnv = createMockGateEnv({
      limits,
      capabilities: { save: true, download: true, sizeUi: true },
    })
    const hostUiGate = createSaveSizeGate({
      port: hostUiEnv.port,
      lang: () => 'vi',
    })
    await hostUiGate.checkBeforeSave(new Uint8Array(Math.ceil(1.9 * MB)))
    expect(document.querySelector(`[data-office-web="${SIZE_WARN_MARKER}"]`)).toBeNull()
    await hostUiGate.checkBeforeSave(new Uint8Array(4))
    hostUiEnv.session.limits = { max_bytes: 10, warn_ratio: 0.9 }
    await hostUiGate.checkBeforeSave(new Uint8Array(11))
    expect(document.querySelector(`[data-office-web="${SAVE_BLOCKED_MARKER}"]`)).toBeNull()

    // 2. sizeUi: false/absent -> fallback warn chip and block dialog rendered in vi & en
    const fallbackEnv = createMockGateEnv({
      limits,
      capabilities: { save: true, download: true },
    })
    let currentLang: 'vi' | 'en' = 'vi'
    const fallbackGate = createSaveSizeGate({
      port: fallbackEnv.port,
      lang: () => currentLang,
    })

    await fallbackGate.checkBeforeSave(new Uint8Array(Math.ceil(1.9 * MB)))
    const chip = document.querySelector<HTMLElement>(`[data-office-web="${SIZE_WARN_MARKER}"]`)
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toContain(
      webText('vi', 'webSizeWarnChip', { max: '2 MB', size: '1,9 MB' }),
    )

    // Block in vi
    await fallbackGate.checkBeforeSave(new Uint8Array(2 * MB + 1))
    const dlgVi = document.querySelector<HTMLElement>(`[data-office-web="${SAVE_BLOCKED_MARKER}"]`)
    expect(dlgVi).not.toBeNull()
    expect(dlgVi!.textContent).toContain(webText('vi', 'webSaveBlockTitle'))
    expect(dlgVi!.textContent).toContain('Tải bản của tôi')

    // Clicking "Tải bản của tôi" triggers api.download and closes the dialog
    const downloadBtn = dlgVi!.querySelector<HTMLButtonElement>('[data-choice="download"]')!
    downloadBtn.click()
    await vi.waitFor(() => {
      expect(fallbackEnv.requests.filter((r) => r.type === 'api.download')).toHaveLength(1)
    })

    // Switch to English and block again
    currentLang = 'en'
    await fallbackGate.checkBeforeSave(new Uint8Array(2 * MB + 2))
    const dlgEn = document.querySelector<HTMLElement>(`[data-office-web="${SAVE_BLOCKED_MARKER}"]`)
    expect(dlgEn).not.toBeNull()
    expect(dlgEn!.textContent).toContain(webText('en', 'webSaveBlockTitle'))
    expect(dlgEn!.textContent).toContain('Download my copy')
  })

  it('defense-in-depth on server 413 too_large with details.max_bytes updates session.limits and opens the block UI with that max', async () => {
    const env = createMockGateEnv({
      limits: { max_bytes: 200 * MB, warn_ratio: 0.9 },
      capabilities: { save: true, download: true },
    })
    const gate = createSaveSizeGate({ port: env.port, lang: () => 'vi' })
    await env.port.whenInitialized()

    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const message = gate.handleServerTooLarge(
      {
        code: 'too_large',
        message: 'HTTP 413',
        status: 413,
        details: { max_bytes: 50 * MB },
      },
      payload,
    )

    expect(gate.limits().max_bytes).toBe(50 * MB)
    expect(env.session.limits.max_bytes).toBe(50 * MB)
    expect(message).toContain('50 MB')
    expect(env.events).toEqual([
      {
        type: 'save_blocked',
        payload: { bytes: 5, max_bytes: 50 * MB },
      },
    ])
    const dlg = document.querySelector<HTMLElement>(`[data-office-web="${SAVE_BLOCKED_MARKER}"]`)
    expect(dlg).not.toBeNull()
    expect(dlg!.textContent).toContain('50 MB')
  })
})
