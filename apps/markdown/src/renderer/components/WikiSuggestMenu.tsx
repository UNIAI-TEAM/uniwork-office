import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { CSSProperties } from 'react'
import type { WikiSuggestState } from '../editor/wikiSuggest'
import { useI18n } from '../i18n/locale'

export interface WikiSuggestMenuHandle {
  handleKey(event: KeyboardEvent): boolean
}

interface Props {
  state: WikiSuggestState | null
  onDismiss: () => void
}

const NO_ITEMS: WikiSuggestState['items'] = []
const GAP = 4
const EDGE = 8
const STATUS_BAR_HEIGHT = 24
const MENU_MAX_HEIGHT = 320
const EST_ROW_HEIGHT = 32
const EST_PAD_HEIGHT = 12

/**
 * Place the `[[` popup below the caret when it fits above the status bar,
 * otherwise flip it above the caret (and cap its height so the bottom row
 * stays inside the viewport).
 */
export function placeWikiSuggestMenu(
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left'>,
  count: number,
  viewportHeight: number = typeof window !== 'undefined' ? window.innerHeight : 800,
): CSSProperties {
  const rows = Math.max(1, count)
  const estimatedHeight = Math.min(MENU_MAX_HEIGHT, rows * EST_ROW_HEIGHT + EST_PAD_HEIGHT)
  const bottomLimit = Math.max(EDGE + estimatedHeight, viewportHeight - STATUS_BAR_HEIGHT - EDGE)
  const roomBelow = bottomLimit - (rect.bottom + GAP)
  const roomAbove = rect.top - GAP - EDGE
  if (roomBelow >= estimatedHeight || roomBelow >= roomAbove) {
    const maxHeight = Math.min(
      MENU_MAX_HEIGHT,
      Math.max(EST_ROW_HEIGHT + EST_PAD_HEIGHT, roomBelow),
    )
    return { position: 'fixed', top: rect.bottom + GAP, left: rect.left, maxHeight }
  }
  const maxHeight = Math.min(MENU_MAX_HEIGHT, Math.max(EST_ROW_HEIGHT + EST_PAD_HEIGHT, roomAbove))
  return {
    position: 'fixed',
    bottom: Math.max(STATUS_BAR_HEIGHT + EDGE, viewportHeight - rect.top + GAP),
    left: rect.left,
    maxHeight,
  }
}
/**
 * The `[[` suggester's popup: vault notes, shallowest first, filtered live,
 * and — while the query names something no note has — a last row that creates
 * that note (Obsidian's "Create new note"), keyboard and click both fine.
 * After a `#` the rows are the target's headings (`##`-glyphed) or its
 * `^block` ids with a line of context.
 */
export const WikiSuggestMenu = forwardRef<WikiSuggestMenuHandle, Props>(function WikiSuggestMenu(
  { state, onDismiss },
  ref,
) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)

  const items = state?.items ?? NO_ITEMS
  const canCreate = (state?.createName ?? '') !== ''
  const createAt = items.length
  const count = items.length + (canCreate ? 1 : 0)

  useEffect(() => {
    setIndex(0)
  }, [state?.items])

  useImperativeHandle(
    ref,
    () => ({
      handleKey(event: KeyboardEvent): boolean {
        if (!state) return false
        if (event.key === 'ArrowDown') {
          setIndex((i) => (count === 0 ? 0 : (i + 1) % count))
          return true
        }
        if (event.key === 'ArrowUp') {
          setIndex((i) => (count === 0 ? 0 : (i - 1 + count) % count))
          return true
        }
        if (event.key === 'Enter') {
          const item = items[index]
          if (item) state.command(item)
          else if (canCreate) state.create()
          return true
        }
        if (event.key === 'Escape') {
          onDismiss()
          return true
        }
        return false
      },
    }),
    [state, index, count, items, canCreate, onDismiss],
  )

  if (!state || !state.clientRect) return null
  const rect = state.clientRect

  return (
    <div
      className="slash-menu wiki-suggest"
      style={placeWikiSuggestMenu(rect, count)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {count === 0 ? (
        <div className="slash-empty">{t('slashNoResults')}</div>
      ) : (
        <>
          {items.map((item, i) => {
            const row =
              item.kind === 'note'
                ? { name: item.entry.name, path: item.entry.relPath, title: item.entry.relPath }
                : item.kind === 'heading'
                  ? { name: item.text, path: '#'.repeat(item.level), title: item.text }
                  : { name: `^${item.id}`, path: item.text, title: item.text }
            return (
              <button
                key={`${item.kind}:${i}`}
                type="button"
                className={`slash-item wiki-suggest-item${i === index ? ' active' : ''}`}
                title={row.title}
                onMouseEnter={() => setIndex(i)}
                onClick={() => state.command(item)}
              >
                <span className="wiki-suggest-name">{row.name}</span>
                <span className="wiki-suggest-path">{row.path}</span>
              </button>
            )
          })}
          {canCreate && (
            <button
              type="button"
              className={`slash-item wiki-suggest-item${createAt === index ? ' active' : ''}`}
              title={state.createName}
              onMouseEnter={() => setIndex(createAt)}
              onClick={() => state.create()}
            >
              <span className="wiki-suggest-name">{t('suggestCreateNote')}</span>
              <span className="wiki-suggest-path">{state.createName}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
})
