/**
 * Passive main-thread lag detector for the web editor frames (UNI-1865, contract-size-frame §4).
 *
 * Uses event-driven `PerformanceObserver` (`longtask` + Event Timing `event` with
 * `durationThreshold: 300`, `buffered: false`). Zero timers, zero polling.
 *
 * Trip rules (after `loadSettledAt` = first post-mount `requestAnimationFrame` + 2 000 ms):
 * - `>= 3` slow interactions (`duration > 300` ms, deduplicated by `interactionId` when > 0)
 *   within a sliding `120 000` ms (2-minute) window -> `reason: 'interactions'`.
 * - `>= 1` long task with `duration > 1 000` ms -> `reason: 'longtask'`.
 *
 * Emits `lag_detected` at most once per `documentId` and immediately disconnects its observer.
 * Re-arms only when `markDocumentLoaded(documentId, bytes)` is called with a new `documentId`.
 * No-op when `PerformanceObserver` / entry types are unsupported, when `capabilities.desktopOpen`
 * is not `true`, or in the desktop app.
 */
import type { Capabilities, LagDetectedPayload } from '../../docs/protocol/types'

export const INTERACTION_THRESHOLD_MS = 300
export const INTERACTION_WINDOW_MS = 120_000
export const INTERACTION_COUNT_THRESHOLD = 3
export const LONGTASK_THRESHOLD_MS = 1_000
export const LOAD_SETTLE_GRACE_MS = 2_000

const DISCRETE_INTERACTION_EVENTS: ReadonlySet<string> = new Set([
  'pointerdown',
  'pointerup',
  'click',
  'keydown',
  'keyup',
  'input',
  'beforeinput',
])

export interface LagPerformanceEntry {
  readonly entryType: string
  readonly name?: string
  readonly startTime: number
  readonly duration: number
  readonly interactionId?: number
}

export interface LagPerformanceObserverList {
  getEntries(): readonly LagPerformanceEntry[]
}

export type LagPerformanceObserverCallback = (list: LagPerformanceObserverList) => void

export interface LagPerformanceObserverInstance {
  observe(options: { type: string; buffered?: boolean; durationThreshold?: number }): void
  disconnect(): void
}

export interface LagPerformanceObserverConstructor {
  new (callback: LagPerformanceObserverCallback): LagPerformanceObserverInstance
  readonly supportedEntryTypes?: readonly string[]
}

export interface LagDetectorPort {
  emit?: (type: 'lag_detected', payload: LagDetectedPayload) => void
  reportLagDetected?: (payload: LagDetectedPayload) => void
  whenInitialized?: () => Promise<{ documentId: string; capabilities?: Capabilities }>
  capabilities?: Capabilities
}

export interface LagDetectorOptions {
  /** Custom PerformanceObserver constructor (injectable for unit tests). */
  observer?: LagPerformanceObserverConstructor | null
  /** High-resolution clock in the same time origin as `entry.startTime` (default: `performance.now()`). */
  now?: () => number
  /** Custom `requestAnimationFrame` (default: global `requestAnimationFrame` when available). */
  requestAnimationFrame?: ((cb: (ts: number) => void) => number) | null
  /** Custom `cancelAnimationFrame` (default: global `cancelAnimationFrame` when available). */
  cancelAnimationFrame?: ((handle: number) => void) | null
  /** Frame port or bridge port to emit `lag_detected` on. */
  port?: LagDetectorPort | null
  /** Explicit `desktopOpen` capability override (`false` disables the detector). */
  desktopOpen?: boolean
  /** Host capabilities object (`capabilities.desktopOpen === true` required when provided). */
  capabilities?: Capabilities | null
  /** Force desktop-app environment check (default: auto-detected via Electron process versions). */
  isDesktopApp?: boolean
  /** Direct callback invoked when `lag_detected` fires. */
  onLagDetected?: (payload: LagDetectedPayload) => void
}

interface WindowInteraction {
  interactionId: number
  startTime: number
  duration: number
}

export interface MarkDocumentLoadedCall {
  documentId: string
  bytes?: number
}

