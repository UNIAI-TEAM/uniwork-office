import { describe, expect, it } from 'vitest'
import { uploadImageToHost } from '../src/main/image-host'
import { strings } from '../src/renderer/i18n/strings'

/**
 * The image-host dialog offers a repository adapter. The provider id and the
 * REST endpoint are code, but nothing the user reads may name the hosting
 * product or its tooling: labels, placeholders and upload errors say
 * "repository" / "access token".
 */
const NAMED = /git/i

describe('image-host wording', () => {
  const locales = Object.entries(strings) as [string, Record<string, string>][]

  it('covers every locale with the repository-kind label', () => {
    expect(locales.length).toBe(21)
    for (const [, table] of locales) expect(table.imageHostKindRepo).toBeTruthy()
  })

  it('names no hosting product in any image-host string, in any locale', () => {
    for (const [locale, table] of locales) {
      for (const [key, value] of Object.entries(table)) {
        if (!key.startsWith('imageHost')) continue
        expect(NAMED.test(value), `${locale}.${key} = ${value}`).toBe(false)
      }
    }
  })

  it('keeps upload errors from the repository adapter neutral', async () => {
    const config = {
      kind: 'github' as const,
      token: 't',
      owner: 'user',
      repo: 'notes',
    }
    const run = (status: number, body: string) =>
      uploadImageToHost(config, {
        bytes: Buffer.from('x'),
        ext: 'png',
        fetchImpl: async () => ({
          ok: status < 300,
          status,
          headers: { get: () => null },
          text: async () => body,
        }),
      })
    const unparseable = await run(500, 'not json')
    const rejected = await run(401, JSON.stringify({ message: 'Bad credentials' }))
    const noUrl = await run(201, JSON.stringify({ content: {} }))
    for (const result of [unparseable, rejected, noUrl]) {
      expect(result.ok).toBe(false)
      expect(NAMED.test(result.error ?? ''), result.error).toBe(false)
    }
    expect(unparseable.error).toBe('Repository 500: unparseable response')
    expect(rejected.error).toBe('Repository 401: Bad credentials')
    expect(noUrl.error).toBe('Repository: no download_url in response')
  })
})
