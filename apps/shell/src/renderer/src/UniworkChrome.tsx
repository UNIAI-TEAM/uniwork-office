import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import type { UniworkDocStatus } from '../../shared/home-api'
import { asSyncCenterSnapshot } from '../../shared/sync-center'
import { useI18n, type StringKey } from './locale'
import { useAccount } from './account-model'
import { onLocalRename, onUniworkNotice } from './uniwork-notice-bus'
import { onDocRenamed, saveLocalCopy } from './uniwork-library-api'
import { ActionModal } from './UniworkDocActions'
import {
  DISCUSSION_PANEL_ID,
  DISCUSSION_TOGGLE_ID,
  discussionBridge,
  discussionTargetOf,
  setDiscussionOpen,
  useDiscussionOpen,
} from './discussion-panel-model'
import { collabStrings } from '@genoffice/ui/collab'
import { showsProfile } from './account-model'
import {
  FOCUS_TIP_MIN_PX,
  chipCopy,
  chipModelOf,
  focusTipRoomOf,
  launchNoticeOf,
  miniGlyphOf,
  type MiniGlyph,
  pathKey,
  remoteBarModelOf,
  saveBlockCopyOf,
  sizeWarnTextOf,
  type ChipActionKind,
  type LaunchNotice,
  type RemoteBarAction,
} from './uniwork-docs-model'
import { UniworkConflictHost } from './UniworkConflictDialog'
import { SaveDialogHost } from './uniwork-folders/SaveDialog'
import { UniworkQueuePopover } from './UniworkQueuePopover'
import {
  failedReasonKeyOf,
  findQueueRow,
  isQueuePopoverState,
  type QueuePopoverOpener,
} from './queue-popover-model'
import { announce } from './uniwork-live'
import {
  measurePillFit,
  pillFitStepOf,
  shortLabelOf,
  warnChipMaxOf,
  type PillVariant,
  type PillWidths,
  type ToggleWidths,
} from './uniwork-pill-fit'
import {
  popoverRoomOf,
  setTopInsetPart,
  uiScaleOf,
  unscaledHeightOf,
  useTopInsetPart,
} from './uniwork-top-inset'
import type { SyncCenterRow } from '../../shared/sync-center'

/**
 * UniWork pieces of the tab strip. The strip is shell DOM that stays visible
 * above the editor views, so this is where a bound document's save state and
 * the "opening from UniWork" progress can be seen whatever tab is active.
 */

