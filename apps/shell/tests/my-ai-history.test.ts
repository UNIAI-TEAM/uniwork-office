import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearMyAiHistory,
  loadMyAiHistory,
  saveMyAiHistory,
} from '../src/renderer/src/my-ai-history'

function installMemoryLocalStorage(): void {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
}

describe('P0 My AI history', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  afterEach(() => {
    clearMyAiHistory('sales')
    clearMyAiHistory('teacher')
  })

  it('persists and loads per practice', () => {
    saveMyAiHistory('sales', [
      { id: '1', role: 'user', text: 'Mở báo giá' },
      { id: '2', role: 'assistant', text: 'Đã mở', contextUsed: true },
    ])
    saveMyAiHistory('teacher', [{ id: 't1', role: 'user', text: 'Soạn giáo án' }])

    expect(loadMyAiHistory('sales')).toEqual([
      { id: '1', role: 'user', text: 'Mở báo giá' },
      { id: '2', role: 'assistant', text: 'Đã mở', contextUsed: true },
    ])
    expect(loadMyAiHistory('teacher')).toHaveLength(1)
    expect(loadMyAiHistory('hr')).toEqual([])
  })

  it('clear removes only that practice thread', () => {
    saveMyAiHistory('sales', [{ id: '1', role: 'user', text: 'a' }])
    saveMyAiHistory('teacher', [{ id: '2', role: 'user', text: 'b' }])
    clearMyAiHistory('sales')
    expect(loadMyAiHistory('sales')).toEqual([])
    expect(loadMyAiHistory('teacher')).toHaveLength(1)
  })
})
