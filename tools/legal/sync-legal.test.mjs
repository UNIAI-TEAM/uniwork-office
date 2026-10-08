// node --test tools/legal/sync-legal.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  LEGAL_JSON,
  noticeHeader,
  syncLegal,
  syncModifications,
  syncNotice,
  syncPackageJson,
  validateLegal,
  wrap,
} from './sync-legal.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LEGAL = JSON.parse(readFileSync(join(REPO, LEGAL_JSON), 'utf8'))
const SHA = 'b08e2ebf7204e28c94eb3fdcaf285891bab002a2'
const UPSTREAM_NOTICE =
  'GenOffice\nCopyright 2026 Mainfunc, Inc.\n\nThis product includes software developed at Mainfunc, Inc.'
const BODY = 'Bundled third-party components are listed in THIRD-PARTY-NOTICES.txt.\n\nFonts\n'

test('legal.json carries the upstream NOTICE verbatim and a non-repository homepage', () => {
  validateLegal(LEGAL)
  assert.equal(LEGAL.upstream.notice, UPSTREAM_NOTICE)
  assert.doesNotMatch(LEGAL.homepage, /github/i)
})

test('NOTICE header: fork first, upstream NOTICE verbatim, body untouched', () => {
  const upstreamOnly = `${UPSTREAM_NOTICE}\n\n${BODY}`
  const out = syncNotice(upstreamOnly, LEGAL)
  assert.ok(out.startsWith(`${LEGAL.product}\nCopyright ${LEGAL.copyrightYear} ${LEGAL.company}\n\n`))
  assert.ok(out.includes(`\n${UPSTREAM_NOTICE}\n`), 'upstream NOTICE kept byte for byte')
  assert.match(out, /modified version of GenOffice/)
  assert.match(out, /described in MODIFICATIONS\.\n\nBundled third-party/)
  assert.ok(out.endsWith(BODY))
  assert.equal(syncNotice(out, LEGAL), out, 'idempotent')
  assert.equal(out.split(UPSTREAM_NOTICE).length, 2, 'upstream NOTICE appears once')
})

test('NOTICE header follows legal.json', () => {
  const other = { ...LEGAL, company: 'Example Learning, Inc.', copyrightYear: 2027 }
  const out = syncNotice(syncNotice(BODY, LEGAL), other)
  assert.match(out, /^UniWork Office\nCopyright 2027 Example Learning, Inc\.\n/)
  assert.match(out, /The changes Example Learning, Inc\. made/)
  assert.doesNotMatch(out, /Copyright 2026 UniWork/)
})

test('NOTICE without the anchor paragraph fails loudly', () => {
  assert.throws(() => syncNotice('GenOffice\n', LEGAL), /Bundled third-party components/)
})

test('MODIFICATIONS header names company, year and the upstream commit', () => {
  const body = 'Summary of changes\n\nBranding\n'
  const out = syncModifications(body, LEGAL, SHA)
  assert.match(out, /^UniWork Office — statement of modifications\nModified by UniWork, 2026\.\n/)
  assert.ok(out.includes(SHA))
  assert.match(out, /genspark-ai\/genoffice/)
  assert.ok(out.endsWith(body))
  assert.equal(syncModifications(out, LEGAL, SHA), out)
  assert.throws(() => syncModifications(body, LEGAL, 'abc'), /40-character/)
})

test('wrap keeps lines short and never starts a line with the company suffix', () => {
  const text = wrap(noticeHeader(LEGAL).replace(/\n/g, ' '), 76)
  for (const line of text.split('\n')) assert.ok(line.length <= 76, line)
  assert.doesNotMatch(wrap('aaaa bbbb Mainfunc, Inc. cccc', 15), /^Inc\./m)
})

test('package.json: shell gets author + homepage, apps get the author, docs the copyright', () => {
  const shell = JSON.parse(
    syncPackageJson(
      JSON.stringify({ name: 's', homepage: 'https://github.com/x/y', author: 'UniWork Office' }),
      LEGAL,
      'shell',
    ),
  )
  assert.deepEqual(shell.author, { name: LEGAL.company, email: LEGAL.email })
  assert.equal(shell.homepage, LEGAL.homepage)
  const app = JSON.parse(syncPackageJson(JSON.stringify({ name: 'a', author: 'X' }), LEGAL, 'app'))
  assert.deepEqual(app.author, { name: LEGAL.company, email: LEGAL.email })
  assert.equal(app.homepage, undefined)
  const bare = JSON.parse(syncPackageJson(JSON.stringify({ name: 'b' }), LEGAL, 'app'))
  assert.equal(bare.author, undefined, 'no author is added where none was declared')
  const docs = JSON.parse(
    syncPackageJson(JSON.stringify({ name: 'd', author: 'X', build: {} }), LEGAL, 'docs'),
  )
  assert.equal(docs.build.copyright, `Copyright © ${LEGAL.copyrightYear} ${LEGAL.company}`)
})

test('validateLegal rejects a repository homepage and missing fields', () => {
  assert.throws(() => validateLegal({ ...LEGAL, homepage: 'https://github.com/a/b' }), /homepage/)
  assert.throws(() => validateLegal({ ...LEGAL, email: '' }), /email/)
  assert.throws(() => validateLegal({ ...LEGAL, upstream: { ...LEGAL.upstream, notice: '' } }))
})

test('syncLegal on a scratch tree: dry run writes nothing, a write run converges', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-legal-'))
  try {
    const put = (f, t) => {
      mkdirSync(dirname(join(root, f)), { recursive: true })
      writeFileSync(join(root, f), t)
    }
    put(LEGAL_JSON, JSON.stringify(LEGAL))
    put('tools/rebrand/UPSTREAM_BASE', `${SHA}\n`)
    put('NOTICE', `${UPSTREAM_NOTICE}\n\n${BODY}`)
    put('MODIFICATIONS', 'Summary of changes\n')
    put('apps/shell/package.json', JSON.stringify({ name: 's', author: 'UniWork Office' }))
    put('apps/pdf/package.json', JSON.stringify({ name: 'p' }, null, 2) + '\n')
    const dry = syncLegal(root)
    assert.deepEqual(dry.changed.sort(), ['MODIFICATIONS', 'NOTICE', 'apps/shell/package.json'])
    assert.equal(readFileSync(join(root, 'MODIFICATIONS'), 'utf8'), 'Summary of changes\n')
    syncLegal(root, { write: true })
    assert.deepEqual(syncLegal(root).changed, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the checked-in tree is in sync with legal.json', () => {
  assert.deepEqual(syncLegal(REPO).changed, [])
})
