import { Fragment } from 'react'
import type { ReactElement } from 'react'
import type { WorkPerson } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES, tintStyle } from './module-tones'
import { useWorkLoad } from './work-cache'
import { greetingName } from './work-home'
import { WorkNoWorkspace, WorkStaleNote, workLoadState, type WorkPaneProps } from './WorkErrorState'

/** Profile tab: the signed-in user's UniWork profile, read-only; edits happen on the web. */
export function WorkProfilePane({
  workspace,
  workspaceError,
  onReload,
}: WorkPaneProps): ReactElement {
  const { t } = useI18n()
  const orgId = workspace?.orgId ?? null
  // one profile per org; the Forms compose merge reads the same key (form-merge.ts)
  const load = useWorkLoad<WorkPerson>(orgId ? `profile:${orgId}` : null, () =>
    window.uniworkWork.myProfile(),
  )

  if (!workspace) return <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
  const person = load.value
  const blocked = workLoadState(load, 'card')
  // workLoadState answers whenever there is no person yet
  if (blocked || !person) return blocked ?? <></>

  // the job title is the caption under the name, so it is not repeated here
  const rows: [StringKey, string][] = [
    ['wbProfileDepartment', person.department?.name ?? ''],
    ['wbProfileManager', person.manager?.display_name ?? ''],
    ['wbProfileEmail', person.email],
    ['wbProfileTimezone', person.timezone],
  ]

  return (
    <div className="wb-work">
      {load.stale && load.updatedAt !== null ? (
        <WorkStaleNote at={load.updatedAt} onRetry={onReload} />
      ) : null}
      <section className="wb-block wb-profile-card">
        <div className="wb-profile-id">
          <span
            className="wb-profile-avatar"
            style={tintStyle(MODULE_TONES.personal)}
            aria-hidden="true"
          >
            {greetingName(person.display_name).charAt(0).toUpperCase()}
          </span>
          <div>
            <strong className="wb-profile-name">{person.display_name}</strong>
            {person.title ? <p className="wb-profile-title">{person.title}</p> : null}
          </div>
        </div>
        <dl className="wb-profile">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{t(label)}</dt>
              <dd>{value || '—'}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
      <p className="wb-work-muted">{t('wbProfileHint')}</p>
      <div>
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
        </button>
      </div>
    </div>
  )
}
