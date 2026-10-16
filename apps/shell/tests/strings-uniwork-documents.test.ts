import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { strings } from '../src/renderer/src/strings'
import { UNIWORK_ERROR_KEYS, UNIWORK_STATE_KEYS } from '../src/renderer/src/uniwork-docs-model'

/**
 * UniWork documents shard (i18n/uniwork-documents/<lang>.ts): zh defines the
 * key set; every UI language has a real translation with the zh placeholders;
 * every error code and save state of the contract has copy.
 */

const referenceKeys = Object.keys(uniworkDocumentStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) =>
  uniworkDocumentStrings[lang] as Record<string, string>

describe('uniwork documents string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(uniworkDocumentStrings).sort()).toEqual([...LANGS].sort())
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

  it.each([...LANGS])(
    'locale %s has no upstream brand, repository words or internal codes',
    (lang) => {
      const bad = Object.values(table(lang)).filter((v) =>
        /genspark|genoffice|github|\bgit\b|filesystem|fileservice|documents api|\bUNI-\d|\bGO-[A-Z]?\d/i.test(
          v,
        ),
      )
      expect(bad).toEqual([])
    },
  )

  it('does not collide with the home or account table keys', () => {
    expect(referenceKeys.filter((k) => k in strings.zh || k in accountStrings.zh)).toEqual([])
  })

  it('has user-facing copy for every error code of the contract', () => {
    expect(Object.keys(UNIWORK_ERROR_KEYS).sort()).toEqual(
      [
        'not_signed_in',
        'session_expired',
        'wrong_deployment',
        'forbidden',
        'not_found',
        'deleted',
        'conflict',
        'quota_exceeded',
        'too_large',
        'unsupported_format',
        'engine_incompatible',
        'idempotency_mismatch',
        'ticket_invalid',
        'ticket_expired',
        'network',
        'timeout',
        'server_error',
        'malformed_response',
        'keystore_locked',
        'store_full',
        // G5-06 save queue
        'capability_off',
        'intent_unknown',
        'document_deleted',
        'permission_revoked',
        'member_deactivated',
        'organization_suspended',
        'drafts_full',
        'other_window',
      ].sort(),
    )
    // the G5-04 / G5-06 refusals reuse the sync shard's sentences
    const sentenceKeys = [...referenceKeys, ...Object.keys(syncStrings.zh)]
    for (const key of Object.values(UNIWORK_ERROR_KEYS)) expect(sentenceKeys).toContain(key)
  })

  it('has chip copy for every save state of the contract', () => {
    expect(Object.keys(UNIWORK_STATE_KEYS).sort()).toEqual(
      [
        'ready',
        'dirty',
        'saving',
        'saved',
        'conflict',
        'blocked',
        'offline',
        'signed-out',
        'error',
        // G5-06 save queue
        'queued',
        'paused_offline',
        'paused_user',
        'paused_admin',
        'reconciling',
        'reconciling-stuck',
        'failed',
      ].sort(),
    )
    // the queue chips live in the sync shard
    const chipKeys = [...referenceKeys, ...Object.keys(syncStrings.zh)]
    for (const key of Object.values(UNIWORK_STATE_KEYS)) expect(chipKeys).toContain(key)
  })

  it('says the same thing in vi and en as the product copy rules ask for', () => {
    expect(uniworkDocumentStrings.en.uwOpenCardTitle).toBe('Open from UniWork')
    expect(uniworkDocumentStrings.vi.uwOpenCardTitle).toBe('Mở từ UniWork')
    expect(uniworkDocumentStrings.en.uwChipSaved).toBe('Saved to UniWork')
    expect(uniworkDocumentStrings.vi.uwChipSaved).toBe('Đã lưu vào UniWork')
    expect(uniworkDocumentStrings.en.uwChipViewOnly).toBe('View only')
    expect(uniworkDocumentStrings.vi.uwChipViewOnly).toBe('Chỉ xem')
    expect(uniworkDocumentStrings.en.uwPickHiddenFormats).toBe(
      'Hidden because UniWork Office cannot open their format: {count}',
    )
    expect(uniworkDocumentStrings.vi.uwPickHiddenFormats).toBe(
      'Đã ẩn vì UniWork Office chưa mở được định dạng: {count}',
    )
    expect(uniworkDocumentStrings.en.uwErrTicketExpired).toBe(
      'This link expired. Open the document again from UniWork.',
    )
  })

  it('FD-14: the unsupported-row label is gone and the hidden-count line exists everywhere', () => {
    expect(referenceKeys).not.toContain('uwPickUnsupported')
    expect(referenceKeys).toContain('uwPickHiddenFormats')
    for (const lang of LANGS) {
      const line = table(lang).uwPickHiddenFormats!
      expect(line).toContain('{count}')
      expect(line).toContain('UniWork Office')
      expect(table(lang)).not.toHaveProperty('uwPickUnsupported')
    }
    // a real translation, not an English copy
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      expect(table(lang).uwPickHiddenFormats).not.toBe(table('en').uwPickHiddenFormats)
    }
  })

  it.each([...LANGS])('locale %s has the S11 newer-store lock copy', (lang) => {
    for (const k of ['uwLockNewerStoreTitle', 'uwLockNewerStore']) {
      expect(referenceKeys).toContain(k)
      expect(table(lang)[k]!.trim()).not.toBe('')
    }
    expect(table(lang).uwLockNewerStore).toContain('UniWork Office')
  })

  it('does not show revision numbers or version jargon in vi/en copy', () => {
    for (const lang of ['vi', 'en'] as const) {
      expect(
        Object.values(table(lang)).filter((v) => /revision|base_revision|\bidempot/i.test(v)),
      ).toEqual([])
    }
  })
})
