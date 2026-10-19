/**
 * S14 mention picker: an APG combobox listbox that sits under the composer.
 * Focus never leaves the textarea (it carries role=combobox while the picker is
 * open); the listbox is only the visible half. `useMentionSearch` owns the
 * debounced `searchMentions` call and turns its state into rows; the composer
 * owns the keys and `MentionPicker` just draws the rows.
 */
import { format } from '@genoffice/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MENTION_DEBOUNCE_MS, MENTION_MAX_ROWS } from './mention-query'
import { NoAccessBadge } from './NoAccessBadge'
import type { CollabCandidate, CollabSource } from './types'

/** the S14 keys plus the shared Retry */
export interface CollabPickerStrings {
  collabMentionLabel: string
  collabMentionSearching: string
  /** `{count}` */
  collabMentionCount: string
  /** `{query}` */
  collabMentionNoMatch: string
  collabMentionNoCandidates: string
  collabMentionError: string
  collabMentionNoAccessBadge: string
  collabRetry: string
}

export type MentionRow =
  | { kind: 'candidate'; key: string; candidate: CollabCandidate }
  /** searching / no match / no candidates / error: shown as an aria-disabled option */
  | { kind: 'message'; key: string; text: string }
  /** the Retry action after an error: a real option, reachable with the arrow keys */
  | { kind: 'retry'; key: string; text: string }

export const isSelectableRow = (row: MentionRow | undefined): boolean =>
  row !== undefined && row.kind !== 'message'

export const mentionOptionId = (listboxId: string, index: number): string =>
  `${listboxId}-opt-${index}`

/** next row (wrapping) that can be picked, or -1; `from` -1 starts before the first row */
export function nextSelectableIndex(
  rows: readonly MentionRow[],
  from: number,
  step: 1 | -1,
): number {
  const n = rows.length
  for (let i = 1; i <= n; i++) {
    const idx = (((from + step * i) % n) + n) % n
    if (isSelectableRow(rows[idx])) return idx
  }
  return -1
}

type SearchStatus = 'searching' | 'ready' | 'error'
interface SearchState {
  status: SearchStatus
  candidates: CollabCandidate[]
  /** the query `candidates` answer (the no-match line names it) */
  forQuery: string
}
const INITIAL: SearchState = { status: 'searching', candidates: [], forQuery: '' }

export interface MentionSearch {
  rows: MentionRow[]
  status: SearchStatus
  /** ask again right away (the Retry row) */
  retry(): void
}

/**
 * `query` null = picker closed (nothing runs, everything is forgotten). Old
 * results stay while a newer query is in flight; a late answer to an older
 * query is dropped. The count (or the message of an empty / failed answer) goes
 * to `announce` once per answer.
 */
export function useMentionSearch(opts: {
  source: Pick<CollabSource, 'searchMentions' | 'canListMembers'>
  query: string | null
  strings: CollabPickerStrings
  announce?: (text: string) => void
  /** G8-18: when true (or `source.canListMembers === true`), pass `include: 'no_access'` */
  canListMembers?: boolean
}): MentionSearch {
  const { query } = opts
  const [state, setState] = useState<SearchState>(INITIAL)
  const [nonce, setNonce] = useState(0)
  // latest props for the async part, so the effect depends on the query only
  const latest = useRef(opts)
  latest.current = opts
  const immediate = useRef(false)

  useEffect(() => {
    if (query === null) {
      setState(INITIAL)
      return
    }
    setState((s) => (s.status === 'searching' ? s : { ...s, status: 'searching' }))
    let alive = true
    const run = async () => {
      const { source, strings, announce, canListMembers } = latest.current
      const mayList = canListMembers ?? source.canListMembers
      try {
        const res = await source.searchMentions(
          mayList
            ? { q: query, limit: MENTION_MAX_ROWS, include: 'no_access' }
            : { q: query, limit: MENTION_MAX_ROWS },
        )
        if (!alive) return
        const candidates = res.candidates.slice(0, MENTION_MAX_ROWS)
        setState({ status: 'ready', candidates, forQuery: query })
        announce?.(
          candidates.length > 0
            ? format(strings.collabMentionCount, { count: candidates.length })
            : emptyText(strings, query),
        )
      } catch {
        if (!alive) return
        setState({ status: 'error', candidates: [], forQuery: query })
        announce?.(strings.collabMentionError)
      }
    }
    const delay = immediate.current ? 0 : MENTION_DEBOUNCE_MS
    immediate.current = false
    const timer = setTimeout(run, delay)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, nonce])

  const retry = useCallback(() => {
    immediate.current = true
    setNonce((n) => n + 1)
  }, [])

  const { strings } = opts
  const rows: MentionRow[] = query === null ? [] : buildRows(state, strings)
  return { rows, status: state.status, retry }
}

