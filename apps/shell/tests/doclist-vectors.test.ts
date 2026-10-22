import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatBytes, formatDaysLeft, formatListDate } from '../src/renderer/src/doclist/format'
import { accessPill, ACCESS_PILL_KEY, levelLine } from '../src/renderer/src/doclist/access'
import { daysLeft, groupOf, GROUP_LABEL_KEY } from '../src/renderer/src/doclist/groups'
import { columnsFor, type DocListScreen } from '../src/renderer/src/doclist/columns'
import { docListText } from '../src/renderer/src/doclist/text'
import { uniworkDocListStrings } from '../src/renderer/src/i18n/strings-uniwork-doclist'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * The shared test vectors: inputs and the strings every Documents list must
 * produce, in vi and en. `doclist-vectors.json` is the web's file, copied
 * byte for byte (shared vectors commit f1e04f17, see the blob hash below); its
 * git blob hash is pinned below, so a drifting copy fails here. Never edit it
 * in this repo: change the web file, copy it again, change the hash.
 * `doclist-app-vectors.json` holds the app-only cases (column ladder by width,
 * extra day/week edges) in the same shape. Dates are local wall-clock strings
 * without an offset, so the cases hold in any time zone.
 */

const DIR = join(__dirname, '../src/renderer/src/doclist')
const WEB_FILE = join(DIR, 'doclist-vectors.json')
const APP_FILE = join(DIR, 'doclist-app-vectors.json')
const WEB_BLOB_SHA1 = 'f1e04f17212006d8cdc72a74d3a15a2ada22b5e4'

const webBytes = readFileSync(WEB_FILE)

interface Pair {
  vi: string | null
  en: string | null
}
interface Vectors {
  access?: { cases: AccessCase[] }
  bytes?: { cases: (Pair & { label: string; bytes: number | null })[] }
  columns?: { cases: { screen: string; width: number; columns: string[] }[] }
  dates?: { now: string; cases: (Pair & { at: string | null; now?: string })[] }
  days_left?: {
    now: string
    cases: (Pair & { label: string; purge_after: string | null; days: number | null })[]
  }
  groups?: {
    labels: Record<string, { vi: string; en: string }>
    cases: (Pair & {
      label: string
      screen: 'recent' | 'shared' | 'trash'
      now: string
      input: { at?: string | null; purgeAfter?: string | null }
      group: string
    })[]
  }
  i18n_keys?: string[]
}
interface AccessCase {
  label: string
  visibility: 'private' | 'workspace' | 'restricted' | null
  share_scope: {
    home_workspace: boolean
    organization: boolean
    public_link: boolean
    users: number
    workspaces: number
  } | null
  my_level: string | null
  is_owner?: boolean
  admin_scope?: boolean
  pill: 'restricted' | 'workspace' | 'shared'
  pill_text: { vi: string; en: string }
  sub: { vi: string; en: string } | null
}

const FILES: [string, Vectors][] = [
  ['web doclist-vectors.json', JSON.parse(webBytes.toString('utf8')) as Vectors],
  ['app doclist-app-vectors.json', JSON.parse(readFileSync(APP_FILE, 'utf8')) as Vectors],
]
const LOCALES = ['vi', 'en'] as const
const at = (local: string) => new Date(local)

describe('doclist-vectors.json is the web file, byte for byte', () => {
  it('has the pinned git blob hash', () => {
    const blob = createHash('sha1')
      .update(`blob ${webBytes.length}\0`)
      .update(webBytes)
      .digest('hex')
    expect(blob).toBe(WEB_BLOB_SHA1)
  })

  it('is sorted-key, 2-space JSON with a trailing newline', () => {
    const text = webBytes.toString('utf8')
    expect(text.endsWith('}\n')).toBe(true)
    const sorted = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sorted)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([k, v]) => [k, sorted(v)]),
            )
          : value
    expect(JSON.stringify(sorted(JSON.parse(text)), null, 2) + '\n').toBe(text)
  })
})

