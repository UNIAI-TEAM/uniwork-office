// node --test tools/rebrand/rebrand.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { globToRegExp, rebrand } from './rebrand.mjs'

const FIXTURE = {
  'apps/docs/package.json': JSON.stringify(
    {
      name: '@genoffice/docs',
      productName: 'GenOffice Docs',
      author: 'GenOffice',
      build: { appId: 'com.genoffice.docs', artifactName: 'AIDocx-${version}-${arch}.${ext}' },
    },
    null,
    2,
  ),
  'apps/shell/electron-builder.cjs': [
    'const config = {',
    "  appId: 'com.genoffice.app',",
    "  productName: 'GenOffice',",
    "  linux: { executableName: 'genoffice' },",
    '}',
    '',
  ].join('\n'),
  'apps/shell/src/main/index.ts': [
    '// GenOffice shell comment stays',
    "const t = 'GenOffice'",
    'const ua = `GenOffice/${v}`',
    "const docs = 'GenOffice Docs'",
    "import { x } from '@genoffice/ui'",
    "const font = 'GenOffice Sans KR'",
    '',
  ].join('\n'),
  'apps/docs/src/renderer/i18n/app/en.ts': [
    "  appLoginGenspark: 'Sign in to Genspark',",
    "  aiPanelTitle: 'Genspark',",
    '',
  ].join('\n'),
  'apps/docs/tests/keep.test.ts': "const t = 'GenOffice'\n",
  LICENSE: 'GenOffice\n',
}

function withTree(fn) {
  const root = mkdtempSync(join(tmpdir(), 'rebrand-test-'))
  try {
    for (const [file, text] of Object.entries(FIXTURE)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const read = (root, f) => readFileSync(join(root, f), 'utf8')

test('rewrites product names, ids and catalog values', () => {
  withTree((root) => {
    rebrand(root, { write: true })
    const pkg = JSON.parse(read(root, 'apps/docs/package.json'))
    assert.equal(pkg.name, '@genoffice/docs')
    assert.equal(pkg.productName, 'UniWork Docs')
    assert.equal(pkg.author, 'UniWork Office')
    assert.equal(pkg.build.appId, 'com.uniwork.docs')
    assert.equal(pkg.build.artifactName, 'UniWork-Docs-${version}-${arch}.${ext}')

    const builder = read(root, 'apps/shell/electron-builder.cjs')
    assert.match(builder, /appId: 'com\.uniwork\.office'/)
    assert.match(builder, /productName: 'UniWork Office',\n {2}artifactName: 'UniWork-Office-/)
    assert.match(builder, /executableName: 'uniwork-office'/)

    const main = read(root, 'apps/shell/src/main/index.ts')
    assert.match(main, /^\/\/ GenOffice shell comment stays$/m)
    assert.match(main, /const t = 'UniWork Office'/)
    assert.match(main, /`UniWorkOffice\/\$\{v\}`/)
    assert.match(main, /const docs = 'UniWork Docs'/)
    assert.match(main, /from '@genoffice\/ui'/)
    assert.match(main, /'GenOffice Sans KR'/)

    const en = read(root, 'apps/docs/src/renderer/i18n/app/en.ts')
    assert.match(en, /appLoginGenspark: 'Sign in to UniWork'/)
    assert.match(en, /aiPanelTitle: 'uniAI'/)
  })
})

test('never touches tests or license text', () => {
  withTree((root) => {
    rebrand(root, { write: true })
    assert.equal(
      read(root, 'apps/docs/tests/keep.test.ts'),
      FIXTURE['apps/docs/tests/keep.test.ts'],
    )
    assert.equal(read(root, 'LICENSE'), FIXTURE.LICENSE)
  })
})

test('is idempotent and --check style dry runs write nothing', () => {
  withTree((root) => {
    const dry = rebrand(root, { write: false })
    assert.ok(dry.changed.length > 0)
    assert.equal(read(root, 'apps/docs/package.json'), FIXTURE['apps/docs/package.json'])
    rebrand(root, { write: true })
    const second = rebrand(root, { write: true })
    assert.equal(second.changed.length, 0)
  })
})

test('glob matching', () => {
  assert.ok(globToRegExp('apps/*/package.json').test('apps/docs/package.json'))
  assert.ok(!globToRegExp('apps/*/package.json').test('apps/docs/x/package.json'))
  assert.ok(globToRegExp('**/tests/**').test('apps/docs/tests/a.test.ts'))
  assert.ok(globToRegExp('apps/*/src/**/*.{ts,tsx}').test('apps/a/src/b/c/d.tsx'))
  assert.ok(globToRegExp('{a,b/c}/x').test('b/c/x'))
})
