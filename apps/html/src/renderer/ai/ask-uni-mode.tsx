import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { AskUniDocBridge, AskUniDocFlags } from '@genoffice/ai-provider/askuni'
import {
  AskUniEditorBody,
  askUniText,
  createAskUniDocAdapter,
  useAskUniDocFlags,
} from '@genoffice/ui'

/** window.uniworkAskUniDoc: exposed by the preload; absent in the web frame build */
function readBridge(): AskUniDocBridge | undefined {
  return (window as Window & { uniworkAskUniDoc?: AskUniDocBridge }).uniworkAskUniDoc
}

/** the file name the panel already shows; never a path or an id */
function fileNameOf(filePath: string | null | undefined): string {
  if (!filePath) return ''
  return filePath.split(/[\\/]/).pop() ?? ''
}

export interface AskUniMode {
  bridge: AskUniDocBridge | undefined
  flags: AskUniDocFlags | null
  /** the toggle shows: the bridge exists and the ask_uni_stream flag is on */
  available: boolean
  /** Ask UNI is the panel body right now */
  on: boolean
  /** Ask UNI was opened once: the body stays mounted (hidden) so its conversation survives the toggle */
  opened: boolean
  toggle: () => void
}

/**
 * Panel mode state for "Ask UNI". What the tab is bound to (a UniWork document, a local file, ...)
 * is read from main through the bridge and read again when the file changes and each time the mode
 * is switched on, so a file saved to UniWork in between is picked up.
 */
export function useAskUniMode(filePath: string | null | undefined): AskUniMode {
  const bridge = readBridge()
  const [wanted, setWanted] = useState(false)
  const [opened, setOpened] = useState(false)
  const [switchedOn, setSwitchedOn] = useState(0)
  const pathKey = useRef({ path: filePath, n: 0 })
  if (pathKey.current.path !== filePath) {
    pathKey.current = { path: filePath, n: pathKey.current.n + 1 }
  }
  const flags = useAskUniDocFlags(bridge, pathKey.current.n + switchedOn)
  const available = bridge !== undefined && flags?.streamEnabled === true
  const on = available && wanted
  useEffect(() => {
    if (on) setOpened(true)
  }, [on])
  return {
    bridge,
    flags,
    available,
    on,
    opened,
    toggle: () => {
      if (!wanted) setSwitchedOn((n) => n + 1)
      setWanted(!wanted)
    },
  }
}

function IconAskUni(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 8.6V4.2a1.7 1.7 0 0 0-1.7-1.7H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h3.9a1.7 1.7 0 0 0 1.7-1.7z" />
      <path d="M8 5v3.2M6.4 6.6h3.2" />
    </svg>
  )
}

/** the header button next to the side button; the label is the Ask UNI name the body already uses */
export function AskUniModeToggle({
  mode,
  lang,
}: {
  mode: AskUniMode
  lang: Parameters<typeof askUniText>[0]
}): ReactElement {
  const label = askUniText(lang, 'askUniDocRegion')
  return (
    <button
      type="button"
      className="ai-header-btn ai-askuni-mode"
      aria-pressed={mode.on}
      aria-label={label}
      data-tip={label}
      onClick={mode.toggle}
    >
      <IconAskUni />
    </button>
  )
}

/** the shared editor body over this window's bridge; only the file name and the live setter come from the panel */
export function AskUniModeBody({
  mode,
  filePath,
  lang,
  onLiveStatus,
}: {
  mode: AskUniMode
  filePath: string | null | undefined
  lang: Parameters<typeof askUniText>[0]
  onLiveStatus: (text: string) => void
}): ReactElement | null {
  const { bridge } = mode
  const adapter = useMemo(
    () =>
      bridge
        ? createAskUniDocAdapter(bridge, (key, params) => askUniText(lang, key, params), lang)
        : null,
    [bridge, lang],
  )
  if (!adapter) return null
  return (
    <AskUniEditorBody
      adapter={adapter}
      flags={mode.flags}
      documentName={fileNameOf(filePath)}
      onLiveStatus={onLiveStatus}
    />
  )
}
