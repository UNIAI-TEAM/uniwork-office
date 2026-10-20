import { describe, expect, it } from 'vitest'
import { accessLevel, accessPill, levelLine } from '../src/renderer/src/doclist/access'
import { docListText } from '../src/renderer/src/doclist/text'

// the shared vectors (doclist-vectors.test.ts) pin every pill + level line;
// these are the Q5 rule and the shapes a row may arrive in

const scope = (over: Partial<Record<string, number | boolean>> = {}) => ({
  homeWorkspace: false,
  users: 0,
  workspaces: 0,
  organization: false,
  publicLink: false,
  ...over,
})

describe('accessPill (Q5: a public link alone is Shared)', () => {
  it('a restricted document with only a live public link is shared, vi and en', () => {
    const doc = { visibility: 'restricted' as const, shareScope: scope({ publicLink: true }) }
    expect(accessPill(doc)).toBe('shared')
    expect(docListText('vi')('dlAccessShared')).toBe('Được chia sẻ')
    expect(docListText('en')('dlAccessShared')).toBe('Shared')
  })

  it('a restricted document nobody else reaches is Private / Riêng tư, not Hạn chế', () => {
    expect(accessPill({ visibility: 'restricted', shareScope: scope() })).toBe('restricted')
    expect(docListText('vi')('dlAccessRestricted')).toBe('Riêng tư')
    expect(docListText('en')('dlAccessRestricted')).toBe('Private')
  })

  it('workspace visibility wins over the share counts', () => {
    expect(accessPill({ visibility: 'workspace', shareScope: scope({ users: 4 }) })).toBe(
      'workspace',
    )
  })

  it('a row with no share scope is never guessed shared', () => {
    expect(accessPill({ visibility: 'restricted' })).toBe('restricted')
    expect(accessPill({})).toBe('restricted')
  })
})

describe('accessLevel', () => {
  it('keeps the four known levels, drops an unknown one', () => {
    for (const l of ['view', 'comment', 'edit', 'manage'] as const) expect(accessLevel(l)).toBe(l)
    expect(accessLevel('superuser')).toBeNull()
    expect(accessLevel(undefined)).toBeNull()
  })

  it('a workspace administrator with no level reads as manage', () => {
    expect(accessLevel(null, true)).toBe('manage')
    expect(accessLevel('view', true)).toBe('view')
    expect(accessLevel(null, false)).toBeNull()
  })
})

describe('levelLine', () => {
  const en = docListText('en')

  it('is the owner line when is_owner is true, whatever the level', () => {
    expect(levelLine({ isOwner: true, myLevel: 'view' }, en)).toBe('Owner')
  })

  it('shows the level when is_owner is false or absent', () => {
    expect(levelLine({ isOwner: false, myLevel: 'edit' }, en)).toBe('You: Edit')
    expect(levelLine({ myLevel: 'comment' }, docListText('vi'))).toBe('Bạn: Bình luận')
  })

  it('is null with neither, so the cell shows only the pill', () => {
    expect(levelLine({}, en)).toBeNull()
  })
})
