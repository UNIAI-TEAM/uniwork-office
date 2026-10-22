import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AskUniAdapterProvider, type AskUniAdapter, type AskUniStringKey } from '@genoffice/ui'
import { useI18n, type StringKey } from '../locale'
import type { AskUniStreamRequest } from '../../../shared/askuni-api'
import { bridgeFeedback, openCitationSource, v2Bridge } from './bridge'

/**
 * The shared Ask UNI core (packages/ui) over the Home shell: window.aiOffice for the session and
 * the shell's own i18n for the words. Built per render: the bridge is read at call time (a preload
 * may lack a method) and the shell's `t` is not referentially stable.
 */
export function useShellAskUniAdapter(): AskUniAdapter {
  const { t, lang } = useI18n()
  return {
    stream: (req) => {
      const call = v2Bridge().askUniStream
      return call
        ? call(req as AskUniStreamRequest)
        : Promise.resolve({ ok: false as const, error: 'error' as const })
    },
    cancel: (requestId) => v2Bridge().askUniStreamCancel?.({ requestId }),
    onEvent: (cb) => v2Bridge().onAskUniStreamEvent?.(cb),
    // Home loads a conversation of its workspace through its own loader (AskUniThread's prop)
    loadMessages: () => Promise.reject(new Error('Home loads messages through its own loader')),
    feedbackSet: (req) => bridgeFeedback.set(req),
    feedbackClear: (req) => bridgeFeedback.clear(req),
    openCitation: (c) => openCitationSource(c),
    t: (key: AskUniStringKey, params) => t(key as StringKey, params),
    lang,
  }
}

/** gives the shared components under it the shell adapter; the shell wrappers each mount one */
export function ShellAskUniScope(props: { children?: ReactNode }): ReactElement {
  return createElement(AskUniAdapterProvider, { adapter: useShellAskUniAdapter() }, props.children)
}
