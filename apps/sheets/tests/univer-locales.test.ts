import { LocaleType } from '@univerjs/core'
import { describe, expect, it } from 'vitest'

import {
  insertRowsBelowLocale,
  numberAsTextAlertLocale,
  tableColumnMenuLocale,
  univerLocaleFor,
} from '../src/renderer/univer-locales'

describe('univerLocaleFor', () => {
  it('maps every app language Univer has packs for', () => {
    expect(univerLocaleFor('zh')).toBe(LocaleType.ZH_CN)
    expect(univerLocaleFor('zh-TW')).toBe(LocaleType.ZH_TW)
    expect(univerLocaleFor('ja')).toBe(LocaleType.JA_JP)
    expect(univerLocaleFor('ko')).toBe(LocaleType.KO_KR)
    expect(univerLocaleFor('ar')).toBe(LocaleType.AR_SA)
  })

  it('falls back to English where Univer ships no pack', () => {
    for (const lang of ['en', 'th', 'nl', 'ms', 'he', 'hi']) {
      expect(univerLocaleFor(lang)).toBeNull()
    }
  })

  it('zh packs resolve and localize the DV rule name', async () => {
    const pack = (await import('@univerjs/preset-sheets-data-validation/locales/zh-CN')) as {
      default: Record<string, { list?: { name?: string } }>
    }
    expect(pack.default['sheets-data-validation']?.list?.name).toBe('值必须是列表中的值')
  })
})

describe('numberAsTextAlertLocale', () => {
  it('replaces the "Error" titles and keeps the rest of the namespaces', async () => {
    const core = (await import('@univerjs/preset-sheets-core/locales/en-US')).default as Record<
      string,
      Record<string, unknown>
    >
    const coreUi = core['sheets-ui'] as { info: Record<string, string> }
    const patched = numberAsTextAlertLocale(core)
    const numfmt = patched['sheets-numfmt-ui'] as { info: Record<string, string> }
    const ui = patched['sheets-ui'] as { info: Record<string, string> }
    expect(numfmt.info.error).toBe('Number stored as text')
    expect(ui.info.error).toBe('Number stored as text')
    expect(numfmt.info.forceStringInfo).toMatch(/stored as text/)
    expect(ui.info.forceStringInfo).toBe(numfmt.info.forceStringInfo)
    expect(Object.keys(numfmt).length).toBe(Object.keys(core['sheets-numfmt-ui'] ?? {}).length)
    expect(Object.keys(ui).length).toBe(Object.keys(coreUi).length)
    for (const key of Object.keys(coreUi.info)) {
      expect(ui.info).toHaveProperty(key)
    }
  })

  it('localizes the title from the numfmt pack', async () => {
    const core = (await import('@univerjs/preset-sheets-core/locales/zh-CN')).default as Record<
      string,
      Record<string, unknown>
    >
    const patched = numberAsTextAlertLocale(core)
    const coreNumfmt = core['sheets-numfmt-ui'] as { info: Record<string, string> }
    const title = (patched['sheets-numfmt-ui'] as { info: Record<string, string> }).info.error
    expect(title).not.toBe(coreNumfmt.info.error)
    expect(title).toBe(coreNumfmt.info.forceStringInfo)
    expect((patched['sheets-ui'] as { info: Record<string, string> }).info.error).toBe(title)
  })
})

describe('insertRowsBelowLocale', () => {
  it('rewords the English insert-rows-after entry to "rows below"', async () => {
    const core = (await import('@univerjs/preset-sheets-core/locales/en-US')).default as Record<
      string,
      Record<string, unknown>
    >
    const patched = insertRowsBelowLocale(core)
    const rightClick = (patched['sheets-ui'] as { rightClick: Record<string, string> }).rightClick
    const coreRightClick = (core['sheets-ui'] as { rightClick: Record<string, string> }).rightClick
    expect(rightClick.insertRowsAfterSuffix).toBe('rows below')
    expect(rightClick.insertRowsAboveSuffix).toBe(coreRightClick.insertRowsAboveSuffix)
    expect(Object.keys(rightClick).length).toBe(Object.keys(coreRightClick).length)
  })

  it('composes with the number-as-text patch (both survive the shallow merge)', async () => {
    const core = (await import('@univerjs/preset-sheets-core/locales/en-US')).default as Record<
      string,
      Record<string, unknown>
    >
    const patched = insertRowsBelowLocale(numberAsTextAlertLocale(core))
    const ui = patched['sheets-ui'] as {
      info: Record<string, string>
      rightClick: Record<string, string>
    }
    expect(ui.info.error).toBe('Number stored as text')
    expect(ui.rightClick.insertRowsAfterSuffix).toBe('rows below')
  })

  it('leaves translated packs untouched', async () => {
    const core = (await import('@univerjs/preset-sheets-core/locales/zh-CN')).default as Record<
      string,
      Record<string, unknown>
    >
    const patched = insertRowsBelowLocale(core)
    expect(patched['sheets-ui']).toBe(core['sheets-ui'])
  })
})

describe('tableColumnMenuLocale (SH-W4-V3)', () => {
  const menuOf = (pack: Record<string, unknown>) =>
    (pack['sheets-table-ui'] as { columnMenu: Record<string, string> }).columnMenu

  it('translates the table-filter popup column actions Univer ships in English for vi', async () => {
    const vi = (await import('@univerjs/preset-sheets-table/locales/vi-VN')).default as Record<
      string,
      Record<string, unknown>
    >
    expect(menuOf(vi)['insert-left']).toBe('Insert 1 table column left')
    const patched = tableColumnMenuLocale(vi, 'vi')
    expect(menuOf(patched)).toEqual({
      'insert-left': 'Chèn 1 cột bảng bên trái',
      'insert-right': 'Chèn 1 cột bảng bên phải',
      delete: 'Xóa cột bảng',
    })
    // The rest of the namespace is carried over, not dropped by the shallow merge.
    expect((patched['sheets-table-ui'] as Record<string, unknown>).sort).toBeDefined()
  })

  it('leaves packs that already translate them, and English, untouched', async () => {
    const zh = (await import('@univerjs/preset-sheets-table/locales/zh-CN')).default as Record<
      string,
      Record<string, unknown>
    >
    expect(tableColumnMenuLocale(zh, 'zh')['sheets-table-ui']).toBe(zh['sheets-table-ui'])
    const en = (await import('@univerjs/preset-sheets-table/locales/en-US')).default as Record<
      string,
      Record<string, unknown>
    >
    expect(tableColumnMenuLocale(en, 'en')['sheets-table-ui']).toBe(en['sheets-table-ui'])
  })
})
