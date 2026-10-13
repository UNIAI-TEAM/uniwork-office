import { MAI, MINH, ulid } from './fixtures'
import type {
  CollabCandidate,
  CollabComment,
  CollabListResult,
  CollabMention,
  CollabRevision,
  CollabSource,
} from '@genoffice/ui/collab'

/** an error the way the host's comments client rejects: `code` + `details.code` */
export interface FakeError {
  code: string
  detailsCode?: string
}

export interface FakeSourceOptions {
  comments?: CollabComment[]
  mentions?: CollabMention[]
  /** the first list call: 'pending' never answers (loading skeleton) */
  first?: 'ok' | 'pending' | FakeError
  /** every later list call (the reload the page triggers once the panel is ready) */
  later?: FakeError
  revisions?: CollabRevision[] | 'error'
  /** people the @ picker finds; query "zz" finds none, "slow" never answers, "boom" fails */
  candidates?: CollabCandidate[]
  /** create() rejects with this (a send that fails) */
  createError?: FakeError
}

export const PEOPLE: CollabCandidate[] = [
  { user_id: MINH, display_name: 'Minh Anh Tran', email: 'minh.anh@example.com' },
  { user_id: MAI, display_name: 'Mai Nguyen', email: 'mai@example.com' },
  { user_id: ulid('MICHAEL'), display_name: 'Michael Ortiz', email: 'michael.o@example.com' },
  { user_id: ulid('LINH'), display_name: 'Linh Pham', email: 'linh.pham@example.com' },
]

function reject(e: FakeError): Promise<never> {
  return Promise.reject(
    Object.assign(new Error(e.code), { code: e.code, detailsCode: e.detailsCode }),
  )
}

const NEVER = new Promise<never>(() => {})

/** a `CollabSource` that answers from fixtures; nothing leaves the page */
export function fakeSource(o: FakeSourceOptions = {}): CollabSource {
  let lists = 0
  const comments = [...(o.comments ?? [])]
  const people = o.candidates ?? PEOPLE
  const ok = (id: string) => {
    const c = comments.find((x) => x.id === id) ?? comments[0]
    return Promise.resolve({ comment: c })
  }
  return {
    list() {
      lists += 1
      if (lists === 1) {
        if (o.first === 'pending') return NEVER
        if (o.first && o.first !== 'ok') return reject(o.first)
      } else if (o.later) return reject(o.later)
      const res: CollabListResult = {
        comments,
        mentions: o.mentions ?? [],
        list_token: `t${lists}`,
        unchanged: false,
      }
      return Promise.resolve(res)
    },
    create(p) {
      if (o.createError) return reject(o.createError)
      const c: CollabComment = {
        id: `new-${comments.length + 1}`,
        document_id: 'harness',
        author_id: 'me',
        parent_id: p.parent_id ?? null,
        body: p.body,
        kind: p.kind,
        revision: 1,
        anchor: p.anchor ?? null,
        created_at: '2026-10-12T12:00:00Z',
        updated_at: '2026-10-12T12:00:00Z',
        display_name: 'You',
      }
      comments.push(c)
      return Promise.resolve({ comment: c })
    },
    update(p) {
      return ok(p.comment_id)
    },
    remove() {
      return Promise.resolve({ outcome: 'tombstoned' as const })
    },
    resolve(p) {
      return ok(p.comment_id)
    },
    reopen(p) {
      return ok(p.comment_id)
    },
    revisions() {
      if (o.revisions === 'error') return reject({ code: 'internal' })
      return Promise.resolve({ revisions: o.revisions ?? [] })
    },
    searchMentions(p) {
      if (p.q === 'slow') return NEVER
      if (p.q === 'boom') return reject({ code: 'internal' })
      if (p.q === 'zz') return Promise.resolve({ candidates: [] })
      const q = p.q.toLowerCase()
      return Promise.resolve({
        candidates: people.filter((c) => c.display_name.toLowerCase().includes(q)).slice(0, 8),
      })
    },
  }
}
