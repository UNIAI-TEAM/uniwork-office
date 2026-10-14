import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent, ReactElement } from 'react'
import {
  WORKBENCH_MODULES,
  getWorkbenchModule,
  isCorePinnedModule,
  type PracticeId,
  type PracticePillarId,
  type PracticePillarLabels,
  type WorkbenchModuleId,
} from '@uniwork/practice-core'
import { WbMenu, WbMenuItem, WbMenuLabel } from './WbMenu'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { useI18n } from './locale'
import type { tabCounts } from './work-home'
import {
  pinModule,
  pinPillar,
  readPinnedModules,
  readPinnedPillars,
  reorderPinnedModules,
  unpinModule,
  unpinPillar,
} from './workbench-pins'

export type WorkbenchTabId = string

interface WorkbenchTabsProps {
  practiceId: PracticeId
  pillars: readonly PracticePillarLabels[]
  active: WorkbenchTabId
  onSelect: (id: WorkbenchTabId) => void
  vi: boolean
  /** Called when pinned modules or pillars change (parent may clear active if unpinned). */
  onPinsChange?: (pins: WorkbenchModuleId[], pillarPins: PracticePillarId[]) => void
  /** Tasks and Calendar counts from the cached Overview summary (tabCounts) */
  counts?: ReturnType<typeof tabCounts>
}

function notifyPinsChanged(): void {
  window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
}

