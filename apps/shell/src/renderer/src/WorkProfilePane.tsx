import { Fragment, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { WorkPerson } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES, tintStyle } from './module-tones'
import { useWorkLoad } from './work-cache'
import { greetingName } from './work-home'
import { WbGlyph } from './WorkbenchIcons'
import { WorkNoWorkspace, WorkStaleNote, workLoadState, type WorkPaneProps } from './WorkErrorState'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'

/** a round initial tile in the Profile tint, like the sidebar account avatar */
function Avatar({ name, small = false }: { name: string; small?: boolean }): ReactElement {
  return (
    <span
      className={`wb-profile-avatar${small ? ' is-small' : ''}`}
      style={tintStyle(MODULE_TONES.personal)}
      aria-hidden="true"
    >
      {greetingName(name).charAt(0).toUpperCase()}
    </span>
  )
}

/** Profile tab (spec 4.6): the signed-in user's UniWork profile, read-only; edits happen on the web. */
export function WorkProfilePane({
  workspace,
  workspaceError,
  onReload,
  head,
}: WorkPaneProps & { head: WorkToolbarProps }): ReactElement {
  const { t } = useI18n()
  const workId = useId()
  const orgId = workspace?.orgId ?? null
  // one profile per org; the Forms compose merge reads the same key (form-merge.ts)
  const load = useWorkLoad<WorkPerson>(orgId ? `profile:${orgId}` : null, () =>
    window.uniworkWork.myProfile(),
  )

  if (!workspace)
    return (
      <>
        <WorkToolbar {...head} />
        <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
      </>
    )
  const person = load.value
  const blocked = workLoadState(load, 'card')
  // workLoadState answers whenever there is no person yet
  if (blocked || !person)
    return (
      <>
        <WorkToolbar {...head} />
        {blocked}
      </>
    )

  // the job title is the caption under the name, so it is not repeated here
  const rows: [StringKey, ReactNode][] = [
    ['wbProfileDepartment', person.department?.name],
    [
      'wbProfileManager',
      person.manager ? (
        <>
          <Avatar name={person.manager.display_name} small />
          {person.manager.display_name}
        </>
      ) : null,
    ],
    ['wbProfileEmail', person.email],
    ['wbProfileTimezone', person.timezone],
  ]

  return (
    <>
      <WorkToolbar
        {...head}
        actions={
          <button
            type="button"
            className="wb-btn wb-btn-secondary"
            onClick={() =>
              void window.uniworkWork
                .openWeb({
                  kind: 'person',
                  orgSlug: workspace.orgSlug,
                  wsSlug: workspace.slug,
                  id: person.user_id,
                })
                .catch(() => false)
            }
          >
            {t('wbProfileEditOnWeb')}
            <WbGlyph id="external" size={14} />
          </button>
        }
      />
      {load.stale && load.updatedAt !== null ? (
        <WorkStaleNote at={load.updatedAt} onRetry={onReload} />
      ) : null}
      <div className="wb-profile-grid">
        <section className="wb-block wb-profile-id" aria-label={t('wbProfileIdentity')}>
          <Avatar name={person.display_name} />
          <h3 className="wb-profile-name">{person.display_name}</h3>
          {person.title ? <p className="wb-profile-title">{person.title}</p> : null}
          <p className="wb-row-sub">{person.email}</p>
        </section>
        <section className="wb-block" aria-labelledby={workId}>
          <div className="wb-desk-head">
            <h3 id={workId}>{t('wbProfileWork')}</h3>
          </div>
          <dl className="wb-profile">
            {rows.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{t(label)}</dt>
                <dd>{value || '—'}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="wb-profile-foot">{t('wbProfileHint')}</p>
        </section>
      </div>
    </>
  )
}
