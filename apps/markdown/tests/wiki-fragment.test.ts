/**
 * The hand-off a wiki link's `#fragment` makes: the tab that follows it and the
 * tab that shows the note are not always the same one, so the fragment waits
 * in main, keyed by path, until a renderer loads that path.
 */
<<<<<<< ours
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  notifyViewsShowingNote,
  rememberWikiFragment,
  takeWikiFragment,
  viewsShowingNote,
} from '../src/main/wiki-fragment'
=======
import { describe, expect, it } from 'vitest'
import { rememberWikiFragment, takeWikiFragment } from '../src/main/wiki-fragment'
>>>>>>> theirs

const PATH = '/notes/Index.md'

describe('wiki fragments', () => {
  it('hands the fragment to the first renderer that asks for that path', () => {
    rememberWikiFragment(PATH, 'Some Heading')
    expect(takeWikiFragment(PATH)).toBe('Some Heading')
    expect(takeWikiFragment(PATH)).toBe('')
  })

  it('keeps fragments apart per path', () => {
    rememberWikiFragment('/notes/A.md', 'One')
    rememberWikiFragment('/notes/B.md', 'Two')
    expect(takeWikiFragment('/notes/A.md')).toBe('One')
    expect(takeWikiFragment('/notes/B.md')).toBe('Two')
  })

  it('lets a later link to the same note replace the earlier target', () => {
    rememberWikiFragment(PATH, 'First')
    rememberWikiFragment(PATH, 'Second')
    expect(takeWikiFragment(PATH)).toBe('Second')
  })

  it('a link with no fragment cancels an earlier one', () => {
    rememberWikiFragment(PATH, 'First')
    rememberWikiFragment(PATH, '')
    expect(takeWikiFragment(PATH)).toBe('')
  })

  it('forgets the oldest fragment rather than growing without bound', () => {
    for (let i = 0; i < 40; i++) rememberWikiFragment(`/notes/${i}.md`, `H${i}`)
    // the oldest waited on is gone; the newest is still there
    expect(takeWikiFragment('/notes/0.md')).toBe('')
    expect(takeWikiFragment('/notes/39.md')).toBe('H39')
  })

  it('an untitled document has no path to wait on', () => {
    rememberWikiFragment('', 'Heading')
    expect(takeWikiFragment('')).toBe('')
  })
})
<<<<<<< ours

describe('views already showing the note', () => {
  // the shell only activates a note's open tab and tells its view nothing, so
  // main has to tell the view the fragment is waiting

  it('finds the other views that show the path, never the one that followed the link', () => {
    const views = new Map([
      [1, '/notes/A.md'],
      [2, '/notes/B.md'],
      [3, '/notes/B.md'],
    ])
    expect(viewsShowingNote(views, '/notes/B.md', 3)).toEqual([{ id: 2, path: '/notes/B.md' }])
    expect(viewsShowingNote(views, '/notes/B.md', 1)).toEqual([
      { id: 2, path: '/notes/B.md' },
      { id: 3, path: '/notes/B.md' },
    ])
  })

  it('finds none for a note no view shows, or for an untitled link target', () => {
    const views = new Map([[1, '/notes/A.md']])
    expect(viewsShowingNote(views, '/notes/Z.md', 9)).toEqual([])
    expect(viewsShowingNote(views, '', 9)).toEqual([])
  })
})

// a symlinked vault folder: the shell finds a note's tab by realpath, so the view
// may show one spelling of the file while the link resolves to the other
const root = mkdtempSync(join(tmpdir(), 'wiki-fragment-'))
const realDir = join(root, 'real')
const linkDir = join(root, 'link')
mkdirSync(realDir)
writeFileSync(join(realDir, 'Note.md'), '# Note\n')
let canSymlink = true
try {
  symlinkSync(realDir, linkDir, 'dir')
} catch {
  canSymlink = false
}
const realNote = join(realDir, 'Note.md')
const linkNote = join(linkDir, 'Note.md')

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!canSymlink)(
  'one note under two spellings (symlink needs a platform that can make one)',
  () => {
    it("pushes to a view that shows the link spelling, with that view's own spelling", () => {
      const views = new Map([
        [1, linkNote],
        [2, '/notes/Other.md'],
      ])
      expect(viewsShowingNote(views, realNote, 9)).toEqual([{ id: 1, path: linkNote }])
    })

    it('pushes to a view that shows the real spelling when the link spelling was followed', () => {
      const views = new Map([[1, realNote]])
      expect(viewsShowingNote(views, linkNote, 9)).toEqual([{ id: 1, path: realNote }])
    })

    it('takes a fragment remembered under the real spelling by the link spelling, and back', () => {
      rememberWikiFragment(realNote, 'Heading')
      expect(takeWikiFragment(linkNote)).toBe('Heading')
      expect(takeWikiFragment(realNote)).toBe('')
      rememberWikiFragment(linkNote, 'Other')
      expect(takeWikiFragment(realNote)).toBe('Other')
    })

    it('lets a link with no fragment cancel one remembered under the other spelling', () => {
      rememberWikiFragment(realNote, 'Heading')
      rememberWikiFragment(linkNote, '')
      expect(takeWikiFragment(realNote)).toBe('')
    })

    it('tells the view with its own spelling, so the renderer compare still matches', () => {
      const sent: Array<[number, string]> = []
      notifyViewsShowingNote(new Map([[1, linkNote]]), realNote, 'Heading', 9, (id, path) =>
        sent.push([id, path]),
      )
      expect(sent).toEqual([[1, linkNote]])
      takeWikiFragment(realNote)
    })
  },
)

describe('telling the views that already show the note', () => {
  it('never tells the view that followed the link, and tells every other one', () => {
    const views = new Map([
      [1, '/notes/B.md'],
      [2, '/notes/B.md'],
      [3, '/notes/B.md'],
      [4, '/notes/A.md'],
    ])
    const sent: Array<[number, string]> = []
    notifyViewsShowingNote(views, '/notes/B.md', 'Heading', 2, (id, path) => sent.push([id, path]))
    expect(sent).toEqual([
      [1, '/notes/B.md'],
      [3, '/notes/B.md'],
    ])
    takeWikiFragment('/notes/B.md')
  })

  it('sends nothing for an empty fragment, and drops the one that waited', () => {
    rememberWikiFragment('/notes/B.md', 'Old')
    const sent: Array<[number, string]> = []
    notifyViewsShowingNote(new Map([[1, '/notes/B.md']]), '/notes/B.md', '', 2, (id, path) =>
      sent.push([id, path]),
    )
    expect(sent).toEqual([])
    expect(takeWikiFragment('/notes/B.md')).toBe('')
  })

  it('remembers the fragment for a view that loads the note later', () => {
    notifyViewsShowingNote(new Map(), '/notes/C.md', 'Late', 2, () => {})
    expect(takeWikiFragment('/notes/C.md')).toBe('Late')
  })
})
=======
>>>>>>> theirs
