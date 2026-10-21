import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import type { UniworkDocSummary } from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { docExtension } from '../uniwork-docs-model'
import { FolderGlyph } from '../uniwork-folders/UniworkFolderTree'
import { isFolderEntry } from '../uniwork-folders/uniwork-folders-model'
import '../uniwork-home/documents-home.css'
import './doclist-picker.css'
import { Person } from './cells'
import { COLUMN_LABEL_KEY } from './columns'
import type { DocSubline } from './DocRow'
import { formatListDate } from './format'
import { pickerColumnsFor, pickerSublineOf, pickerTrackOf, type PickerColumnId } from './picker'
import { editorNameOf } from './table-model'

/** what a row is, for the classes the Open dialog styles */
export interface PickerRowState {
  /** the row cannot be opened (dimmed) */
  disabled?: boolean
  /** the row is in the trash: parked, not unsupported */
  archived?: boolean
  /** an open of this row is under way */
  opening?: boolean
}

/** the attributes and handlers a host puts on a row's option (id, tabindex, keys, clicks...) */
export type PickerOptionProps = HTMLAttributes<HTMLDivElement> & { 'data-id'?: string }

export interface DocPickerListProps {
  /** the rows, in the order to show them: the picker never sorts */
  docs: readonly UniworkDocSummary[]
  /** accessible name of the listbox */
  label: string
  /** the highlighted row (the host moves it with its own keys) */
  activeId: string | null
  id?: string
  describedBy?: string
  /** classes of the listbox beside the picker's own */
  className?: string
  listRef?: Ref<HTMLUListElement>
  /** px the rows keep clear for the buttons the host puts beside them (default: Details + "…") */
  reserve?: number
  stateOf?: (doc: UniworkDocSummary) => PickerRowState
  /** the title as shown (My Folder is named by its label) */
  titleOf?: (doc: UniworkDocSummary) => string
  /** the second line: where the row sits, or which workspace shared it */
  sublineFor?: (doc: UniworkDocSummary) => DocSubline | null
  /** replaces the file badge (a row that is not a file, e.g. a notification); null keeps the badge */
  iconFor?: (doc: UniworkDocSummary) => ReactNode
  /** replaces the title (rename in place); null keeps it */
  nameFor?: (doc: UniworkDocSummary) => ReactNode
  optionProps?: (doc: UniworkDocSummary, index: number) => PickerOptionProps
  /** the row's buttons, after its option inside the same item */
  trailing?: (doc: UniworkDocSummary) => ReactNode
}

/** the width of an element, kept up to date; 0 until it is measured */
function useWidth(): [number, (el: HTMLElement | null) => void] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect.width
      if (typeof next === 'number') setWidth(next)
    })
    observer.current.observe(el)
  }, [])
  return [width, measure]
}

const COLUMN_CLASS: Record<PickerColumnId, string> = {
  name: 'dh-pick-name',
  editor: 'dh-cell-person',
  updated: 'dh-cell-time',
}

/**
 * The compact `picker` variant of the Documents list, for the Open dialog and
 * the folder browser: Tên (+ a second line) · Người sửa gần nhất · Cập nhật on
 * the shared formatters. One listbox of options, one choice: no Chọn, no sort,
 * no Truy cập or Dung lượng. The host owns what a row does (its keys, clicks,
 * buttons and menu); Người sửa hides by the width of the list itself and its
 * name then moves under the title.
 */
export function DocPickerList({
  docs,
  label,
  activeId,
  id,
  describedBy,
  className,
  listRef,
  reserve,
  stateOf,
  titleOf,
  sublineFor,
  iconFor,
  nameFor,
  optionProps,
  trailing,
}: DocPickerListProps) {
  const { t, dateLocale } = useI18n()
  const [width, measure] = useWidth()
  const columns = pickerColumnsFor(width > 0 ? width : undefined)
  const showEditor = columns.includes('editor')
  const track = pickerTrackOf(columns)
  const now = new Date()
  const style =
    reserve === undefined ? undefined : ({ '--pick-trail-base': `${reserve}px` } as CSSProperties)

  return (
    <div ref={measure} className="dh-picker" style={style}>
      <div className="dh-picker-head" aria-hidden="true" style={{ gridTemplateColumns: track }}>
        {columns.map((column) => (
          <span key={column} data-col={column}>
            {t(COLUMN_LABEL_KEY[column])}
          </span>
        ))}
      </div>
      <ul
        className={`uw-pick-list${className ? ` ${className}` : ''}`}
        id={id}
        role="listbox"
        aria-label={label}
        aria-describedby={describedBy}
        ref={listRef}
      >
        {docs.map((doc, index) => {
          const state = stateOf?.(doc) ?? {}
          const active = doc.id === activeId
          const folder = isFolderEntry(doc)
          const title = titleOf ? titleOf(doc) : doc.title
          const editor = editorNameOf(doc)
          const subline = pickerSublineOf(sublineFor?.(doc) ?? null, editor, showEditor)
          const { className: rowClass, ...rest } = optionProps?.(doc, index) ?? {}
          const renamed = nameFor?.(doc)
          const icon = iconFor?.(doc)
          return (
            <li key={doc.id} role="presentation" className="uw-pick-item">
              <div
                {...rest}
                role="option"
                data-id={doc.id}
                aria-selected={active}
                className={[
                  'uw-pick-row dh-pick-row',
                  active && 'active',
                  state.disabled && 'disabled',
                  state.archived && 'archived',
                  state.opening && 'opening',
                  rowClass,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ gridTemplateColumns: track }}
              >
                {columns.map((column) => {
                  switch (column) {
                    case 'name':
                      return (
                        <span key={column} data-col={column} className={COLUMN_CLASS[column]}>
                          {icon ? (
                            icon
                          ) : folder ? (
                            <span className="uwf-row-icon">
                              <FolderGlyph />
                            </span>
                          ) : (
                            <FileBadge
                              ext={doc.kind === 'page' ? 'page' : docExtension(doc)}
                              size={24}
                            />
                          )}
                          <span className="uw-pick-row-text">
                            {renamed ?? <span className="uw-pick-row-title">{title}</span>}
                            {subline && (
                              <span
                                className={`uw-pick-row-meta${subline.path ? ' uwf-path' : ''}`}
                                title={subline.path ? undefined : subline.full}
                              >
                                {subline.path ? (
                                  <>
                                    <span aria-hidden="true">{subline.short}</span>
                                    <span className="uw-sr-only">
                                      {t('ufPathLabel', { path: subline.full })}
                                    </span>
                                  </>
                                ) : (
                                  subline.short
                                )}
                              </span>
                            )}
                          </span>
                        </span>
                      )
                    case 'editor':
                      return (
                        <span key={column} data-col={column} className={COLUMN_CLASS[column]}>
                          <Person name={editor} />
                        </span>
                      )
                    case 'updated':
                      return (
                        <span key={column} data-col={column} className={COLUMN_CLASS[column]}>
                          {formatListDate(doc.updatedAt, now, dateLocale, t)}
                        </span>
                      )
                  }
                })}
              </div>
              {trailing?.(doc)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
