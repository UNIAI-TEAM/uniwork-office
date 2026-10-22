import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AskUniCitation,
  AskUniMessage,
  AskUniStreamEvent,
  AskUniV2ErrorCode,
} from '@genoffice/ai-provider/askuni'
import type { AskUniAdapter, AskUniAdapterRequest } from './adapter'

export type AskStreamStatus = 'idle' | 'streaming' | 'done' | 'stopped' | 'error'

export interface AskStreamState {
  status: AskStreamStatus
  question: string
  /** the conversation the turn was asked in; null until `run` names a new one */
  conversationId: string | null
  /** text of the current model call; cleared on every step */
  draft: string
  /** step counts summed by tool kind */
  counts: Record<string, number>
  citations: AskUniCitation[]
  message: AskUniMessage | null
  errorCode: AskUniV2ErrorCode | null
  retryAfterSeconds: number | null
  /** bumped whenever the stored conversation should be loaded again (done, Stop, ~1.5 s after Stop) */
  reloadTick: number
}

/** what a turn is asked with: the request minus what the hook knows (workspace) or defaults (locale) */
export type AskUniAskInput = Omit<AskUniAdapterRequest, 'workspaceId' | 'locale'> & {
  locale?: 'vi' | 'en'
}

export interface UseAskUniStreamOptions {
  /**
   * The workspace Home asks in. null = no workspace yet: an ask fails with `error`. Left out (an
   * editor) the request carries no workspace id at all: main derives it from the asking tab.
   */
  workspaceId?: string | null
  /** `run` named the conversation (a new one has no id before): the owner keeps it */
  onConversation?: (conversationId: string) => void
  /** the turn ended (done, Stop or error): refresh history, quota, ... */
  onSettled?: (info: {
    status: 'done' | 'stopped' | 'error'
    conversationId: string | null
  }) => void
}

/** a cancel is best effort: a host that throws or rejects has nothing left to stop */
function cancelQuietly(adapter: AskUniAdapter, requestId: string): void {
  try {
    void Promise.resolve(adapter.cancel(requestId)).then(undefined, () => undefined)
  } catch {
    /* a host that throws synchronously has nothing left to cancel */
  }
}

const IDLE: AskStreamState = {
  status: 'idle',
  question: '',
  conversationId: null,
  draft: '',
  counts: {},
  citations: [],
  message: null,
  errorCode: null,
  retryAfterSeconds: null,
  reloadTick: 0,
}

/** the server stores a stopped turn only after it notices the cancel */
const STOP_RELOAD_MS = 1500

interface Run {
  /** null until askUniStream answered; events that come first wait in `queue` */
  requestId: string | null
  queue: AskUniStreamEvent[]
}

/**
 * Drives one streamed Ask UNI turn at a time over the host's session (the adapter). A newer ask, an
 * unmount or a workspace switch cancels the older request; its late events no longer count.
 */
