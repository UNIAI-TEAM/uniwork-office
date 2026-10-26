/**
 * Shortest-path resolution against a real directory tree: the ordering rules
 * are the whole behaviour, so the fixture is a real tree on disk rather than a
 * stubbed fs.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodeFs, resolveWikiLinks, splitTarget } from '../src/main/wiki-resolve'

let root = ''

const write = (rel: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, `# ${rel}\n`)
  return p
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wikiresolve-'))
  // a note beside its own directory, and the same name again one level deeper
  write('Alpha.md')
  write('sub/Alpha.md')
  write('Beta.txt')
  write('Beta.md')
  write('deep/one/two/Gamma.md')
  write('nested/only/Hidden.md')
  // the same name in two subtrees at different depths: `d1` sorts before `s`,
  // so a depth-first walk reaches d1/d2 first and answers wrong
  write('d1/d2/Contested.md')
  write('s/Contested.md')
  // directories a note must never be found through
  write('.git/Config.md')
  write('node_modules/pkg/Pkg.md')
  // an explicit-extension target that is not markdown
  write('assets/Figure 1.png')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

const resolve = (targets: string[], fromPath: string) =>
  resolveWikiLinks(targets, { fromPath, root }, nodeFs())

<<<<<<< ours
=======
// every resolve awaits; the walk is asynchronous so the main process never blocks on it

>>>>>>> theirs
describe('splitTarget', () => {
  it('separates the file from a heading or block fragment', () => {
    expect(splitTarget('Note')).toEqual({ name: 'Note', fragment: '' })
    expect(splitTarget('Note#Some Heading')).toEqual({ name: 'Note', fragment: 'Some Heading' })
    expect(splitTarget('Note#^a1b2c3')).toEqual({ name: 'Note', fragment: '^a1b2c3' })
    expect(splitTarget('#Heading')).toEqual({ name: '', fragment: 'Heading' })
  })
})

describe('resolveWikiLinks', () => {
<<<<<<< ours
  it('a note in the document directory beats one nested deeper', () => {
    const map = resolve(['Alpha'], join(root, 'sub', 'note.md'))
=======
  it('a note in the document directory beats one nested deeper', async () => {
    const map = await resolve(['Alpha'], join(root, 'sub', 'note.md'))
>>>>>>> theirs
    expect(map.get('Alpha')).toEqual({
      path: join(root, 'sub', 'Alpha.md'),
      fragment: '',
      found: true,
    })
  })

<<<<<<< ours
  it('a shallower note beats a deeper one of the same name', () => {
    // from a directory that holds no Alpha, the root-level one wins over sub/
    const map = resolve(['Alpha'], join(root, 'note.md'))
    expect(map.get('Alpha')?.path).toBe(join(root, 'Alpha.md'))
  })

  it('finds a note several levels down when nothing shallower matches', () => {
    const map = resolve(['Gamma'], join(root, 'note.md'))
=======
  it('a shallower note beats a deeper one of the same name', async () => {
    // from a directory that holds no Alpha, the root-level one wins over sub/
    const map = await resolve(['Alpha'], join(root, 'note.md'))
    expect(map.get('Alpha')?.path).toBe(join(root, 'Alpha.md'))
  })

  it('finds a note several levels down when nothing shallower matches', async () => {
    const map = await resolve(['Gamma'], join(root, 'note.md'))
>>>>>>> theirs
    expect(map.get('Gamma')).toEqual({
      path: join(root, 'deep', 'one', 'two', 'Gamma.md'),
      fragment: '',
      found: true,
    })
  })

<<<<<<< ours
  it('walks breadth-first: a shallower match in a later subtree still wins', () => {
    // both live under the root and neither is in the document's directory, so
    // only the traversal order decides. `d1` is walked before `s`, and the
    // depth-3 copy sits inside it — a depth-first walk would answer d1/d2.
    const map = resolve(['Contested'], join(root, 'note.md'))
    expect(map.get('Contested')?.path).toBe(join(root, 's', 'Contested.md'))
  })

  it('a same-file link addresses this document and keeps its fragment', () => {
    const self = join(root, 'note.md')
    const map = resolve(['#Some Heading'], self)
    expect(map.get('#Some Heading')).toEqual({ path: self, fragment: 'Some Heading', found: true })
  })

  it('keeps the fragment while resolving the file it points into', () => {
    const map = resolve(['Alpha#^a1b2c3'], join(root, 'note.md'))
=======
  it('walks breadth-first: a shallower match in a later subtree still wins', async () => {
    // both live under the root and neither is in the document's directory, so
    // only the traversal order decides. `d1` is walked before `s`, and the
    // depth-3 copy sits inside it — a depth-first walk would answer d1/d2.
    const map = await resolve(['Contested'], join(root, 'note.md'))
    expect(map.get('Contested')?.path).toBe(join(root, 's', 'Contested.md'))
  })

  it('a same-file link addresses this document and keeps its fragment', async () => {
    const self = join(root, 'note.md')
    const map = await resolve(['#Some Heading'], self)
    expect(map.get('#Some Heading')).toEqual({ path: self, fragment: 'Some Heading', found: true })
  })

  it('keeps the fragment while resolving the file it points into', async () => {
    const map = await resolve(['Alpha#^a1b2c3'], join(root, 'note.md'))
>>>>>>> theirs
    expect(map.get('Alpha#^a1b2c3')).toEqual({
      path: join(root, 'Alpha.md'),
      fragment: '^a1b2c3',
      found: true,
    })
  })

<<<<<<< ours
  it('prefers .md over .txt for a bare name', () => {
    const map = resolve(['Beta'], join(root, 'note.md'))
    expect(map.get('Beta')?.path).toBe(join(root, 'Beta.md'))
  })

  it('an explicit extension is taken literally, spaces and all', () => {
    const map = resolve(['Figure 1.png'], join(root, 'note.md'))
=======
  it('prefers .md over .txt for a bare name', async () => {
    const map = await resolve(['Beta'], join(root, 'note.md'))
    expect(map.get('Beta')?.path).toBe(join(root, 'Beta.md'))
  })

  it('an explicit extension is taken literally, spaces and all', async () => {
    const map = await resolve(['Figure 1.png'], join(root, 'note.md'))
>>>>>>> theirs
    expect(map.get('Figure 1.png')).toEqual({
      path: join(root, 'assets', 'Figure 1.png'),
      fragment: '',
      found: true,
    })
  })

<<<<<<< ours
  it('reports an unmatched target instead of guessing', () => {
    const map = resolve(['Nowhere'], join(root, 'note.md'))
    expect(map.get('Nowhere')).toEqual({ path: '', fragment: '', found: false })
  })

  it('never reaches a note through .git or node_modules', () => {
    const map = resolve(['Config', 'Pkg'], join(root, 'note.md'))
=======
  it('reports an unmatched target instead of guessing', async () => {
    const map = await resolve(['Nowhere'], join(root, 'note.md'))
    expect(map.get('Nowhere')).toEqual({ path: '', fragment: '', found: false })
  })

  it('never reaches a note through .git or node_modules', async () => {
    const map = await resolve(['Config', 'Pkg'], join(root, 'note.md'))
>>>>>>> theirs
    expect(map.get('Config')?.found).toBe(false)
    expect(map.get('Pkg')?.found).toBe(false)
  })

<<<<<<< ours
  it('resolves a batch in one pass and reports every link, found or not', () => {
    const map = resolve(['Alpha', 'Nowhere', 'Gamma', '#Self'], join(root, 'note.md'))
=======
  it('resolves a batch in one pass and reports every link, found or not', async () => {
    const map = await resolve(['Alpha', 'Nowhere', 'Gamma', '#Self'], join(root, 'note.md'))
>>>>>>> theirs
    expect([...map.keys()].sort()).toEqual(['#Self', 'Alpha', 'Gamma', 'Nowhere'])
    expect(map.get('Alpha')?.found).toBe(true)
    expect(map.get('Nowhere')?.found).toBe(false)
    expect(map.get('Gamma')?.found).toBe(true)
    expect(map.get('#Self')?.found).toBe(true)
  })

<<<<<<< ours
  it('an unreadable root yields unresolved links, not a throw', () => {
    const map = resolveWikiLinks(
=======
  it('an unreadable root yields unresolved links, not a throw', async () => {
    const map = await resolveWikiLinks(
>>>>>>> theirs
      ['Alpha'],
      { fromPath: '', root: join(root, 'no-such-dir') },
      nodeFs(),
    )
    expect(map.get('Alpha')?.found).toBe(false)
  })

<<<<<<< ours
  it('an untitled document still resolves against the root', () => {
    const map = resolve(['Alpha'], '')
=======
  it('an untitled document still resolves against the root', async () => {
    const map = await resolve(['Alpha'], '')
>>>>>>> theirs
    expect(map.get('Alpha')).toEqual({ path: join(root, 'Alpha.md'), fragment: '', found: true })
  })
})

<<<<<<< ours
=======
describe('listing cache', () => {
  it('reads a directory once per burst and sees a new note after its directory changed', async () => {
    const fs = nodeFs()
    const dir = mkdtempSync(join(tmpdir(), 'wikicache-'))
    try {
      writeFileSync(join(dir, 'One.md'), '# one\n')
      const first = await fs.list(dir)
      expect(first.files).toEqual(['One.md'])
      writeFileSync(join(dir, 'Two.md'), '# two\n')
      // inside the trust window the listing is served from memory
      expect(await fs.list(dir)).toBe(first)
      ;(first as { checkedAt: number }).checkedAt = 0
      // past it, the directory's mtime tells the cache the listing moved on
      const second = await fs.list(dir)
      expect(second.files.sort()).toEqual(['One.md', 'Two.md'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

>>>>>>> theirs
describe('staying inside the vault', () => {
  // the reader's disk is not the resolver's business: a shared note must not be
  // able to name a file outside the root by walking up with `..`
  const outside = () => {
    const dir = mkdtempSync(join(tmpdir(), 'wikioutside-'))
    writeFileSync(join(dir, 'outside.txt'), '# outside\n')
    writeFileSync(join(dir, 'budget.xlsx'), '# budget\n')
    return dir
  }

<<<<<<< ours
  it('refuses a target that climbs out with ..', () => {
=======
  it('refuses a target that climbs out with ..', async () => {
>>>>>>> theirs
    const dir = outside()
    try {
      const doc = join(dir, 'vault', 'sub', 'doc.md')
      mkdirSync(join(dir, 'vault', 'sub'), { recursive: true })
      writeFileSync(doc, '# doc\n')
      const vault = join(dir, 'vault')
      for (const target of ['../../outside', '../../budget.xlsx']) {
<<<<<<< ours
        const map = resolveWikiLinks([target], { fromPath: doc, root: vault }, nodeFs())
=======
        const map = await resolveWikiLinks([target], { fromPath: doc, root: vault }, nodeFs())
>>>>>>> theirs
        expect(map.get(target), `${target} must not resolve`).toEqual({
          path: '',
          fragment: '',
          found: false,
        })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

<<<<<<< ours
  it('refuses a target that climbs out with a backslash or an absolute path', () => {
    const doc = join(root, 'sub', 'note.md')
    for (const target of ['..\\..\\Alpha', '/etc/passwd', 'sub/../../Alpha', '....//Alpha']) {
      const map = resolve([target], doc)
=======
  it('refuses a target that climbs out with a backslash or an absolute path', async () => {
    const doc = join(root, 'sub', 'note.md')
    for (const target of ['..\\..\\Alpha', '/etc/passwd', 'sub/../../Alpha', '....//Alpha']) {
      const map = await resolve([target], doc)
>>>>>>> theirs
      expect(map.get(target)?.found, `${target} must not resolve`).toBe(false)
    }
  })

<<<<<<< ours
  it('still resolves a plain relative name inside the document directory', () => {
    const map = resolve(['sub/Alpha'], join(root, 'note.md'))
=======
  it('resolves a path with a directory from the vault root', async () => {
    const map = await resolve(
      ['deep/one/two/Gamma', 'd1/d2/Contested'],
      join(root, 'sub', 'note.md'),
    )
    expect(map.get('deep/one/two/Gamma')?.path).toBe(join(root, 'deep', 'one', 'two', 'Gamma.md'))
    expect(map.get('d1/d2/Contested')?.path).toBe(join(root, 'd1', 'd2', 'Contested.md'))
  })

  it("matches a partial path as a suffix, like Obsidian's shortest unique path", async () => {
    const map = await resolve(['two/Gamma', 'd2/Contested', 'only/Nope'], join(root, 'note.md'))
    expect(map.get('two/Gamma')?.path).toBe(join(root, 'deep', 'one', 'two', 'Gamma.md'))
    expect(map.get('d2/Contested')?.path).toBe(join(root, 'd1', 'd2', 'Contested.md'))
    expect(map.get('only/Nope')?.found).toBe(false)
  })

  it('still resolves a plain relative name inside the document directory', async () => {
    const map = await resolve(['sub/Alpha'], join(root, 'note.md'))
>>>>>>> theirs
    expect(map.get('sub/Alpha')).toEqual({
      path: join(root, 'sub', 'Alpha.md'),
      fragment: '',
      found: true,
    })
  })
})
