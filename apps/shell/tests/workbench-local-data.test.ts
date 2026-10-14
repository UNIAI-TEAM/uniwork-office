import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import {
  createStickyNote,
  readForms,
  readNotes,
  readStickyNotes,
  writeForms,
} from '../src/renderer/src/workbench-pins'

beforeEach(() => store.clear())

describe('notes and forms are not per role (spec 5.6)', () => {
  it('a note written under one role is read under another', () => {
    createStickyNote('legal', 'Call the notary')
    expect(readStickyNotes('sales').map((n) => n.body)).toEqual(['Call the notary'])
    expect(readNotes('hr')).toBe('Call the notary')
  })

  it('a form saved under one role is listed under another', () => {
    writeForms('legal', [{ id: 'f1', title: 'Leave request' }])
    expect(readForms('accounting').map((f) => f.id)).toEqual(['f1'])
  })
})
