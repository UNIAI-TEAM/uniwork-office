/**
 * G8-15 (UNI-1410): 21-locale parity of the server-comments shard and its place in
 * the app dictionary; product copy carries no internal codes.
 */
import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { serverCommentsStrings } from '../src/renderer/i18n/strings-server-comments'
import { strings } from '../src/renderer/i18n/strings'

const shards = serverCommentsStrings as Record<string, Record<string, string>>
const keys = Object.keys(shards.zh!).sort()

describe('server comments strings', () => {
  it('has one shard per supported language', () => {
    expect(LANGS).toHaveLength(21)
    expect(Object.keys(shards).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('%s has the zh key set, non-empty, without internal codes', (lang) => {
    const shard = shards[lang]!
    expect(Object.keys(shard).sort()).toEqual(keys)
    for (const key of keys) {
      const v = shard[key]!
      expect(v.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
      expect(v).not.toMatch(/\b(?:G\d+-\d+|UNI-\d+)\b|git/i)
    }
  })

  it.each([...LANGS])('%s reaches the app dictionary', (lang) => {
    const dict = (strings as Record<string, Record<string, string>>)[lang]!
    for (const key of keys) expect(dict[key]).toBe(shards[lang]![key])
  })
})