function emptyText(strings: CollabPickerStrings, query: string): string {
  return query === ''
    ? strings.collabMentionNoCandidates
    : format(strings.collabMentionNoMatch, { query })
}

function buildRows(state: SearchState, strings: CollabPickerStrings): MentionRow[] {
  const people: MentionRow[] = state.candidates.map((candidate) => ({
    kind: 'candidate',
    key: `c:${candidate.user_id}`,
    candidate,
  }))
  switch (state.status) {
    case 'searching':
      return [
        ...people,
        { kind: 'message', key: 'msg:searching', text: strings.collabMentionSearching },
      ]
    case 'error':
      return [
        { kind: 'message', key: 'msg:error', text: strings.collabMentionError },
        { kind: 'retry', key: 'retry', text: strings.collabRetry },
      ]
    case 'ready':
      return people.length > 0
        ? people
        : [{ kind: 'message', key: 'msg:empty', text: emptyText(strings, state.forQuery) }]
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('')
}

export interface MentionPickerProps {
  listboxId: string
  /** `collabMentionLabel` */
  label: string
  rows: readonly MentionRow[]
  /** index into `rows`, -1 = none */
  activeIndex: number
  /** a candidate or the Retry row was clicked */
  onPick(row: MentionRow): void
  /** the visible result count line (`collabMentionCount`), when there is one */
  footer?: string
  /** `collabMentionNoAccessBadge` shown with a lock icon on candidates with `can_view === false` (G8-18) */
  noAccessBadge: string
}

export function MentionPicker({
  listboxId,
  label,
  rows,
  activeIndex,
  onPick,
  footer,
  noAccessBadge,
}: MentionPickerProps) {
  return (
    // mousedown must not move focus out of the textarea
    <div className="collab-mention-pop" onMouseDown={(e) => e.preventDefault()}>
      <ul role="listbox" id={listboxId} aria-label={label} className="collab-mention-list">
        {rows.map((row, i) => {
          const disabled = row.kind === 'message'
          const noAccess = row.kind === 'candidate' && row.candidate.can_view === false
          return (
            <li
              key={row.key}
              id={mentionOptionId(listboxId, i)}
              role="option"
              aria-selected={i === activeIndex}
              aria-disabled={disabled ? true : undefined}
              data-no-access={noAccess ? 'true' : undefined}
              className={`collab-mention-option collab-mention-${row.kind}`}
              onClick={disabled ? undefined : () => onPick(row)}
            >
              {row.kind === 'candidate' ? (
                <>
                  <span className="collab-mention-avatar" aria-hidden="true">
                    {row.candidate.avatar_url ? (
                      <img src={row.candidate.avatar_url} alt="" />
                    ) : (
                      initials(row.candidate.display_name)
                    )}
                  </span>
                  <span className="collab-mention-text">
                    <span className="collab-mention-name">{row.candidate.display_name}</span>
                    {row.candidate.email ? (
                      <span className="collab-mention-email" title={row.candidate.email}>
                        {row.candidate.email}
                      </span>
                    ) : null}
                  </span>
                  {noAccess ? <NoAccessBadge label={noAccessBadge} /> : null}
                </>
              ) : (
                <span className="collab-mention-text">{row.text}</span>
              )}
            </li>
          )
        })}
      </ul>
      {footer ? <div className="collab-mention-foot">{footer}</div> : null}
    </div>
  )
}
