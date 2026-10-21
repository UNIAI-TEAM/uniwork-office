// What a dry-run preview says, in the future tense for the confirm box and in the past tense for
// the note that follows the write. The wording and the branching are the web's
// (share-preview-sentences.ts); the data is the app's camelCase preview.
import type { SharePreviewGroup, SharePreviewUser } from '../../../shared/share-api'
import type { ShareT } from './share-model'

export interface PreviewSentence {
  confirm: string
  done: string
}

export interface PreviewSentenceDeps {
  t: ShareT
  levelLabel: (level: string) => string
  sourceLabel: (via: string) => string
}

export interface WarningSentenceInput {
  code: string
  name: string
  principalType: string
  /** the level the item writes */
  targetLevel: string
  /** the principal's level before the write, when known */
  beforeLevel?: string
  user?: SharePreviewUser
  group?: SharePreviewGroup
}

/**
 * The sentence for one dry-run warning. `wide_scope` and `direct_below_group` keep their own
 * wording; every other code (`downgrade`, or one a newer server adds) reads as a level change and
 * branches by principal type, so a group is never worded as a person. When the data a sentence
 * needs is missing the level-less sentence is used rather than a made-up level or a count of zero.
 */
export function warningSentence(
  { t, levelLabel, sourceLabel }: PreviewSentenceDeps,
  input: WarningSentenceInput,
): PreviewSentence {
  const { code, name, principalType, targetLevel, user, group } = input
  const generic: PreviewSentence = {
    confirm: t('shrWarningGeneric', { name }),
    done: t('shrWarningGenericDone', { name }),
  }
  const isOrganization = principalType === 'organization'

  if (code === 'wide_scope') {
    if (!group) return generic
    const params = { name, count: group.memberCount, level: levelLabel(targetLevel) }
    return isOrganization
      ? {
          confirm: t('shrWarningWideScopeOrganization', params),
          done: t('shrWarningWideScopeOrganizationDone', params),
        }
      : {
          confirm: t('shrWarningWideScopeWorkspace', params),
          done: t('shrWarningWideScopeWorkspaceDone', params),
        }
  }

  if (code === 'direct_below_group') {
    if (!user?.after.level) return generic
    const params = {
      name,
      effectiveLevel: levelLabel(user.after.level),
      source: sourceLabel(user.after.via),
    }
    return {
      confirm: t('shrWarningDirectBelowGroup', params),
      done: t('shrWarningDirectBelowGroupDone', params),
    }
  }

  const before = input.beforeLevel || user?.before.level
  if (!before) return generic
  const params = { name, before: levelLabel(before), after: levelLabel(targetLevel) }
  if (principalType === 'user') {
    return {
      confirm: t('shrWarningDowngradePerson', params),
      done: t('shrWarningDowngradePersonDone', params),
    }
  }
  if (!group) return generic
  const groupParams = { ...params, count: group.memberCount }
  return {
    confirm: t('shrWarningDowngradeGroup', groupParams),
    done: t('shrWarningDowngradeGroupDone', groupParams),
  }
}

export interface RevokeSentenceInput {
  name: string
  principalType: string
  user?: SharePreviewUser
  group?: SharePreviewGroup
}

/** the sentence for revoking one principal's direct grant */
export function revokeSentence(
  { t, levelLabel, sourceLabel }: PreviewSentenceDeps,
  { name, principalType, user, group }: RevokeSentenceInput,
): PreviewSentence {
  if (principalType === 'user') {
    if (user?.after.level) {
      const params = {
        name,
        level: levelLabel(user.after.level),
        source: sourceLabel(user.after.via),
      }
      return {
        confirm: t('shrRevokeConfirmKeep', params),
        done: t('shrRevokeDoneKeep', params),
      }
    }
    return {
      confirm: t('shrRevokeConfirmLose', { name }),
      done: t('shrRevokeDoneLose', { name }),
    }
  }
  const params = {
    name,
    memberCount: group?.memberCount ?? 0,
    losingCount: group?.losingCount ?? 0,
  }
  return {
    confirm: t('shrRevokeConfirmGroup', params),
    done: t('shrRevokeDoneGroup', params),
  }
}
