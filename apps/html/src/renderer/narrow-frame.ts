import { useEffect, useState } from 'react'

/** the frame is phone width (the same 600 px the narrow CSS rules use) */
export const NARROW_FRAME_QUERY = '(max-width: 600px)'

function matches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(NARROW_FRAME_QUERY).matches === true
}

export function useNarrowFrame(): boolean {
  const [narrow, setNarrow] = useState(matches)
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_FRAME_QUERY)
    if (!query) return
    const update = (): void => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}
