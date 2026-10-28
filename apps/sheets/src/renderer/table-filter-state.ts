/// Snapshots the filter of an Excel table from Univer's table plugin.
///
/// A table's header dropdown drives the table plugin's own filter model
/// (TableManager / TableFilters), not the sheet filter model that
/// `collectFilterStates` reads for a worksheet autoFilter. Its criteria are
/// turned into the same declarative wire state, which the gateway routes
/// into the table part (`applyRoutedFilterState`).
import type { IRange } from '@univerjs/core'
import { TABLE_FILTER_EMPTY_VALUE, type ITableFilterItem } from '@univerjs/preset-sheets-table'
import type { WorkbookFilterState } from '../shared/desktop-api'

type FilterColumn = NonNullable<WorkbookFilterState['filter']>['columns'][number]
type Custom = NonNullable<NonNullable<FilterColumn['customs']>['filters'][number]>

export interface TableFilterSource {
  readonly id: string
  /// Table range in screen coordinates: header row through the last data row
  /// (the totals band is not part of it).
  readonly range: IRange
  /// Criteria by column offset from the table's left edge.
  readonly columnFilters: readonly (ITableFilterItem | undefined)[]
  /// Rows the plugin currently hides for these criteria.
  readonly filteredOutRows: Iterable<number>
}

/// Wildcard text of a string condition. Excel stores "contains" and friends
/// as an equal / notEqual custom filter over a `*` pattern, escaping literal
/// wildcard characters with `~`.
function escapeWildcards(text: string): string {
  return text.replace(/[~*?]/g, (char) => `~${char}`)
}

const SIMPLE_COMPARES = new Set([
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
])

function unsaveable(compareType: string): Error {
  return new Error(
    `Table filter condition "${compareType}" cannot be saved as XLSX yet — clear it before saving.`,
  )
}

function customsFor(filter: Extract<ITableFilterItem, { filterType: 'condition' }>): {
  and?: boolean
  filters: Custom[]
} {
  const info = filter.filterInfo
  const compare: string = info.compareType
  if (info.conditionType === 'number') {
    const expected = info.expectedValue
    if (compare === 'between' || compare === 'notBetween') {
      if (!Array.isArray(expected)) throw unsaveable(compare)
      const [low, high] = expected
      if (compare === 'between') {
        return {
          and: true,
          filters: [
            { val: low as number, operator: 'greaterThanOrEqual' },
            { val: high as number, operator: 'lessThanOrEqual' },
          ],
        }
      }
      return {
        filters: [
          { val: low as number, operator: 'lessThan' },
          { val: high as number, operator: 'greaterThan' },
        ],
      }
    }
    if (Array.isArray(expected) || !SIMPLE_COMPARES.has(compare)) throw unsaveable(compare)
    return { filters: [{ val: expected, operator: compare as Custom['operator'] }] }
  }
  if (info.conditionType === 'string') {
    const text = info.expectedValue
    switch (compare) {
      case 'equal':
        return { filters: [{ val: text }] }
      case 'notEqual':
        return { filters: [{ val: text, operator: 'notEqual' }] }
      case 'contains':
        return { filters: [{ val: `*${escapeWildcards(text)}*` }] }
      case 'notContains':
        return { filters: [{ val: `*${escapeWildcards(text)}*`, operator: 'notEqual' }] }
      case 'startsWith':
        return { filters: [{ val: `${escapeWildcards(text)}*` }] }
      case 'endsWith':
        return { filters: [{ val: `*${escapeWildcards(text)}` }] }
      default:
        throw unsaveable(compare)
    }
  }
  throw unsaveable(compare)
}

/// One column's criteria on the wire; null when the item filters nothing.
export function tableColumnCriteria(filter: ITableFilterItem, colId: number): FilterColumn | null {
  if (filter.filterType === 'manual') {
    if (filter.isAllSelected) return null
    const values = filter.values.filter((value) => value !== TABLE_FILTER_EMPTY_VALUE)
    const blank = values.length !== filter.values.length
    return { colId, values, ...(blank ? { blank: true } : {}) }
  }
  const customs = customsFor(filter)
  return { colId, customs: { ...(customs.and ? { and: true } : {}), filters: customs.filters } }
}

export function tableFilterState(sheetId: string, table: TableFilterSource): WorkbookFilterState {
  const columns: FilterColumn[] = []
  table.columnFilters.forEach((filter, colId) => {
    if (!filter) return
    const criteria = tableColumnCriteria(filter, colId)
    if (criteria) columns.push(criteria)
  })
  const { startRow, startColumn, endRow, endColumn } = table.range
  return {
    sheetId,
    filter: { range: { startRow, startColumn, endRow, endColumn }, columns },
    hiddenRows: [...table.filteredOutRows].sort((left, right) => left - right),
    // Data rows only: the header row is never a filter result.
    visibilityRange: { startRow: startRow + 1, startColumn, endRow, endColumn },
  }
}