describe.each(FILES)('vectors from %s', (_name, vectors) => {
  it.each(vectors.dates?.cases ?? [])('date $at', (c) => {
    const now = at(c.now ?? vectors.dates!.now)
    for (const locale of LOCALES) expect(formatListDate(c.at, now, locale)).toBe(c[locale])
  })

  it.each(vectors.bytes?.cases ?? [])('bytes $label', (c) => {
    for (const locale of LOCALES) expect(formatBytes(c.bytes, locale)).toBe(c[locale])
  })

  it.each(vectors.access?.cases ?? [])('access $label', (c) => {
    const scope = c.share_scope
    const doc = {
      visibility: c.visibility,
      shareScope: scope
        ? {
            homeWorkspace: scope.home_workspace,
            users: scope.users,
            workspaces: scope.workspaces,
            organization: scope.organization,
            publicLink: scope.public_link,
          }
        : null,
      myLevel: c.my_level,
      isOwner: c.is_owner,
      adminScope: c.admin_scope,
    }
    expect(accessPill(doc)).toBe(c.pill)
    for (const locale of LOCALES) {
      const t = docListText(locale)
      expect(t(ACCESS_PILL_KEY[accessPill(doc)])).toBe(c.pill_text[locale])
      expect(levelLine(doc, t)).toBe(c.sub ? c.sub[locale] : null)
    }
  })

  it.each(vectors.days_left?.cases ?? [])('days left $label', (c) => {
    const now = at(vectors.days_left!.now)
    const days = daysLeft(c.purge_after, now)
    expect(days).toBe(c.days)
    for (const locale of LOCALES) {
      expect(formatDaysLeft(c.purge_after, now, docListText(locale))).toBe(c[locale])
    }
  })

  it.each(vectors.groups?.cases ?? [])('group $label', (c) => {
    const id = groupOf(c.screen, c.input, at(c.now))
    expect(id).toBe(c.group)
    for (const locale of LOCALES) expect(docListText(locale)(GROUP_LABEL_KEY[id!])).toBe(c[locale])
  })

  it('lists every group label of both languages', () => {
    for (const [id, words] of Object.entries(vectors.groups?.labels ?? {})) {
      for (const locale of LOCALES) {
        expect(docListText(locale)(GROUP_LABEL_KEY[id as keyof typeof GROUP_LABEL_KEY])).toBe(
          words[locale],
        )
      }
    }
  })

  it.each(vectors.columns?.cases ?? [])('columns $screen at $width px', (c) => {
    expect(columnsFor(c.screen as DocListScreen, c.width)).toEqual(c.columns)
  })
})

/** web documents.list.* key -> the app's dl* key; every web key has exactly one */
const WEB_TO_APP_KEYS: Record<string, string> = {
  'documents.list.access.level.comment': 'dlLevelComment',
  'documents.list.access.level.edit': 'dlLevelEdit',
  'documents.list.access.level.manage': 'dlLevelManage',
  'documents.list.access.level.view': 'dlLevelView',
  'documents.list.access.owner': 'dlAccessOwner',
  'documents.list.access.restricted': 'dlAccessRestricted',
  'documents.list.access.shared': 'dlAccessShared',
  'documents.list.access.workspace': 'dlAccessWorkspace',
  'documents.list.access.you': 'dlAccessYou',
  'documents.list.activity.commented': 'dlActCommented',
  'documents.list.activity.edited': 'dlActEdited',
  'documents.list.activity.opened': 'dlActOpened',
  'documents.list.bulk.action.restore': 'dlActRestore',
  'documents.list.bulk.action.shelve': 'dlActShelve',
  'documents.list.bulk.action.trash': 'dlActTrash',
  'documents.list.bulk.action.unshelve': 'dlActUnshelve',
  'documents.list.bulk.clear': 'dlBulkClear',
  'documents.list.bulk.confirm.trash_action': 'dlActTrash',
  'documents.list.bulk.confirm.trash_description': 'dlBulkConfirmBody',
  'documents.list.bulk.confirm.trash_title_one': 'dlBulkConfirmTitleOne',
  'documents.list.bulk.confirm.trash_title_other': 'dlBulkConfirmTitleOther',
  // UNI-2078: Delete forever on the trash bar (the bar's button reuses the row menu's label, the
  // confirm button the purge dialog's)
  'documents.list.bulk.action.purge': 'dlActPurge',
  'documents.list.bulk.confirm.purge_action': 'dlPurgeSubmit',
  'documents.list.bulk.confirm.purge_description': 'dlBulkPurgeDescription',
  'documents.list.bulk.confirm.purge_title_one': 'dlBulkPurgeTitleOne',
  'documents.list.bulk.confirm.purge_title_other': 'dlBulkPurgeTitleOther',
  'documents.list.bulk.done.purge': 'dlBulkDonePurge',
  'documents.list.bulk.done.restore': 'dlBulkDoneRestore',
  'documents.list.bulk.done.shelve': 'dlBulkDoneShelve',
  'documents.list.bulk.done.trash': 'dlBulkDoneTrash',
  'documents.list.bulk.done.unshelve': 'dlBulkDoneUnshelve',
  'documents.list.bulk.select_all': 'dlColSelect',
  'documents.list.bulk.select_row': 'dlColSelect',
  'documents.list.bulk.selected': 'dlBulkSelected',
  'documents.list.bulk.toolbar': 'dlBulkToolbar',
  'documents.list.column.access': 'dlColAccess',
  'documents.list.column.actions': 'dlColActions',
  'documents.list.column.editor': 'dlColEditor',
  'documents.list.column.name': 'dlColName',
  'documents.list.column.select': 'dlColSelect',
  'documents.list.column.size': 'dlColSize',
  'documents.list.column.updated': 'dlColUpdated',
  'documents.list.date.yesterday': 'dlDateYesterday',
  'documents.list.days_left_one': 'dlDaysLeftOne',
  'documents.list.days_left_other': 'dlDaysLeftOther',
  'documents.list.group.deleting_soon': 'dlGroupDeletingSoon',
  'documents.list.group.earlier': 'dlGroupEarlier',
  'documents.list.group.more_than_7_days': 'dlGroupMoreThan7Days',
  'documents.list.group.this_week': 'dlGroupThisWeek',
  'documents.list.group.today': 'dlGroupToday',
  'documents.list.group.yesterday': 'dlGroupYesterday',
  'documents.list.menu.copy_link': 'dlActCopyLink',
  'documents.list.menu.link_copied': 'dlLinkCopied',
  'documents.list.menu.link_copy_failed': 'dlLinkCopyFailed',
  'documents.list.screen_column.activity': 'dlColActivity',
  'documents.list.screen_column.deleted': 'dlColDeleted',
  'documents.list.screen_column.shared': 'dlColShared',
  'documents.list.screen_column.shared_with': 'dlColSharedWith',
  'documents.list.screen_column.shelved': 'dlColShelved',
  'documents.list.screen_column.starred': 'dlColStarred',
  'documents.list.share_summary.links_one': 'dlShareLinkOne',
  'documents.list.share_summary.links_other': 'dlShareLinkOther',
  'documents.list.share_summary.people_one': 'dlSharePeopleOne',
  'documents.list.share_summary.people_other': 'dlSharePeopleOther',
  'documents.list.share_summary.workspaces_one': 'dlShareWorkspaceOne',
  'documents.list.share_summary.workspaces_other': 'dlShareWorkspaceOther',
  'documents.list.starred_by_you': 'dlStarredByYou',
}

