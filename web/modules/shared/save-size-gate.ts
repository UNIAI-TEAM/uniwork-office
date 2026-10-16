/**
 * Shared frame-side document size gate (`SIZE-F1`, `UNI-1861`):
 *   - `evaluateSaveSize`: evaluates serialized byte size against `DocumentSizeLimits`
 *     (`warnBytes = Math.floor(max_bytes * warn_ratio)` -> `'normal' | 'warn' | 'block'`).
 *   - `formatSizeMB`: deterministic binary MiB formatter (`1024 * 1024`) with boundary-safe
 *     rounding (`ceil` to `0.1 MB` above `max_bytes`, `floor` to `0.1 MB` in the warn band,
 *     whole numbers with `0` decimals, non-whole numbers with at most `1` decimal via `Intl`).
 *   - `createSaveSizeGate`: per-frame controller tracking `session.limits`, the once-per-session
 *     warning latch (`warnedNearLimit`, re-armed only after a save below `warnBytes` or a new
 *     `documentId`), `lastBlockedBytes`, the `doc.download` -> `api.download` handler, defense-in-depth
 *     `413 too_large` handling (`details.max_bytes`), and the in-frame fallback UI (warn chip +
 *     save-block modal dialog) shown only when `capabilities.sizeUi !== true`.
 */
import type { Lang } from '@genoffice/i18n'
import {
  DEFAULT_DOCUMENT_LIMITS,
  resolveDocumentSizeLimits,
  toProtocolError,
  type ApiDownloadResult,
  type DocumentSizeLimits,
  type ProtocolErrorShape,
} from '../../docs/protocol/types'
import { webLanguage } from '../../docs/bridge/browser'
import { TIMEOUTS, type FramePort, type PortSession } from '../../docs/bridge/frame-port'
import { openFrameDialog, type FrameDialogFrame, type FrameDialogHandle } from './frame-dialog'
import { webText } from './i18n/strings-web'
import './remote-bar.css'
import { ensureLiveNodes } from './remote-bar'

export type SaveSizeBand = 'normal' | 'warn' | 'block'

export interface SaveSizeEvaluation {
  band: SaveSizeBand
  bytes: number
  warnBytes: number
  maxBytes: number
  warnRatio: number
}

const BYTES_PER_MB = 1024 * 1024

/**
 * Evaluates a serialized document byte size against `limits` (§3.2):
 *   - `warnBytes = Math.floor(max_bytes * warn_ratio)`
 *   - `'normal'`: `bytes < warnBytes`
 *   - `'warn'`: `warnBytes <= bytes <= max_bytes`
 *   - `'block'`: `bytes > max_bytes`
 */
export function evaluateSaveSize(
  bytes: number,
  limits?: Partial<DocumentSizeLimits> | null,
): SaveSizeEvaluation {
  const resolved = resolveDocumentSizeLimits(limits, DEFAULT_DOCUMENT_LIMITS)
  const maxBytes = resolved.max_bytes
  const warnRatio = resolved.warn_ratio
  const warnBytes = Math.floor(maxBytes * warnRatio)
  const band: SaveSizeBand = bytes > maxBytes ? 'block' : bytes >= warnBytes ? 'warn' : 'normal'
  return {
    band,
    bytes,
    warnBytes,
    maxBytes,
    warnRatio,
  }
}

export interface FormatSizeMBOptions {
  band?: SaveSizeBand
  maxBytes?: number
  warnBytes?: number
  limits?: Partial<DocumentSizeLimits> | null
}

/**
 * Formats a byte count in binary MiB (`1024 * 1024`) per contract §6.1:
 *   - Whole numbers render with 0 decimals (`"200 MB"`, `"180 MB"`).
 *   - Non-whole numbers render with at most 1 decimal via `Intl.NumberFormat(locale, { maximumFractionDigits: 1 })`
 *     (`vi` -> `"185,4 MB"`, `en` -> `"185.4 MB"`).
 *   - Boundary safety:
 *     - When `bytes > max_bytes` (`band === 'block'`), rounds UP to `0.1 MB` so `max_bytes + 1`
 *       never displays as `{max}` (e.g. `200 MiB + 1 B` -> `"200,1 MB"` / `"200.1 MB"`).
 *     - When `warn_bytes <= bytes <= max_bytes` (`band === 'warn'`), floors to `0.1 MB` so `{size}`
 *       never exceeds `{max}`.
 */
