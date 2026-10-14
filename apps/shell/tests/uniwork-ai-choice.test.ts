/**
 * G6-05 S2 gap 3 (Q-3), shell side: the choice lives in the UNI-1240 account store under
 * `uniwork.ai.uniwork-choice`, so it follows the active account bucket.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchAccounts, type WorkbenchOwner } from '../src/main/workbench-accounts'
import { isAllowedWbKey, resetWorkbenchDbForTests } from '../src/main/workbench-db'
import { UNIWORK_AI_CHOICE_KEY, createUniworkAiChoiceStore } from '../src/main/uniwork-ai-choice'

function sqliteAvailable(): boolean {
  try {
    // Node < 22 does not ship node:sqlite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node:sqlite') as typeof import('node:sqlite')
    return typeof mod.DatabaseSync === 'function'
  } catch {
    return false
  }
}
const describeSqlite = sqliteAvailable() ? describe : describe.skip

const A: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-a' }
const B: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-b' }

describeSqlite('UniWork AI choice in the account store', () => {
  const dirs: string[] = []
  const stores: WorkbenchAccounts[] = []
  afterEach(() => {
    for (const s of stores.splice(0)) s.close()
    resetWorkbenchDbForTests()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const open = () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwork-choice-store-'))
    dirs.push(dir)
    const accounts = new WorkbenchAccounts({ userDataDir: dir, log: () => {} })
    stores.push(accounts)
    return { accounts, store: createUniworkAiChoiceStore(accounts) }
  }

  it('uses the key the account store allows', () => {
    expect(UNIWORK_AI_CHOICE_KEY).toBe('uniwork.ai.uniwork-choice')
    expect(isAllowedWbKey(UNIWORK_AI_CHOICE_KEY)).toBe(true)
  })

  it('is off until chosen, then written to the active account only', () => {
    const { accounts, store } = open()
    accounts.setOwner(A)
    expect(store.read()).toBe(false)
    store.write(true)
    expect(store.read()).toBe(true)
    expect(accounts.activeDb()?.get(UNIWORK_AI_CHOICE_KEY)).not.toBeNull()
    accounts.setOwner(B)
    expect(store.read()).toBe(false) // another account never sees A's choice
    store.write(true)
    store.write(false)
    accounts.setOwner(A)
    expect(store.read()).toBe(true) // switching back restores it
  })

  it('signed out the choice is the local bucket one; nothing throws when the store cannot open', () => {
    const { accounts, store } = open()
    expect(store.read()).toBe(false)
    const broken = createUniworkAiChoiceStore({ activeDb: () => null })
    expect(broken.read()).toBe(false)
    expect(() => broken.write(true)).not.toThrow()
    void accounts
  })

  it('index.ts hands the store to docs-main and re-reads settings when the account changes', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(src).toContain(
      'setUniworkAiChoiceStore(createUniworkAiChoiceStore(workbenchAccounts()))',
    )
    expect(src).toContain("other.send('ai:settings-changed')")
  })
})
