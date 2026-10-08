import type { EduMeta } from './types.js'

/** Filters for the personal Knowledge library (Tri thức). */
export interface EduKnowledgeFilter {
  query?: string
  subject?: string
  grade?: string
  tag?: string
}

export interface EduKnowledgeItem {
  id: string
  name: string
  fileCount: number
  lastActiveAt: string
  edu: EduMeta
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-')
}

export function eduMatchesFilter(item: EduKnowledgeItem, filter: EduKnowledgeFilter): boolean {
  const { edu } = item
  if (filter.subject && edu.subject.trim().toLowerCase() !== filter.subject.trim().toLowerCase()) {
    return false
  }
  if (filter.grade && edu.grade.trim().toLowerCase() !== filter.grade.trim().toLowerCase()) {
    return false
  }
  if (filter.tag) {
    const want = normalizeTag(filter.tag)
    const tags = (edu.tags ?? []).map(normalizeTag)
    if (!tags.includes(want)) return false
  }
  const q = filter.query?.trim().toLowerCase()
  if (q) {
    const hay = [
      item.name,
      edu.lessonTitle,
      edu.subject,
      edu.grade,
      edu.week ?? '',
      ...(edu.tags ?? []),
      ...(edu.objectives ?? []),
      edu.notes ?? '',
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function uniqueSubjects(items: EduKnowledgeItem[]): string[] {
  return [...new Set(items.map((i) => i.edu.subject).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'vi'),
  )
}

export function uniqueGrades(items: EduKnowledgeItem[]): string[] {
  return [...new Set(items.map((i) => i.edu.grade).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'vi'),
  )
}

export function uniqueTags(items: EduKnowledgeItem[]): string[] {
  const set = new Set<string>()
  for (const i of items) for (const t of i.edu.tags ?? []) if (t.trim()) set.add(t.trim())
  return [...set].sort((a, b) => a.localeCompare(b, 'vi'))
}
