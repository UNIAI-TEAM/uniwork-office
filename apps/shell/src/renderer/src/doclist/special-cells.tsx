// The screen column of Recent, Shared with me and Shared by me: a main line and
// a muted 12px line under it, built on the rows' server fields. A row without
// its field reads "—"; the table draws the column only once some loaded row
// has the field. The other screens' columns live in cells.tsx.
import { useI18n } from '../locale'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { Empty, Person, SpecialContent, Stack, type OwnSpecialColumn } from './cells'
import type { SpecialColumnId } from './columns'
import { EMPTY_CELL, activityKey, formatListDate, formatShareWith } from './format'

/** Recent: a coloured dot and "Bạn đã sửa|mở|bình luận" over the time of the last touch */
function ActivityCell({ doc, now }: { doc: DocumentsHomeDoc; now: Date }) {
  const { t, dateLocale } = useI18n()
  const activity = doc.lastActivity
  const key = activity ? activityKey(activity.kind) : null
  if (!activity || !key) return <Empty />
  return (
    <Stack
      main={
        <>
          <span className="dh-act-dot" data-kind={activity.kind} aria-hidden="true" />
          <span className="dh-special-text">{t(key)}</span>
        </>
      }
      sub={formatListDate(activity.at, now, dateLocale, t)}
    />
  )
}

/** Shared with me: who shared it (avatar + name), over when */
function SharedCell({ doc, now }: { doc: DocumentsHomeDoc; now: Date }) {
  const { t, dateLocale } = useI18n()
  if (!doc.shared) return <Empty />
  return (
    <Stack
      main={doc.shared.byName ? <Person name={doc.shared.byName} /> : EMPTY_CELL}
      sub={formatListDate(doc.shared.at, now, dateLocale, t)}
    />
  )
}

/** Shared by me: "3 người · 1 workspace · 1 link" (parts at zero dropped), over the latest share */
function SharedWithCell({ doc, now }: { doc: DocumentsHomeDoc; now: Date }) {
  const { t, dateLocale } = useI18n()
  const summary = doc.shareSummary
  if (!summary) return <Empty />
  return (
    <Stack
      main={formatShareWith(summary, t)}
      sub={summary.latestAt ? formatListDate(summary.latestAt, now, dateLocale, t) : undefined}
    />
  )
}

const isOwn = (column: SpecialColumnId): column is OwnSpecialColumn =>
  column === 'activity' || column === 'shared' || column === 'shared_with'

/** the screen cell of a row, whichever screen it is */
export function SpecialCell({
  column,
  doc,
  now,
}: {
  column: SpecialColumnId
  doc: DocumentsHomeDoc
  now: Date
}) {
  if (!isOwn(column)) return <SpecialContent column={column} doc={doc} now={now} />
  switch (column) {
    case 'activity':
      return <ActivityCell doc={doc} now={now} />
    case 'shared':
      return <SharedCell doc={doc} now={now} />
    case 'shared_with':
      return <SharedWithCell doc={doc} now={now} />
  }
}
