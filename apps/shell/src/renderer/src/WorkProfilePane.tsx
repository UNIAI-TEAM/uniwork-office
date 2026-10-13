import { Fragment } from 'react'
import type { ReactElement } from 'react'
import type { WorkPerson } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { useWorkLoad } from './work-cache'
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
  const blocked = workLoadState(load)
  // workLoadState answers whenever there is no person yet
  if (blocked || !person) return blocked ?? <></>

  const rows: [StringKey, string][] = [
    ['wbProfileJobTitle', person.title],
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
      <strong className="wb-profile-name">{person.display_name}</strong>
      <dl className="wb-profile">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{t(label)}</dt>
            <dd>{value || '—'}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="wb-work-muted">{t('wbProfileHint')}</p>
      <div>
        <button
          type="button"
          className="btn btn-secondary"
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
