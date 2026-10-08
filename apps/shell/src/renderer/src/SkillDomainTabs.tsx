import { useEffect, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import {
  SKILL_DOMAINS,
  getSkillDomain,
  type SkillDomainId,
} from '@uniwork/practice-core'
import {
  pinSkillDomain,
  readActiveSkillDomain,
  readPinnedSkillDomains,
  reorderPinnedSkillDomains,
  unpinSkillDomain,
  writeActiveSkillDomain,
} from './skill-domain-pins'

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
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill={def?.color ?? '#64748B'} />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="#fff"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  )
}

export function SkillDomainTabs({ vi, active, onSelect, onPinsChange }: Props): ReactElement {
  const [pins, setPins] = useState<SkillDomainId[]>(() => readPinnedSkillDomains())
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragId, setDragId] = useState<SkillDomainId | null>(null)
  const [overId, setOverId] = useState<SkillDomainId | null>(null)
  const dragMoved = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const label = (a: string, b: string) => (vi ? a : b)

  useEffect(() => {
    const next = readPinnedSkillDomains()
    setPins(next)
    if (!next.includes(active)) {
      onSelect(readActiveSkillDomain(next))
    }
    // Sync pins from storage once on mount; parent owns active thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

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
    if (active === id) select(next[0] ?? 'education')
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
    <nav className="skill-domain-tabs" aria-label={label('Tab kỹ năng chuyên môn', 'Skill domain tabs')}>
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
            title={`${vi ? mod.hintVi : mod.hintEn} · ${label('Kéo để sắp xếp', 'Drag to reorder')}`}
          >
            <span className="skill-domain-tab-grip" aria-hidden>
              ⋮⋮
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
                aria-label={label('Bỏ tab', 'Unpin tab')}
                onClick={(e) => remove(id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    remove(id, e as unknown as ReactMouseEvent)
                  }
                }}
              >
                ×
              </span>
            ) : null}
          </button>
        )
      })}

      <div className="skill-domain-add-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`skill-domain-tab skill-domain-add${menuOpen ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          title={label('Thêm tab kỹ năng', 'Add Skill tab')}
        >
          <span className="skill-domain-tab-icon" aria-hidden>
            +
          </span>
        </button>
        {menuOpen && (
          <div className="skill-domain-menu" role="menu">
            <p className="skill-domain-menu-title">
              {label('Thêm lĩnh vực kỹ năng', 'Add Skill domain')}
            </p>
            {availableToAdd.length === 0 ? (
              <p className="skill-domain-menu-empty">
                {label('Đã thêm đủ lĩnh vực.', 'All domains are pinned.')}
              </p>
            ) : (
              <div className="skill-domain-menu-grid">
                {availableToAdd.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitem"
                    className="skill-domain-menu-item"
                    onClick={() => add(m.id)}
                    title={vi ? m.hintVi : m.hintEn}
                  >
                    <span className="skill-domain-menu-icon">
                      <DomainBadge id={m.id} size={22} />
                    </span>
                    <strong>{vi ? m.labelVi : m.labelEn}</strong>
                    <span>{vi ? m.hintVi : m.hintEn}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
