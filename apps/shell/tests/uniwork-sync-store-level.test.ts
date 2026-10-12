import { describe, expect, it } from 'vitest'
import { APP_STORE_LEVEL, readStoreGate } from '../src/main/uniwork-sync/store-level'

describe('uniwork store level gate (OQ-P4 b)', () => {
  it('is store level 2', () => {
    expect(APP_STORE_LEVEL).toBe(2)
  })

  it('opens schema 1 and a schema 2 binding at or below the level', () => {
    expect(readStoreGate({ schema: 1 })).toBe('open')
    expect(readStoreGate({ schema: 2, min_store_level: 1 })).toBe('open')
    expect(readStoreGate({ schema: 2, min_store_level: 2 })).toBe('open')
  })

  it('locks a schema 2 binding with a missing or malformed level', () => {
    expect(readStoreGate({ schema: 2 })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: null })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: '2' })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: 2.5 })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: 0 })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: -1 })).toBe('store_newer')
  })

  it('locks a level newer than this build', () => {
    expect(readStoreGate({ schema: 2, min_store_level: 3 })).toBe('store_newer')
    expect(readStoreGate({ schema: 2, min_store_level: 99 })).toBe('store_newer')
  })

  it('locks schema >= 3 whatever the level says', () => {
    expect(readStoreGate({ schema: 3 })).toBe('store_newer')
    expect(readStoreGate({ schema: 3, min_store_level: 1 })).toBe('store_newer')
    expect(readStoreGate({ schema: 4, min_store_level: 2 })).toBe('store_newer')
  })

  it('locks a malformed binding', () => {
    expect(readStoreGate(null)).toBe('store_newer')
    expect(readStoreGate(undefined)).toBe('store_newer')
    expect(readStoreGate('binding')).toBe('store_newer')
    expect(readStoreGate({})).toBe('store_newer')
    expect(readStoreGate({ schema: '2' })).toBe('store_newer')
    expect(readStoreGate({ schema: 2.5 })).toBe('store_newer')
    expect(readStoreGate({ schema: 0 })).toBe('store_newer')
    expect(readStoreGate({ schema: -1 })).toBe('store_newer')
  })

  it('treats min_app_version as display only: equal level decides the same way', () => {
    const cases: Array<
      [{ schema: number; min_store_level: number; min_app_version: string }, string]
    > = [
      [{ schema: 2, min_store_level: 2, min_app_version: '0.11.0-beta.9' }, 'open'],
      [{ schema: 2, min_store_level: 2, min_app_version: '0.11.0-dev.3' }, 'open'],
      [{ schema: 2, min_store_level: 3, min_app_version: '0.11.0-beta.9' }, 'store_newer'],
      [{ schema: 2, min_store_level: 3, min_app_version: '0.11.0-dev.3' }, 'store_newer'],
    ]
    for (const [binding, expected] of cases) {
      expect(readStoreGate(binding)).toBe(expected)
    }
    // a garbage min_app_version changes nothing
    expect(readStoreGate({ schema: 2, min_store_level: 2, min_app_version: 42 })).toBe('open')
  })
})
