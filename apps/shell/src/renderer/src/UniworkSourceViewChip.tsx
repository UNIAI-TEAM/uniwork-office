import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { pathKey } from '../../shared/path-key'
import type { SourceViewState } from '../../shared/source-view'
import { useI18n } from './locale'
import { docDirOf, popoverLeftOf } from './queue-popover-model'
import { shortLabelOf } from './uniwork-pill-fit'
import { onSourceViewHint } from './uniwork-library-api'
import {
  popoverRoomOf,
  setTopInsetPart,
  uiScaleOf,
  unscaledHeightOf,
  useTopInsetPart,
} from './uniwork-top-inset'
import { usePillFit } from './UniworkChrome'
import './queue-popover.css'

/** the modules this build has a name for (the web's Chat, Tasks, Meetings, Email) */
function originKeyOf(origin: string) {
  switch (origin) {
    case 'chat':
      return 'uwSourceOriginChat'
    case 'task':
      return 'uwSourceOriginTask'
    case 'meeting':
      return 'uwSourceOriginMeeting'
    case 'email':
      return 'uwSourceOriginEmail'
    default:
      return null
  }
}

/**
 * "View only · From Chat" for a source file opened in an editor tab: an attachment of a chat, task,
 * meeting or email that carries no UniWork document. Same pill as the view-only save chip (neutral
 * tone, dot + label, native title tooltip, the sentence once more for a screen reader) and the same
 * fit to a narrow strip (the label, its short head, the dot alone, the 28px circle), no button:
 * there is nothing to resolve, the way to a copy is Download in the Documents list. An origin this
 * build has no name for (the server may add a module) reads as the generic view-only chip.
 */
export function UniworkSourceViewChip({ state }: { state: SourceViewState | null }) {
  const { t } = useI18n()
  const tipId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  const originKey = state ? originKeyOf(state.origin) : null
  const parentTitle = state?.parentTitle.trim()
  const label = !state
    ? ''
    : originKey
      ? t('uwChipSourceView', { origin: t(originKey) })
      : t('uwChipViewOnly')
  const tip = !state
    ? ''
    : originKey
      ? t('uwTipSourceView', {
          origin: t(originKey),
          parent: parentTitle ? ` · ${parentTitle}` : '',
        })
      : t('uwTipViewOnly')
  const shortLabel = shortLabelOf(label)
  const { variant } = usePillFit(groupRef, label, shortLabel !== label)
  if (!state) return null
  return (
    <div
      ref={groupRef}
      className="uw-pill"
      role="group"
      aria-label={label}
      aria-describedby={tipId}
      title={tip}
      data-tone="neutral"
      data-state="view-only"
      data-variant={variant}
    >
      <span id={tipId} className="uw-sr-only">
        {tip}
      </span>
      <span className="uw-pill-status">
        <span className="uw-pill-dot" aria-hidden="true" />
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
    </div>
  )
}

/** how long the Save hint stays when nobody closes it */
const HINT_MS = 6000

/**
 * The sentence for an explicit Save (Ctrl/Cmd+S, Save) in a view-only source tab: nothing is saved,
 * and the person is told so, in the same band under the pill the other explanations use (the editor
 * view sits below the strip, so the band joins the top inset while it is open). It takes no focus
 * (the person is typing in the editor), says itself as a status, and goes on Esc, a click elsewhere,
 * another tab, or after a few seconds. Only the active tab that owns the path shows it.
 */
export function UniworkSourceViewHint({ activePath }: { activePath: string | undefined }) {
  const activeKey = activePath ? pathKey(activePath) : ''
  const activeRef = useRef(activeKey)
  activeRef.current = activeKey
  // a new object per request: a second Save restarts the time and keeps one hint
  const [hint, setHint] = useState<{ at: number } | null>(null)

  useEffect(
    () =>
      onSourceViewHint(({ path }) => {
        if (activeRef.current && pathKey(path) === activeRef.current) {
          setHint((prev) => ({ at: (prev?.at ?? 0) + 1 }))
        }
      }),
    [],
  )
  // another tab: the hint belonged to the one that was active
  useEffect(() => setHint(null), [activeKey])
  useEffect(() => {
    if (!hint) return undefined
    const timer = setTimeout(() => setHint(null), HINT_MS)
    return () => clearTimeout(timer)
  }, [hint])
  const shown = hint !== null
  useEffect(() => {
    if (!shown) return undefined
    const close = () => setHint(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', close)
    }
  }, [shown])

  return hint ? <HintBand /> : null
}

function HintBand() {
  const { t } = useI18n()
  const bandRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const barPx = useTopInsetPart('bar')
  const room = popoverRoomOf(barPx)
  const roomRef = useRef(room)
  roomRef.current = room
  const [left, setLeft] = useState<number | null>(null)
  const [dir, setDir] = useState<'ltr' | 'rtl'>(() => docDirOf())

  // the dialog's x follows the chip: right-aligned to it, inside the window (the queue popover's rule)
  const place = useCallback(() => {
    const dialog = dialogRef.current
    const band = bandRef.current
    if (!dialog || !band) return
    const scale = uiScaleOf(dialog)
    const bandWidth = band.getBoundingClientRect().width
    const direction = docDirOf()
    const pillRect = document
      .querySelector('.uw-chrome .uw-pill[data-state="view-only"]')
      ?.getBoundingClientRect()
    const next = popoverLeftOf({
      dir: direction,
      pillRight: (pillRect?.right ?? Number.NaN) / scale,
      pillLeft: (pillRect?.left ?? Number.NaN) / scale,
      width: dialog.getBoundingClientRect().width / scale,
      windowWidth: (bandWidth > 0 ? bandWidth : window.innerWidth) / scale,
    })
    setLeft((prev) => (prev === next ? prev : next))
    setDir((prev) => (prev === direction ? prev : direction))
  }, [])
  useLayoutEffect(place)
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  // the band's height joins the top inset while it is open; closing gives the editor the room back
  useLayoutEffect(() => {
    const band = bandRef.current
    if (!band) return undefined
    const measure = () =>
      setTopInsetPart('popover', Math.min(unscaledHeightOf(band), roomRef.current))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(band)
    return () => observer.disconnect()
  }, [room])
  useLayoutEffect(() => () => setTopInsetPart('popover', 0), [])

  return (
    <div
      ref={bandRef}
      className="uw-queue-band"
      data-uw-source-hint=""
      style={
        {
          top: `calc(var(--tab-bar-height, 40px) + ${barPx}px)`,
          '--uw-queue-room': `${room}px`,
        } as CSSProperties
      }
    >
      <div
        ref={dialogRef}
        className="uw-queue-pop"
        dir={dir}
        style={left === null ? undefined : { marginLeft: `${left}px` }}
      >
        <p role="status" className="uw-queue-pop-line">
          {t('uwSourceViewSaveHint')}
        </p>
      </div>
    </div>
  )
}
