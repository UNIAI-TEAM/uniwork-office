import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'
import { discussionStrings } from '../src/renderer/src/i18n/strings-discussion'
import { settingsStrings } from '../src/renderer/src/i18n/strings-settings'
import { strings } from '../src/renderer/src/strings'

/**
 * FD-11 §5: the uniwork-folders shard (i18n/uniwork-folders/<lang>.ts). zh
 * defines the key set; every UI language has a real translation with the zh
 * placeholders; vi/en use the web's wording; no "cục bộ" anywhere.
 */

const referenceKeys = Object.keys(uniworkFolderStrings.zh).sort()
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => uniworkFolderStrings[lang] as Record<string, string>

describe('uniwork folders string shards', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(uniworkFolderStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
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

  it.each([...LANGS.filter((l) => l !== 'en')])(
    'locale %s is translated, not the English copy',
    (lang) => {
      const en = table('en')
      // the brand and short shared words may coincide; most of the table must differ
      const same = referenceKeys.filter((k) => table(lang)[k] === en[k])
      expect(same.length).toBeLessThan(referenceKeys.length / 4)
    },
  )

  it('never says "cục bộ" (no local-only wording)', () => {
    const all = LANGS.flatMap((l) => Object.values(table(l)))
    expect(all.filter((v) => /cục bộ/i.test(v))).toEqual([])
  })

  it('uses the web wording for vi and en (contract §5)', () => {
    const vi = table('vi')
    const en = table('en')
    expect(vi.ufNewFolder).toBe('Thư mục mới')
    expect(vi.ufMoveTo).toBe('Di chuyển tới…')
    expect(vi.ufMoved).toBe('Đã chuyển tới {folder}')
    expect(vi.ufMovedRenamed).toBe('Đã chuyển và đổi tên thành {title}')
    expect(vi.ufNameTaken).toBe('Đã có thư mục tên này ở đây. Hãy đặt tên khác.')
    expect(vi.ufMoveNameTaken).toBe(
      'Thư mục đích đã có quá nhiều thư mục trùng tên. Hãy đổi tên trước khi chuyển.',
    )
    expect(vi.ufFolderGone).toBe('Thư mục này không còn ở đây.')
    expect(vi.ufLocationRoot).toBe('Thư mục gốc của workspace')
    expect(vi.ufSameFolder).toBe('Cùng thư mục với bản gốc')
    expect(en.ufNameTaken).toBe('A folder with this name already exists here. Choose another name.')
    expect(en.ufTooDeep).toBe('The document tree is at most {max} levels deep.')
    expect(en.ufNoPermission).toBe("You don't have permission to change this folder.")
  })

  it('does not collide with any other renderer table', () => {
    const others = [
      strings.zh,
      accountStrings.zh,
      cloudStrings.zh,
      uniworkDocumentStrings.zh,
      syncStrings.zh,
      workbenchStrings.zh,
      discussionStrings.zh,
      settingsStrings.zh,
    ]
    expect(referenceKeys.filter((k) => others.some((t) => k in t))).toEqual([])
  })

  it.each([...LANGS])(
    'locale %s has no replacement chars or ?-corrupted non-ASCII bytes (R2-1)',
    (lang) => {
      const corrupted = Object.entries(table(lang)).filter(([, v]) =>
        /\uFFFD|\?{2,}|\p{L}\?\p{L}/u.test(v),
      )
      expect(corrupted).toEqual([])
    },
  )

  it('FD-13: scans every vi value across all shell renderer string tables (NFC, case-insensitive) and finds no "cục bộ"', () => {
    const rendererViTables: Record<string, Record<string, string>> = {
      strings: strings.vi,
      accountStrings: accountStrings.vi,
      cloudStrings: cloudStrings.vi,
      uniworkDocumentStrings: uniworkDocumentStrings.vi,
      uniworkFolderStrings: uniworkFolderStrings.vi,
      syncStrings: syncStrings.vi,
      workbenchStrings: workbenchStrings.vi,
      discussionStrings: discussionStrings.vi,
      settingsStrings: settingsStrings.vi,
    }
    const needle = 'cục bộ'.normalize('NFC').toLowerCase()
    const hits: string[] = []
    for (const [tableName, dict] of Object.entries(rendererViTables)) {
      for (const [key, value] of Object.entries(dict)) {
        if (value.normalize('NFC').toLowerCase().includes(needle)) {
          hits.push(`${tableName}.vi.${key}: ${value}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('FD-13: updates openLocal across all 21 locales to "on this device" wording and provides area toggle keys', () => {
    expect(strings.vi.openLocal).toBe('Mở tệp trên máy')
    expect(strings.en.openLocal).toBe('Open file on this device')
    expect(strings.vi.setMcp).toBe('Máy chủ MCP trên máy này')
    expect(strings.vi.setAiCapFileSearch).toBe('Tìm kiếm tệp trên máy')
    expect(strings.zh.openLocal).toBe('打开本机文件')
    expect(strings['zh-TW'].openLocal).toBe('開啟本機檔案')
    expect(strings.ja.openLocal).toBe('この端末のファイルを開く')
    expect(strings.ko.openLocal).toBe('이 기기의 파일 열기')
    expect(strings.fr.openLocal).toBe('Ouvrir un fichier sur cet appareil')
    expect(strings.de.openLocal).toBe('Datei auf diesem Gerät öffnen')
    expect(strings.es.openLocal).toBe('Abrir archivo en este dispositivo')
    expect(strings.th.openLocal).toBe('เปิดไฟล์ในเครื่องนี้')
    expect(strings.id.openLocal).toBe('Buka file di perangkat ini')
    expect(strings.ru.openLocal).toBe('Открыть файл на этом устройстве')
    expect(strings.ar.openLocal).toBe('فتح ملف على هذا الجهاز')
    expect(strings.pt.openLocal).toBe('Abrir arquivo neste dispositivo')
    expect(strings.it.openLocal).toBe('Apri file su questo dispositivo')
    expect(strings.pl.openLocal).toBe('Otwórz plik na tym urządzeniu')
    expect(strings.cs.openLocal).toBe('Otevřít soubor v tomto zařízení')
    expect(strings.nl.openLocal).toBe('Bestand op dit apparaat openen')
    expect(strings.ms.openLocal).toBe('Buka fail pada peranti ini')
    expect(strings.he.openLocal).toBe('פתיחת קובץ במכשיר זה')
    expect(strings.hi.openLocal).toBe('इस डिवाइस पर फ़ाइल खोलें')

    expect(workbenchStrings.vi.wbDeskSubCloud).toBe('Trên UniWork')
    expect(workbenchStrings.en.wbDeskSubCloud).toBe('On UniWork')
    expect(workbenchStrings.zh.wbDeskSubCloud).toBe('在 UniWork 上')
    expect(workbenchStrings.vi.wbOnThisDevice).toBe('Trên máy này')
    expect(workbenchStrings.en.wbOnThisDevice).toBe('On this device')

    for (const lang of LANGS) {
      expect(table(lang).ufAreaUniwork).toBe('UniWork')
    }
    expect(table('vi').ufAreaLabel).toBe('Khu vực')
    expect(table('en').ufAreaLabel).toBe('Area')
    expect(table('vi').ufNoDeviceFolders).toBe('Chưa có thư mục nào trên máy này.')
    expect(table('en').ufNoDeviceFolders).toBe('No folders on this device yet.')
  })
})