export function WorkbenchTabs({
  practiceId,
  pillars,
  active,
  onSelect,
  vi,
  onPinsChange,
  counts,
}: WorkbenchTabsProps): ReactElement {
  const [pins, setPins] = useState<WorkbenchModuleId[]>(() => readPinnedModules(practiceId))
  const [pillarPins, setPillarPins] = useState<PracticePillarId[]>(() =>
    readPinnedPillars(practiceId),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragId, setDragId] = useState<WorkbenchModuleId | null>(null)
  const [overId, setOverId] = useState<WorkbenchModuleId | null>(null)
  const dragMoved = useRef(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // the row overflows on that side: fade the edge and show a step button
  const [edges, setEdges] = useState({ start: false, end: false })
  // a tab moved by Alt+arrow: keep keyboard focus on it after the row re-renders
  const refocus = useRef<WorkbenchModuleId | null>(null)

  // one row that scrolls sideways: bring the selected tab into view
  useEffect(() => {
    scrollRef.current
      ?.querySelector('.wb-tab.active')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  // the scrollbar is hidden, so a mouse wheel scrolls the row sideways
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      const before = el.scrollLeft
      el.scrollLeft += e.deltaY
      // at either end the row cannot move: let the page scroll instead
      if (el.scrollLeft !== before) e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro?.disconnect()
    }
  }, [pins, pillarPins])

  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    scrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.focus()
  })

  useEffect(() => {
    setPins(readPinnedModules(practiceId))
    setPillarPins(readPinnedPillars(practiceId))
    setMenuOpen(false)
    setDragId(null)
    setOverId(null)
  }, [practiceId])

  useEffect(() => {
    const refresh = () => {
      setPins(readPinnedModules(practiceId))
      setPillarPins(readPinnedPillars(practiceId))
    }
    window.addEventListener('uniwork:wb-pins-changed', refresh)
    return () => window.removeEventListener('uniwork:wb-pins-changed', refresh)
  }, [practiceId])

  const { t } = useI18n()
  const pinnedPillarDefs = pillars.filter((p) => pillarPins.includes(p.id))
  const availablePillars = pillars.filter((p) => !pillarPins.includes(p.id))
  const availableModules = WORKBENCH_MODULES.filter((m) => !pins.includes(m.id))
  const nothingToAdd = availablePillars.length === 0 && availableModules.length === 0

  const emitChange = (nextPins: WorkbenchModuleId[], nextPillars: PracticePillarId[]) => {
    setPins(nextPins)
    setPillarPins(nextPillars)
    onPinsChange?.(nextPins, nextPillars)
    notifyPinsChanged()
  }

  const addModule = (id: WorkbenchModuleId) => {
    const next = pinModule(practiceId, id)
    emitChange(next, pillarPins)
    onSelect(id)
    setMenuOpen(false)
  }

  const addPillar = (id: PracticePillarId) => {
    const next = pinPillar(practiceId, id)
    emitChange(pins, next)
    onSelect(id)
    setMenuOpen(false)
  }

  const removeModule = (id: WorkbenchModuleId) => {
    if (isCorePinnedModule(id)) return
    const next = unpinModule(practiceId, id)
    emitChange(next, pillarPins)
    if (active === id) onSelect('desk')
  }

  const removePillar = (id: PracticePillarId) => {
    const next = unpinPillar(practiceId, id)
    emitChange(pins, next)
    if (active === id) onSelect('desk')
  }

  // Alt+←/→ on a focused non-core tab swaps it with its neighbour: the drag, by keyboard
  const onTabKeyDown = (id: WorkbenchModuleId, e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    if (isCorePinnedModule(id)) return
    e.preventDefault()
    const i = pins.indexOf(id)
    // the row runs right to left in an RTL locale
    const forward = (e.key === 'ArrowRight') !== (document.dir === 'rtl')
    const target = pins[forward ? i + 1 : i - 1]
    if (!target) return
    refocus.current = id
    emitChange(reorderPinnedModules(practiceId, id, target), pillarPins)
  }

  const step = (dir: 1 | -1) => {
    const el = scrollRef.current
    el?.scrollBy?.({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' })
  }

  const onDragStart = (id: WorkbenchModuleId, e: ReactDragEvent) => {
    dragMoved.current = false
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 24, 16)
    }
  }

  const onDragOver = (id: WorkbenchModuleId, e: ReactDragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragId && dragId !== id) {
      dragMoved.current = true
      setOverId(id)
    }
  }

  const onDrop = (id: WorkbenchModuleId, e: ReactDragEvent) => {
    e.preventDefault()
    const from = (e.dataTransfer.getData('text/plain') as WorkbenchModuleId) || dragId
    if (!from || from === id) {
      setDragId(null)
      setOverId(null)
      return
    }
    const next = reorderPinnedModules(practiceId, from, id)
    emitChange(next, pillarPins)
    setDragId(null)
    setOverId(null)
  }

  const onDragEnd = () => {
    setDragId(null)
    setOverId(null)
  }

  const unpinButton = (onClick: () => void, tabName: string) => (
    <button
      type="button"
      className="wb-tab-unpin"
      aria-label={`${t('wbCommonUnpin')}: ${tabName}`}
      title={t('wbCommonUnpin')}
      onClick={onClick}
    >
      <WbGlyph id="close" size={14} />
    </button>
  )

  return (
    <nav className="wb-tabs" aria-label={t('wbTabsAreas')}>
      {edges.start ? (
        <button
          type="button"
          className="wb-tabs-step"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => step(-1)}
        >
          <WbGlyph id="chevronLeft" />
        </button>
      ) : null}
      <div
        className={`wb-tabs-scroll${edges.start ? ' is-fade-start' : ''}${
          edges.end ? ' is-fade-end' : ''
        }`}
        ref={scrollRef}
      >
        {pins.map((id) => {
          const mod = getWorkbenchModule(id)
          if (!mod) return null
          const dragging = dragId === id
          const over = overId === id && dragId !== id
          const count = id === 'tasks' || id === 'calendar' ? counts?.[id] : undefined
          const core = isCorePinnedModule(id)
          const name = vi ? mod.labelVi : mod.labelEn
          return (
            <div key={id} className={`wb-tab-item${core ? '' : ' has-unpin'}`}>
              <button
                type="button"
                draggable
                data-tab-id={id}
                aria-current={active === id ? 'page' : undefined}
                aria-keyshortcuts={core ? undefined : 'Alt+ArrowLeft Alt+ArrowRight'}
                className={`wb-tab wb-tab-module is-movable${
                  active === id ? ' active' : ''
                }${dragging ? ' is-dragging' : ''}${over ? ' is-drag-over' : ''}`}
                onClick={() => {
                  if (dragMoved.current) {
                    dragMoved.current = false
                    return
                  }
                  onSelect(id)
                }}
                onKeyDown={(e) => onTabKeyDown(id, e)}
                onDragStart={(e) => onDragStart(id, e)}
                onDragOver={(e) => onDragOver(id, e)}
                onDrop={(e) => onDrop(id, e)}
                onDragEnd={onDragEnd}
                title={`${vi ? mod.hintVi : mod.hintEn} · ${t('wbCommonDragToReorder')}`}
              >
                <span className="wb-tab-grip" aria-hidden="true">
                  <WbGlyph id="grip" size={12} />
                </span>
                <span className="wb-tab-icon">
                  <WorkbenchIcon id={id} size={16} bare />
                </span>
                <span>{name}</span>
                {count ? (
                  <>
                    <span className={`wb-tab-count wb-num is-${count.tone}`} aria-hidden="true">
                      {count.n}
                    </span>
                    <span className="uw-sr-only">{t(count.key, { count: count.n })}</span>
                  </>
                ) : null}
              </button>
              {core ? null : unpinButton(() => removeModule(id), name)}
            </div>
          )
        })}

        {pinnedPillarDefs.map((p) => {
          const name = vi ? p.labelVi : p.labelEn
          return (
            <div key={p.id} className="wb-tab-item has-unpin">
              <button
                type="button"
                aria-current={active === p.id ? 'page' : undefined}
                className={`wb-tab wb-tab-module${active === p.id ? ' active' : ''}`}
                onClick={() => onSelect(p.id)}
                title={vi ? p.hintVi : p.hintEn}
              >
                <span className="wb-tab-icon">
                  <WorkbenchIcon id={p.id as PracticePillarId} size={16} bare />
                </span>
                <span>{name}</span>
              </button>
              {unpinButton(() => removePillar(p.id), name)}
            </div>
          )
        })}
      </div>
      {edges.end ? (
        <button
          type="button"
          className="wb-tabs-step"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => step(1)}
        >
          <WbGlyph id="chevronRight" />
        </button>
      ) : null}

      <div className="wb-menu-wrap">
        <button
          ref={addRef}
          type="button"
          className="wb-tab wb-tab-add"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('wbTabsAdd')}
          onClick={() => setMenuOpen((o) => !o)}
          title={t('wbTabsAdd')}
        >
          <WbGlyph id="plus" />
        </button>
        <WbMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={addRef}
          label={t('wbTabsMenuTitle')}
          className="wb-tab-menu"
        >
          {nothingToAdd ? <WbMenuLabel>{t('wbTabsAllPinned')}</WbMenuLabel> : null}
          {availablePillars.length > 0 ? <WbMenuLabel>{t('wbTabsCore')}</WbMenuLabel> : null}
          {availablePillars.map((p) => (
            <WbMenuItem
              key={p.id}
              icon={<WorkbenchIcon id={p.id} size={18} />}
              title={vi ? p.hintVi : p.hintEn}
              onSelect={() => addPillar(p.id)}
            >
              {vi ? p.labelVi : p.labelEn}
            </WbMenuItem>
          ))}
          {availableModules.length > 0 ? <WbMenuLabel>{t('wbTabsModules')}</WbMenuLabel> : null}
          {availableModules.map((m) => (
            <WbMenuItem
              key={m.id}
              icon={<WorkbenchIcon id={m.id} size={18} />}
              title={vi ? m.hintVi : m.hintEn}
              onSelect={() => addModule(m.id)}
            >
              {vi ? m.labelVi : m.labelEn}
            </WbMenuItem>
          ))}
        </WbMenu>
      </div>
    </nav>
  )
}
