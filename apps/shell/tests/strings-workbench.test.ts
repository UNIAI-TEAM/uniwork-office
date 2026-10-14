import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { strings } from '../src/renderer/src/strings'

/**
 * Workbench shard (i18n/workbench/<lang>.ts): zh defines the key set; vi and en are hand-written,
 * the other locales start as the English copy (spec 6.8) but must keep the key set and placeholders.
 */

const referenceKeys = Object.keys(workbenchStrings.zh).sort()
const PLACEHOLDER = /\{[a-zA-Z0-9]+\}/g
const placeholdersOf = (s: string) => (s.match(PLACEHOLDER) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => workbenchStrings[lang] as Record<string, string>

/** server NOTIFICATION_KINDS (uniwork:packages/core/types/notification.ts:4-23) */
const KINDS = [
  'task_assigned',
  'task_status_changed',
  'task_commented',
  'mentioned',
  'meeting_invited',
  'meeting_starting',
  'meeting_summary_reminder',
  'member_added',
  'role_changed',
  'audit_export_ready',
  'chat_follow_up',
  'chat_reminder',
  'email_hub_new_mail',
  'document_commented',
  'document_mentioned',
  'chat_mentioned',
  'chat_dm',
  'chat_thread_replied',
]
const notifKey = (kind: string) => `wbNotif_${kind}`

describe('workbench string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(workbenchStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const zh = table('zh')
    expect(
      referenceKeys.filter((k) => placeholdersOf(table(lang)[k]!) !== placeholdersOf(zh[k]!)),
    ).toEqual([])
  })

  it('uses the wb prefix and collides with no other dictionary', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('wb'))).toEqual([])
    expect(
      referenceKeys.filter(
        (k) =>
          k in strings.zh ||
          k in accountStrings.zh ||
          k in cloudStrings.zh ||
          k in syncStrings.zh ||
          k in uniworkDocumentStrings.zh,
      ),
    ).toEqual([])
  })

  it('has one sentence per server notification kind plus a fallback', () => {
    expect(KINDS.map(notifKey).filter((k) => !referenceKeys.includes(k))).toEqual([])
    expect(referenceKeys).toContain('wbNotifFallback')
  })

  it('says what the spec says in vi and en', () => {
    expect(workbenchStrings.vi.wbOnThisDevice).toBe('Trên máy này')
    expect(workbenchStrings.en.wbOnThisDevice).toBe('On this device')
    expect(workbenchStrings.vi.wbNotif_task_assigned).toBe('{actor} đã giao bạn việc “{task}”')
    expect(workbenchStrings.en.wbNotif_task_assigned).toBe('{actor} assigned you “{task}”')
    expect(workbenchStrings.vi.wbNotifFallback).toBe('Thông báo mới')
  })

  it('formal vi copy does not mix in English UI words', () => {
    // placeholders such as {workspace} or {task} are parameter names, not copy
    expect(
      Object.values(table('vi')).filter((v) =>
        /\b(workspace|task|meeting|tab|inbox|online|offline|profile)\b/i.test(
          v.replace(PLACEHOLDER, ''),
        ),
      ),
    ).toEqual([])
  })
})

describe('Workbench nav label', () => {
  const NAV: Record<(typeof LANGS)[number], string> = {
    zh: '工作台',
    en: 'Workbench',
    ja: 'ワークベンチ',
    ko: '워크벤치',
    fr: 'Plan de travail',
    de: 'Arbeitsplatz',
    es: 'Mesa de trabajo',
    th: 'โต๊ะทำงาน',
    id: 'Meja kerja',
    ru: 'Рабочее место',
    ar: 'مكتب العمل',
    pt: 'Bancada de trabalho',
    it: 'Banco di lavoro',
    pl: 'Stanowisko pracy',
    cs: 'Pracovní stůl',
    nl: 'Werkbank',
    ms: 'Meja kerja',
    he: 'עמדת עבודה',
    hi: 'वर्कबेंच',
    vi: 'Bàn làm việc',
    'zh-TW': '工作台',
  }

  it.each([...LANGS])('%s names the Workbench, not a teacher', (lang) => {
    const dict = strings[lang] as Record<string, string>
    expect(dict.navTeacher).toBeUndefined()
    expect(dict.navWorkbench).toBe(NAV[lang])
  })

  // spec 4.12: one AI name, and state titles carry no closing full stop
  it.each(['zh', 'en', 'vi'] as const)('%s names the AI UniAI only', (lang) => {
    expect(
      Object.values(table(lang)).filter((v) =>
        /Hub AI|AI Hub|Trợ lý của bạn|Your assistant/i.test(v),
      ),
    ).toEqual([])
  })

  it.each(['zh', 'en', 'vi'] as const)('%s state titles end without a full stop', (lang) => {
    const titles = [
      'wbTasksEmpty',
      'wbCalEmpty',
      'wbNotesEmpty',
      'wbFormsEmpty',
      'wbKnEmpty',
      'wbKnSelectPack',
      'wbKnNoMatch',
      'wbMatEmpty',
      'wbMatPackNone',
      'wbSkNeedPack',
      'wbDeskInTrayEmpty',
      'wbDeskInProgressEmpty',
    ]
    expect(titles.filter((k) => /[.。]$/.test(table(lang)[k]!))).toEqual([])
  })
})
