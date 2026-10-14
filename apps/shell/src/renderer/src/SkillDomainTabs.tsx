import { useEffect, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import { SKILL_DOMAINS, getSkillDomain, type SkillDomainId } from '@uniwork/practice-core'
import {
  pinSkillDomain,
  readActiveSkillDomain,
  readPinnedSkillDomains,
  reorderPinnedSkillDomains,
  unpinSkillDomain,
  writeActiveSkillDomain,
} from './skill-domain-pins'
import { MODULE_TONES, tintStyle } from './module-tones'
import { useI18n } from './locale'
import { WbMenu, WbMenuItem, WbMenuLabel } from './WbMenu'
import { WbGlyph } from './WorkbenchIcons'

interface Props {
  vi: boolean
  active: SkillDomainId
  onSelect: (id: SkillDomainId) => void
  onPinsChange?: (pins: SkillDomainId[]) => void
}

function DomainBadge({ id, size = 18 }: { id: SkillDomainId; size?: number }): ReactElement {
  const def = getSkillDomain(id)
  const letter = (def?.labelEn ?? id).slice(0, 1).toUpperCase()
  return (
    <span
      className="wb-domain-badge"
      style={{ ...tintStyle(MODULE_TONES.skills), width: size, height: size }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

export function SkillDomainTabs({ vi, active, onSelect, onPinsChange }: Props): ReactElement {
  const [pins, setPins] = useState<SkillDomainId[]>(() => readPinnedSkillDomains())
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragId, setDragId] = useState<SkillDomainId | null>(null)
  const [overId, setOverId] = useState<SkillDomainId | null>(null)
  const dragMoved = useRef(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const { t } = useI18n()

  useEffect(() => {
    const next = readPinnedSkillDomains()
    setPins(next)
    if (!next.includes(active)) {
      onSelect(readActiveSkillDomain(next))
    }
    // Sync pins from storage once on mount; parent owns active thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const availableToAdd = SKILL_DOMAINS.filter((d) => !pins.includes(d.id))

  const select = (id: SkillDomainId) => {
    writeActiveSkillDomain(id)
    onSelect(id)
  }

  const add = (id: SkillDomainId) => {
    const next = pinSkillDomain(id)
    setPins(next)
    onPinsChange?.(next)
    select(id)
    setMenuOpen(false)
  }

  const remove = (id: SkillDomainId, e: ReactMouseEvent) => {
    e.stopPropagation()
    if (pins.length <= 1) return
    const next = unpinSkillDomain(id)
    setPins(next)
    onPinsChange?.(next)
    if (active === id) select(readActiveSkillDomain(next))
  }

  const onDragStart = (id: SkillDomainId, e: ReactDragEvent) => {
    dragMoved.current = false
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 24, 16)
    }
  }

  const onDragOver = (id: SkillDomainId, e: ReactDragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId && dragId !== id) {
      dragMoved.current = true
      setOverId(id)
    }
  }

  const onDrop = (id: SkillDomainId, e: ReactDragEvent) => {
    e.preventDefault()
    const from = (e.dataTransfer.getData('text/plain') as SkillDomainId) || dragId
    if (!from || from === id) {
      setDragId(null)
      setOverId(null)
      return
    }
    const next = reorderPinnedSkillDomains(from, id)
    setPins(next)
    onPinsChange?.(next)
    setDragId(null)
    setOverId(null)
  }

  return (
    <nav className="skill-domain-tabs" aria-label={t('wbSkTabsNav')}>
      {pins.map((id) => {
        const mod = getSkillDomain(id)
        if (!mod) return null
        const dragging = dragId === id
        const over = overId === id && dragId !== id
        return (
          <button
            key={id}
            type="button"
            draggable
            className={`skill-domain-tab${active === id ? ' active' : ''}${
              dragging ? ' is-dragging' : ''
            }${over ? ' is-drag-over' : ''}`}
            onClick={() => {
              if (dragMoved.current) {
                dragMoved.current = false
                return
              }
              select(id)
            }}
            onDragStart={(e) => onDragStart(id, e)}
            onDragOver={(e) => onDragOver(id, e)}
            onDrop={(e) => onDrop(id, e)}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            title={`${vi ? mod.hintVi : mod.hintEn} · ${t('wbCommonDragToReorder')}`}
          >
            <span className="skill-domain-tab-grip" aria-hidden>
              <WbGlyph id="grip" size={12} />
            </span>
            <span className="skill-domain-tab-icon">
              <DomainBadge id={id} size={18} />
            </span>
            <span>{vi ? mod.labelVi : mod.labelEn}</span>
            {pins.length > 1 ? (
              <span
                className="skill-domain-tab-unpin"
                role="button"
                tabIndex={0}
                draggable={false}
                aria-label={t('wbCommonUnpin')}
                onClick={(e) => remove(id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    remove(id, e as unknown as ReactMouseEvent)
                  }
                }}
              >
                <WbGlyph id="close" size={14} />
              </span>
            ) : null}
          </button>
        )
      })}

      <div className="wb-menu-wrap">
        <button
          ref={addRef}
          type="button"
          className={`skill-domain-tab skill-domain-add${menuOpen ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('wbSkTabsAdd')}
          onClick={() => setMenuOpen((o) => !o)}
          title={t('wbSkTabsAdd')}
        >
          <span className="skill-domain-tab-icon" aria-hidden>
            <WbGlyph id="plus" />
          </span>
        </button>
        <WbMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={addRef}
          label={t('wbSkTabsMenuTitle')}
        >
          {availableToAdd.length === 0 ? (
            <WbMenuLabel>{t('wbSkTabsAllPinned')}</WbMenuLabel>
          ) : (
            availableToAdd.map((m) => (
              <WbMenuItem
                key={m.id}
                icon={<DomainBadge id={m.id} size={22} />}
                hint={vi ? m.hintVi : m.hintEn}
                onSelect={() => add(m.id)}
              >
                {vi ? m.labelVi : m.labelEn}
              </WbMenuItem>
            ))
          )}
        </WbMenu>
      </div>
    </nav>
  )
}
