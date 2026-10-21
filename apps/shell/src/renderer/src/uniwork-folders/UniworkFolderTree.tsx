import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { UniworkFolderNode } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { RenameField } from '../UniworkDocActions'
import type { DocNameError } from '../uniwork-docs-model'
import { FolderMenu, type FolderMenuItem } from './FolderMenu'
import {
  FOLDER_NAME_ERROR_KEYS,
  MOVE_BLOCK_KEYS,
  MY_FOLDER_LABEL_KEY,
  ROOT_KEY,
  isMyFolder,
  treeKey,
  treeRows,
  withMyFolderLabel,
  type MoveBlock,
  type TreeRow,
} from './uniwork-folders-model'
import './uniwork-folders.css'

/** a folder row's inline rename (F2 / the row menu); the browser owns the call */
export interface TreeRename {
  id: string
  error: DocNameError | null
  busy: boolean
}

export function FolderGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg className="uwf-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={
          open
            ? 'M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.5h5.5c.69 0 1.25.56 1.25 1.25v.75H4.6c-.5 0-.95.3-1.14.77L1.75 11.5z M3.5 7.25h11l-1.6 5.25H1.9z'
            : 'M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.5h5.5c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z'
        }
        fill="currentColor"
      />
    </svg>
  )
}

export function MyFolderGlyph() {
  return (
    <svg
      className="uwf-glyph uwf-glyph-my-folder"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
      <path d="M3 10h8" />
      <path d="M3 7v11a2 2 0 0 0 2 2h6" />
      <rect x="14" y="14" width="7" height="6" rx="1.2" />
      <path d="M16 14v-1.5a1.5 1.5 0 0 1 3 0V14" />
    </svg>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`uwf-chevron${expanded ? ' open' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M4.5 2.75 7.75 6 4.5 9.25"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * FD-11: the workspace's folder tree (WAI-ARIA tree view). One tab stop (the
 * focused row); arrows move and expand/collapse, Home/End jump, Enter opens,
 * F2 renames in place, Shift+F10 / the context-menu key / a right click open
 * the row menu. Expand state lives in the host (in memory only). In the
 * picker, rows that cannot take the item stay visible but aria-disabled with
 * their reason shown on the row. My Folder shows its localized label (from
 * `systemKind`, never the stored title) and sits first among its siblings.
 * `hideRoot` drops the root row (the Documents sidebar, as the web's folders
 * tree: its nav item is the root); the top-level folders then sit at the first
 * level, always shown.
 */
export function UniworkFolderTree({
  nodes,
  label,
  expanded,
  onExpandedChange,
  selectedKey,
  onOpen,
  blockOf,
  menuFor,
  rename,
  onRenameSave,
  onRenameCancel,
  onRenameEdit,
  tagOf,
  checkLabel,
  idPrefix = 'uwf-tree',
  hideRoot = false,
}: {
  nodes: UniworkFolderNode[]
  label: string
  expanded: ReadonlySet<string>
  onExpandedChange: (next: Set<string>) => void
  /** ROOT_KEY or a folder id: the open (browser) / chosen (picker) folder */
  selectedKey: string
  /** a row was chosen: click or Enter (null = the root) */
  onOpen: (id: string | null) => void
  blockOf?: (id: string | null) => MoveBlock
  menuFor?: (row: TreeRow) => FolderMenuItem[]
  rename?: TreeRename | null
  onRenameSave?: (id: string, value: string) => void
  onRenameCancel?: (id: string) => void
  onRenameEdit?: () => void
  /** SAVE-01 State 2: a short tag at the row's end (its visibility), null = none */
  tagOf?: (row: TreeRow) => string | null
  /** SAVE-01 State 2: the selected row carries a check with this accessible name */
  checkLabel?: string
  idPrefix?: string
  /** no root row: the top-level folders at the first level (the picker and dialogs keep it) */
  hideRoot?: boolean
}) {
  const { t } = useI18n()
  // `t` is not referentially stable: the memo keys on the translated string
  const rootTitle = t('ufRoot')
  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)
  const rows = useMemo(() => {
    const labelled = withMyFolderLabel(nodes, myFolderLabel)
    if (!hideRoot) return treeRows(labelled, expanded, rootTitle)
    return treeRows(labelled, new Set([...expanded, ROOT_KEY]), rootTitle)
      .slice(1)
      .map((row) => ({
        ...row,
        level: row.level - 1,
        parentKey: row.parentKey === ROOT_KEY ? null : row.parentKey,
      }))
  }, [nodes, expanded, rootTitle, myFolderLabel, hideRoot])
  const [focusKey, setFocusKey] = useState(selectedKey)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /** focus moves to the row only after a key in the tree, never on a re-render */
  const moveFocus = useRef(false)

  // the open folder changed elsewhere (breadcrumb, contents): the tab stop follows it
  useEffect(() => setFocusKey(selectedKey), [selectedKey])

  // a focused row hidden by a collapse or gone after a refresh hands the tab stop on (to the
  // first drawn row when the selection is not drawn: no folder open in a root-less tree)
  const tabKey = rows.some((r) => r.key === focusKey)
    ? focusKey
    : rows.some((r) => r.key === selectedKey)
      ? selectedKey
      : (rows[0]?.key ?? ROOT_KEY)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])
      .find((el) => el.dataset.key === tabKey)
      ?.focus()
  }, [tabKey])

  const toggle = (key: string, open: boolean) => {
    const next = new Set(expanded)
    if (open) next.add(key)
    else next.delete(key)
    onExpandedChange(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, row: TreeRow) => {
    if (event.nativeEvent.isComposing) return
    // keys inside the inline rename field are its own
    if ((event.target as HTMLElement).tagName === 'INPUT') return
    const result = treeKey(rows, row.key, event.key, { shift: event.shiftKey })
    if (!result) return
    event.preventDefault()
    event.stopPropagation()
    if ('focus' in result) {
      moveFocus.current = true
      setFocusKey(result.focus)
    } else if ('expand' in result) toggle(result.expand, true)
    else if ('collapse' in result) toggle(result.collapse, false)
    else if ('open' in result) {
      if (!blockOf?.(row.id)) onOpen(row.id)
    } else if ('menu' in result) {
      if (menuFor && menuFor(row).length > 0) setMenuKey(row.key)
    } else if ('rename' in result) {
      menuFor?.(row)
        .find((item) => item.id === 'rename')
        ?.onSelect()
    }
  }

  // a root-less tree with no folder draws no empty tree
  if (rows.length === 0) return null

  return (
    <ul className="uwf-tree" role="tree" aria-label={label} ref={listRef}>
      {rows.map((row) => {
        const block = blockOf?.(row.id) ?? null
        const selected = row.key === selectedKey
        const editing = rename && row.id === rename.id ? rename : null
        const reasonId = `${idPrefix}-reason-${row.key || 'root'}`
        const items = menuFor?.(row) ?? []
        const tag = tagOf?.(row) ?? null
        return (
          <li
            key={row.key || 'root'}
            role="treeitem"
            data-key={row.key}
            aria-level={row.level}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={selected}
            aria-disabled={block ? true : undefined}
            aria-describedby={block ? reasonId : undefined}
            tabIndex={row.key === tabKey ? 0 : -1}
            className={`uwf-tree-row${selected ? ' selected' : ''}${block ? ' blocked' : ''}`}
            style={{ paddingInlineStart: `${4 + (row.level - 1) * 14}px` }}
            onKeyDown={(e) => onKeyDown(e, row)}
            onFocus={(e) => {
              if (e.target === e.currentTarget) setFocusKey(row.key)
            }}
            onClick={() => {
              setFocusKey(row.key)
              if (!block && !editing) onOpen(row.id)
            }}
            onContextMenu={(e) => {
              if (items.length === 0) return
              e.preventDefault()
              setFocusKey(row.key)
              setMenuKey(row.key)
            }}
          >
            <span
              className="uwf-twisty"
              aria-hidden="true"
              onClick={(e) => {
                if (!row.hasChildren) return
                e.stopPropagation()
                toggle(row.key, !row.expanded)
              }}
            >
              {row.hasChildren && <Chevron expanded={row.expanded} />}
            </span>
            {row.id === null ? (
              <svg
                className="uwf-glyph"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M2.25 7.1 8 2.5l5.75 4.6V13c0 .41-.34.75-.75.75H9.75V10h-3.5v3.75H3c-.41 0-.75-.34-.75-.75z"
                  fill="currentColor"
                />
              </svg>
            ) : isMyFolder(row) ? (
              <MyFolderGlyph />
            ) : (
              <FolderGlyph open={row.expanded} />
            )}
            {editing && onRenameSave ? (
              <RenameField
                initial={row.title}
                label={row.title}
                nameLabel={t('ufFolderName')}
                error={editing.error}
                busy={editing.busy}
                errorKeys={FOLDER_NAME_ERROR_KEYS}
                onSave={(value) => onRenameSave(row.id!, value)}
                onCancel={() => onRenameCancel?.(row.id!)}
                onEdit={() => onRenameEdit?.()}
              />
            ) : (
              <span className="uwf-tree-text">
                <span className="uwf-tree-title">{row.title}</span>
                {block && (
                  <span className="uwf-reason" id={reasonId}>
                    {t(MOVE_BLOCK_KEYS[block])}
                  </span>
                )}
              </span>
            )}
            {tag && <span className="uwf-tree-tag">{tag}</span>}
            {checkLabel && selected && (
              <svg
                className="uwf-tree-check"
                role="img"
                aria-label={checkLabel}
                width="16"
                height="16"
                viewBox="0 0 16 16"
              >
                <path
                  d="M13.25 4.5 6.5 11.25 2.75 7.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {items.length > 0 && !editing && (
              <FolderMenu
                label={t('ufActionsFor', { name: row.title })}
                items={items}
                dataFor={row.key}
                open={menuKey === row.key}
                onOpenChange={(open) => setMenuKey(open ? row.key : null)}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