export interface LagDetector {
  markDocumentLoaded(documentId: string, bytes?: number): void
  /**
   * Follow the last serialized size (the save gate calls this from `checkBeforeSave`, §4.1.2:
   * `knownBytes` follows the last serialized save so `lag_detected.bytes` is never stale).
   * Only updates while a document is the current one.
   */
  bindPort(port: LagDetectorPort | null | undefined, capabilities?: Capabilities | null): void
  disconnect(): void
  readonly currentDocumentId: string | null
  readonly currentBytes: number | undefined
  readonly loadSettledAt: number | null
  readonly isTripped: boolean
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0
}

function defaultObserverCtor(): LagPerformanceObserverConstructor | null {
  if (typeof PerformanceObserver === 'undefined') return null
  return PerformanceObserver as unknown as LagPerformanceObserverConstructor
}

function detectDesktopApp(override?: boolean): boolean {
  if (typeof override === 'boolean') return override
  const proc = (globalThis as { process?: { versions?: { electron?: unknown } } }).process
  return Boolean(proc?.versions?.electron)
}

function isDiscreteEventEntry(entry: LagPerformanceEntry): boolean {
  if (typeof entry.interactionId === 'number' && entry.interactionId > 0) return true
  if (!entry.name) return true
  return DISCRETE_INTERACTION_EVENTS.has(entry.name)
}