/**
 * bulk failure reasons: the app words them through the shared uw* error
 * sentences (bulk.ts bulkSummary), which live in the Documents shard
 */
const WEB_TO_APP_ERROR_KEYS: Record<string, string> = {
  'documents.list.bulk.error.conflict': 'uwErrConflict',
  'documents.list.bulk.error.failed': 'uwDocActionFailed',
  'documents.list.bulk.error.forbidden': 'uwErrForbidden',
  'documents.list.bulk.error.not_found': 'uwErrNotFound',
  'documents.list.bulk.error.rate_limited': 'uwErrServerError',
  'documents.list.bulk.error.too_large': 'uwErrTooLarge',
}

/**
 * web keys for features the app does not have yet (zip download,
 * share and move as bulk actions, per-row error lines). Listed on purpose:
 * no dead dl* string is added until the feature lands, and a new web key
 * that is neither mapped nor listed here fails the test below.
 */
const NOT_IN_THE_APP_YET = [
  'documents.list.bulk.action.download',
  'documents.list.bulk.action.move',
  'documents.list.bulk.action.share',
  'documents.list.bulk.done.download',
  'documents.list.bulk.done.move',
  'documents.list.bulk.error.folder_too_large',
  'documents.list.bulk.error.not_a_file',
  'documents.list.bulk.error.not_verifiable',
  'documents.list.bulk.error_line',
  'documents.list.bulk.more_one',
  'documents.list.bulk.more_other',
  'documents.list.bulk.move.description',
  'documents.list.bulk.move.title_one',
  'documents.list.bulk.move.title_other',
  'documents.list.bulk.zip.expired',
  'documents.list.bulk.zip.failed',
  'documents.list.bulk.zip.preparing',
  'documents.list.bulk.zip.timeout',
  'documents.list.bulk.zip.too_large',
]

describe('documents.list.* keys map onto the app strings', () => {
  const webKeys = FILES[0]![1].i18n_keys ?? []
  const mapped = { ...WEB_TO_APP_KEYS, ...WEB_TO_APP_ERROR_KEYS }

  it('accounts for every web key exactly once: mapped or listed as not in the app yet', () => {
    expect([...Object.keys(mapped), ...NOT_IN_THE_APP_YET].sort()).toEqual([...webKeys].sort())
  })

  it('maps distinct web keys onto distinct app keys, except where one app string serves two', () => {
    const shared = Object.values(WEB_TO_APP_KEYS).filter((key, i, all) => all.indexOf(key) !== i)
    expect([...new Set(shared)].sort()).toEqual(['dlActTrash', 'dlColSelect'])
  })

  it('every mapped dl* key exists in the zh key set', () => {
    const keys = new Set(Object.keys(uniworkDocListStrings.zh))
    expect(Object.values(WEB_TO_APP_KEYS).filter((k) => !keys.has(k))).toEqual([])
  })

  it('every mapped error key exists in the Documents zh key set', () => {
    const keys = new Set(Object.keys(uniworkDocumentStrings.zh))
    expect(Object.values(WEB_TO_APP_ERROR_KEYS).filter((k) => !keys.has(k))).toEqual([])
  })

  it('does not give a dead dl* string to a feature the app lacks', () => {
    const keys = Object.keys(uniworkDocListStrings.zh)
    expect(
      keys.filter((k) => /^dl(Zip|Move|Download|Share)(Done|Action|Title|Confirm)/.test(k)),
    ).toEqual([])
  })
})