export function formatSizeMB(bytes: number, locale: string, opts?: FormatSizeMBOptions): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  let band = opts?.band
  if (!band) {
    if (opts?.limits) {
      band = evaluateSaveSize(safeBytes, opts.limits).band
    } else if (opts?.maxBytes !== undefined && safeBytes > opts.maxBytes) {
      band = 'block'
    } else if (
      opts?.warnBytes !== undefined &&
      safeBytes >= opts.warnBytes &&
      (opts.maxBytes === undefined || safeBytes <= opts.maxBytes)
    ) {
      band = 'warn'
    }
  }

  const rawTenths = (safeBytes / BYTES_PER_MB) * 10
  let tenths: number
  if (band === 'block') {
    tenths = Math.max(1, Math.ceil(rawTenths - 1e-12))
  } else if (band === 'warn') {
    tenths = Math.floor(rawTenths + 1e-12)
  } else {
    tenths = Math.round(rawTenths)
  }
  const mb = tenths / 10
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(mb)
  return `${formatted} MB`
}

function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const out = new ArrayBuffer(src.byteLength)
  new Uint8Array(out).set(src)
  return out
}

export const SAVE_BLOCKED_MARKER = 'save-blocked'
export const SIZE_WARN_MARKER = 'size-warning'

export interface SaveSizeGatePort {
  whenInitialized(): Promise<PortSession>
  request: FramePort['request']
  emit?: <K extends 'size_warning' | 'save_blocked'>(
    type: K,
    payload: K extends 'size_warning'
      ? { bytes: number; max_bytes: number; warn_ratio: number }
      : { bytes: number; max_bytes: number },
  ) => void
  reportSizeWarning?: FramePort['reportSizeWarning']
  reportSaveBlocked?: FramePort['reportSaveBlocked']
  handleDownload?: FramePort['handleDownload']
  setDirty?: FramePort['setDirty']
}

export interface SaveSizeGateOptions {
  port: SaveSizeGatePort
  /** Live serialized bytes fallback when `doc.download` is requested and `lastBlockedBytes` is null */
  getLiveBytes?: () => Promise<ArrayBuffer | Uint8Array | null> | ArrayBuffer | Uint8Array | null
  /** Best-effort local draft persistence called when a save is blocked (`try / catch`) */
  persistDraft?: (bytes: ArrayBuffer) => Promise<void> | void
  /** Optional module dialog marker attributes */
  frame?: Pick<FrameDialogFrame, 'markerAttr' | 'maskClass' | 'onChange'>
  /** Optional language getter override (default: `webLanguage()`) */
  lang?: () => Lang
  /** Optional DOM document override for tests */
  doc?: Document
}

export type SaveSizeGateCheckResult =
  | {
      allowed: true
      evaluation: SaveSizeEvaluation
    }
  | {
      allowed: false
      evaluation: SaveSizeEvaluation
      error: ProtocolErrorShape
      message: string
    }

