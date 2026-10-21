import { describe, expect, it } from 'vitest'
import {
  dragHasFiles,
  planDrop,
  readDropped,
  type DropItemLike,
  type DroppedItem,
} from '../src/renderer/src/uniwork-folder-upload/drop'

const file = (name: string) => ({ name }) as File
const pathOf = (f: File) => (f.name === 'virtual' ? '' : `/disk/${f.name}`)

const item = (name: string, isDirectory: boolean | 'no-entry-api'): DropItemLike => ({
  kind: 'file',
  getAsFile: () => file(name),
  ...(isDirectory === 'no-entry-api' ? {} : { webkitGetAsEntry: () => ({ isDirectory }) }),
})

const dropped = (name: string, isDirectory: boolean | null): DroppedItem => ({
  path: `/disk/${name}`,
  name,
  isDirectory,
})

describe('dropping on the library list', () => {
  describe('dragHasFiles', () => {
    it('reacts to file drags only, not text or links', () => {
      expect(dragHasFiles({ types: ['Files'] })).toBe(true)
      expect(dragHasFiles({ types: ['text/plain', 'Files'] })).toBe(true)
      expect(dragHasFiles({ types: ['text/uri-list'] })).toBe(false)
      expect(dragHasFiles(null)).toBe(false)
    })
  })

  describe('readDropped', () => {
    it('reads the absolute path and whether each item is a folder', () => {
      expect(readDropped({ items: [item('a.docx', false), item('Hồ sơ', true)] }, pathOf)).toEqual([
        { path: '/disk/a.docx', name: 'a.docx', isDirectory: false },
        { path: '/disk/Hồ sơ', name: 'Hồ sơ', isDirectory: true },
      ])
    })

    it('skips an entry with no path (a virtual file) and non-file items', () => {
      expect(
        readDropped(
          {
            items: [
              item('virtual', false),
              { ...item('x', false), kind: 'string' },
              item('b.md', false),
            ],
          },
          pathOf,
        ).map((d) => d.name),
      ).toEqual(['b.md'])
    })

    it('says "unknown" when the host has no entry API, and reads plain files when there are no items', () => {
      expect(readDropped({ items: [item('a', 'no-entry-api')] }, pathOf)[0]?.isDirectory).toBeNull()
      expect(readDropped({ files: [file('c.pdf')] }, pathOf)).toEqual([
        { path: '/disk/c.pdf', name: 'c.pdf', isDirectory: null },
      ])
    })
  })

  describe('planDrop', () => {
    it('nothing usable is nothing', () => {
      expect(planDrop([])).toEqual({ kind: 'none' })
    })

    it("exactly one file keeps today's single-file upload", () => {
      expect(planDrop([dropped('a.docx', false)])).toEqual({
        kind: 'single',
        file: { path: '/disk/a.docx', name: 'a.docx' },
      })
    })

    it('two or more files are one files pre-flight', () => {
      expect(planDrop([dropped('a.docx', false), dropped('b.xlsx', false)])).toEqual({
        kind: 'batch',
        paths: ['/disk/a.docx', '/disk/b.xlsx'],
        files: 2,
        folders: 0,
      })
    })

    it('a folder is a batch even when it is alone', () => {
      expect(planDrop([dropped('Hồ sơ', true)])).toEqual({
        kind: 'batch',
        paths: ['/disk/Hồ sơ'],
        files: 0,
        folders: 1,
      })
    })

    it('several folders keep the order they were dropped in', () => {
      const plan = planDrop([dropped('B', true), dropped('A', true)])
      expect(plan).toMatchObject({ kind: 'batch', paths: ['/disk/B', '/disk/A'], folders: 2 })
    })

    it('a mixed drop sends the loose files first, then each folder in order', () => {
      const plan = planDrop([
        dropped('B', true),
        dropped('a.docx', false),
        dropped('A', true),
        dropped('b.md', false),
      ])
      expect(plan).toEqual({
        kind: 'batch',
        paths: ['/disk/a.docx', '/disk/b.md', '/disk/B', '/disk/A'],
        files: 2,
        folders: 2,
      })
    })

    it('one file plus one folder is a batch, not the single-file flow', () => {
      expect(planDrop([dropped('a.docx', false), dropped('A', true)])).toMatchObject({
        kind: 'batch',
        files: 1,
        folders: 1,
      })
    })

    it('a lone item that could not be classified goes to the pre-flight, never taken for a file', () => {
      expect(planDrop([dropped('mystery', null)])).toMatchObject({ kind: 'batch', files: 1 })
    })
  })
})
