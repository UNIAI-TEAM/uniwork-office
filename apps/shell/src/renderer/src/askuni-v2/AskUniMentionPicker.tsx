import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { useI18n, type StringKey } from '../locale'
import type {
  AskUniLookupItem,
  AskUniMentionKind,
  AskUniObjectKind,
} from '../../../shared/askuni-api'
import { foldText, frameBridge } from './frame-bridge'

/** how long the typing must rest before the server is asked again (an empty query asks at once) */
export const LOOKUP_DEBOUNCE_MS = 200
const GROUP_LIMIT = 5

export const GROUP_KEYS: Record<string, StringKey> = {
  member: 'askUniV2GroupPeople',
  task: 'askUniV2GroupTasks',
  document: 'askUniV2GroupDocuments',
  meeting: 'askUniV2GroupMeetings',
  project: 'askUniV2GroupProjects',
  room: 'askUniV2GroupRooms',
}

export interface LookupGroup {
  kind: AskUniObjectKind
  items: AskUniLookupItem[]
}

/**
 * Looks the kinds up through the bridge: one call per kind, the server answer is a superset so the title
 * (and subtitle) are filtered again here without caring for case or accents. A newer query or workspace
 * drops the older answer; a kind that failed is left out and `failed` is only true when none answered.
 */
export function useLookupGroups(
  workspaceId: string,
  kinds: readonly AskUniObjectKind[],
  query: string,
  enabled = true,
): { groups: LookupGroup[]; loading: boolean; failed: boolean } {
  const kindsKey = kinds.join(',')
  const [state, setState] = useState<{
    groups: LookupGroup[]
    loading: boolean
    failed: boolean
  }>({ groups: [], loading: enabled, failed: false })

  useEffect(() => {
    if (!enabled) {
      setState({ groups: [], loading: false, failed: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    const run = () => {
      const call = frameBridge().askUniLookup
      const wanted = kindsKey.split(',') as AskUniObjectKind[]
      const needle = foldText(query.trim())
      Promise.all(
        wanted.map(async (kind) => {
          try {
            if (!call) return null
            const r = await call({ workspaceId, kind, query: query.trim() })
            if (!r.ok) return null
            const items = r.items
              .filter(
                (i) =>
                  needle === '' ||
                  foldText(i.title).includes(needle) ||
                  foldText(i.subtitle ?? '').includes(needle),
              )
              .slice(0, GROUP_LIMIT)
            return { kind, items } satisfies LookupGroup
          } catch {
            return null
          }
        }),
      ).then((all) => {
        if (!alive) return
        const ok = all.filter((g): g is LookupGroup => g !== null)
        setState({
          groups: ok.filter((g) => g.items.length > 0),
          loading: false,
          failed: ok.length === 0,
        })
      })
    }
    if (query.trim() === '') {
      run()
      return () => {
        alive = false
      }
    }
    const timer = setTimeout(run, LOOKUP_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [workspaceId, kindsKey, query, enabled])

  return state
}

export interface ListPick {
  kind: AskUniObjectKind
  id: string
  title: string
}

/** the grouped options of a lookup; the owner keeps focus and names the active option through aria-activedescendant */
export function LookupListbox({
  id,
  label,
  groups,
  active,
  optionId,
  onActive,
  onPick,
}: {
  id: string
  label: string
  groups: LookupGroup[]
  active: number
  optionId: (i: number) => string
  onActive: (i: number) => void
  onPick: (pick: ListPick) => void
}): ReactElement {
  const { t } = useI18n()
  const uid = useId()
  let index = -1
  return (
    <div
      role="listbox"
      id={id}
      aria-label={label}
      className="askuni2-listbox"
      hidden={groups.length === 0}
    >
      {groups.map((g) => (
        <div key={g.kind} role="group" aria-labelledby={`${uid}-${g.kind}`}>
          <p id={`${uid}-${g.kind}`} className="askuni2-menu-caption">
            {t(GROUP_KEYS[g.kind] ?? 'askUniV2GroupTasks')}
          </p>
          {g.items.map((item) => {
            index += 1
            const i = index
            return (
              // keys belong to the owner (aria-activedescendant); the option itself only takes the pointer
              <div
                key={`${g.kind}:${item.id}`}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className="askuni2-option"
                // keep the caret where it is while the pointer picks
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => onActive(i)}
                onClick={() => onPick({ kind: g.kind, id: item.id, title: item.title })}
              >
                <span className="askuni2-option-title">{item.title}</span>
                {item.subtitle ? <span className="askuni2-option-sub">{item.subtitle}</span> : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export interface MentionPick {
  kind: AskUniMentionKind
  id: string
  label: string
}

/** right after `@` only people are offered; with a query tasks, documents, meetings and projects join */
const KINDS_EMPTY: readonly AskUniObjectKind[] = ['member']
const KINDS_QUERY: readonly AskUniObjectKind[] = [
  'member',
  'task',
  'document',
  'meeting',
  'project',
]

/**
 * The list under an open `@`. It never takes focus: the textarea keeps the caret and this list is
 * driven from its keys (arrows, Enter/Tab pick, Escape closes) through aria-activedescendant.
 */
export function AskUniMentionPicker({
  workspaceId,
  query,
  listId,
  inputRef,
  onPick,
  onDismiss,
}: {
  workspaceId: string
  query: string
  /** the listbox id the textarea's aria-controls names */
  listId: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  onPick: (pick: MentionPick) => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useI18n()
  const uid = useId()
  const { groups, loading } = useLookupGroups(
    workspaceId,
    query === '' ? KINDS_EMPTY : KINDS_QUERY,
    query,
  )
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((item) => ({
          kind: g.kind as AskUniMentionKind,
          id: item.id,
          label: item.title,
        })),
      ),
    [groups],
  )
  const [active, setActive] = useState(0)
  const optionId = (i: number) => `${uid}-opt-${i}`
  // a new query is a new list: the highlight returns to the top
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'Escape') {
        consume()
        onDismiss()
      } else if (loading && flat.length === 0 && e.key === 'Enter' && !e.shiftKey) {
        // nothing to pick yet and results are on their way: a send now would race the list
        consume()
      } else if (flat.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        consume()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length)
      } else if (flat.length > 0 && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        consume()
        const pick = flat[Math.min(active, flat.length - 1)]
        if (pick) onPick(pick)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [inputRef, flat, active, loading, onPick, onDismiss])

  // the textarea names the highlighted option for assistive tech
  useEffect(() => {
    const el = inputRef.current
    if (!el || flat.length === 0) return
    el.setAttribute('aria-activedescendant', optionId(Math.min(active, flat.length - 1)))
    return () => el.removeAttribute('aria-activedescendant')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputRef, active, flat.length, groups])

  return (
    <div className="askuni2-popover askuni2-mention">
      <LookupListbox
        id={listId}
        label={t('askUniV2MentionList')}
        groups={groups}
        active={active}
        optionId={optionId}
        onActive={setActive}
        onPick={(p) => onPick({ kind: p.kind as AskUniMentionKind, id: p.id, label: p.title })}
      />
      {flat.length === 0 && !loading ? (
        <p aria-hidden="true" className="askuni2-note">
          {t('askUniV2LookupEmpty')}
        </p>
      ) : null}
      <p role="status" className="askuni-sr-only">
        {loading
          ? ''
          : flat.length === 0
            ? t('askUniV2LookupEmpty')
            : t('askUniV2MentionCount', { count: String(flat.length) })}
      </p>
    </div>
  )
}
