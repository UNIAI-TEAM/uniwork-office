import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
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
import { WbMenuButton } from './WbMenu'
import { WbGlyph } from './WorkbenchIcons'

interface Props {
  vi: boolean
  active: SkillDomainId
  onSelect: (id: SkillDomainId) => void
  onPinsChange?: (pins: SkillDomainId[]) => void
}

/** the domain's first letter in the UI language, so the tile agrees with the label next to it */
function DomainBadge({
  id,
  vi,
  size = 18,
}: {
  id: SkillDomainId
  vi: boolean
  size?: number
}): ReactElement {
  const def = getSkillDomain(id)
  const letter = ((vi ? def?.labelVi : def?.labelEn) ?? id).slice(0, 1).toUpperCase()
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

/**
 * The pinned skill domains as one segmented control (redesign spec 4.9): plain toggle buttons
 * with nothing nested in them, a ⋯ menu (with two or more pins) that moves or unpins the shown
 * domain, and a ghost "Add a field" menu.
 */
export function SkillDomainTabs({ vi, active, onSelect, onPinsChange }: Props): ReactElement {
  const [pins, setPins] = useState<SkillDomainId[]>(() => readPinnedSkillDomains())
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

  const name = (id: SkillDomainId) => {
    const def = getSkillDomain(id)
    return (vi ? def?.labelVi : def?.labelEn) ?? id
  }

  const select = (id: SkillDomainId) => {
    writeActiveSkillDomain(id)
    onSelect(id)
  }

  const update = (next: SkillDomainId[]) => {
    setPins(next)
    onPinsChange?.(next)
  }

  const add = (id: SkillDomainId) => {
    update(pinSkillDomain(id))
    select(id)
  }

  const groupRef = useRef<HTMLDivElement>(null)
  // the unpinned segment (and with one pin left, the ⋯ that had focus) is gone: focus the shown one
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    groupRef.current?.querySelector<HTMLElement>('.skill-domain-tab.active')?.focus()
  })

  const remove = (id: SkillDomainId) => {
    const next = unpinSkillDomain(id)
    refocus.current = true
    update(next)
    select(readActiveSkillDomain(next))
  }

  const at = pins.indexOf(active)
  const move = (by: -1 | 1) => {
    const to = pins[at + by]
    if (to) update(reorderPinnedSkillDomains(active, to))
  }

  return (
    <div className="skill-domain-bar">
      <div ref={groupRef} className="skill-domain-tabs" role="group" aria-label={t('wbSkTabsNav')}>
        {pins.map((id) => {
          const mod = getSkillDomain(id)
          if (!mod) return null
          return (
            <button
              key={id}
              type="button"
              className={`skill-domain-tab${active === id ? ' active' : ''}`}
              aria-pressed={active === id}
              title={vi ? mod.hintVi : mod.hintEn}
              onClick={() => select(id)}
            >
              <DomainBadge id={id} vi={vi} />
              <span>{name(id)}</span>
            </button>
          )
        })}
      </div>
      {/* an agent can show a domain that is not pinned: nothing here could move or unpin it */}
      {pins.length > 1 && at >= 0 ? (
        <WbMenuButton
          label={t('wbSkDomainMore')}
          items={[
            {
              label: t('wbSkMoveEarlier', { name: name(active) }),
              icon: <WbGlyph id="chevronLeft" />,
              disabled: at <= 0,
              onSelect: () => move(-1),
            },
            {
              label: t('wbSkMoveLater', { name: name(active) }),
              icon: <WbGlyph id="chevronRight" />,
              disabled: at >= pins.length - 1,
              onSelect: () => move(1),
            },
            {
              label: t('wbSkUnpinDomain', { name: name(active) }),
              icon: <WbGlyph id="close" />,
              onSelect: () => remove(active),
            },
          ]}
        />
      ) : null}
      <WbMenuButton
        label={t('wbSkTabsAdd')}
        menuLabel={t('wbSkTabsMenuTitle')}
        className="wb-btn wb-btn-ghost wb-btn-sm"
        empty={t('wbSkTabsAllPinned')}
        items={SKILL_DOMAINS.filter((d) => !pins.includes(d.id)).map((m) => ({
          label: vi ? m.labelVi : m.labelEn,
          hint: vi ? m.hintVi : m.hintEn,
          icon: <DomainBadge id={m.id} vi={vi} size={22} />,
          onSelect: () => add(m.id),
        }))}
      >
        <WbGlyph id="plus" />
        {t('wbSkTabsAdd')}
      </WbMenuButton>
    </div>
  )
}
