/**
 * Word for Mac "Collapse ribbon": the tab row stays, the command band hides.
 * The selected tab doubles as the collapse control; while collapsed no tab is
 * selected and pressing any tab expands the band again (it stays expanded —
 * no peek overlay, no pin). Double-clicking a tab and Ctrl+F1 (⌥⌘R on macOS)
 * toggle too. The state persists per app in localStorage.
 *
 * An optional middle density, "compact" (icon-only commands on a shorter
 * band), is opt-in per call site: it needs `labels.compact` / `labels.expandFull`
 * and is otherwise inert, so ribbons that only pass collapse/expand keep the
 * original two-state behaviour and stay byte-for-byte compatible. ⌥⌘K
 * (Ctrl+Alt+K) cycles full ↔ compact. See #362.
 *
 * Overflow cue: a band wider than its frame (AI panel open, phone width) scrolls
 * sideways. While it does, the hook marks the root `data-ribbon-overflow="start|end|both"`
 * and shows a chevron button at each clipped edge (fade + click-to-scroll), so no
 * label is cut mid-word without a hint that more is there. The buttons are a visual
 * aid (aria-hidden, no tab stop): every control is already reachable by Tab.
 *
 * The collapse (and compact) key can come from the caller's shortcut table instead of the
 * hard-coded pair: pass `{ action }` (UNI-2011 common-10, or the module's own row such as
 * docs-086 whose web key is Ctrl+F3) and the hook matches it with the package matcher
 * (IME composition, AltGr and key-repeat guards, Mac / web chords) and shows its hint in the
 * tips. A caller that passes nothing keeps Ctrl+F1 / ⌥⌘R.
 *
 * Markup contract: the ribbon root carries `rootRef` + `rootClass`, the band
 * element carries `data-ribbon-body`, tabs render `tabClass` / `tabTip` and
 * call `onTabPress`. Ribbons without tabs use `RibbonCollapseButton` +
 * `RibbonExpandButton` instead (ribbon-collapse.css anchors the former to the
 * band's corner).
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import {
  ariaKeyshortcuts,
  currentShortcutPlatform,
  formatAriaChord,
  formatHint,
  matchShortcut,
  type ShortcutAction,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export const RIBBON_TOGGLE_SHORTCUT = IS_MAC ? '⌥⌘R' : 'Ctrl+F1'
export const RIBBON_COMPACT_SHORTCUT = IS_MAC ? '⌥⌘K' : 'Ctrl+Alt+K'

/** The same fallback keys as canonical chords, for `aria-keyshortcuts`. */
const FALLBACK_TOGGLE_CHORD = { win: 'Ctrl+F1', mac: 'Alt+Cmd+R' } as const
const FALLBACK_COMPACT_CHORD = { win: 'Ctrl+Alt+K', mac: 'Alt+Cmd+K' } as const

/**
 * How much of the command band to show. `full` and `compact` both keep the band
 * visible (and keep the active tab highlighted); `collapsed` hides it entirely.
 */
export type RibbonDensity = 'full' | 'compact' | 'collapsed'

export function readRibbonCollapsed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

export function writeRibbonCollapsed(storageKey: string, collapsed: boolean): void {
  try {
    localStorage.setItem(storageKey, collapsed ? '1' : '0')
  } catch {
    /* private mode / quota: the toggle still works for this session */
  }
}

/**
 * Reads the persisted density, honouring the legacy `'1'`/`'0'` values written
 * by the two-state version so an existing collapsed ribbon stays collapsed.
 */
export function readRibbonDensity(storageKey: string): RibbonDensity {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === 'collapsed' || raw === 'compact') return raw
    if (raw === '1') return 'collapsed'
    return 'full'
  } catch {
    return 'full'
  }
}

export function writeRibbonDensity(storageKey: string, density: RibbonDensity): void {
  try {
    localStorage.setItem(storageKey, density)
  } catch {
    /* private mode / quota: the toggle still works for this session */
  }
}