export function createLagDetector(options: LagDetectorOptions = {}): LagDetector {
  let port: LagDetectorPort | null | undefined = options.port
  let explicitDesktopOpen: boolean | undefined =
    options.desktopOpen !== undefined
      ? options.desktopOpen
      : options.capabilities !== undefined && options.capabilities !== null
        ? options.capabilities.desktopOpen === true
        : port?.capabilities !== undefined
          ? port.capabilities.desktopOpen === true
          : undefined

  let activeObserver: LagPerformanceObserverInstance | null = null
  let rafHandle: number | null = null
  let currentDocId: string | null = null
  let knownBytes: number | undefined = undefined
  let settledAt: number | null = null
  let trippedDocId: string | null = null
  let windowEntries: WindowInteraction[] = []

  const getNow = (): number => (options.now ? options.now() : defaultNow())

  const getRaf = (): ((cb: (ts: number) => void) => number) | null => {
    if (options.requestAnimationFrame !== undefined) return options.requestAnimationFrame
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
  }

  const getCaf = (): ((handle: number) => void) | null => {
    if (options.cancelAnimationFrame !== undefined) return options.cancelAnimationFrame
    return typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null
  }

  function cancelPendingRaf(): void {
    if (rafHandle !== null) {
      const caf = getCaf()
      if (caf) {
        try {
          caf(rafHandle)
        } catch {
          // ignore
        }
      }
      rafHandle = null
    }
  }

  function stopObserver(): void {
    cancelPendingRaf()
    if (activeObserver) {
      const obs = activeObserver
      activeObserver = null
      try {
        obs.disconnect()
      } catch {
        // ignore
      }
    }
  }

  function isDesktopOpenAllowed(): boolean {
    if (detectDesktopApp(options.isDesktopApp)) return false
    if (explicitDesktopOpen !== undefined) return explicitDesktopOpen
    return true
  }

  function emitLagDetected(payload: LagDetectedPayload): void {
    options.onLagDetected?.(payload)
    // reportLagDetected (guarded ep.emit on the real client) wins over the raw emit
    // that only exists on test doubles; without a bound port the event drops:
    // every markDocumentLoaded call site binds the port first, and a portless
    // frame has no host to report to.
    if (typeof port?.reportLagDetected === 'function') {
      port.reportLagDetected(payload)
    } else if (typeof port?.emit === 'function') {
      port.emit('lag_detected', payload)
    }
  }

  function trip(payload: LagDetectedPayload): void {
    if (!currentDocId || trippedDocId === currentDocId) return
    trippedDocId = currentDocId
    windowEntries = []
    stopObserver()
    emitLagDetected(payload)
  }

  function handleEntries(entries: readonly LagPerformanceEntry[]): void {
    if (!currentDocId || trippedDocId === currentDocId || settledAt === null) return
    if (!isDesktopOpenAllowed()) {
      stopObserver()
      return
    }

    for (const entry of entries) {
      if (!currentDocId || trippedDocId === currentDocId) return
      if (
        !entry ||
        typeof entry.startTime !== 'number' ||
        typeof entry.duration !== 'number' ||
        !Number.isFinite(entry.startTime) ||
        !Number.isFinite(entry.duration)
      ) {
        continue
      }

      // Ignore everything before initial document load has settled.
      if (entry.startTime < settledAt) continue

      if (entry.entryType === 'longtask') {
        if (entry.duration > LONGTASK_THRESHOLD_MS) {
          trip({
            reason: 'longtask',
            worst_ms: Math.round(entry.duration),
            count: 1,
            window_ms: 0,
            ...(knownBytes !== undefined && knownBytes > 0 ? { bytes: knownBytes } : {}),
          })
          return
        }
        continue
      }

      if (entry.entryType === 'event') {
        if (entry.duration <= INTERACTION_THRESHOLD_MS) continue
        if (!isDiscreteEventEntry(entry)) continue

        const cutoff = entry.startTime - INTERACTION_WINDOW_MS
        windowEntries = windowEntries.filter((item) => item.startTime >= cutoff)

        const interactionId =
          typeof entry.interactionId === 'number' && entry.interactionId > 0
            ? entry.interactionId
            : 0

        if (interactionId > 0) {
          const existing = windowEntries.find((item) => item.interactionId === interactionId)
          if (existing) {
            existing.duration = Math.max(existing.duration, entry.duration)
            existing.startTime = Math.max(existing.startTime, entry.startTime)
          } else {
            windowEntries.push({
              interactionId,
              startTime: entry.startTime,
              duration: entry.duration,
            })
          }
        } else {
          windowEntries.push({
            interactionId: 0,
            startTime: entry.startTime,
            duration: entry.duration,
          })
        }

        if (windowEntries.length >= INTERACTION_COUNT_THRESHOLD) {
          let maxDuration = 0
          for (const item of windowEntries) {
            if (item.duration > maxDuration) maxDuration = item.duration
          }
          trip({
            reason: 'interactions',
            worst_ms: Math.round(maxDuration),
            count: windowEntries.length,
            window_ms: INTERACTION_WINDOW_MS,
            ...(knownBytes !== undefined && knownBytes > 0 ? { bytes: knownBytes } : {}),
          })
          return
        }
      }
    }
  }

  function bindPort(
    nextPort: LagDetectorPort | null | undefined,
    capabilities?: Capabilities | null,
  ): void {
    port = nextPort
    if (capabilities !== undefined && capabilities !== null) {
      explicitDesktopOpen = capabilities.desktopOpen === true
    } else if (nextPort?.capabilities !== undefined) {
      explicitDesktopOpen = nextPort.capabilities.desktopOpen === true
    }
    if (typeof nextPort?.whenInitialized === 'function') {
      void nextPort
        .whenInitialized()
        .then((session) => {
          if (port !== nextPort) return
          if (session?.capabilities !== undefined) {
            explicitDesktopOpen = session.capabilities.desktopOpen === true
            if (!explicitDesktopOpen) stopObserver()
          }
        })
        .catch(() => {})
    }
    if (explicitDesktopOpen === false) {
      stopObserver()
    }
  }

  if (port) {
    bindPort(port, options.capabilities)
  }

  function markDocumentLoaded(documentId: string, bytes?: number): void {
    if (typeof documentId !== 'string' || documentId.length === 0) return

    const normalizedBytes =
      typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0
        ? Math.round(bytes)
        : undefined

    const isSameDoc = currentDocId === documentId
    if (!isSameDoc) {
      currentDocId = documentId
      trippedDocId = null
      windowEntries = []
    }
    knownBytes = normalizedBytes

    // If this documentId already tripped, stay disconnected and never re-arm for the same documentId.
    if (trippedDocId === documentId) {
      stopObserver()
      return
    }

    stopObserver()

    if (!isDesktopOpenAllowed()) {
      settledAt = null
      return
    }

    const ObserverCtor = options.observer !== undefined ? options.observer : defaultObserverCtor()
    if (!ObserverCtor || !Array.isArray(ObserverCtor.supportedEntryTypes)) {
      settledAt = null
      return
    }

    const supported = ObserverCtor.supportedEntryTypes
    const supportsLongtask = supported.includes('longtask')
    const supportsEvent = supported.includes('event')
    if (!supportsLongtask && !supportsEvent) {
      settledAt = null
      return
    }

    const docAtMark = documentId
    settledAt = getNow() + LOAD_SETTLE_GRACE_MS
    const raf = getRaf()
    if (raf) {
      try {
        rafHandle = raf(() => {
          rafHandle = null
          if (currentDocId === docAtMark && trippedDocId !== docAtMark) {
            settledAt = Math.max(settledAt ?? 0, getNow() + LOAD_SETTLE_GRACE_MS)
          }
        })
      } catch {
        // ignore rAF errors in non-browser test environments
      }
    }

    let instance: LagPerformanceObserverInstance
    try {
      instance = new ObserverCtor((list) => {
        handleEntries(list.getEntries())
      })
    } catch {
      settledAt = null
      return
    }

    activeObserver = instance
    if (supportsLongtask) {
      try {
        instance.observe({ type: 'longtask', buffered: false })
      } catch {
        // ignore
      }
    }
    if (supportsEvent) {
      try {
        instance.observe({
          type: 'event',
          durationThreshold: INTERACTION_THRESHOLD_MS,
          buffered: false,
        })
      } catch {
        // ignore
      }
    }
  }

  return {
    markDocumentLoaded,
      if (!currentDocId) return
      if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) {
        knownBytes = Math.round(bytes)
      }
    },
    bindPort,
    disconnect: stopObserver,
    get currentDocumentId() {
      return currentDocId
    },
    get currentBytes() {
      return knownBytes
    },
    get loadSettledAt() {
      return settledAt
    },
    get isTripped() {
      return currentDocId !== null && trippedDocId === currentDocId
    },
  }
}

