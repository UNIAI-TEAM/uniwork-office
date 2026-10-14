import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  listPracticeGroups,
  type PracticeDefinition,
  type PracticeId,
} from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { WbMenu, WbMenuItem } from './WbMenu'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'

/** one entry of Home's "New" list (Home.tsx NEW_ITEMS) */
export interface WorkbenchNewItem {
  ext: string
  title: string
  action: () => unknown
}

interface Props {
  practice: PracticeDefinition
  onSwitchPractice: (id: PracticeId) => void
  /** empty while signed out or still loading: the workspace chip is hidden */
  workspaces: readonly UniworkWorkspaceRef[]
  workspaceId: string | null
  onSelectWorkspace: (id: string) => void
  newItems: readonly WorkbenchNewItem[]
  onNewTask: () => void
  onRefresh: () => void
}

/**
 * Workbench page head (redesign spec 3): the title, the workspace and role chips,
 * Refresh and New. Each chip lays a transparent native select over itself, so
 * keyboard and screen readers keep the platform picker.
 */
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
  const newRef = useRef<HTMLButtonElement>(null)
  // a select whose value is not listed shows its first option, so the chip does too
  const ws = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0]

  const run = (action: () => unknown) => {
    setMenuOpen(false)
    void action()
  }

  return (
    <header className="wb-topbar">
      <h1 className="wb-topbar-title">{t('wbTopTitle')}</h1>
      {ws ? (
        <span className="wb-crumb wb-crumb-ws">
          <span className="wb-crumb-mark" aria-hidden="true">
            {Array.from(ws.name.trim())[0]?.toUpperCase()}
          </span>
          <span className="wb-crumb-name" aria-hidden="true">
            {ws.name}
          </span>
          <span
            className={`wb-crumb-caret${workspaces.length === 1 ? ' is-muted' : ''}`}
            aria-hidden="true"
          >
            <WbGlyph id="chevronDown" size={14} />
          </span>
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
        </span>
      ) : null}
      <span className="wb-crumb wb-crumb-role">
        <span className="wb-crumb-name" aria-hidden="true">
          {vi ? practice.labelVi : practice.labelEn}
        </span>
        <span className="wb-crumb-caret" aria-hidden="true">
          <WbGlyph id="chevronDown" size={14} />
        </span>
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
      </span>
      <div className="wb-topbar-actions">
        <button
          type="button"
          className="wb-btn wb-btn-secondary wb-btn-icon"
          aria-label={t('wbTopRefresh')}
          title={t('wbTopRefresh')}
          onClick={onRefresh}
        >
          <WbGlyph id="refresh" />
        </button>
        <div className="wb-menu-wrap">
          <button
            ref={newRef}
            type="button"
            className="wb-btn wb-btn-primary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <WbGlyph id="plus" />
            {t('wbTopNew')}
            <WbGlyph id="chevronDown" size={14} />
          </button>
          <WbMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={newRef}
            label={t('wbTopNew')}
            >
            <WbMenuItem
              icon={<WorkbenchIcon id="tasks" size={18} />}
              onSelect={() => run(onNewTask)}
            >
              {t('wbTopNewTask')}
            </WbMenuItem>
            {newItems.map((item) => (
              <WbMenuItem
                key={item.ext}
                icon={<FileBadge ext={item.ext} size={18} />}
                onSelect={() => run(item.action)}
              >
                {item.title}
              </WbMenuItem>
            ))}
          </WbMenu>
        </div>
      </div>
    </header>
  )
}
