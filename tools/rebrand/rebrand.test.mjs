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

/** Runs a rebrand over an ad-hoc file map (in addition to FIXTURE) and returns the result reader. */
function withFiles(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'rebrand-test-'))
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    rebrand(root, { write: true })
    fn((f) => read(root, f), root)
    assert.equal(rebrand(root, { write: true }).changed.length, 0, 'second run changes nothing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('CLI launchers start the renamed app binaries', () => {
  withFiles(
    {
      'packages/cli/bin/genoffice': [
        '  */Contents/Resources/cli) app="$here/../../MacOS/GenOffice" ;;',
        '    if [ -x "$here/../../GenOffice.exe" ]; then app="$here/../../GenOffice.exe"; else app="$here/../../genoffice"; fi',
        '',
      ].join('\n'),
      'packages/cli/bin/genoffice.cmd': '"%~dp0..\..\GenOffice.exe" "%~dp0genoffice.cjs" %*\n',
      'packages/cli/src/resources.ts': [
        "      return [...(shipped ? [shipped] : []), '/opt/GenOffice/genoffice', '/usr/bin/genoffice']",
        "  return join(install, 'genoffice')",
        '',
      ].join('\n'),
    },
    (get) => {
      const sh = get('packages/cli/bin/genoffice')
      assert.match(sh, /MacOS\/UniWork Office" ;;/)
      assert.match(sh, /-x "\$here\/\.\.\/\.\.\/UniWork Office\.exe"/)
      assert.match(sh, /app="\$here\/\.\.\/\.\.\/uniwork-office"/)
      assert.match(
        get('packages/cli/bin/genoffice.cmd'),
        /\.\.\UniWork Office\.exe" "%~dp0genoffice\.cjs"/,
      )
      const res = get('packages/cli/src/resources.ts')
      assert.match(
        res,
        /\[\.\.\.\(shipped \? \[shipped\] : \[\]\), '\/opt\/UniWork Office\/uniwork-office'\]/,
      )
      assert.ok(!res.includes('/usr/bin/'), 'no dead /usr/bin candidate')
      assert.match(res, /join\(install, 'uniwork-office'\)/)
    },
  )
})

test('vi errNoApiKey keeps the UniWork wording after an upstream merge', () => {
  const upstreamVi = "    errNoApiKey: 'Chưa cấu hình khóa API cho {provider}',\n"
  withFiles({ 'apps/docs/src/main/docs-main.ts': upstreamVi }, (get) => {
    assert.equal(
      get('apps/docs/src/main/docs-main.ts'),
      "    errNoApiKey: 'Chưa kích hoạt / mua gói AI. Hãy mua gói để dùng Trợ lý AI.',\n",
    )
  })
})

test('origin links point at the UNIAI-TEAM repo, from upstream and from the old fork', () => {
  withFiles(
    {
      'package.json': '{ "homepage": "https://github.com/truongnt7/uniwork-office" }\n',
      'apps/shell/src/main/updater.ts':
        "const A = 'https://github.com/genspark-ai/genoffice/releases/latest'\nconst B = 'https://github.com/truongnt7/uniwork-office/releases/latest'\n",
      'apps/shell/src/main/index.ts':
        "const S = 'https://api.github.com/repos/truongnt7/uniwork-office'\nconst J = 'https://genoffice.ai/join'\n",
    },
    (get) => {
      assert.match(get('package.json'), /github\.com\/UNIAI-TEAM\/uniwork-office"/)
      assert.equal(
        get('apps/shell/src/main/updater.ts'),
        "const A = 'https://github.com/UNIAI-TEAM/uniwork-office/releases/latest'\nconst B = 'https://github.com/UNIAI-TEAM/uniwork-office/releases/latest'\n",
      )
      assert.equal(
        get('apps/shell/src/main/index.ts'),
        "const S = 'https://api.github.com/repos/UNIAI-TEAM/uniwork-office'\nconst J = 'https://github.com/UNIAI-TEAM/uniwork-office'\n",
      )
    },
  )
})
