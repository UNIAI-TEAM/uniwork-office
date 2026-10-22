import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { useI18n } from '../locale'
import type { AskUniFocusKind, AskUniObjectKind } from '../../../shared/askuni-api'
import { LookupListbox, useLookupGroups } from './AskUniMentionPicker'
import { usePopoverDismiss } from './frame-popover'

/** the kinds a question can be scoped to (the server's focus kinds minus email threads, which have no picker) */
const SCOPE_KINDS: readonly AskUniObjectKind[] = ['task', 'meeting', 'document', 'project', 'room']

export interface ScopePick {
  kind: AskUniFocusKind
  id: string
  title: string
}

function List({
  workspaceId,
  onPick,
  onClose,
}: {
  workspaceId: string
  onPick: (pick: ScopePick) => void
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const uid = useId()
  const listId = `${uid}-list`
  const [query, setQuery] = useState('')
  const { groups, loading, failed } = useLookupGroups(workspaceId, SCOPE_KINDS, query)
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((i) => ({ kind: g.kind as AskUniFocusKind, id: i.id, title: i.title })),
      ),
    [groups],
  )
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionId = (i: number) => `${uid}-opt-${i}`
  useEffect(() => setActive(0), [query])
  useEffect(() => inputRef.current?.focus(), [])
  // keep the highlighted option in view as the arrows move it
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, groups])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // an IME commits its syllable on Enter; that keydown must not pick
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (flat.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flat[Math.min(active, flat.length - 1)]
      if (pick) onPick(pick)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        className="askuni2-search"
        aria-label={t('askUniV2ScopeSearch')}
        aria-expanded={flat.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          flat.length > 0 ? optionId(Math.min(active, flat.length - 1)) : undefined
        }
        placeholder={t('askUniV2ScopeSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <LookupListbox
        id={listId}
        label={t('askUniV2ScopeTitle')}
        groups={groups}
        active={active}
        optionId={optionId}
        onActive={setActive}
        onPick={(p) => onPick({ kind: p.kind as AskUniFocusKind, id: p.id, title: p.title })}
      />
      {flat.length === 0 && !loading ? (
        <p className="askuni2-note" role={failed ? 'alert' : undefined}>
          {failed ? t('askUniV2LookupFailed') : t('askUniV2LookupEmpty')}
        </p>
      ) : null}
    </>
  )
}

/** The "+" button: one task, meeting, document, project or chat room becomes the question's focus. */
export function AskUniScopePicker({
  workspaceId,
  onPick,
  finalFocus,
  disabled = false,
}: {
  workspaceId: string
  onPick: (pick: ScopePick) => void
  /** where focus lands after a pick (the composer's textarea) */
  finalFocus: RefObject<HTMLElement | null>
  disabled?: boolean
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  usePopoverDismiss(open, () => setOpen(false), anchorRef, popRef)
  return (
    <span className="askuni2-picker">
      <button
        ref={anchorRef}
        type="button"
        className="askuni2-icon-btn"
        aria-label={t('askUniV2ScopeAdd')}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
      {open ? (
        <div
          ref={popRef}
          role="dialog"
          aria-label={t('askUniV2ScopeTitle')}
          className="askuni2-popover askuni2-scope"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <List
            workspaceId={workspaceId}
            onClose={() => setOpen(false)}
            onPick={(pick) => {
              setOpen(false)
              onPick(pick)
              // the pick belongs in the composer: focus goes there, not back to the plus
              queueMicrotask(() => finalFocus.current?.focus())
            }}
          />
        </div>
      ) : null}
    </span>
  )
}
