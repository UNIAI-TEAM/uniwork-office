import { isPracticeId } from './types.js'
import type { CreatePracticeMetaInput, PracticeId, PracticeMeta, PracticeProjectKind } from './types.js'

function nowIso(): string {
  return new Date().toISOString()
}

export function practiceProjectKind(practiceId: PracticeId): PracticeProjectKind {
  if (practiceId === 'teacher') return 'education'
  return practiceId
}

export function practiceIdFromProjectKind(kind: string | undefined): PracticeId | null {
  if (!kind) return null
  if (kind === 'education') return 'teacher'
  if (isPracticeId(kind) && kind !== 'teacher') return kind
  return null
}

export function packDisplayName(practiceLabel: string, title: string, facets: Record<string, string>): string {
  const secondary = Object.values(facets)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 2)
  const parts = [practiceLabel, ...secondary, title.trim()].filter(Boolean)
  return parts.join(' · ')
}

export function createPracticeMeta(input: CreatePracticeMetaInput): PracticeMeta {
  const ts = nowIso()
  const facets: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.facets ?? {})) {
    const t = v.trim()
    if (t) facets[k] = t
  }
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean)
  return {
    version: 1,
    kind: 'practice',
    practiceId: input.practiceId,
    title: input.title.trim(),
    facets,
    ...(tags.length > 0 ? { tags } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    materials: {},
    createdAt: ts,
    updatedAt: ts,
  }
}

export function isPracticeMeta(value: unknown): value is PracticeMeta {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.kind === 'practice' &&
    v.version === 1 &&
    typeof v.practiceId === 'string' &&
    typeof v.title === 'string' &&
    !!v.facets &&
    typeof v.facets === 'object'
  )
}
