import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  listPracticeGroups,
  type PracticeDefinition,
  type PracticeId,
} from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { WorkbenchIcon } from './WorkbenchIcons'

/** one entry of Home's "New" list (Home.tsx NEW_ITEMS) */
export interface WorkbenchNewItem {
  ext: string
  title: string
  action: () => unknown
}

interface Props {
  practice: PracticeDefinition
  onSwitchPractice: (id: PracticeId) => void
  /** empty while signed out or still loading: the workspace select is hidden */
  workspaces: readonly UniworkWorkspaceRef[]
  workspaceId: string | null
  onSelectWorkspace: (id: string) => void
  newItems: readonly WorkbenchNewItem[]
  onNewTask: () => void
  onRefresh: () => void
}

/** Workbench title, the "workspace · role" picker, + New and Refresh. */
export function WorkbenchTopBar({
  practice,
  onSwitchPractice,
  workspaces,
  workspaceId,
  onSelectWorkspace,
  newItems,
  onNewTask,
  onRefresh,
}: Props): ReactElement {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const run = (action: () => unknown) => {
    setMenuOpen(false)
    void action()
  }

  return (
    <header className="wb-topbar">
      <h1 className="wb-topbar-title">{t('wbTopTitle')}</h1>
      <div className="wb-topbar-picker">
        {workspaces.length > 0 ? (
          <>
            <select
              aria-label={t('wbTopWorkspace')}
              value={workspaceId ?? ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <span className="wb-topbar-sep" aria-hidden="true">
              ·
            </span>
          </>
        ) : null}
        <select
          aria-label={t('wbTopRole')}
          value={practice.id}
          onChange={(e) => onSwitchPractice(e.target.value as PracticeId)}
        >
          {listPracticeGroups(vi).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.practices.map((p) => (
                <option key={p.id} value={p.id}>
                  {vi ? p.labelVi : p.labelEn}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="wb-topbar-actions">
        <button type="button" className="btn btn-secondary" onClick={onRefresh}>
          {t('wbTopRefresh')}
        </button>
        <div className="wb-new-wrap" ref={wrapRef}>
          <button
            type="button"
            className="btn btn-primary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            + {t('wbTopNew')}
          </button>
          {menuOpen ? (
            <div className="wb-new-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="wb-new-item"
                onClick={() => run(onNewTask)}
              >
                <WorkbenchIcon id="tasks" size={18} />
                <span>{t('wbTopNewTask')}</span>
              </button>
              {newItems.map((item) => (
                <button
                  key={item.ext}
                  type="button"
                  role="menuitem"
                  className="wb-new-item"
                  onClick={() => run(item.action)}
                >
                  <FileBadge ext={item.ext} size={18} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