function Spinner() {
  return (
    <svg className="uw-spinner" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeDasharray="26"
        strokeDashoffset="18"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** the dot of the mini pill: a shape per state, so the state is never told by colour alone */
function MiniGlyphIcon({ glyph }: { glyph: MiniGlyph }) {
  const draw = (children: ReactNode) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
  let icon: ReactNode
  switch (glyph) {
    case 'check':
      icon = draw(<path d="M3.5 8.5l3 3 6-7" />)
      break
    case 'clock':
      icon = draw(
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.2l2 1.3" />
        </>,
      )
      break
    case 'pause':
      icon = draw(<path d="M6 4.5v7M10 4.5v7" />)
      break
    case 'alert':
      icon = draw(
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.8v3.8M8 11.2h.01" />
        </>,
      )
      break
    case 'warn':
      icon = draw(<path d="M8 2.8l6 10.4H2zM8 6.6v3M8 11.5h.01" />)
      break
    case 'lock':
      icon = draw(
        <>
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
          <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />
        </>,
      )
      break
    case 'offline':
      icon = draw(
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M3.8 3.8l8.4 8.4" />
        </>,
      )
      break
    case 'busy':
      icon = <Spinner />
      break
    default:
      icon = draw(<circle cx="8" cy="8" r="4.5" />)
  }
  return (
    <span className="uw-pill-mini-glyph" data-glyph={glyph} aria-hidden="true">
      {icon}
    </span>
  )
}

export interface UniworkStatuses {
  /** the UniWork status of the document behind this path; null for a plain local file */
  statusOf(path: string | undefined): UniworkDocStatus | null
  /** the status of this path was read (null then means a plain local file, not "not read yet") */
  isKnown(path: string | undefined): boolean
  /** take a status main just answered with (after Retry / Resolve) */
  apply(status: UniworkDocStatus): void
}

/**
 * Status of every open tab's document, from main: read once per path, then
 * kept current by the pushed changes. A push always wins over a read that was
 * already in flight (the read may describe an older moment).
 */
export function useUniworkStatuses(tabs: TabSummary[]): UniworkStatuses {
  const [byPath, setByPath] = useState<ReadonlyMap<string, UniworkDocStatus | null>>(new Map())
  const mapRef = useRef(byPath)
  mapRef.current = byPath
  /** bumped by every push for a path; a read started before it is dropped */
  const pushes = useRef(new Map<string, number>())
  const anyPush = useRef(0)

  const apply = useCallback((status: UniworkDocStatus) => {
    const key = pathKey(status.path)
    pushes.current.set(key, (pushes.current.get(key) ?? 0) + 1)
    anyPush.current++
    setByPath((prev) => new Map(prev).set(key, status))
  }, [])

  useEffect(() => window.aiOffice.onUniworkDocStatus(apply), [apply])

  const paths = tabs.flatMap((tab) => (tab.filePath ? [tab.filePath] : []))
  const pathsKey = paths.map(pathKey).join('\n')
  const activePath = tabs.find((tab) => tab.active)?.filePath

  useEffect(() => {
    const wanted = new Set(pathsKey ? pathsKey.split('\n') : [])
    setByPath((prev) => {
      if (![...prev.keys()].some((key) => !wanted.has(key))) return prev
      return new Map([...prev].filter(([key]) => wanted.has(key)))
    })
    for (const path of paths) {
      const key = pathKey(path)
      if (mapRef.current.has(key)) continue
      const seen = pushes.current.get(key) ?? 0
      void window.aiOffice
        .uniworkDocStatus(path)
        .then((status) => {
          if ((pushes.current.get(key) ?? 0) !== seen) return
          setByPath((prev) => (prev.has(key) ? prev : new Map(prev).set(key, status)))
        })
        .catch(() => undefined)
    }
    // the paths are compared through their key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  // the active tab's state is read again when the tab changes (main's view of "active")
  useEffect(() => {
    if (!activePath) return
    const seen = anyPush.current
    void window.aiOffice
      .uniworkActiveDocStatus()
      .then((status) => {
        if (status && anyPush.current === seen) apply(status)
      })
      .catch(() => undefined)
  }, [activePath, apply])

  const statusOf = useCallback(
    (path: string | undefined) => (path ? (byPath.get(pathKey(path)) ?? null) : null),
    [byPath],
  )
  const isKnown = useCallback(
    (path: string | undefined) => (path ? byPath.has(pathKey(path)) : false),
    [byPath],
  )
  return { statusOf, isKnown, apply }
}

/** small marker on the tab icon of a UniWork document */
export function UniworkTabMarker({ status }: { status: UniworkDocStatus }) {
  const { t } = useI18n()
  const model = chipModelOf(status)
  return (
    <span
      className="uw-tab-marker"
      data-tone={model.tone}
      role="img"
      aria-label={t('uwTabMarker')}
      title={t('uwTabMarker')}
    />
  )
}

/** save states in which the waiting save has a time worth showing in the tooltip */
const QUEUED_STATES: ReadonlySet<UniworkDocStatus['state']> = new Set([
  'queued',
  'paused_offline',
  'paused_user',
])

/**
 * The sync center row of this document (G5-10) while the pill reads from it: the time of a
 * waiting save, the reason of a failed one. None without the sync center.
 */
function useQueueRowOf(status: UniworkDocStatus): SyncCenterRow | undefined {
  const [row, setRow] = useState<SyncCenterRow | undefined>(undefined)
  const wanted = QUEUED_STATES.has(status.state) || status.state === 'failed'
  const documentId = status.documentId
  useEffect(() => {
    const api = window.uniworkSyncCenter
    if (!wanted || !api) {
      setRow(undefined)
      return
    }
    let live = true
    const take = (value: unknown) => {
      if (live) setRow(findQueueRow(asSyncCenterSnapshot(value), documentId))
    }
    void api
      .getSnapshot()
      .then(take)
      .catch(() => undefined)
    const unsubscribe = api.subscribe(take)
    return () => {
      live = false
      unsubscribe()
    }
  }, [wanted, documentId])
  return row
}

/**
 * Whether the Discussion toggle beside the pill is icon-only. The pill's fit decides it (the toggle
 * is the next thing to give when even the compact pill leaves the strip below its floor), the
 * toggle, a sibling in the holder, reads it. Without a scope around the holder the toggle stays full.
 */
const ToggleFitContext = createContext<{
  iconOnly: boolean
  setIconOnly: (value: boolean) => void
}>({ iconOnly: false, setIconOnly: () => undefined })

/** the holder's scope: the pill's fit writes whether the toggle is icon-only, the toggle reads it */
export function PillFitScope({ children }: { children: ReactNode }) {
  const [iconOnly, setIconOnly] = useState(false)
  const value = useMemo(() => ({ iconOnly, setIconOnly }), [iconOnly])
  return <ToggleFitContext.Provider value={value}>{children}</ToggleFitContext.Provider>
}

/**
 * Which variant of the pill the tab bar has room for (U-1), and whether the Discussion toggle beside
 * it gives up its label. The pill is drawn in its full form, measured against the room the strip can
 * spare, and stepped down (short label, then dot + action, then an icon-only toggle) until it fits;
 * a variant already measured is not drawn again to find out. It measures again when the label or the
 * interface scale changes, on a window resize, when the bar or the holder changes size, and when a
 * tab opens or closes or the holder gains or loses a part. A host with no layout to measure keeps the
 * full pill. The effect runs before paint, so the steps are never seen.
 */
function usePillFit(
  groupRef: RefObject<HTMLDivElement | null>,
  key: string,
  hasShort: boolean,
  hasWarn = false,
): { variant: PillVariant; warnMax: number | null } {
  const { iconOnly: drawnIconOnly, setIconOnly: publish } = useContext(ToggleFitContext)
  const [variant, setVariant] = useState<PillVariant>('full')
  const [iconToggle, setIconToggle] = useState(false)
  const [warnMax, setWarnMax] = useState<number | null>(null)
  // bumped by whatever changes the room (a resize, a tab, the holder's size): measure again
  const [pass, setPass] = useState(0)
  const widths = useRef<PillWidths>({})
  const toggleWidths = useRef<ToggleWidths>({})
  const lastKey = useRef('')

  useLayoutEffect(() => {
    const el = groupRef.current
    if (!el) return
    const measuredKey = `${key}
${uiScaleOf(el)}`
    if (lastKey.current !== measuredKey) {
      // another label (or scale): the widths measured so far describe something else
      lastKey.current = measuredKey
      widths.current = {}
      toggleWidths.current = {}
      if (variant !== 'full' || iconToggle) {
        setVariant('full')
        setIconToggle(false)
        return
      }
    }
    const fit = measurePillFit(el)
    if (!fit) {
      widths.current = {}
      toggleWidths.current = {}
      if (variant !== 'full') setVariant('full')
      if (iconToggle) setIconToggle(false)
      if (warnMax !== null) setWarnMax(null)
      return
    }
    widths.current[variant] = fit.natural
    // the toggle as it is drawn right now (the DOM is the truth, the state may be one commit ahead)
    if (fit.toggle) toggleWidths.current[fit.toggle.iconOnly ? 'icon' : 'full'] = fit.toggle.width
    else toggleWidths.current = {}
    const next = pillFitStepOf({
      budget: fit.budget,
      toggle: fit.toggle,
      toggleWidths: toggleWidths.current,
      widths: widths.current,
      hasShort,
      miniSlack: fit.miniSlack,
    })
    if (next.variant !== variant) setVariant(next.variant)
    if (next.iconToggle !== iconToggle) setIconToggle(next.iconToggle)
    const nextWarnMax =
      fit.warnRoom === null
        ? null
        : warnChipMaxOf({
            room: fit.warnRoom,
            pillWidth: widths.current[next.variant] ?? fit.natural,
            scale: fit.scale,
          })
    if (nextWarnMax !== warnMax) setWarnMax(nextWarnMax)
    // drawnIconOnly: the toggle took its new form (the sibling re-rendered), measure it as drawn
  }, [groupRef, key, variant, iconToggle, drawnIconOnly, hasShort, hasWarn, warnMax, pass])

  // the toggle (a sibling) reads it; it goes back to its full form with this pill
  useLayoutEffect(() => {
    publish(iconToggle)
  }, [iconToggle, publish])
  useLayoutEffect(() => () => publish(false), [publish])

  useEffect(() => {
    const el = groupRef.current
    const chrome = el?.parentElement
    const bar = chrome?.parentElement
    const strip = bar
      ? (Array.from(bar.children).find((child) => child.classList.contains('tab-strip')) ?? null)
      : null
    // no tab strip beside the holder (a chip shown elsewhere): there is no room to share
    if (!strip) return undefined
    const again = () => setPass((n) => n + 1)
    window.addEventListener('resize', again)
    // a tab opening or closing changes the floor the strip keeps; the Discussion toggle or a
    // notice joining the holder changes what is left for the pill
    const tabs = typeof MutationObserver !== 'undefined' ? new MutationObserver(again) : null
    tabs?.observe(strip, { childList: true })
    if (chrome) tabs?.observe(chrome, { childList: true })
    // the strip changing form (G5-06u-TS) moves Home's width and the tabs' minimum without a
    // child coming or going, and maybe without the bar changing size
    if (bar) tabs?.observe(bar, { attributes: true, attributeFilter: ['data-strip'] })
    // the holder changing size (the Discussion toggle or a notice coming and going) moves the budget;
    // answered in the next frame so a size change caused by this very step is not reported in the same one
    let frame = 0
    let sizes: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && bar && chrome) {
      sizes = new ResizeObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(again)
      })
      sizes.observe(bar)
      sizes.observe(chrome)
    }
    return () => {
      window.removeEventListener('resize', again)
      tabs?.disconnect()
      sizes?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [groupRef])

  return { variant, warnMax }
}

/** the states whose arrival is said to a screen reader at once (EXPERIENCE: blocked, failed, conflict) */
function isUrgent(status: UniworkDocStatus, labelKey: StringKey): boolean {
  return status.state === 'failed' || labelKey === 'uwChipBlocked' || labelKey === 'uwChipConflict'
}

/**
 * Saved / Unsaved / Saving / Queued / Blocked / Error ... for the active tab (Save pill, S1).
 *
 * One reading channel: the label is plain text; the explanation is a visually hidden node that the
 * button, or the pill itself when it has no button, points at through aria-describedby (read
 * once: aria-describedby wins over title). Sighted users get the native title tooltip on hover,
 * which Electron draws above the editor view (shell DOM below the 40px strip would be covered by
 * it). Chromium shows no title on keyboard focus, so a focus-visible pill also shows the sentence
 * in up to two lines inside the strip, over the tab titles left of it (aria-hidden: it is the
 * description again), never wider than the room between the window edge and the pill; Esc or
 * pointer use hides it until the pill is focused again.
 * A change of the pill is said once through the window live host. The
 * queue states open the queue popover (S4); so does Ctrl/Cmd+S on a waiting save (main pushes
 * the request, the chip of the active document opens it).
 */
export function UniworkStatusChip({
  status,
  onStatus,
}: {
  status: UniworkDocStatus
  onStatus: (status: UniworkDocStatus) => void
}) {
  const { t, dateLocale } = useI18n()
  const account = useAccount()
  const tipId = useId()
  // the dot alone is named by these two hidden texts (aria-labelledby): the full label, then the action
  const nameId = useId()
  const actionNameId = useId()
  const [busy, setBusy] = useState(false)
  const [popover, setPopover] = useState<QueuePopoverOpener | null>(null)
  const [ctrlS, setCtrlS] = useState(0)
  const [tipOff, setTipOff] = useState(false)
  const [tipRoom, setTipRoom] = useState<number | null>(null)
  const [focusWithin, setFocusWithin] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const accountOk = account.view === 'signed-in' || account.view === 'refreshing'
  const row = useQueueRowOf(status)
  const queuedAt = QUEUED_STATES.has(status.state) ? row?.savedAt : undefined
  const failedReasonKey = status.state === 'failed' ? failedReasonKeyOf(status, row) : undefined
  const maxBytes = row?.maxBytes ?? status.maxBytes
  const model = chipModelOf(status, {
    needsSignIn: !accountOk,
    queuedAt,
    failedReasonKey,
    maxBytes,
  })
  const { label, tip, title } = chipCopy(model, t, dateLocale)
  const action = model.action
  const shortLabel = shortLabelOf(label)
  const glyph = miniGlyphOf(model, status.state)
  const [warnDismissedFor, setWarnDismissedFor] = useState<string | null>(null)
  const [, setBlockTick] = useState(0)
  const blockLatchRef = useRef<{
    path: string
    open: boolean
    lastToken: string | null
    wasPrompting: boolean
    maxBytes?: number
  }>({
    path: '',
    open: false,
    lastToken: null,
    wasPrompting: false,
  })
  const [savingLocal, setSavingLocal] = useState(false)
  const blockTitleId = useId()
  const blockBodyId = useId()

  // Latch the save-block dialog in the renderer (SIZE-fe-d2-2): open on the
  // rising edge of a new prompt (keyed by monotonic saveTooLargePromptSeq, or
  // size/rising-edge when seq is absent), keep open across status publishes
  // that omit the one-shot flag, and close only on Close, a successful local
  // copy, a document switch, or a later `saved` state.
  const currentPath = pathKey(status.path)
  const hasPrompt = Boolean(status.saveTooLargePrompt)
  const hasExplicitSeq = typeof status.saveTooLargePromptSeq === 'number'
  const promptToken = hasPrompt
    ? `${currentPath}#${
        hasExplicitSeq
          ? `seq:${status.saveTooLargePromptSeq}`
          : `size:${status.sizeBytes ?? 0}:${status.maxBytes ?? 0}`
      }`
    : null
  if (blockLatchRef.current.path !== currentPath) {
    blockLatchRef.current = {
      path: currentPath,
      open: false,
      lastToken: null,
      wasPrompting: false,
      maxBytes: undefined,
    }
  }
  if (status.state === 'saved') {
    blockLatchRef.current.open = false
    blockLatchRef.current.lastToken = null
    blockLatchRef.current.wasPrompting = false
  } else if (promptToken !== null) {
    if (promptToken !== blockLatchRef.current.lastToken) {
      blockLatchRef.current.lastToken = promptToken
      blockLatchRef.current.open = true
    }
    blockLatchRef.current.wasPrompting = true
  } else {
    if (blockLatchRef.current.wasPrompting && blockLatchRef.current.lastToken?.includes('#size:')) {
      blockLatchRef.current.lastToken = null
    }
    blockLatchRef.current.wasPrompting = false
  }
  if (maxBytes !== undefined) {
    blockLatchRef.current.maxBytes = maxBytes
  }
  const closeSaveBlock = useCallback(() => {
    if (!blockLatchRef.current.open) return
    blockLatchRef.current.open = false
    setBlockTick((n) => n + 1)
    if (popoverRef.current) {
      const popEl = document.querySelector<HTMLElement>('.uw-queue-pop')
      const target = popEl?.isConnected
        ? popEl
        : buttonRef.current?.isConnected
          ? buttonRef.current
          : groupRef.current
      target?.focus()
      return
    }
    window.aiOfficeTabs?.focusActive()
  }, [])

  useEffect(() => {
    if (!status.sizeWarn && status.state === 'saved') {
      setWarnDismissedFor(null)
    }
  }, [status.path, status.sizeWarn, status.state])

  const warnKey = status.sizeWarn ? `${currentPath}:${status.sizeWarn.maxBytes}` : null
  const showSizeWarn = Boolean(status.sizeWarn && warnKey && warnDismissedFor !== warnKey)
  const sizeWarnText = showSizeWarn ? sizeWarnTextOf(status.sizeWarn, t, dateLocale) : null
  const { variant, warnMax } = usePillFit(
    groupRef,
    `${label}
${action ? t(action.labelKey) : ''}`,
    shortLabel !== label,
    Boolean(sizeWarnText && warnKey),
  )
  const showSaveBlock = blockLatchRef.current.open
  const saveBlockCopy = showSaveBlock
    ? saveBlockCopyOf(blockLatchRef.current.maxBytes, t, dateLocale)
    : null
  const blockBandRef = useRef<HTMLDivElement>(null)
  const barPx = useTopInsetPart('bar')
  const popoverPx = useTopInsetPart('popover')
  const blockAbovePx = barPx + popoverPx
  const blockRoom = popoverRoomOf(blockAbovePx)
  const blockRoomRef = useRef(blockRoom)
  useLayoutEffect(() => {
    blockRoomRef.current = blockRoom
  })
  useLayoutEffect(() => {
    const band = blockBandRef.current
    if (!showSaveBlock || !band) {
      setTopInsetPart('saveBlock', 0)
      return
    }
    const measure = () => {
      setTopInsetPart('saveBlock', Math.min(unscaledHeightOf(band), blockRoomRef.current))
    }
    measure()
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(band)
    }
    return () => {
      observer?.disconnect()
      setTopInsetPart('saveBlock', 0)
    }
  }, [showSaveBlock])
  useLayoutEffect(() => {
    const band = blockBandRef.current
    if (!showSaveBlock || !band) return
    setTopInsetPart('saveBlock', Math.min(unscaledHeightOf(band), blockRoom))
  }, [showSaveBlock, blockRoom])

  // the button never leaves while focus is on it without the pill taking the focus first (a
  // callback ref runs before the node is removed; focus dropped to <body> would lose the place).
  // A step that replaces the button (compact <-> the dot) gives the focus to the new one right
  // after the commit, below. The button is also state, so the queue popover's opener is the node
  // that is drawn now, not the one of the render before it.
  const [buttonEl, setButtonEl] = useState<HTMLButtonElement | null>(null)
  const focusFollows = useRef(false)
  const setButton = useCallback((el: HTMLButtonElement | null) => {
    const previous = buttonRef.current
    buttonRef.current = el
    setButtonEl(el)
    if (!el && previous && document.activeElement === previous) {
      focusFollows.current = true
      groupRef.current?.focus()
    }
  }, [])
  // after the commit that swapped the button (the refs are set before this runs): the focus the old
  // button had goes to the new one. Only that commit counts; a button that comes later (a waiting
  // save after a settled one) never takes a focus the user has put elsewhere.
  useLayoutEffect(() => {
    if (!focusFollows.current) return
    focusFollows.current = false
    buttonRef.current?.focus()
  })

  // one sentence per change of this document's pill, none when the pill first shows (a tab
  // switch mounts another chip: the chip is keyed by path)
  const signature = `${status.path}\n${model.labelKey}\n${model.reasonKey ?? ''}\n${status.state}`
  const lastSignature = useRef(signature)
  const lastPendingNext = useRef(Boolean(status.pendingNext))
  const labelRef = useRef(label)
  labelRef.current = label
  const popoverRef = useRef(popover)
  popoverRef.current = popover
  useEffect(() => {
    const pendingNextArrived = !lastPendingNext.current && Boolean(status.pendingNext)
    lastPendingNext.current = Boolean(status.pendingNext)
    if (lastSignature.current === signature) return
    const [lastPath, , , lastState] = lastSignature.current.split('\n')
    lastSignature.current = signature
    if (lastPath !== status.path) return
    // a newer version waiting behind the same save only comes from Ctrl/Cmd+S, which main follows
    // with the queue popover: its line 1 is the one sentence of that press. A popover the pill
    // already opened stays as it is and says nothing again, so then the pill says it.
    if (pendingNextArrived && lastState === status.state && popoverRef.current !== 'pill') return
    announce(t('uwSyncRowAnnounce', { doc: status.title, state: labelRef.current }), {
      assertive: isUrgent(status, model.labelKey),
    })
    // t is not referentially stable (CLAUDE.md): the key is the dependency, the text is made now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, status.pendingNext])

  const sizeWarnTextRef = useRef(sizeWarnText)
  sizeWarnTextRef.current = sizeWarnText
  const lastAnnouncedWarnKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!showSizeWarn || !warnKey) {
      if (!warnKey) lastAnnouncedWarnKeyRef.current = null
      return
    }
    if (lastAnnouncedWarnKeyRef.current === warnKey) return
    lastAnnouncedWarnKeyRef.current = warnKey
    if (sizeWarnTextRef.current) {
      announce(sizeWarnTextRef.current)
    }
  }, [showSizeWarn, warnKey])

  // Ctrl/Cmd+S on a document with a waiting save: main asks for the popover (a conflict opens the
  // resolve choice instead). This chip only exists for the active tab, so another path is ignored.
  useEffect(
    () =>
      window.aiOffice.onUniworkQueuePopover((request) => {
        if (pathKey(request.path) === pathKey(status.path)) setCtrlS((n) => n + 1)
      }),
    [status.path],
  )
  const statusRef = useRef(status)
  statusRef.current = status
  useEffect(() => {
    if (ctrlS === 0) return
    const current = statusRef.current
    if (current.state === 'conflict') {
      setBusy(true)
      void window.aiOffice
        .uniworkResolveConflict(current.path)
        .then((next) => {
          if (next) onStatus(next)
        })
        .catch(() => undefined)
        .finally(() => setBusy(false))
      return
    }
    // a status that settled in between (no waiting save any more) has nothing to say; a popover
    // the pill opened stays the pill's (Esc goes back to the pill button)
    if (isQueuePopoverState(current)) setPopover((open) => open ?? 'ctrl-s')
    // only a new request counts, not a changed onStatus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrlS])

  const run = (kind: ChipActionKind) => {
    if (busy) return
    if (kind === 'sign-in') {
      account.signIn()
      return
    }
    if (kind === 'view-queue' || kind === 'details') {
      // the button controls the popover whatever opened it: a click on an open one closes it
      setPopover((open) => (open ? null : 'pill'))
      return
    }
    if (kind === 'stop-ai') {
      // the AI run a save waits for has no owner in main yet (`saveWait` is never set): nothing to stop
      return
    }
    setBusy(true)
    const call =
      kind === 'retry'
        ? window.aiOffice.uniworkSave(status.path)
        : kind === 'reload'
          ? window.aiOffice.uniworkRemoteAction(status.path, 'reload')
          : window.aiOffice.uniworkResolveConflict(status.path)
    void call
      .then((next) => {
        if (next) onStatus(next)
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  // the focus chip hangs left of the pill: its width is the room up to the window edge, measured
  // when the pill takes the focus and again on a resize while it has it
  const measureTip = useCallback(() => {
    const el = groupRef.current
    if (el) setTipRoom(focusTipRoomOf(el.getBoundingClientRect().left, uiScaleOf(el)))
  }, [])
  useEffect(() => {
    if (!focusWithin) return
    window.addEventListener('resize', measureTip)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && groupRef.current) {
      observer = new ResizeObserver(measureTip)
      observer.observe(groupRef.current)
    }
    return () => {
      window.removeEventListener('resize', measureTip)
      observer?.disconnect()
    }
  }, [focusWithin, measureTip])
  const tipStyle =
    tipRoom === null ? undefined : ({ '--uw-tip-room': `${tipRoom}px` } as CSSProperties)
  const warnStyle =
    warnMax === null ? undefined : ({ '--uw-warn-max': `${warnMax}px` } as CSSProperties)

  // the pill group is the keyboard stop only when it has no button to carry the description
  const describedHere = !action
  return (
    <>
      {sizeWarnText && warnKey && (
        <div
          className="uw-pill uw-size-warn"
          data-tone="warn"
          title={sizeWarnText}
          style={warnStyle}
        >
          <span className="uw-pill-status">
            <span className="uw-pill-dot" aria-hidden="true" />
            <span className="uw-pill-label">{sizeWarnText}</span>
          </span>
          <button
            type="button"
            className="uw-pill-close"
            aria-label={t('uwSizeWarnDismiss')}
            onClick={() => setWarnDismissedFor(warnKey)}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
      <div
        ref={groupRef}
        className="uw-pill"
        role="group"
        aria-label={t('uwChipAria')}
        data-tone={model.tone}
        data-state={status.state}
        data-variant={variant}
        tabIndex={describedHere ? 0 : -1}
        title={describedHere ? title : undefined}
        aria-describedby={describedHere ? tipId : undefined}
        data-tip-off={tipOff ? '' : undefined}
        data-tip-room={tipRoom !== null && tipRoom < FOCUS_TIP_MIN_PX ? 'none' : undefined}
        style={tipStyle}
        onFocus={() => {
          setTipOff(false)
          setFocusWithin(true)
          measureTip()
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusWithin(false)
          }
        }}
        onPointerDown={() => setTipOff(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTipOff(true)
        }}
      >
        <span id={tipId} className="uw-sr-only">
          {tip}
        </span>
        {variant === 'mini' ? (
          // the dot alone (the strip is below its floor even with the narrowest pill): with a button
          // the dot IS the button, named by the full label and the action; without one it is a plain dot
          action ? (
            <button
              ref={setButton}
              type="button"
              className="uw-pill-mini"
              aria-labelledby={`${nameId} ${actionNameId}`}
              aria-disabled={busy ? 'true' : undefined}
              aria-describedby={tipId}
              title={title}
              aria-expanded={
                action.kind === 'view-queue' || action.kind === 'details'
                  ? popover !== null
                  : undefined
              }
              onClick={() => run(action.kind)}
            >
              <MiniGlyphIcon glyph={glyph} />
              <span id={nameId} className="uw-sr-only">
                {label}
              </span>
              <span id={actionNameId} className="uw-sr-only">
                {t(action.labelKey)}
              </span>
            </button>
          ) : (
            <span className="uw-pill-status">
              <MiniGlyphIcon glyph={glyph} />
              <span className="uw-pill-label">
                <span className="uw-sr-only">{label}</span>
              </span>
            </span>
          )
        ) : (
          <>
            <span className="uw-pill-status">
              {model.tone === 'busy' ? (
                <Spinner />
              ) : (
                <span className="uw-pill-dot" aria-hidden="true" />
              )}
              {variant === 'full' ? (
                <span className="uw-pill-label">{label}</span>
              ) : (
                // fewer words drawn, the same sentence read: the hidden text is the whole label
                <span className="uw-pill-label">
                  <span className="uw-sr-only">{label}</span>
                  {variant === 'short' && <span aria-hidden="true">{shortLabel}</span>}
                </span>
              )}
            </span>
            {action && (
              <button
                ref={setButton}
                type="button"
                className="uw-pill-action"
                aria-disabled={busy ? 'true' : undefined}
                aria-describedby={tipId}
                title={title}
                aria-expanded={
                  action.kind === 'view-queue' || action.kind === 'details'
                    ? popover !== null
                    : undefined
                }
                onClick={() => run(action.kind)}
              >
                {t(action.labelKey)}
              </button>
            )}
          </>
        )}
        <span className="uw-pill-focus-tip" aria-hidden="true">
          <span className="uw-pill-focus-tip-text">{tip}</span>
        </span>
      </div>
      {popover && (
        <UniworkQueuePopover
          status={status}
          opener={popover}
          anchorEl={groupRef.current}
          openerEl={popover === 'pill' ? buttonEl : null}
          onClose={() => setPopover(null)}
          onSignIn={() => account.signIn()}
          onFocusEditor={() => window.aiOfficeTabs?.focusActive()}
        />
      )}
      {saveBlockCopy && (
        <div
          ref={blockBandRef}
          className="uw-save-block-band"
          data-uw-save-block-band=""
          style={
            {
              top: `calc(var(--tab-bar-height, 40px) + ${blockAbovePx}px)`,
              '--uw-save-block-room': `${blockRoom}px`,
            } as CSSProperties
          }
        >
          <ActionModal
            labelledBy={blockTitleId}
            describedBy={blockBodyId}
            className="uw-save-block-modal"
            initialFocus=".btn-primary"
            restoreFocus={false}
            onCancel={closeSaveBlock}
          >
            <h3 id={blockTitleId}>{saveBlockCopy.title}</h3>
            <p id={blockBodyId}>{saveBlockCopy.body}</p>
            <div className="modal-buttons">
              <button type="button" className="btn btn-secondary" onClick={closeSaveBlock}>
                {saveBlockCopy.close}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                aria-disabled={savingLocal ? 'true' : undefined}
                aria-busy={savingLocal ? 'true' : undefined}
                onClick={() => {
                  if (savingLocal) return
                  setSavingLocal(true)
                  void saveLocalCopy(status.path)
                    .then((saved) => {
                      if (saved) closeSaveBlock()
                    })
                    .catch(() => undefined)
                    .finally(() => setSavingLocal(false))
                }}
              >
                {saveBlockCopy.saveLocal}
              </button>
            </div>
          </ActionModal>
        </div>
      )}
    </>
  )
}

function NoticePill({ notice, onDismiss }: { notice: LaunchNotice; onDismiss: () => void }) {
  const { t } = useI18n()
  const account = useAccount()
  return (
    <div
      className="uw-pill uw-notice"
      data-tone={notice.tone}
      title={t(notice.messageKey, notice.params)}
    >
      <span className="uw-pill-status" role={notice.tone === 'error' ? 'alert' : 'status'}>
        {notice.tone === 'busy' ? <Spinner /> : <span className="uw-pill-dot" aria-hidden="true" />}
        <span className="uw-pill-label">{t(notice.messageKey, notice.params)}</span>
      </span>
      {notice.signIn && (
        <button type="button" className="uw-pill-action" onClick={() => account.signIn()}>
          {t('acctSignIn')}
        </button>
      )}
      {notice.tone !== 'busy' && (
        <button
          type="button"
          className="uw-pill-close"
          aria-label={t('uwLaunchDismiss')}
          onClick={onDismiss}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

/** "Opening from UniWork…", the sign-in prompt and failures of an open (web launch or recent) */
export function UniworkNotice({ openDocumentIds }: { openDocumentIds: ReadonlySet<string> }) {
  const [notice, setNotice] = useState<LaunchNotice | null>(null)

  useEffect(() => {
    const show = (event: Parameters<typeof launchNoticeOf>[0]) => setNotice(launchNoticeOf(event))
    const offLaunch = window.aiOffice.onUniworkLaunch(show)
    const offBus = onUniworkNotice(show)
    return () => {
      offLaunch()
      offBus()
    }
  }, [])

  useEffect(() => {
    if (!notice?.autoHideMs) return
    const timer = window.setTimeout(() => setNotice(null), notice.autoHideMs)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <>
      {notice && <NoticePill notice={notice} onDismiss={() => setNotice(null)} />}
      <RenamedAnnouncer openDocumentIds={openDocumentIds} />
      <UniworkConflictHost />
      <SaveDialogHost />
    </>
  )
}

/**
 * Polite announcement of a document's new name: a rename the person just made
 * in the library, or one from elsewhere for a document open in a tab (main
 * refreshed its metadata; the tab title follows from main). A feed push for a
 * document that is not open stays silent. The live region is always in the DOM
 * so screen readers pick changes up.
 */
function RenamedAnnouncer({ openDocumentIds }: { openDocumentIds: ReadonlySet<string> }) {
  const { t } = useI18n()
  const [name, setName] = useState<{ title: string; n: number } | null>(null)
  const openRef = useRef(openDocumentIds)
  openRef.current = openDocumentIds
  useEffect(() => {
    const say = (title: string) => setName((prev) => ({ title, n: (prev?.n ?? 0) + 1 }))
    const offFeed = onDocRenamed(({ documentId, title }) => {
      if (openRef.current.has(documentId)) say(title)
    })
    const offLocal = onLocalRename(say)
    return () => {
      offFeed()
      offLocal()
    }
  }, [])
  return (
    <span className="uw-sr-only" role="status" aria-live="polite">
      {name ? <span key={name.n}>{t('uwDocRenamedAnnounce', { name: name.title })}</span> : null}
    </span>
  )
}

/**
 * "Discussion" button of the tab strip: shown only for a UniWork document while signed in. A plain
 * local file (and a signed-out desktop) has no Discussion, so no button.
 */
export function DiscussionToggle({ status }: { status: UniworkDocStatus }) {
  const { lang } = useI18n()
  const account = useAccount()
  const open = useDiscussionOpen()
  const { iconOnly } = useContext(ToggleFitContext)
  const bridge = discussionBridge()
  if (!discussionTargetOf(status, showsProfile(account.view, account.status), bridge)) return null
  const label = collabStrings(lang).collabDiscussion
  return (
    <button
      type="button"
      id={DISCUSSION_TOGGLE_ID}
      className="uw-discussion-toggle"
      // the same name and tooltip whether or not the label is drawn (icon-only at the narrowest
      // widths, see usePillFit): the label stays in the button as visually hidden text
      title={label}
      data-icon-only={iconOnly ? 'true' : undefined}
      aria-expanded={open}
      aria-controls={open ? DISCUSSION_PANEL_ID : undefined}
      data-open={open ? 'true' : undefined}
      onClick={() => setDiscussionOpen(!open)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="uw-discussion-toggle-label">{label}</span>
    </button>
  )
}

// ── S6 new-version bar ──────────────────────────────────

/** one signature per bar state: a newer revision (another version) is a different bar */
function remoteSignature(status: UniworkDocStatus | null): string | null {
  if (status?.lockWhileOpen) return JSON.stringify(status.lockWhileOpen)
  return status?.remote ? JSON.stringify(status.remote) : null
}

/**
 * The identity of the notice a user closed or put off. A newer revision is the same notice
 * whatever it waits for (a commit in flight, a stuck one) and whether it is dirty or AI: only a
 * higher version is a new one. Every other kind is its whole state.
 */
function remoteNoticeKey(status: UniworkDocStatus | null): string | null {
  // a lock while open is its mode: the sentence changes with it, not with the lock's reason
  if (status?.lockWhileOpen) return `lock-while-open\n${status.lockWhileOpen.mode}`
  const remote = status?.remote
  if (!remote) return null
  if (remote.kind === 'newer-dirty' || remote.kind === 'newer-ai') return `newer\n${remote.version}`
  return JSON.stringify(remote)
}

interface RemoteSay {
  key: StringKey
  params: Record<string, string | number>
  assertive: boolean
  n: number
}

/**
 * The bar under the tab strip for the ACTIVE tab's document (one bar, never stacked; a second
 * notice replaces its version). The sentence on screen is not live: it is read once through
 * the window-level live nodes below, polite for a newer version, alert for the error kinds.
 * `Later` / `Close` hide the bar here at once and tell main; a bar that main later replaces
 * with another notice (a newer version, another kind) shows again.
 */
export function UniworkRemoteBar({
  status,
  onStatus,
}: {
  status: UniworkDocStatus | null
  onStatus: (status: UniworkDocStatus) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const model = status ? remoteBarModelOf(status) : null
  const path = status ? pathKey(status.path) : null
  const signature = remoteSignature(status)
  const noticeKey = remoteNoticeKey(status)
  // paths whose current notice was closed / put off, with the notice's identity
  const [hidden, setHidden] = useState<ReadonlyMap<string, string>>(new Map())
  const hiddenHere = path !== null && noticeKey !== null && hidden.get(path) === noticeKey
  const visible = Boolean(model) && !hiddenHere
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<RemoteSay | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const heightRef = useRef(0)

  const hide = useCallback(() => {
    if (path === null || noticeKey === null) return
    setHidden((prev) => new Map(prev).set(path, noticeKey))
  }, [path, noticeKey])

  const act = useCallback(
    (kind: RemoteBarAction['kind']) => {
      if (!status) return
      if (kind === 'later' || kind === 'close') hide()
      setBusy(true)
      void window.aiOffice
        .uniworkRemoteAction(status.path, kind)
        .then((next) => {
          if (next) onStatus(next)
        })
        .catch(() => undefined)
        .finally(() => setBusy(false))
    },
    [status, hide, onStatus],
  )

  // a closed bar is forgotten once the document has no bar, or another notice
  useEffect(() => {
    if (path === null || hidden.get(path) === undefined || hidden.get(path) === noticeKey) return
    setHidden((prev) => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [path, noticeKey, hidden])

  // announced once per notice of a document: coming back to a tab does not say it again, a bar
  // that went away (no remote) and returns does, and a hidden bar leaves no stale sentence behind
  const announced = useRef(new Map<string, string>())
  const shownKey = visible && model && path ? `${path}\n${signature}` : null
  const announceKey = visible && model && path && noticeKey ? `${path}\n${noticeKey}` : null
  const modelRef = useRef(model)
  modelRef.current = model
  useEffect(() => {
    if (path !== null && model === null) announced.current.delete(path)
  }, [path, model])
  useEffect(() => {
    const current = modelRef.current
    if (!announceKey || !current || path === null || noticeKey === null) {
      setSay(null)
      return
    }
    if (announced.current.get(path) === noticeKey) return
    announced.current.set(path, noticeKey)
    setSay((prev) => ({
      key: current.messageKey,
      params: current.params,
      assertive: current.tone === 'error',
      n: (prev?.n ?? 0) + 1,
    }))
  }, [announceKey, path, noticeKey])

  // an information bar hides itself unless the pointer or the focus is in it; leaving restarts the 8 s
  const autoHideMs = visible ? model?.autoHideMs : undefined
  const actRef = useRef(act)
  actRef.current = act
  useEffect(() => {
    if (!autoHideMs || hovered || focused || busy) return
    const timer = window.setTimeout(() => actRef.current('close'), autoHideMs)
    return () => window.clearTimeout(timer)
  }, [autoHideMs, hovered, focused, busy, shownKey])
  useEffect(() => {
    if (!visible) {
      setHovered(false)
      setFocused(false)
    }
  }, [visible])

  // main moves the active editor view down by the bar's unscaled CSS-px height (main multiplies by
  // the interface scale): 0 when there is no bar or no document tab. An open queue popover adds
  // its own height below the bar; the inset owner sends the sum.
  const report = useCallback((px: number) => setTopInsetPart('bar', px), [])
  useEffect(() => {
    const bar = barRef.current
    if (!visible || !bar) {
      heightRef.current = 0
      report(0)
      return
    }
    const cssHeight = () => {
      const rawScale = Number.parseFloat(
        getComputedStyle(bar).getPropertyValue('--ui-scale') ||
          document.documentElement.style.getPropertyValue('--ui-scale'),
      )
      const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1
      return Math.ceil(bar.getBoundingClientRect().height / scale)
    }
    const measure = () => {
      const px = cssHeight()
      if (px === heightRef.current) return
      heightRef.current = px
      report(px)
    }
    heightRef.current = cssHeight()
    report(heightRef.current)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
    // a tab switch sends the height again (the view that becomes active needs it)
  }, [visible, path, shownKey, report])
  useEffect(() => () => report(0), [report])

  const messageId = `${id}-msg`
  const reasonId = `${id}-reason`
  const reasonKey = model?.actions.find((a) => a.disabledReasonKey)?.disabledReasonKey
  const showReason = Boolean(reasonKey) && reasonKey !== model?.messageKey

  return (
    <>
      {visible && model && (
        <div
          ref={barRef}
          className="uw-remote-bar"
          role="region"
          aria-label={t(model.regionKey)}
          aria-busy={busy ? 'true' : undefined}
          data-tone={model.tone}
          data-kind={status?.lockWhileOpen ? 'lock-while-open' : status?.remote?.kind}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
          }}
        >
          <span className="uw-remote-dot" aria-hidden="true" />
          <div className="uw-remote-text">
            <p id={messageId} className="uw-remote-message">
              {t(model.messageKey, model.params)}
            </p>
            {showReason && reasonKey && (
              <p id={reasonId} className="uw-remote-reason">
                {t(reasonKey)}
              </p>
            )}
          </div>
          {model.actions.length > 0 && (
            <div className="uw-remote-actions">
              {model.actions.map((action) => {
                const blocked = Boolean(action.disabledReasonKey)
                return (
                  <button
                    key={action.kind}
                    type="button"
                    className="uw-remote-action"
                    data-action={action.kind}
                    aria-disabled={blocked || busy ? 'true' : undefined}
                    aria-describedby={
                      action.disabledReasonKey
                        ? action.disabledReasonKey === model.messageKey
                          ? messageId
                          : reasonId
                        : undefined
                    }
                    onClick={() => {
                      if (blocked || busy) return
                      act(action.kind)
                    }}
                  >
                    {t(action.labelKey)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {/* window-level live nodes: always in the DOM so a screen reader picks the change up */}
      <span className="uw-sr-only" role="status" aria-live="polite">
        {say && !say.assertive ? <span key={say.n}>{t(say.key, say.params)}</span> : null}
      </span>
      <span className="uw-sr-only" role="alert">
        {say?.assertive ? <span key={say.n}>{t(say.key, say.params)}</span> : null}
      </span>
    </>
  )
}