export interface SaveSizeGate {
  /** Active `DocumentSizeLimits` (`open.limits ?? init.limits ?? DEFAULT_DOCUMENT_LIMITS`) */
  limits(): DocumentSizeLimits
  /** True when the host advertised `capabilities.sizeUi === true` */
  sizeUi(): boolean
  /** Last serialized bytes that were blocked from saving, if any */
  lastBlockedBytes(): ArrayBuffer | null
  /** Notify the gate when a document is opened; resets warn latch & blocked bytes on new `documentId` */
  noteDocumentOpened(
    documentId: string | null | undefined,
    openLimits?: Partial<DocumentSizeLimits> | null,
  ): void
  /**
   * Run after serializing the document and BEFORE `port.request('api.save' | 'api.saveAs')`:
   *   - `'normal'`: re-arms `warnedNearLimit`, hides fallback warn chip, returns `{ allowed: true }`.
   *   - `'warn'`: if not latched, sets `warnedNearLimit = true`, emits `size_warning` before save,
   *     shows fallback warn chip when `sizeUi !== true`, and returns `{ allowed: true }`.
   *   - `'block'`: caches `lastBlockedBytes`, emits `save_blocked` INSTEAD of `api.save` / `api.saveAs`,
   *     keeps dirty state + local draft, opens fallback save-block dialog when `sizeUi !== true`,
   *     and returns `{ allowed: false, error, message }`.
   */
  checkBeforeSave(data: ArrayBuffer | Uint8Array): Promise<SaveSizeGateCheckResult>
  /**
   * Defense-in-depth when `api.save` / `api.saveAs` returns `code === 'too_large'` (HTTP 413):
   * updates `limits.max_bytes` from `error.details.max_bytes` (when valid), caches `data`,
   * emits `save_blocked`, and opens the fallback save-block dialog when `sizeUi !== true`.
   */
  handleServerTooLarge(error: ProtocolErrorShape, data?: ArrayBuffer | Uint8Array): string
  /** Reset all per-document state and close any fallback UI */
  reset(): void
}

type BlockChoice = 'download' | 'close'

