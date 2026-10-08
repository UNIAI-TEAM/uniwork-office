import type { PracticeMeta } from './types.js'

export interface PracticeKnowledgeFilter {
  query?: string
  facetKey?: string
  facetValue?: string
  tag?: string
}

export interface PracticeKnowledgeItem {
  id: string
  name: string
  fileCount: number
  lastActiveAt: string
  meta: PracticeMeta
}

export function practiceMatchesFilter(
  item: PracticeKnowledgeItem,
  filter: PracticeKnowledgeFilter,
): boolean {
  const { meta } = item
  if (filter.facetKey && filter.facetValue) {
    const got = (meta.facets[filter.facetKey] ?? '').trim().toLowerCase()
    if (got !== filter.facetValue.trim().toLowerCase()) return false
  }
  if (filter.tag) {
    const want = filter.tag.trim().toLowerCase()
    const tags = (meta.tags ?? []).map((t) => t.trim().toLowerCase())
    if (!tags.includes(want)) return false
  }
  const q = filter.query?.trim().toLowerCase()
  if (q) {
    const hay = [
      item.name,
      meta.title,
      ...(meta.tags ?? []),
      meta.notes ?? '',
      ...Object.values(meta.facets),
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}
