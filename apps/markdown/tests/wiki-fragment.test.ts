/**
 * The hand-off a wiki link's `#fragment` makes: the tab that follows it and the
 * tab that shows the note are not always the same one, so the fragment waits
 * in main, keyed by path, until a renderer loads that path.
 */
import { describe, expect, it } from 'vitest'
import {
  rememberWikiFragment,
  takeWikiFragment,
  viewsShowingNote,
} from '../src/main/wiki-fragment'

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

describe('views already showing the note', () => {
  // the shell only activates a note's open tab and tells its view nothing, so
  // main has to tell the view the fragment is waiting

  it('finds the other views that show the path, never the one that followed the link', () => {
    const views = new Map([
      [1, '/notes/A.md'],
      [2, '/notes/B.md'],
      [3, '/notes/B.md'],
    ])
    expect(viewsShowingNote(views, '/notes/B.md', 3)).toEqual([2])
    expect(viewsShowingNote(views, '/notes/B.md', 1)).toEqual([2, 3])
  })

  it('finds none for a note no view shows, or for an untitled link target', () => {
    const views = new Map([[1, '/notes/A.md']])
    expect(viewsShowingNote(views, '/notes/Z.md', 9)).toEqual([])
    expect(viewsShowingNote(views, '', 9)).toEqual([])
  })
})
