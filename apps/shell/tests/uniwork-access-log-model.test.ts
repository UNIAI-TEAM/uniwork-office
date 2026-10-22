import { describe, expect, it, vi } from 'vitest'
import {
  ACCESS_LOG_FILTERS,
  accessLogActor,
  accessLogActionKey,
  accessLogViaKey,
  canOfferAccessLog,
  canReadAccessLog,
} from '../src/renderer/src/uniwork-doc-history/access-log-model'
import { buildRowMenu, type RowMenuActionId } from '../src/renderer/src/doclist/row-menu'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import type { StringKey } from '../src/renderer/src/locale'
import { accessLogOf } from './doc-history-fake-bridge'

/**
 * UNI-2077 UI-L: who may read / is offered the access log (the web's document-actions-menu gate:
 * canManage && !owned && !archived && !shelved), and how a log row is named.
 */

const doc = (partial: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
  id: 'd1',
  workspaceId: 'ws-1',
  title: 'Kế hoạch.docx',
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  myLevel: 'manage',
  canEdit: true,
  canManage: true,
  ...partial,
})

describe('canReadAccessLog', () => {
  it('manage level or admin scope reads; every other level does not', () => {
    expect(canReadAccessLog({ myLevel: 'manage' })).toBe(true)
    expect(canReadAccessLog({ myLevel: 'view', adminScope: true })).toBe(true)
    expect(canReadAccessLog({ adminScope: true })).toBe(true)
    for (const myLevel of ['view', 'comment', 'edit', undefined] as const) {
      expect(canReadAccessLog({ myLevel })).toBe(false)
    }
  })
})

describe('canOfferAccessLog (menu gate)', () => {
  it('offers a live managed document', () => {
    expect(canOfferAccessLog(doc())).toBe(true)
    expect(canOfferAccessLog(doc({ canManage: false, myLevel: 'view', adminScope: true }))).toBe(
      true,
    )
  })
  it('hides it for non-managers, other modules, trashed and shelved rows', () => {
    expect(canOfferAccessLog(doc({ myLevel: 'edit', canManage: false }))).toBe(false)
    expect(canOfferAccessLog(doc({ ownerKind: 'task' }))).toBe(false)
    expect(canOfferAccessLog(doc({ archived: true }))).toBe(false)
    expect(canOfferAccessLog(doc({ archivedAt: '2026-10-01T00:00:00Z' }))).toBe(false)
    expect(canOfferAccessLog(doc({ shelvedAt: '2026-10-01T00:00:00Z' }))).toBe(false)
  })
})

describe('row labels', () => {
  it('filters are all + the four server actions', () => {
    expect(ACCESS_LOG_FILTERS).toEqual(['', 'view', 'download', 'export', 'link_view'])
  })
  it('a resolved actor shows its name; the rest name the kind, never an id', () => {
    expect(accessLogActor(accessLogOf())).toEqual({ name: 'Nguyễn Văn A' })
    expect(accessLogActor(accessLogOf({ actor: null, actor_kind: 'anonymous' }))).toEqual({
      key: 'algActorAnonymous',
    })
    expect(accessLogActor(accessLogOf({ actor: null, actor_kind: 'system' }))).toEqual({
      key: 'algActorSystem',
    })
    for (const actor_kind of ['human', 'agent', 'robot']) {
      expect(accessLogActor(accessLogOf({ actor: null, actor_kind, actor_id: 'u-9' }))).toEqual({
        key: 'algActorUnknown',
      })
    }
  })
  it('actions and vias map to keys; an unknown action reads Other, an unknown via stays raw', () => {
    expect(accessLogActionKey('view')).toBe('algActionView')
    expect(accessLogActionKey('download')).toBe('algActionDownload')
    expect(accessLogActionKey('export')).toBe('algActionExport')
    expect(accessLogActionKey('link_view')).toBe('algActionLinkView')
    expect(accessLogActionKey('purge')).toBe('algActionUnknown')
    expect(accessLogViaKey('member')).toBe('shrViaMember')
    expect(accessLogViaKey('share')).toBe('shrViaShare')
    expect(accessLogViaKey('link')).toBe('shrViaLink')
    expect(accessLogViaKey('ai_context')).toBe('shrViaAiContext')
    expect(accessLogViaKey('break_glass')).toBe('shrBgViaBreakGlass')
    expect(accessLogViaKey('teleport')).toBeNull()
  })
})

describe('row menu entry', () => {
  const menu = (d: DocumentsHomeDoc, ids: RowMenuActionId[] = ['open', 'logs']) => {
    const run: Partial<Record<RowMenuActionId, () => void>> = {}
    for (const id of ids) run[id] = vi.fn()
    return buildRowMenu({
      screen: 'workspace',
      doc: d,
      run,
      offlineLabel: null,
      label: (key: StringKey) => key,
    })
  }
  it('a managed live document gets "logs" after the share group', () => {
    const items = menu(doc(), ['open', 'share', 'copy-link', 'download', 'logs', 'star', 'trash'])
    const ids = items.map((i) => i.id)
    expect(ids).toContain('logs')
    expect(ids.indexOf('logs')).toBeGreaterThan(ids.indexOf('copy-link'))
    expect(ids.indexOf('logs')).toBeLessThan(ids.indexOf('star'))
    expect(items.find((i) => i.id === 'logs')!.label).toBe('algMenu')
  })
  it('gates match the web: not for editors, other modules, trashed or shelved rows', () => {
    for (const d of [
      doc({ myLevel: 'edit', canManage: false }),
      doc({ ownerKind: 'task' }),
      doc({ archived: true }),
      doc({ shelvedAt: '2026-10-01T00:00:00Z' }),
    ]) {
      expect(menu(d).map((i) => i.id)).not.toContain('logs')
    }
  })
  it('a host that cannot run it (no bridge) leaves no dead entry', () => {
    expect(menu(doc(), ['open']).map((i) => i.id)).not.toContain('logs')
  })
  it('the shelf and trash screens never carry it', () => {
    const run = { open: vi.fn(), logs: vi.fn(), unshelve: vi.fn(), restore: vi.fn() }
    for (const screen of ['shelved', 'trash'] as const) {
      const items = buildRowMenu({
        screen,
        doc: doc(),
        run,
        offlineLabel: null,
        label: (k: StringKey) => k,
      })
      expect(items.map((i) => i.id)).not.toContain('logs')
    }
  })
})