/** Ctrl+F1 (Office on Windows) or ⌥⌘R (Office for Mac); key-repeat while held does not re-toggle. */
export function isRibbonToggleShortcut(e: KeyboardEvent): boolean {
  if (e.repeat) return false
  if (e.key === 'F1' && e.ctrlKey && !e.metaKey && !e.altKey) return true
  return IS_MAC && e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyR'
}

/** ⌥⌘K on macOS, Ctrl+Alt+K elsewhere. ⌥⌘R (collapse) and every ⌥⌘<letter> the
 * editors bind — G/M/A/F/E/D — are already taken, hence K. */
export function isRibbonCompactShortcut(e: KeyboardEvent): boolean {
  if (e.repeat || e.shiftKey) return false
  // AltGr is reported as Ctrl+Alt on Windows layouts (Polish, German...): AltGr+K types a character
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return false
  if (IS_MAC) return e.metaKey && e.altKey && !e.ctrlKey && e.code === 'KeyK'
  return e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyK'
}

/** which edges of a horizontally scrolling band still hide something */
export type RibbonOverflow = '' | 'start' | 'end' | 'both'

export interface RibbonScrollMetrics {
  readonly scrollLeft: number
  readonly clientWidth: number
  readonly scrollWidth: number
  /** the band lays out right to left: `scrollLeft` is <= 0 (Chromium) */
  readonly rtl: boolean
}

/** the clipped edges of a band, in logical (start / end) terms; pure, for tests */
export function ribbonOverflowOf(m: RibbonScrollMetrics): RibbonOverflow {
  // a 1 px slack absorbs sub-pixel layout rounding
  if (m.scrollWidth - m.clientWidth <= 1) return ''
  const position = Math.abs(m.scrollLeft)
  const start = position > 1
  const end = position + m.clientWidth < m.scrollWidth - 1
  return start && end ? 'both' : start ? 'start' : end ? 'end' : ''
}

const CUE_ICON =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">' +
  '<path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>'

/**
 * Watch the band inside `root` and keep the overflow cue in step with it: two chevron buttons
 * appended to the root (the band is a scroll container, so the cue cannot live inside it) and the
 * `data-ribbon-overflow` marker. Returns the cleanup.
 */
