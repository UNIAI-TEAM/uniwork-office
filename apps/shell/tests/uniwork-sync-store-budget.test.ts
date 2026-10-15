import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * OQ-UX2 / U-15 (EXPERIENCE.md "Ngân sách store đồng bộ mỗi tài khoản"): the
 * per-account sync store (queue + drafts, not the offline library) may keep
 * 1 GiB of encrypted bytes, and the layer the shell builds is given that budget.
 */

let dir: string

vi.mock('electron', () => ({
  app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}))

const created: Array<{ budgetBytes?: number }> = []
vi.mock('../src/main/uniwork-sync/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/uniwork-sync/store')>()
  return {
    ...actual,
    createStoreLayer: (options: Parameters<typeof actual.createStoreLayer>[0]) => {
      created.push({ budgetBytes: options.budgetBytes })
      return actual.createStoreLayer(options)
    },
  }
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sync-store-budget-'))
  created.length = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the sync store budget (OQ-UX2)', () => {
  it('is 1 GiB per account', async () => {
    const { SYNC_STORE_BUDGET_BYTES } = await import('../src/main/uniwork-docs/wiring')
    expect(SYNC_STORE_BUDGET_BYTES).toBe(1024 * 1024 * 1024)
  })

  it('is the budget the shell gives the sync store layer', async () => {
    const { createSyncStoreLayer } = await import('../src/main/uniwork-docs/wiring')
    createSyncStoreLayer(join(dir, 'uniwork-sync'))
    expect(created).toEqual([{ budgetBytes: 1024 * 1024 * 1024 }])
  })
})
