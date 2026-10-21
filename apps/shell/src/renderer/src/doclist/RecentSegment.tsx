import { useCallback, useState } from 'react'
import { useI18n } from '../locale'
import { readRecentSegment, writeRecentSegment, type RecentSegment } from './persist'

const SEGMENTS = [
  { value: 'all', labelKey: 'dlSegAll' },
  { value: 'opened', labelKey: 'dlSegOpened' },
  { value: 'edited', labelKey: 'dlSegEdited' },
] as const

/** the Recent segment a person chose, remembered per account; Tất cả until they pick one */
export function useRecentSegment(): readonly [RecentSegment, (next: RecentSegment) => void] {
  const [segment, setSegment] = useState<RecentSegment>(() => readRecentSegment())
  const set = useCallback((next: RecentSegment) => {
    writeRecentSegment(next)
    setSegment(next)
  }, [])
  return [segment, set] as const
}

/**
 * Tất cả · Đã mở · Đã sửa: which last touch Recent lists. The server filters
 * (`activity=opened|edited`), so every pick reloads from the first page.
 */
export function RecentSegmentControl({
  value,
  onChange,
}: {
  value: RecentSegment
  onChange: (next: RecentSegment) => void
}) {
  const { t } = useI18n()
  return (
    <div className="dh-segment" role="group" aria-label={t('dlColActivity')}>
      {SEGMENTS.map((segment) => (
        <button
          key={segment.value}
          type="button"
          className="dh-segment-btn"
          data-seg={segment.value}
          aria-pressed={value === segment.value}
          onClick={() => onChange(segment.value)}
        >
          {t(segment.labelKey)}
        </button>
      ))}
    </div>
  )
}