export function mountRibbonOverflowCue(root: HTMLElement): () => void {
  const make = (edge: 'start' | 'end'): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ribbon-overflow-cue'
    b.dataset.edge = edge
    b.hidden = true
    b.tabIndex = -1
    b.setAttribute('aria-hidden', 'true')
    b.innerHTML = CUE_ICON
    // the band keeps its scroll position: a click on the cue must not steal focus from a control
    b.addEventListener('mousedown', (e) => e.preventDefault())
    return b
  }
  const startCue = make('start')
  const endCue = make('end')
  root.append(startCue, endCue)

  let band: HTMLElement | null = null
  let queued = false
  let frame = 0

  const bandOf = (): HTMLElement | null => {
    const el = root.querySelector<HTMLElement>('[data-ribbon-body]')
    // a collapsed ribbon hides the band (display: none): no client rects, no cue
    return el && el.getClientRects().length > 0 ? el : null
  }

  const update = (): void => {
    queued = false
    const el = bandOf()
    if (el !== band) {
      if (band) resizeObserver?.unobserve(band)
      band = el
      if (band) resizeObserver?.observe(band)
    }
    let state: RibbonOverflow = ''
    if (band) {
      state = ribbonOverflowOf({
        scrollLeft: band.scrollLeft,
        clientWidth: band.clientWidth,
        scrollWidth: band.scrollWidth,
        rtl: getComputedStyle(band).direction === 'rtl',
      })
      // the cue covers the band's own box (not the tab row, not the scrollbar lane)
      const r = root.getBoundingClientRect()
      const b = band.getBoundingClientRect()
      for (const c of [startCue, endCue]) {
        c.style.top = `${b.top - r.top}px`
        c.style.height = `${band.clientHeight}px`
      }
    }
    startCue.hidden = !(state === 'start' || state === 'both')
    endCue.hidden = !(state === 'end' || state === 'both')
    if (state) root.dataset.ribbonOverflow = state
    else delete root.dataset.ribbonOverflow
  }

  const schedule = (): void => {
    if (queued) return
    queued = true
    frame = requestAnimationFrame(update)
  }

  const scrollBand = (dir: 1 | -1) => (): void => {
    const el = bandOf()
    if (!el) return
    const rtl = getComputedStyle(el).direction === 'rtl'
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: dir * (rtl ? -1 : 1) * Math.max(120, el.clientWidth * 0.6),
      behavior: reduce ? 'auto' : 'smooth',
    })
  }
  startCue.addEventListener('click', scrollBand(-1))
  endCue.addEventListener('click', scrollBand(1))

  // scroll does not bubble: listen in the capture phase for whichever band is showing
  root.addEventListener('scroll', schedule, true)
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resizeObserver?.observe(root)
  // tab switches swap the band's content (and collapse hides it): re-measure after any of that
  const mutationObserver =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
  // (class only: the cue's own writes are style / hidden / data attributes, so it cannot re-trigger itself)
  mutationObserver?.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
  schedule()

  return () => {
    cancelAnimationFrame(frame)
    root.removeEventListener('scroll', schedule, true)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    startCue.remove()
    endCue.remove()
    delete root.dataset.ribbonOverflow
  }
}

export interface RibbonCollapseLabels {
  readonly collapse: string
  readonly expand: string
  /** opt in: the icon-only middle density */
  readonly compact?: string
  /** opt in: label for leaving `compact` back to `full` */
  readonly expandFull?: string
}

export interface RibbonCollapseOptions {
  /** The collapse action of the caller's table (common-10, or the module's own row). Absent: the
   * hard-coded Ctrl+F1 / ⌥⌘R. */
  readonly action?: ShortcutAction
  /** The compact-density action (docs-087). Absent: the hard-coded Ctrl+Alt+K / ⌥⌘K. Only read
   * when the call site opted into the compact labels. */
  readonly compactAction?: ShortcutAction
  /** `web` inside a module frame in a browser (the capability reader's `platform() === 'web'`),
   * `desktop` otherwise. Default `desktop`. */
  readonly surface?: ShortcutSurface
  /** Default: `currentShortcutPlatform()`. Mainly for tests. */
  readonly platform?: ShortcutPlatform
}

export interface RibbonCollapse {
  readonly collapsed: boolean
  /** The collapse key as shown in tips (`Ctrl+F1`, `⌥⌘R`); empty when the action has no chord here */
  readonly shortcutLabel: string
  /** The collapse key in `aria-keyshortcuts` notation (`Control+F1`, `Alt+Meta+R`); empty
   * when the action has no chord here. The accessible name never carries the key. */
  readonly ariaKeyshortcuts: string
  /** current band density; `'full'` when the call site did not opt in */
  readonly density: RibbonDensity
  /** true when the call site passed the compact labels */
  readonly compactEnabled: boolean
  readonly rootRef: RefObject<HTMLDivElement | null>
  /** class list for the ribbon root (append to the app's own classes) */
  readonly rootClass: string
  readonly toggle: () => void
  /** cycle full ↔ compact (no-op when the call site did not opt in) */
  readonly toggleCompact: () => void
  /** call from every tab button's click handler */
  readonly onTabPress: (wasActive: boolean) => void
  /** double-click on a tab toggles, like Office; attach to the tab row */
  readonly onTabsDoubleClick: (e: MouseEvent) => void
  /** `active` whenever the band is visible: a collapsed tab row has no selected tab */
  readonly tabClass: (isActive: boolean) => string
  /** hover tip: the selected tab offers Collapse, every tab offers Expand while collapsed */
  readonly tabTip: (isActive: boolean) => string | undefined
  /** `aria-keyshortcuts` for a tab: the keys its tip offers, or undefined when it offers none */
  readonly tabKeyshortcuts: (isActive: boolean) => string | undefined
}

