import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../locale'
import { v2Bridge } from './bridge'
import type {
  AskUniCitation,
  AskUniMessage,
  AskUniStreamEvent,
  AskUniStreamRequest,
  AskUniV2ErrorCode,
} from '../../../shared/askuni-api'

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
export type AskUniAskInput = Omit<AskUniStreamRequest, 'workspaceId' | 'locale'> & {
  locale?: 'vi' | 'en'
}

export interface UseAskUniStreamOptions {
  /** null = no workspace yet: an ask fails with `error` */
  workspaceId: string | null
  /** `run` named the conversation (a new one has no id before): the owner keeps it */
  onConversation?: (conversationId: string) => void
  /** the turn ended (done, Stop or error): refresh history, quota, ... */
  onSettled?: (info: {
    status: 'done' | 'stopped' | 'error'
    conversationId: string | null
  }) => void
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
 * Drives one streamed Ask UNI turn at a time over the main-process session. A newer ask, an unmount
 * or a workspace switch cancels the older request; its late events no longer count.
 */
export function useAskUniStream(options: UseAskUniStreamOptions) {
  const { lang } = useI18n()
  const [state, setState] = useState<AskStreamState>(IDLE)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const langRef = useRef(lang)
  langRef.current = lang
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
    if (run?.requestId) {
      try {
        void v2Bridge()
          .askUniStreamCancel?.({ requestId: run.requestId })
          ?.then(undefined, () => undefined)
      } catch {
        /* a bridge that throws synchronously has nothing left to cancel */
      }
    }
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
    const subscribe = v2Bridge().onAskUniStreamEvent
    const off = subscribe?.((ev) => {
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
      const b = v2Bridge()
      const wsId = optionsRef.current.workspaceId
      if (!wsId || !b.askUniStream) {
        fail('error')
        return
      }
      const locale = input.locale ?? (langRef.current === 'vi' ? 'vi' : 'en')
      b.askUniStream({ ...input, workspaceId: wsId, locale }).then(
        (res) => {
          if (runRef.current !== run) {
            // replaced or stopped while the start was in flight: the request is still running in main
            if (res.ok) void b.askUniStreamCancel?.({ requestId: res.requestId })?.catch(() => {})
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