export function useAskUniStream(adapter: AskUniAdapter, options: UseAskUniStreamOptions = {}) {
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const [state, setState] = useState<AskStreamState>(IDLE)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const runRef = useRef<Run | null>(null)
  const turnConversation = useRef<string | null>(null)
  const lastInput = useRef<AskUniAskInput | null>(null)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearReloadTimer = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = null
  }, [])

  const cancelRun = useCallback(() => {
    const run = runRef.current
    runRef.current = null
    clearReloadTimer()
    // a start that has not answered is cancelled when it does (see ask)
    if (run?.requestId) cancelQuietly(adapterRef.current, run.requestId)
  }, [clearReloadTimer])

  const settle = useCallback((status: 'done' | 'stopped' | 'error') => {
    optionsRef.current.onSettled?.({ status, conversationId: turnConversation.current })
  }, [])

  const apply = useCallback(
    (run: Run, ev: AskUniStreamEvent) => {
      if (runRef.current !== run) return
      switch (ev.type) {
        case 'run':
          turnConversation.current = ev.conversationId
          setState((s) => ({ ...s, conversationId: ev.conversationId }))
          optionsRef.current.onConversation?.(ev.conversationId)
          break
        case 'step':
          setState((s) => {
            const counts = { ...s.counts }
            for (const [k, n] of Object.entries(ev.counts)) counts[k] = (counts[k] ?? 0) + n
            return { ...s, draft: '', counts }
          })
          break
        case 'delta':
          setState((s) => ({ ...s, draft: s.draft + ev.text }))
          break
        case 'citations':
          setState((s) => ({ ...s, citations: ev.citations }))
          break
        case 'done': {
          runRef.current = null
          const status = ev.message.notice === 'stopped' ? 'stopped' : 'done'
          setState((s) => ({ ...s, status, message: ev.message, reloadTick: s.reloadTick + 1 }))
          settle(status)
          break
        }
        case 'error':
          runRef.current = null
          setState((s) => ({
            ...s,
            status: 'error',
            errorCode: ev.code,
            retryAfterSeconds: ev.retryAfterSeconds ?? null,
          }))
          settle('error')
          break
      }
    },
    [settle],
  )

  // one subscription for the life of the hook; events of other requests are dropped
  useEffect(() => {
    const off = adapterRef.current.onEvent((ev) => {
      const run = runRef.current
      if (!run) return
      if (run.requestId === null) run.queue.push(ev)
      else if (ev.requestId === run.requestId) apply(run, ev)
    })
    return () => {
      off?.()
      cancelRun()
    }
  }, [apply, cancelRun])

  // undefined (an editor) and null (not ready) are different scopes, so they differ in the key too
  const workspaceId = options.workspaceId
  useEffect(
    () => () => {
      cancelRun()
      lastInput.current = null
      setState((s) => ({ ...IDLE, reloadTick: s.reloadTick }))
    },
    [workspaceId, cancelRun],
  )

  const ask = useCallback(
    (input: AskUniAskInput) => {
      cancelRun()
      lastInput.current = input
      turnConversation.current = input.conversationId ?? null
      const run: Run = { requestId: null, queue: [] }
      runRef.current = run
      setState((s) => ({
        ...IDLE,
        reloadTick: s.reloadTick,
        status: 'streaming',
        question: input.question,
        conversationId: input.conversationId ?? null,
      }))
      const fail = (code: AskUniV2ErrorCode, retryAfterSeconds?: number) => {
        if (runRef.current !== run) return
        runRef.current = null
        setState((s) => ({
          ...s,
          status: 'error',
          errorCode: code,
          retryAfterSeconds: retryAfterSeconds ?? null,
        }))
        settle('error')
      }
      const host = adapterRef.current
      const wsId = optionsRef.current.workspaceId
      if (wsId === null || wsId === '') {
        fail('error')
        return
      }
      const locale = input.locale ?? (host.lang === 'vi' ? 'vi' : 'en')
      // no workspace id when the host has none: the editor request is the question and its options
      const req: AskUniAdapterRequest =
        wsId === undefined ? { ...input, locale } : { ...input, workspaceId: wsId, locale }
      let start: ReturnType<AskUniAdapter['stream']>
      try {
        start = host.stream(req)
      } catch {
        fail('error')
        return
      }
      start.then(
        (res) => {
          if (runRef.current !== run) {
            // replaced or stopped while the start was in flight: the request is still running in main
            if (res.ok) cancelQuietly(host, res.requestId)
            return
          }
          if (!res.ok) {
            fail(res.error, res.retryAfterSeconds)
            return
          }
          run.requestId = res.requestId
          const early = run.queue
          run.queue = []
          for (const ev of early) if (ev.requestId === res.requestId) apply(run, ev)
        },
        () => fail('error'),
      )
    },
    [apply, cancelRun, settle],
  )

  const stop = useCallback(() => {
    if (!runRef.current) return
    cancelRun()
    setState((s) =>
      s.status === 'streaming' ? { ...s, status: 'stopped', reloadTick: s.reloadTick + 1 } : s,
    )
    settle('stopped')
    // the server stores the question and the partial answer with the stopped notice
    if (turnConversation.current) {
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null
        setState((s) => ({ ...s, reloadTick: s.reloadTick + 1 }))
      }, STOP_RELOAD_MS)
    }
  }, [cancelRun, settle])

  /** asks the last question again with the same options */
  const retry = useCallback(() => {
    if (lastInput.current) ask(lastInput.current)
  }, [ask])

  /** back to idle (New chat): cancels what runs and forgets the turn */
  const reset = useCallback(() => {
    cancelRun()
    lastInput.current = null
    turnConversation.current = null
    setState((s) => ({ ...IDLE, reloadTick: s.reloadTick }))
  }, [cancelRun])

  return { state, ask, stop, retry, reset }
}

/** the hook's return, for the panel and the thread to share */
export type AskUniStreamHandle = ReturnType<typeof useAskUniStream>
export type AskStreamApi = AskUniStreamHandle

/**
 * The composer is disabled while a turn streams: focus moves to Stop, and comes back to the
 * composer when the turn ends, unless the user has put it somewhere else meanwhile.
 */
export function useStreamFocus(
  streaming: boolean,
  getStop: () => HTMLElement | null,
  getComposer: () => HTMLElement | null,
): void {
  const was = useRef(false)
  const getters = useRef({ getStop, getComposer })
  getters.current = { getStop, getComposer }
  useEffect(() => {
    if (streaming && !was.current) {
      getters.current.getStop()?.focus()
    } else if (!streaming && was.current) {
      const active = document.activeElement
      if (!active || active === document.body) getters.current.getComposer()?.focus()
    }
    was.current = streaming
  }, [streaming])
}
