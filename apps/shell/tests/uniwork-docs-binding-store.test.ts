import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BINDING_FILE,
  BindingStore,
  bindingKindAt,
  bindingCanEdit,
  bindingKindOf,
  docLevelOf,
  parseBinding,
} from '../src/main/uniwork-docs/binding-store'

// counts reads of binding.json (a module namespace cannot be spied on in ESM)
const reads = vi.hoisted(() => ({ binding: 0 }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      if (String(args[0]).endsWith('binding.json')) reads.binding += 1
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args)
    },
  }
})

/**
 * OQ-P4 (b): a binding is a store this build reads when it is schema 1 (the
 * legacy form) or schema 2 whose `min_store_level` is inside this build's
 * window (1..APP_STORE_LEVEL = 2). Everything else - schema >= 3, a missing or
 * malformed level, a level above this build - is a newer store: the G5-04g S11
 * lock, never a plain local file. `min_app_version` is display only and is
 * never compared.
 */

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'uw-binding-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const DOCX = 'Plan.docx'

/** a working copy + binding.json under `<root>/default/acc_1/doc_1/` */
function folder(binding: unknown): { dir: string; path: string } {
  const dir = join(root, 'default', 'acc_1', 'doc_1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, DOCX), 'working copy bytes')
  writeFileSync(join(dir, BINDING_FILE), JSON.stringify(binding))
  return { dir, path: join(dir, DOCX) }
}

const schema1 = {
  schema: 1,
  documentId: '01J8X4DOC0N1P2Q3R4S5T6U7',
  workspaceId: 'ws_1',
  orgId: 'org_a',
  title: DOCX,
  filename: DOCX,
  format: 'docx',
  access: 'edit',
  baseRevision: '41',
  baseVersion: 3,
  baseChecksum: 'abc',
  state: 'ready',
}

const schema2 = {
  schema: 2,
  documentId: '01J8X4DOC0N1P2Q3R4S5T6U7',
  workspaceId: 'ws_1',
  orgId: 'org_a',
  title: DOCX,
  filename: DOCX,
  format: 'docx',
  access: 'edit',
  baseRevision: '41',
  baseVersion: 3,
  baseChecksum: 'abc',
  state: 'ready',
  min_store_level: 2,
  min_app_version: '0.11.0',
}

describe('bindingKindOf (the classifier)', () => {
  it('reads schema 1 and an in-window schema 2 as current, and a newer store as newer', () => {
    expect(bindingKindOf({ schema: 1 })).toBe('current')
    expect(bindingKindOf({ schema: 2, min_store_level: 1 })).toBe('current')
    expect(bindingKindOf({ schema: 2, min_store_level: 2 })).toBe('current')
    // a schema-2 level outside the window, or no usable level at all
    expect(bindingKindOf({ schema: 2 })).toBe('newer')
    expect(bindingKindOf({ schema: 2, min_store_level: 3 })).toBe('newer')
    expect(bindingKindOf({ schema: 2, min_store_level: 0 })).toBe('newer')
    expect(bindingKindOf({ schema: 2, min_store_level: 2.5 })).toBe('newer')
    expect(bindingKindOf({ schema: 2, min_store_level: '2' })).toBe('newer')
    expect(bindingKindOf({ schema: 3 })).toBe('newer')
    expect(bindingKindOf({ schema: 99, min_store_level: 2 })).toBe('newer')
  })

  it('ignores min_app_version completely: lower, higher, missing or malformed', () => {
    for (const minAppVersion of ['0.0.1', '999.0.0', undefined, null, 7, {}, [], 'nonsense']) {
      const binding = {
        schema: 2,
        min_store_level: 2,
        ...(minAppVersion === undefined ? {} : { min_app_version: minAppVersion }),
      }
      expect(bindingKindOf(binding)).toBe('current')
    }
    // and two prerelease tails at the same level decide the same way (OQ-P4 test)
    expect(bindingKindOf({ schema: 2, min_store_level: 2, min_app_version: '0.11.0-beta.9' })).toBe(
      bindingKindOf({ schema: 2, min_store_level: 2, min_app_version: '0.11.0-dev.3' }),
    )
    // the field cannot turn a schema-1 store into a newer one
    expect(bindingKindOf({ schema: 1, min_app_version: '999.0.0' })).toBe('current')
  })

  it('anything without an integer schema >= 1 stays unrecognized', () => {
    for (const raw of [
      undefined,
      null,
      0,
      '',
      'schema 2',
      [],
      {},
      { schema: 0 },
      { schema: -1 },
      { schema: 1.5 },
      { schema: '2' },
      { schema: NaN },
      { schema: Infinity },
      { schema: 2n },
      { schema: true },
    ]) {
      expect(bindingKindOf(raw)).toBe('unrecognized')
    }
  })
})

describe('bindingKindAt (reading the folder)', () => {
  it('classifies the three shapes, and is null when there is nothing to read', () => {
    const two = folder(schema2)
    expect(bindingKindAt(two.dir)).toBe('current')
    const newer = folder({ schema: 2, min_store_level: 9 })
    expect(bindingKindAt(newer.dir)).toBe('newer')
    const three = folder({ schema: 3 })
    expect(bindingKindAt(three.dir)).toBe('newer')
    expect(bindingKindAt(join(root, 'default', 'acc_1', 'missing'))).toBeNull()
    const bad = folder({ schema: 2 })
    writeFileSync(join(bad.dir, BINDING_FILE), 'not json at all')
    // unreadable: no lock at all (the same as today's lookup)
    expect(bindingKindAt(bad.dir)).toBeNull()
    writeFileSync(join(bad.dir, BINDING_FILE), JSON.stringify({ schema: 'x' }))
    expect(bindingKindAt(bad.dir)).toBe('unrecognized')
  })
})

describe('BindingStore.lookup reads both schemas of this build', () => {
  it('a schema-1 working copy is bound, normalized to the schema-2 shape', () => {
    const { path } = folder(schema1)
    const doc = new BindingStore(root).lookup(path)
    expect(doc).toMatchObject({ path, deploymentId: 'default', userId: 'acc_1', key: 'doc_1' })
    expect(doc?.binding).toMatchObject({
      schema: 2,
      documentId: schema1.documentId,
      state: 'ready',
      minStoreLevel: 2,
      minAppVersion: '',
    })
  })

  it('a schema-2 working copy inside the window is bound too', () => {
    const { path } = folder(schema2)
    const doc = new BindingStore(root).lookup(path)
    expect(doc?.binding).toMatchObject({
      schema: 2,
      documentId: schema2.documentId,
      minStoreLevel: 2,
      minAppVersion: '0.11.0',
    })
  })

  it('a schema-2 copy above the window and a schema-3 copy are not bound documents', () => {
    const above = folder({ ...schema2, min_store_level: 3 })
    const three = folder({ ...schema2, schema: 3 })
    const store = new BindingStore(root)
    expect(store.lookup(above.path)).toBeNull()
    expect(store.lookup(three.path)).toBeNull()
  })

  it('a schema-1 copy with a pendingIntent parses: the intent field is ignored (the store owns it)', () => {
    const { path } = folder({
      ...schema1,
      state: 'saving',
      pendingIntent: {
        intentId: 'i',
        idempotencyKey: 'k',
        documentId: 'd',
        baseRevision: '41',
        checksum: 'a'.repeat(64),
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    })
    const doc = new BindingStore(root).lookup(path)
    // a save cannot still be running after a restart: it reads dirty, and no
    // pendingIntent is returned any more
    expect(doc?.binding.state).toBe('dirty')
    expect(doc?.binding).not.toHaveProperty('pendingIntent')
  })
})

describe('bindingKindOf / newerStoreAt (the lock)', () => {
  it('locks a working copy whose store is newer, naming it by its basename', () => {
    const above = folder({ schema: 2, min_store_level: 3 })
    const three = folder({ schema: 3, min_app_version: '1.0.0' })
    const store = new BindingStore(root)
    expect(store.newerStoreAt(above.path)).toEqual({ path: above.path, name: DOCX })
    expect(store.newerStoreAt(three.path)).toEqual({ path: three.path, name: DOCX })
  })

  it('this build’s own schemas, a plain local file and a path outside the root are never locked', () => {
    const one = folder(schema1)
    const two = folder(schema2)
    const store = new BindingStore(root)
    expect(store.newerStoreAt(one.path)).toBeNull()
    expect(store.newerStoreAt(two.path)).toBeNull()
    expect(store.newerStoreAt(join(root, 'plain.docx'))).toBeNull()
    expect(store.newerStoreAt(join(tmpdir(), 'elsewhere.docx'))).toBeNull()
    // a folder that is not a working-copy folder (too shallow) is not one of ours
    expect(store.newerStoreAt(join(root, 'default', DOCX))).toBeNull()
  })

  it('an unreadable or absent binding is not a lock, and a lock never writes anything', () => {
    const { dir, path } = folder({ schema: 2, min_store_level: 3 })
    const store = new BindingStore(root)
    const before = JSON.stringify(store.newerStoreAt(path))
    expect(store.newerStoreAt(path)).toEqual(JSON.parse(before))
    rmSync(join(dir, BINDING_FILE))
    expect(store.newerStoreAt(path)).toBeNull()
  })
})

describe('BindingStore.newerStoreIn (the launch route knows only the folder)', () => {
  it('names the lock after the document file inside the folder', () => {
    const { dir } = folder({ schema: 2 })
    expect(new BindingStore(root).newerStoreIn(dir)).toEqual({ path: join(dir, DOCX), name: DOCX })
  })

  it('picks the name in sorted order, so it is the same on every run (R1-be-8)', () => {
    const { dir } = folder({ schema: 2 })
    // a second document file, listed first by some readdir orders and last by others
    writeFileSync(join(dir, 'AAA first.xlsx'), 'x')
    const store = new BindingStore(root)
    const name = store.newerStoreIn(dir)?.name
    expect(name).toBe('AAA first.xlsx')
    // stable across repeated calls, whatever order the filesystem reports
    for (let i = 0; i < 5; i += 1) expect(store.newerStoreIn(dir)?.name).toBe(name)
  })

  it('falls back to the folder name, and is null for a schema this build reads', () => {
    const empty = join(root, 'default', 'acc_1', 'doc_2')
    mkdirSync(empty, { recursive: true })
    writeFileSync(join(empty, BINDING_FILE), JSON.stringify({ schema: 2 }))
    expect(new BindingStore(root).newerStoreIn(empty)).toEqual({
      path: join(empty, 'doc_2'),
      name: 'doc_2',
    })
    const one = folder(schema1)
    expect(new BindingStore(root).newerStoreIn(one.dir)).toBeNull()
    const two = folder(schema2)
    expect(new BindingStore(root).newerStoreIn(two.dir)).toBeNull()
  })
})

describe('BindingStore.classify reads the binding once (R1-be-5)', () => {
  it('classifies a path in one read: newer, bound or plain', () => {
    const newer = folder({ schema: 2, min_store_level: 9 })
    const store = new BindingStore(root)
    reads.binding = 0
    expect(store.classify(newer.path)).toEqual({ kind: 'newer', path: newer.path, name: DOCX })
    expect(reads.binding).toBe(1)
    const one = folder(schema1)
    reads.binding = 0
    expect(store.classify(one.path)).toMatchObject({ kind: 'bound' })
    expect(reads.binding).toBe(1)
    reads.binding = 0
    expect(store.classify(join(root, 'plain.docx'))).toEqual({ kind: 'plain' })
    expect(store.classify(join(tmpdir(), 'elsewhere.docx'))).toEqual({ kind: 'plain' })
    // neither is a working-copy folder: no binding read is even attempted
    expect(reads.binding).toBe(0)
  })

  it('a schema-2 copy of this build classifies as bound, one read', () => {
    const two = folder(schema2)
    const store = new BindingStore(root)
    reads.binding = 0
    expect(store.classify(two.path)).toMatchObject({ kind: 'bound' })
    expect(reads.binding).toBe(1)
  })

  it('a binding for another file name in the same folder is plain', () => {
    const { dir } = folder(schema1)
    const store = new BindingStore(root)
    expect(store.classify(join(dir, 'Other.docx'))).toEqual({ kind: 'plain' })
  })
})

describe('parseBinding + write (what this build stamps)', () => {
  it('a schema-1 value reads as schema 2 and is rewritten with the OQ-P4 fields', async () => {
    const { dir, path } = folder(schema1)
    const store = new BindingStore(root)
    const doc = store.lookup(path)
    if (!doc) throw new Error('not bound')
    await store.write(dir, { ...doc.binding, minAppVersion: '0.11.0' })
    const raw = JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')) as Record<string, unknown>
    expect(raw.schema).toBe(2)
    expect(raw.min_store_level).toBe(2)
    expect(raw.min_app_version).toBe('0.11.0')
    expect(raw).not.toHaveProperty('minStoreLevel')
    expect(raw).not.toHaveProperty('minAppVersion')
    expect(raw).not.toHaveProperty('pendingIntent')
    // and it reads back exactly as it was written
    expect(parseBinding(raw)).toMatchObject({ schema: 2, minStoreLevel: 2 })
  })

  it('DOC5-W04: the comment level is kept in binding.json; an unknown level is dropped', () => {
    const raw = (level: unknown) => ({ ...schema2, level })
    expect(parseBinding(raw('comment'))?.level).toBe('comment')
    expect(parseBinding(raw('manage'))?.level).toBe('manage')
    expect(docLevelOf('comment')).toBe('comment')
    expect(docLevelOf('owner')).toBeUndefined()
    expect(parseBinding(raw('owner'))).not.toHaveProperty('level')
  })

  it('DOC5-W04: only an edit access with an edit-or-better (or unread) level counts as editable', () => {
    const copy = (access: 'edit' | 'view', level?: string) =>
      ({ access, ...(level ? { level } : {}) }) as Parameters<typeof bindingCanEdit>[0]
    expect(bindingCanEdit(copy('edit'))).toBe(true)
    expect(bindingCanEdit(copy('edit', 'edit'))).toBe(true)
    expect(bindingCanEdit(copy('edit', 'manage'))).toBe(true)
    // a level below edit never rides on a stale edit access, and an unknown word never raises it
    expect(bindingCanEdit(copy('edit', 'view'))).toBe(false)
    expect(bindingCanEdit(copy('edit', 'comment'))).toBe(false)
    expect(bindingCanEdit(copy('edit', 'owner'))).toBe(false)
    expect(bindingCanEdit(copy('view', 'manage'))).toBe(false)
  })

  it('a malformed raw value never parses, whatever the schema claims', () => {
    expect(parseBinding({ schema: 2, min_store_level: 2 })).toBeNull()
    expect(parseBinding({ ...schema2, baseVersion: 1.5 })).toBeNull()
    expect(parseBinding({ ...schema2, state: 'nonsense' })).toBeNull()
    expect(parseBinding({ ...schema2, schema: 3 })).toBeNull()
    expect(parseBinding(null)).toBeNull()
  })
})
