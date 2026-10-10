import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/**
 * The ribbon body scrolls sideways with its scrollbar hidden, so on a narrow window (or with a
 * longer language, or the AI panel open) the last commands were simply cut off: in Vietnamese at
 * 1440 px the Present button sat behind a bare chevron. Instead of cutting, the ribbon sheds
 * labels in steps until everything fits:
 *   0  every label shown
 *   1  the Insert row is icon-only
 *   2  every command is icon-only (tooltips and accessible names stay)
 */
export const MAX_FIT_LEVEL = 2

export function nextFitLevel(
  level: number,
  measure: { scrollWidth: number; clientWidth: number },
): number {
  return measure.scrollWidth > measure.clientWidth + 1 && level < MAX_FIT_LEVEL ? level + 1 : level
}

/**
 * The current fit level of `ref` (the scrolling band). `key` names what changes the natural width
 * (language, which groups are shown); a different key or band width starts again from level 0.
 */
export function useRibbonFit(ref: RefObject<HTMLElement | null>, key: string): number {
  const [level, setLevel] = useState(0)

  useLayoutEffect(() => {
    setLevel(0)
  }, [key])

  // no deps: after every render, one more step while the band still overflows (sync, before paint)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = nextFitLevel(level, el)
    if (next !== level) setLevel(next)
  })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      setLevel(0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return level
}
