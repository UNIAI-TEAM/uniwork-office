import { describe, expect, it } from 'vitest'
import {
  allowedLevelsForPrincipal,
  foldSearchText,
  levelRank,
  linkErrorKey,
  plural,
  shareErrorKey,
} from '../src/renderer/src/uniwork-share/share-model'
import {
  revokeSentence,
  warningSentence,
} from '../src/renderer/src/uniwork-share/share-preview-sentences'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'

const en = uniworkShareStrings.en as Record<string, string>
const t = (key: string, params?: Record<string, string | number>) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) =>
    params && n in params ? String(params[n]) : w,
  )
const deps = { t, levelLabel: (l: string) => `L:${l}`, sourceLabel: (v: string) => `V:${v}` }

describe('share model', () => {
  it('a group or the home workspace never gets manage; people do', () => {
    expect(allowedLevelsForPrincipal('user')).toEqual(['view', 'comment', 'edit', 'manage'])
    expect(allowedLevelsForPrincipal('organization')).toEqual(['view', 'comment', 'edit'])
    expect(allowedLevelsForPrincipal('workspace', true)).toEqual(['view', 'comment', 'edit'])
    expect(allowedLevelsForPrincipal('workspace', false)).toEqual([
      'view',
      'comment',
      'edit',
      'manage',
    ])
  })

  it('ranks view < comment < edit < manage; an unknown level and none rank lowest', () => {
    expect(levelRank('view')).toBeLessThan(levelRank('comment'))
    expect(levelRank('edit')).toBeLessThan(levelRank('manage'))
    expect(levelRank('weird')).toBe(-1)
    expect(levelRank(null)).toBe(-1)
  })

  it('folds Vietnamese diacritics and đ for the filter', () => {
    expect(foldSearchText('  Đặng Văn Ân ')).toBe('dang van an')
  })

  it('plural picks the one form only for a count of 1', () => {
    expect(plural(t, 'shrLinkViews', 1)).toBe('1 view')
    expect(plural(t, 'shrLinkViews', 0)).toBe('0 views')
    expect(plural(t, 'shrLinkViews', 3)).toBe('3 views')
  })

  it('maps every share error code to a copy key, transport codes to none', () => {
    expect(shareErrorKey('document_shelved')).toBe('shrShelvedBlocked')
    expect(shareErrorKey('my_folder_locked')).toBe('shrErrMyFolderLocked')
    expect(shareErrorKey('break_glass_required')).toBe('shrBgSelfShareError')
    expect(shareErrorKey('forbidden')).toBeNull()
    expect(shareErrorKey('network')).toBeNull()
    expect(shareErrorKey('server_error')).toBeNull()
  })

  it('link creation names its own refusals: the limit, the org switch, the plan', () => {
    expect(linkErrorKey('document_link_limit')).toBe('shrLinkLimit')
    expect(linkErrorKey('document_links_disabled')).toBe('shrLinksOff')
    expect(linkErrorKey('forbidden')).toBe('shrLinkEntitlement')
    expect(linkErrorKey('document_shelved')).toBe('shrShelvedBlocked')
    expect(linkErrorKey('network')).toBeNull()
  })
})

describe('preview sentences (the web wording)', () => {
  it('wide scope names the group and its size', () => {
    const s = warningSentence(deps, {
      code: 'wide_scope',
      name: 'Acme',
      principalType: 'organization',
      targetLevel: 'edit',
      group: { principalType: 'organization', principalId: 'o', memberCount: 40, losingCount: 0 },
    })
    expect(s.confirm).toBe('Share with all of Organization Acme (40 members) at L:edit')
  })

  it('direct below group says which level the person keeps and from where', () => {
    const s = warningSentence(deps, {
      code: 'direct_below_group',
      name: 'An',
      principalType: 'user',
      targetLevel: 'view',
      user: {
        userId: 'u',
        before: { level: '', via: '' },
        after: { level: 'edit', via: 'member' },
      },
    })
    expect(s.confirm).toContain('An')
    expect(s.confirm).toContain('L:edit')
    expect(s.confirm).toContain('V:member')
  })

  it('falls back to the level-less sentence when the data is missing', () => {
    expect(
      warningSentence(deps, {
        code: 'downgrade',
        name: 'An',
        principalType: 'user',
        targetLevel: 'view',
      }).confirm,
    ).toBe(t('shrWarningGeneric', { name: 'An' }))
  })

  it('a downgrade branches by principal type', () => {
    const person = warningSentence(deps, {
      code: 'downgrade',
      name: 'An',
      principalType: 'user',
      targetLevel: 'view',
      beforeLevel: 'edit',
    })
    expect(person.confirm).toBe(
      t('shrWarningDowngradePerson', { name: 'An', before: 'L:edit', after: 'L:view' }),
    )
  })

  it('revoking a person who keeps access names the remaining level; one who loses it says so', () => {
    const keep = revokeSentence(deps, {
      name: 'An',
      principalType: 'user',
      user: {
        userId: 'u',
        before: { level: 'edit', via: 'share' },
        after: { level: 'view', via: 'member' },
      },
    })
    expect(keep.confirm).toBe(
      t('shrRevokeConfirmKeep', { name: 'An', level: 'L:view', source: 'V:member' }),
    )
    const lose = revokeSentence(deps, { name: 'An', principalType: 'user' })
    expect(lose.confirm).toBe(t('shrRevokeConfirmLose', { name: 'An' }))
    const group = revokeSentence(deps, {
      name: 'Team',
      principalType: 'workspace',
      group: { principalType: 'workspace', principalId: 'w', memberCount: 12, losingCount: 3 },
    })
    expect(group.confirm).toBe(
      t('shrRevokeConfirmGroup', { name: 'Team', memberCount: 12, losingCount: 3 }),
    )
  })
})
