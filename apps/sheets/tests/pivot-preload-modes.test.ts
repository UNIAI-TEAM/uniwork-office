import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  PIVOT_AGGREGATIONS,
  PIVOT_SHOW_DATA_AS,
} from '@genoffice/xlsx-gateway/domain/pivot-value-modes'

/**
 * The preload validates new pivot value fields with a hand-kept list of
 * aggregations and Show Values As modes. A mode the engine and the wire schema
 * accept but this list misses throws 'Invalid workbook pivot addition.' on save.
 */
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')

function listed(name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(preloadSource)
  expect(match, name).not.toBeNull()
  return [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('preload pivot value-field allowlists', () => {
  it('accept every aggregation the pivot engine can save', () => {
    expect(listed('PIVOT_AGGREGATION_NAMES').sort()).toEqual([...PIVOT_AGGREGATIONS].sort())
  })

  it('accept every Show Values As mode the pivot engine can save', () => {
    expect(listed('PIVOT_SHOW_DATA_AS_NAMES').sort()).toEqual([...PIVOT_SHOW_DATA_AS].sort())
  })
})
