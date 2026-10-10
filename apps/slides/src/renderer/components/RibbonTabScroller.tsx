import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The main + contextual tab buttons of the ribbon, in a row that scrolls sideways when the frame
 * is too narrow for all of them (phone width). The quick-access buttons and the File menu stay
 * outside it, so the File dropdown is never clipped. A soft fade plus a chevron on the edge that
 * still hides tabs tell the user the row scrolls (the chevron is the same cue the ribbon body
 * shows; a click scrolls the row); `activeKey` brings the selected tab into view.
 */
export function RibbonTabScroller({
  activeKey,
  children,
}: {
  activeKey: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [fade, setFade] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((f) => (f.start === start && f.end === end ? f : { start, end }))
  }, [])

  useLayoutEffect(measure)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('.ribbon-tab.active')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  const scrollBy = (dir: 1 | -1) =>
    ref.current?.scrollBy?.({
      left: dir * Math.max(80, ref.current.clientWidth * 0.6),
      behavior: 'smooth',
    })

  return (
    <div className="ribbon-tab-scroll-wrap">
      <div
        className="ribbon-tab-scroll"
        ref={ref}
        data-fade-start={fade.start || undefined}
        data-fade-end={fade.end || undefined}
        onScroll={measure}
      >
        {children}
      </div>
      {fade.start && <TabCue edge="start" onClick={() => scrollBy(-1)} />}
      {fade.end && <TabCue edge="end" onClick={() => scrollBy(1)} />}
    </div>
  )
}

/** the chevron over the clipped edge of the tab row (the pointer stays on the tab it covers) */
function TabCue({ edge, onClick }: { edge: 'start' | 'end'; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ribbon-tab-cue"
      data-edge={edge}
      tabIndex={-1}
      aria-hidden="true"
      // the row keeps its focus: a click on the cue must not steal it from a control
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4.5 2.5 8 6l-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
