import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BINDING_FILE,
  BindingStore,
  bindingKindAt,
  bindingKindOf,
} from '../src/main/uniwork-docs/binding-store'

/**
 * G5-04g: a folder whose binding.json declares an integer schema >= 2 holds a
 * store a newer app wrote. This build does not read it, and it must never read
 * as a plain local file (which would let an unbound edit land nowhere).
 * `min_app_version` is not compared at all (OQ-P4).
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

describe('bindingKindOf (the classifier)', () => {
  it('reads schema 1 as current and an integer schema >= 2 as newer', () => {
    expect(bindingKindOf({ schema: 1 })).toBe('current')
    expect(bindingKindOf({ schema: 2 })).toBe('newer')
    expect(bindingKindOf({ schema: 3 })).toBe('newer')
    expect(bindingKindOf({ schema: 99 })).toBe('newer')
  })

  it('ignores min_app_version completely: lower, higher, missing or malformed', () => {
    for (const minAppVersion of ['0.0.1', '999.0.0', undefined, null, 7, {}, [], 'nonsense']) {
      const binding = {
        schema: 2,
        ...(minAppVersion === undefined ? {} : { min_app_version: minAppVersion }),
      }
      expect(bindingKindOf(binding)).toBe('newer')
    }
    // and the field cannot turn a schema-1 store into a newer one
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
  it('classifies schema 2 and 3 folders, and is null when there is nothing to read', () => {
    const two = folder({ schema: 2, min_app_version: '99.0.0' })
    expect(bindingKindAt(two.dir)).toBe('newer')
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

describe('BindingStore.lookup keeps its schema-1 semantics', () => {
  it('a schema-1 working copy is bound, exactly as before', () => {
    const { path } = folder(schema1)
    const doc = new BindingStore(root).lookup(path)
    expect(doc).toMatchObject({ path, deploymentId: 'default', userId: 'acc_1' })
    expect(doc?.binding).toMatchObject({
      schema: 1,
      documentId: schema1.documentId,
      state: 'ready',
    })
  })

  it('a schema >= 2 working copy is not a bound document (as today: null)', () => {
    const two = folder({ schema: 2 })
    const three = folder({ schema: 3 })
    const store = new BindingStore(root)
    expect(store.lookup(two.path)).toBeNull()
    expect(store.lookup(three.path)).toBeNull()
  })

  it('isBound / isReadOnly read as "plain local file" for a newer store (the guard is separate)', () => {
    const { path } = folder({ schema: 2 })
    const store = new BindingStore(root)
    expect(store.isInside(path)).toBe(true)
    expect(store.lookup(path)).toBeNull()
  })
})

describe('BindingStore.newerStoreAt (the lock)', () => {
  it('locks a working copy whose folder declares schema >= 2, naming it by its basename', () => {
    const two = folder({ schema: 2 })
    const three = folder({ schema: 3, min_app_version: '1.0.0' })
    const store = new BindingStore(root)
    expect(store.newerStoreAt(two.path)).toEqual({ path: two.path, name: DOCX })
    expect(store.newerStoreAt(three.path)).toEqual({ path: three.path, name: DOCX })
  })

  it('a schema-1 working copy, a plain local file and a path outside the root are never locked', () => {
    const one = folder(schema1)
    const store = new BindingStore(root)
    expect(store.newerStoreAt(one.path)).toBeNull()
    expect(store.newerStoreAt(join(root, 'plain.docx'))).toBeNull()
    expect(store.newerStoreAt(join(tmpdir(), 'elsewhere.docx'))).toBeNull()
    // a folder that is not a working-copy folder (too shallow) is not one of ours
    expect(store.newerStoreAt(join(root, 'default', DOCX))).toBeNull()
  })

  it('an unreadable or absent binding is not a lock, and a lock never writes anything', () => {
    const { dir, path } = folder({ schema: 2 })
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

  it('falls back to the folder name, and is null for a schema-1 folder', () => {
    const empty = join(root, 'default', 'acc_1', 'doc_2')
    mkdirSync(empty, { recursive: true })
    writeFileSync(join(empty, BINDING_FILE), JSON.stringify({ schema: 2 }))
    expect(new BindingStore(root).newerStoreIn(empty)).toEqual({
      path: join(empty, 'doc_2'),
      name: 'doc_2',
    })
    const one = folder(schema1)
    expect(new BindingStore(root).newerStoreIn(one.dir)).toBeNull()
  })
})