export const startLagDetector = createLagDetector

// ---------------------------------------------------------------- shared module singleton

let sharedOptions: LagDetectorOptions = {}
let sharedDetector: LagDetector = createLagDetector(sharedOptions)
const markListeners = new Set<(call: MarkDocumentLoadedCall) => void>()

export function getSharedLagDetector(): LagDetector {
  return sharedDetector
}

export function configureSharedLagDetector(options: LagDetectorOptions): LagDetector {
  sharedDetector.disconnect()
  sharedOptions = { ...options }
  sharedDetector = createLagDetector(sharedOptions)
  return sharedDetector
}
export function resetSharedLagDetector(): void {
  sharedDetector.disconnect()
  sharedOptions = {}
  sharedDetector = createLagDetector(sharedOptions)
  pendingDocumentLoaded = null
}

export function onMarkDocumentLoaded(listener: (call: MarkDocumentLoadedCall) => void): () => void {
  markListeners.add(listener)
  return () => {
    markListeners.delete(listener)
  }
}

export function bindLagDetectorPort(
  port: LagDetectorPort | null | undefined,
  capabilities?: Capabilities | null,
): void {
  sharedDetector.bindPort(port, capabilities)
}

export function markDocumentLoaded(documentId: string, bytes?: number): void {
  for (const listener of markListeners) {
    listener({ documentId, ...(bytes !== undefined ? { bytes } : {}) })
  }
  sharedDetector.markDocumentLoaded(documentId, bytes)
}

// d1-2: the bridge queues the opened document; the renderer calls
// documentMounted() at its real mount/commit point so loadSettledAt (and the
// 2 s grace) is measured from mount, not from the api.open result.
let pendingDocumentLoaded: { documentId: string; bytes?: number } | null = null

/** bridge open path: remember the document; the settle stamp waits for documentMounted() */
export function queueDocumentLoaded(documentId: string, bytes?: number): void {
  pendingDocumentLoaded = { documentId, ...(bytes !== undefined ? { bytes } : {}) }
}

/** renderer mount hook (the module api's `noteDocumentMounted`): commits the queued document */
export function documentMounted(): void {
  const pending = pendingDocumentLoaded
  pendingDocumentLoaded = null
  if (!pending) return
  markDocumentLoaded(pending.documentId, pending.bytes)
}

/** `lag_detected.bytes` follows the last serialized save size (§4.1.2; called by the save gate) */
}
