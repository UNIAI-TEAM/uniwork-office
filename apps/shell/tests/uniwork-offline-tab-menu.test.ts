import { describe, expect, it, vi } from 'vitest'
import { offlineTabMenuItem } from '../src/main/uniwork-sync/offline-library/menu'

/**
 * G5-05u B8: the native tab menu's "Dùng khi không có mạng" / "Bỏ dùng khi
 * không có mạng" item - only for a UniWork-bound tab, and taking a new pin is
 * hidden while the org capability is off (OQ-UX11 a) while removing one stays.
 */

const LABELS = { pin: 'Dùng khi không có mạng', unpin: 'Bỏ dùng khi không có mạng' }
const BOUND = { documentId: 'doc_1', workspaceId: 'ws_1', orgId: 'org_1' }

const item = (over: {
  bound?: typeof BOUND | null
  pinned?: boolean
  capabilityOn?: boolean
  pin?: () => void
  unpin?: () => void
}) =>
  offlineTabMenuItem({
    bound: over.bound === undefined ? BOUND : over.bound,
    state: {
      pinned: over.pinned === true,
      state: over.pinned === true ? 'ready' : null,
      capabilityOn: over.capabilityOn !== false,
    },
    labels: LABELS,
    pin: over.pin ?? (() => undefined),
    unpin: over.unpin ?? (() => undefined),
  })

describe('G5-05u B8 the tab menu pin item', () => {
  it('a UniWork-bound tab that is not pinned offers the pin', () => {
    const built = item({})
    expect(built).toMatchObject({ label: LABELS.pin })
  })

  it('a plain local file offers nothing', () => {
    expect(item({ bound: null })).toBeNull()
  })

  it('a pinned document offers the unpin, even with the capability off', () => {
    expect(item({ pinned: true })).toMatchObject({ label: LABELS.unpin })
    expect(item({ pinned: true, capabilityOn: false })).toMatchObject({ label: LABELS.unpin })
  })

  it('taking a new pin is hidden while the capability is off', () => {
    expect(item({ capabilityOn: false })).toBeNull()
  })

  it('the item calls back into the library, never a path of its own', () => {
    const pin = vi.fn()
    const unpin = vi.fn()
    item({ pin })?.click?.({} as never, {} as never, {} as never)
    expect(pin).toHaveBeenCalledTimes(1)
    item({ pinned: true, unpin })?.click?.({} as never, {} as never, {} as never)
    expect(unpin).toHaveBeenCalledTimes(1)
  })
})
