import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The main + contextual tab buttons of the ribbon, in a row that scrolls sideways when the frame
 * is too narrow for all of them (phone width). The quick-access buttons and the File menu stay
 * outside it, so the File dropdown is never clipped. A soft fade on the edge that still hides
 * tabs tells the user the row scrolls; `activeKey` brings the selected tab into view.
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

  return (
    <div
      className="ribbon-tab-scroll"
      ref={ref}
      data-fade-start={fade.start || undefined}
      data-fade-end={fade.end || undefined}
      onScroll={measure}
    >
      {children}
    </div>
  )
}