export function useRibbonCollapse(
  storageKey: string,
  labels: RibbonCollapseLabels,
  options: RibbonCollapseOptions = {},
): RibbonCollapse {
  const { action, compactAction, surface = 'desktop' } = options
  const platform = options.platform ?? currentShortcutPlatform()
  const shortcutLabel = action ? formatHint(action, platform, surface) : RIBBON_TOGGLE_SHORTCUT
  const compactLabel = compactAction
    ? formatHint(compactAction, platform, surface)
    : RIBBON_COMPACT_SHORTCUT
  const ariaShortcut = action
    ? ariaKeyshortcuts(action, platform, surface)
    : formatAriaChord(FALLBACK_TOGGLE_CHORD[platform], platform)
  const compactAria = compactAction
    ? ariaKeyshortcuts(compactAction, platform, surface)
    : formatAriaChord(FALLBACK_COMPACT_CHORD[platform], platform)
  /** ` (key)` after a tip, or nothing when the surface has no key */
  const keyed = (text: string, key: string) => (key ? `${text} (${key})` : text)
  const compactEnabled = Boolean(labels.compact && labels.expandFull)
  const [density, setDensity] = useState<RibbonDensity>(() =>
    compactEnabled
      ? readRibbonDensity(storageKey)
      : readRibbonCollapsed(storageKey)
        ? 'collapsed'
        : 'full',
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const collapsed = density === 'collapsed'
  const densityRef = useRef(density)
  densityRef.current = density

  const persist = useCallback(
    (next: RibbonDensity) => {
      // the legacy key only ever stored '1'/'0', so keep writing that shape for
      // the two states and use the name for the middle one
      if (!compactEnabled) {
        writeRibbonCollapsed(storageKey, next === 'collapsed')
        return
      }
      writeRibbonDensity(storageKey, next)
    },
    [compactEnabled, storageKey],
  )

  const toggle = useCallback(() => {
    // the band control hides the band or brings it back at full size; compact is
    // not a stopping point for it
    const next: RibbonDensity = densityRef.current === 'collapsed' ? 'full' : 'collapsed'
    persist(next)
    setDensity(next)
  }, [persist])

  const toggleCompact = useCallback(() => {
    if (!compactEnabled) return
    // from collapsed this reveals the band compactly, matching what the user
    // just asked for rather than jumping straight back to full
    const next: RibbonDensity = densityRef.current === 'compact' ? 'full' : 'compact'
    persist(next)
    setDensity(next)
  }, [compactEnabled, persist])

  // state before each of the last two presses: a double-click arrives after its
  // two clicks already ran onTabPress, and must end up toggled relative to the
  // state before the first of them
  const pressHistory = useRef<RibbonDensity[]>([])

  const onTabPress = useCallback(
    (wasActive: boolean) => {
      pressHistory.current = [...pressHistory.current.slice(-1), densityRef.current]
      if (densityRef.current === 'collapsed' || wasActive) toggle()
    },
    [toggle],
  )

  const onTabsDoubleClick = useCallback(
    (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest('button')
      if (!btn || btn.classList.contains('qa-btn') || btn.classList.contains('ribbon-tab-file'))
        return
      const before = pressHistory.current[0] ?? densityRef.current
      pressHistory.current = []
      if (densityRef.current === before) toggle()
    },
    [toggle],
  )

  // The overflow cue of the band (see the header comment); the root ref is the call site's. The
  // ref is a plain object (no callback when a node lands in it), and a ribbon may render long after
  // the hook's owner mounted (PDF shows it only once the file has loaded): check on every render
  // which node the ref holds and mount the cue on a new one, so a late or replaced ribbon gets it.
  const cue = useRef<{ root: HTMLElement; dispose: () => void } | null>(null)
  useEffect(() => {
    const root = rootRef.current
    if (cue.current?.root === root) return
    cue.current?.dispose()
    cue.current = root ? { root, dispose: mountRibbonOverflowCue(root) } : null
  })
  useEffect(
    () => () => {
      cue.current?.dispose()
      cue.current = null
    },
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a table action goes through the package matcher (composition, AltGr, repeat); without
      // one the old hard-coded key answers
      const isToggle = action
        ? matchShortcut(e, [action], platform, surface) !== null
        : isRibbonToggleShortcut(e)
      if (isToggle) {
        e.preventDefault()
        toggle()
        return
      }
      if (!compactEnabled) return
      const isCompact = compactAction
        ? matchShortcut(e, [compactAction], platform, surface) !== null
        : isRibbonCompactShortcut(e)
      if (isCompact) {
        e.preventDefault()
        toggleCompact()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, toggleCompact, compactEnabled, action, compactAction, platform, surface])

  const tabClass = (isActive: boolean) => (isActive && !collapsed ? 'active' : '')
  const tabTip = (isActive: boolean) => {
    if (collapsed) return keyed(labels.expand, shortcutLabel)
    if (!isActive) return undefined
    if (!compactEnabled) return keyed(labels.collapse, shortcutLabel)
    // while compact the band toggle would collapse; offer both ways out
    return density === 'compact'
      ? keyed(labels.expandFull ?? '', compactLabel)
      : `${keyed(labels.collapse, shortcutLabel)} · ${keyed(labels.compact ?? '', compactLabel)}`
  }
  const tabKeyshortcuts = (isActive: boolean) => {
    const keys = (...parts: string[]) => parts.filter(Boolean).join(' ') || undefined
    if (collapsed) return keys(ariaShortcut)
    if (!isActive) return undefined
    if (!compactEnabled) return keys(ariaShortcut)
    return density === 'compact' ? keys(compactAria) : keys(ariaShortcut, compactAria)
  }

  const rootClass = `ribbon-collapsible${collapsed ? ' ribbon-collapsed' : ''}${
    density === 'compact' ? ' ribbon-compact' : ''
  }`
  return {
    collapsed,
    shortcutLabel,
    ariaKeyshortcuts: ariaShortcut,
    density,
    compactEnabled,
    rootRef,
    rootClass,
    toggle,
    toggleCompact,
    onTabPress,
    onTabsDoubleClick,
    tabClass,
    tabTip,
    tabKeyshortcuts,
  }
}

function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5 6 4l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Corner button of the band for ribbons without tabs (no selected tab to press): shown only while expanded. */
export function RibbonCollapseButton({ state, label }: { state: RibbonCollapse; label: string }) {
  if (state.collapsed) return null
  const tip = state.shortcutLabel ? `${label} (${state.shortcutLabel})` : label
  return (
    <button
      type="button"
      className="ribbon-collapse-btn"
      data-tip={tip}
      aria-label={label}
      aria-keyshortcuts={state.ariaKeyshortcuts || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={state.toggle}
    >
      <ChevronUp />
    </button>
  )
}

/** Tab-row button for ribbons without tabs (nothing to press to expand): shown only while collapsed. */
export function RibbonExpandButton({ state, label }: { state: RibbonCollapse; label: string }) {
  if (!state.collapsed) return null
  const tip = state.shortcutLabel ? `${label} (${state.shortcutLabel})` : label
  return (
    <button
      type="button"
      className="ribbon-expand-btn"
      data-tip={tip}
      aria-label={label}
      aria-keyshortcuts={state.ariaKeyshortcuts || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={state.toggle}
    >
      <ChevronDown />
    </button>
  )
}