export function createSaveSizeGate(opts: SaveSizeGateOptions): SaveSizeGate {
  const { port } = opts
  const getLang = opts.lang ?? (() => webLanguage())
  const getDoc = (): Document | null =>
    opts.doc ?? (typeof document !== 'undefined' ? document : null)

  let session: PortSession | null = null
  let currentDocumentId: string | null = null
  let limitsOverride: DocumentSizeLimits | null = null
  let warnedNearLimit = false
  let blockedBytes: ArrayBuffer | null = null
  let warnChipEl: HTMLElement | null = null
  let activeBlockDialog: FrameDialogHandle<BlockChoice> | null = null

  port
    .whenInitialized()
    .then((s) => {
      session = s
      if (currentDocumentId === null) currentDocumentId = s.documentId
    })
    .catch(() => {})

  async function syncSession(): Promise<void> {
    if (session !== null) return
    try {
      const resolved = await Promise.race([
        port.whenInitialized(),
        Promise.resolve<PortSession | null>(null),
      ])
      if (resolved) {
        session = resolved
        if (currentDocumentId === null) currentDocumentId = resolved.documentId
      }
    } catch {
      // ignore uninitialized or rejected init in standalone tests
    }
  }

  function activeLimits(): DocumentSizeLimits {
    return resolveDocumentSizeLimits(limitsOverride ?? session?.limits, DEFAULT_DOCUMENT_LIMITS)
  }

  function hasHostSizeUi(): boolean {
    return session?.capabilities?.sizeUi === true
  }

  function hideWarnChip(): void {
    warnChipEl?.remove()
    warnChipEl = null
  }

  function closeBlockDialog(): void {
    const dlg = activeBlockDialog
    activeBlockDialog = null
    dlg?.close()
  }

  function showWarnChip(bytes: number, limits: DocumentSizeLimits): void {
    const doc = getDoc()
    if (!doc?.body) return
    hideWarnChip()
    const locale = getLang()
    const warnBytes = Math.floor(limits.max_bytes * limits.warn_ratio)
    const max = formatSizeMB(limits.max_bytes, locale)
    const size = formatSizeMB(bytes, locale, {
      band: 'warn',
      maxBytes: limits.max_bytes,
      warnBytes,
    })
    const copy = webText(locale, 'webSizeWarnChip', { max, size })

    const bar = doc.createElement('div')
    bar.className = 'uw-remote-bar uw-remote-bar--warn uw-size-warn-chip'
    bar.setAttribute('data-office-web', SIZE_WARN_MARKER)
    bar.setAttribute('data-testid', 'size-warn-chip')
    if (opts.frame?.markerAttr) {
      bar.setAttribute(opts.frame.markerAttr, SIZE_WARN_MARKER)
    }
    bar.setAttribute('role', 'status')

    const textSpan = doc.createElement('span')
    textSpan.className = 'uw-remote-bar-text'
    textSpan.textContent = copy
    bar.append(textSpan)

    const actions = doc.createElement('div')
    actions.className = 'uw-remote-bar-actions'
    const closeBtn = doc.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'uw-remote-link'
    closeBtn.dataset.action = 'dismiss'
    const closeLabel = webText(locale, 'uwConflictClose')
    closeBtn.setAttribute('aria-label', closeLabel)
    closeBtn.textContent = closeLabel
    closeBtn.addEventListener('click', () => {
      hideWarnChip()
    })
    actions.append(closeBtn)
    bar.append(actions)

    warnChipEl = bar
    doc.body.prepend(bar)
    const { polite } = ensureLiveNodes(doc)
    polite.textContent = ''
    polite.textContent = copy
  }

  async function triggerDownload(bytes: ArrayBuffer): Promise<ApiDownloadResult> {
    const data = copyBuffer(bytes)
    await port.request('api.download', { data }, { timeoutMs: TIMEOUTS.transfer, transfer: [data] })
    return { delivered: true }
  }

  function showBlockDialog(bytes: ArrayBuffer, maxBytes: number): void {
    const doc = getDoc()
    if (!doc?.body) return
    closeBlockDialog()
    const locale = getLang()
    const max = formatSizeMB(maxBytes, locale)
    const title = webText(locale, 'webSaveBlockTitle')
    const body = webText(locale, 'webSaveBlockBody', { max })
    const downloadLabel = webText(locale, 'webSaveBlockDownload')
    const closeLabel = webText(locale, 'uwConflictClose')

    const dialog = openFrameDialog<BlockChoice>({
      marker: SAVE_BLOCKED_MARKER,
      closeLabel,
      ...(opts.frame?.markerAttr ? { markerAttr: opts.frame.markerAttr } : {}),
      ...(opts.frame?.maskClass ? { maskClass: opts.frame.maskClass } : {}),
      ...(opts.frame?.onChange ? { onChange: opts.frame.onChange } : {}),
    })
    // Ensure `[data-office-web="save-blocked"]` is always present even when a custom `markerAttr` is used
    const mask = dialog.card.parentElement
    if (mask && mask.getAttribute('data-office-web') !== SAVE_BLOCKED_MARKER) {
      mask.setAttribute('data-office-web', SAVE_BLOCKED_MARKER)
    }
    activeBlockDialog = dialog

    void dialog
      .step(
        {
          title,
          body,
          choices: [
            { id: 'download', label: downloadLabel, primary: true },
            { id: 'close', label: closeLabel },
          ],
          cancelId: 'close',
          focusId: 'download',
        },
        { closeOnAnswer: true },
      )
      .then(async (choice) => {
        if (activeBlockDialog === dialog) activeBlockDialog = null
        if (choice === 'download') {
          try {
            await triggerDownload(bytes)
          } catch (err) {
            console.warn('[office-web] save-blocked download failed:', err)
          }
        }
      })
  }

  port.handleDownload?.(async () => {
    await syncSession()
    let data: ArrayBuffer | Uint8Array | null = blockedBytes
    if (!data && opts.getLiveBytes) {
      data = await opts.getLiveBytes()
    }
    if (!data) {
      throw toProtocolError({
        code: 'not_ready',
        message: 'no document bytes available for download',
      })
    }
    return triggerDownload(copyBuffer(data))
  })

  return {
    limits: activeLimits,
    sizeUi: hasHostSizeUi,
    lastBlockedBytes: () => (blockedBytes ? copyBuffer(blockedBytes) : null),

    noteDocumentOpened(documentId, openLimits) {
      if (documentId && currentDocumentId !== null && documentId !== currentDocumentId) {
        warnedNearLimit = false
        blockedBytes = null
        limitsOverride = null
        hideWarnChip()
        closeBlockDialog()
      }
      if (documentId) currentDocumentId = documentId
      if (openLimits) {
        limitsOverride = resolveDocumentSizeLimits(openLimits, activeLimits())
        if (session) session.limits = limitsOverride
      }
    },

    async checkBeforeSave(data) {
      await syncSession()
      const currentLimits = activeLimits()
      const evaluation = evaluateSaveSize(data.byteLength, currentLimits)

      if (evaluation.band === 'normal') {
        warnedNearLimit = false
        hideWarnChip()
        return { allowed: true, evaluation }
      }

      if (evaluation.band === 'warn') {
        if (!warnedNearLimit) {
          warnedNearLimit = true
          const warnPayload = {
            bytes: evaluation.bytes,
            max_bytes: evaluation.maxBytes,
            warn_ratio: evaluation.warnRatio,
          }
          if (port.reportSizeWarning) port.reportSizeWarning(warnPayload)
          else port.emit?.('size_warning', warnPayload)
          if (!hasHostSizeUi()) {
            showWarnChip(evaluation.bytes, currentLimits)
          }
        }
        return { allowed: true, evaluation }
      }

      // evaluation.band === 'block'
      const savedCopy = copyBuffer(data)
      blockedBytes = savedCopy
      const blockPayload = {
        bytes: evaluation.bytes,
        max_bytes: evaluation.maxBytes,
      }
      if (port.reportSaveBlocked) port.reportSaveBlocked(blockPayload)
      else port.emit?.('save_blocked', blockPayload)
      port.setDirty?.(true, { force: true })
      if (opts.persistDraft) {
        try {
          await opts.persistDraft(copyBuffer(savedCopy))
        } catch {
          // best-effort draft persistence
        }
      }
      if (!hasHostSizeUi()) {
        showBlockDialog(savedCopy, evaluation.maxBytes)
      }
      const locale = getLang()
      const max = formatSizeMB(evaluation.maxBytes, locale)
      const message = webText(locale, 'webSaveBlockBody', { max })
      return {
        allowed: false,
        evaluation,
        error: {
          code: 'too_large',
          message,
          details: { max_bytes: evaluation.maxBytes },
        },
        message,
      }
    },

    handleServerTooLarge(error, data) {
      const serverMax = error.details?.max_bytes
      const hasExplicitLimit =
        (typeof serverMax === 'number' && Number.isFinite(serverMax) && serverMax > 0) ||
        limitsOverride !== null ||
        session?.limits !== undefined
      if (typeof serverMax === 'number' && Number.isFinite(serverMax) && serverMax > 0) {
        const updated = resolveDocumentSizeLimits(
          { max_bytes: Math.floor(serverMax) },
          activeLimits(),
        )
        limitsOverride = updated
        if (session) session.limits = updated
      }
      const currentLimits = activeLimits()
      if (data) {
        blockedBytes = copyBuffer(data)
      }
      const byteLength = data
        ? data.byteLength
        : (blockedBytes?.byteLength ?? currentLimits.max_bytes + 1)
      const blockPayload = {
        bytes: byteLength,
        max_bytes: currentLimits.max_bytes,
      }
      if (port.reportSaveBlocked) port.reportSaveBlocked(blockPayload)
      else port.emit?.('save_blocked', blockPayload)
      port.setDirty?.(true, { force: true })
      if (!hasHostSizeUi()) {
        showBlockDialog(blockedBytes ?? new ArrayBuffer(0), currentLimits.max_bytes)
      }
      const locale = getLang()
      if (!hasExplicitLimit) {
        return webText(locale, 'webSaveTooLarge')
      }
      const max = formatSizeMB(currentLimits.max_bytes, locale)
      return webText(locale, 'webSaveBlockBody', { max })
    },

    reset() {
      warnedNearLimit = false
      blockedBytes = null
      limitsOverride = null
      hideWarnChip()
      closeBlockDialog()
    },
  }
}
