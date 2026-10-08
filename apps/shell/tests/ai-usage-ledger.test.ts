import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAiUsageEstimate,
  estimateCreditsPrecise,
  estimateTokensFromChars,
  listAiUsage,
  localDayStartIso,
  recordAiTurnUsage,
  sumAiUsageCreditsSince,
} from '../src/renderer/src/ai-usage-ledger'

const store = new Map<string, string>()

vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
}))

describe('ai usage ledger', () => {
  afterEach(() => {
    store.clear()
  })

  it('estimates tokens and credits from char counts', () => {
    expect(estimateTokensFromChars(400)).toBe(100)
    const est = buildAiUsageEstimate({ promptChars: 400, completionChars: 200 })
    expect(est.estTotalTokens).toBe(150)
    expect(est.estimated).toBe(true)
    expect(est.estCredits).toBe(estimateCreditsPrecise(150))
    expect(est.estCredits).toBeGreaterThan(0)
  })

  it('records and lists turns; sums today', () => {
    recordAiTurnUsage({
      source: 'my-ai',
      summary: 'Soạn thư mời',
      system: 'sys'.repeat(100),
      user: 'user'.repeat(100),
      completion: 'out'.repeat(80),
      provider: 'genspark',
      model: 'openrouter/auto',
      ok: true,
    })
    recordAiTurnUsage({
      source: 'my-ai',
      summary: 'fail',
      system: 's',
      user: 'u',
      ok: false,
    })
    const rows = listAiUsage(10)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.summary).toBe('fail')
    expect(rows[1]!.ok).toBe(true)
    expect(rows[1]!.estCredits).toBeGreaterThan(0)

    const today = sumAiUsageCreditsSince(localDayStartIso())
    expect(today).toBe(rows[1]!.estCredits)
  })
})
