// node --test tools/rebrand/brand-scan.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brandMatches, compileAllowlist, loadAllowlist, scan, scopeOf } from './brand-scan.mjs'

/** Scans an in-memory file map. */
function run(files, allow = []) {
  return scan({
    files: Object.keys(files),
    read: (f) => files[f],
    allow: compileAllowlist(allow),
  })
}

test('catalog: flags brand in the value, ignores identifier keys', () => {
  const { violations } = run({
    'apps/docs/src/renderer/i18n/app/en.ts': [
      "  appGensparkAccount: 'UniWork account',",
      "  appLoginGenspark: 'Sign in to Genspark',",
      "  aiTitle: 'About GenOffice',",
    ].join('\n'),
  })
  assert.deepEqual(
    violations.map((v) => [v.line, v.match]),
    [
      [2, 'Genspark'],
      [3, 'GenOffice'],
    ],
  )
})

test('catalog: inflections and hyphenated compounds still count as the brand', () => {
  assert.deepEqual(brandMatches('Přihlásit se ke Gensparku'), ['Genspark'])
  assert.deepEqual(brandMatches('Installieren Sie den GenOffice-Skill'), ['GenOffice'])
})

test('code identifiers and the lowercase CLI command are not brand hits', () => {
  for (const line of [
    "import { x } from '@genoffice/ui'",
    'process.env.GENOFFICE_USER_DATA',
    'const p = genofficeAuthPath()',
    'type GenSparkAccountStatus = {}',
    "contextBridge.exposeInMainWorld('__genofficeDebugHooks', true)",
    "font-family: 'GenOffice Sans KR'",
    'run `genoffice open report.docx`',
    "provider === 'genspark'",
    'openGenTeam()',
  ]) {
    assert.deepEqual(brandMatches(line), [], line)
  }
})

test('org and domain forms are brand hits even in lowercase', () => {
  assert.ok(brandMatches("fetch('https://www.genspark.ai/api')").includes('genspark.ai'))
  assert.ok(brandMatches("open('https://genoffice.ai/join')").includes('genoffice.ai'))
  assert.ok(brandMatches('npx skills add genspark-ai/genoffice').includes('genspark-ai/'))
})

test('source: comment lines are skipped, string literals are not', () => {
  const { violations } = run({
    'apps/pdf/src/main/save-pdf.ts': [
      '// GenOffice default author',
      '/**',
      ' * Genspark note',
      ' */',
      "const author = 'GenOffice'",
      "const glob = 'apps/*/src' // trailing",
      "const ok = 'UniWork Office'",
    ].join('\n'),
  })
  assert.deepEqual(
    violations.map((v) => v.line),
    [5],
  )
})

test('source: a glob inside a string does not open a block comment', () => {
  const { violations } = run({
    'apps/shell/src/main/a.ts': ["const g = 'apps/*/src/**'", "const t = 'GenOffice'"].join('\n'),
  })
  assert.equal(violations.length, 1)
})

test('installer config is scanned in full, comments included', () => {
  const { violations } = run({
    'apps/shell/electron-builder.cjs': "// bare GenOffice logo\nproductName: 'UniWork Office',",
  })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].scope, 'installer')
})

test('package.json: productName and metadata are scanned, name and dependencies are not', () => {
  const json = JSON.stringify({
    name: '@genoffice/docs',
    productName: 'GenOffice Docs',
    description: 'UniWork Docs',
    dependencies: { '@genoffice/ui': '*' },
    build: { appId: 'com.genoffice.docs' },
    bin: { genoffice: './bin/genoffice' },
  })
  const { violations } = run({ 'apps/docs/package.json': json })
  assert.deepEqual(violations.map((v) => v.match).sort(), ['GenOffice', 'com.genoffice'])
})

test('out-of-scope paths are never scanned', () => {
  const files = Object.fromEntries(
    [
      'LICENSE',
      'NOTICE',
      'README.md',
      'docs/go1/BASELINE.md',
      'apps/docs/tests/a.test.ts',
      'e2e/x.spec.ts',
      'packages/ui/tests/b.test.ts',
      'package-lock.json',
    ].map((f) => [f, 'GenOffice Genspark genspark.ai']),
  )
  assert.equal(run(files).violations.length, 0)
  assert.equal(scopeOf('apps/docs/src/renderer/i18n/ai/vi.ts'), 'catalog')
  assert.equal(scopeOf('apps/shell/src/renderer/src/strings.ts'), 'catalog')
})

test('allowlist entries need a reason and suppress matching hits only', () => {
  assert.throws(() => compileAllowlist([{ path: 'a', kind: 'permanent' }]), /reason/)
  const files = {
    'apps/shell/src/main/a.ts': "const u = 'https://www.genspark.ai/'\nconst n = 'GenOffice'",
  }
  const { violations, allowed } = run(files, [
    { path: 'apps/shell/src/main/a.ts', pattern: 'genspark\\.ai', kind: 'debt', reason: 'GO-A4' },
  ])
  assert.deepEqual(
    violations.map((v) => v.line),
    [2],
  )
  assert.equal(allowed[0].reason, 'GO-A4')
})

test('a debt entry that no longer matches is reported as unused', () => {
  const { unused } = run({ 'apps/shell/src/main/a.ts': "const n = 'UniWork'" }, [
    { path: 'apps/shell/src/main/a.ts', pattern: 'GenOffice', kind: 'debt', reason: 'fixed soon' },
  ])
  assert.equal(unused.length, 1)
})

test('the shipped allowlist file is well formed', () => {
  const entries = loadAllowlist()
  assert.ok(entries.length > 0)
  for (const e of entries) assert.ok(e.reason.length > 20, `reason too thin: ${e.path}`)
})

test('scope covers the shipped CLI launchers, packaging recipes, CLI README and MCP bridge', () => {
  assert.equal(scopeOf('packages/cli/bin/genoffice'), 'installer')
  assert.equal(scopeOf('packages/cli/bin/genoffice.cmd'), 'installer')
  assert.equal(scopeOf('packaging/flatpak/com.genoffice.app.json'), 'installer')
  assert.equal(scopeOf('packaging/docker/batch-convert'), 'installer')
  assert.equal(scopeOf('packages/cli/README.md'), 'shipped')
  assert.equal(scopeOf('scripts/mcp-stdio-bridge.js'), 'source')
  const { violations } = run({
    'packages/cli/bin/genoffice': 'app="$here/../../MacOS/GenOffice"',
  })
  assert.equal(violations.length, 1)
})

test('catalog and source: internal tracker ids are violations, comments are not', () => {
  const { violations } = run({
    'apps/shell/src/renderer/src/strings.ts': [
      "  onbBody1: 'A desktop runtime; platform integration is not part of GO-1.',",
      "  onbBody2: 'See UNI-1002 and GO-A8.',",
      "  onbBody3: 'Your ego-1 and a GOAL-100 stay.',",
      '',
    ].join('\n'),
    'apps/shell/src/main/index.ts': "// disabled in GO-1\nconst x = 'GO-1'\n",
  })
  assert.deepEqual(
    violations.map((v) => [v.file, v.line]),
    [
      ['apps/shell/src/renderer/src/strings.ts', 1],
      ['apps/shell/src/renderer/src/strings.ts', 2],
      ['apps/shell/src/main/index.ts', 2],
    ],
  )
})

test('internal planning vocabulary in user-visible strings is a violation', () => {
  const hits = (line, file = 'apps/shell/src/renderer/src/strings.ts') =>
    run({ [file]: line }).violations.length
  // hits: tracker ids, phase talk, unreleased platform names, spec-speak (en and vi)
  for (const text of [
    'platform integration is not part of GO-1.',
    'Tracked in GO-A8 and GO-B2.',
    'See UNI-1002.',
    'Cloud sync is not part of this phase.',
    'The next milestone adds sync.',
    'Phase 1',
    'plan v2 only',
    'Work Graph and cloud sync',
    'A desktop office runtime',
    'Open document productivity runtime',
    'Dashboard chỉ số — giai đoạn này nhập thủ công',
    'Giai đoạn 1',
  ]) {
    assert.equal(hits(`  key: '${text}',`), 1, text)
  }
  // string literals in renderer source count too, comment lines do not
  assert.equal(hits("const a = 'Phase 1'", 'apps/shell/src/renderer/src/Wb.tsx'), 1)
  assert.equal(hits('// GO-1 is the first phase 1', 'apps/shell/src/renderer/src/Wb.tsx'), 0)
  // non-hits: lookalikes and legitimate product words
  for (const text of [
    'UniAI and uniAI stay',
    'Unicode and UNIAI-TEAM',
    'Press GO-TO to jump',
    'go-to-next-match',
    'Family milestones: birthdays and weddings',
    'A new moon phase calendar',
    'Add milestone',
    'PHASE1_BLOCKS',
    'giai đoạn ôn tập',
    'Plan your week',
    'Run time: 5 min',
  ]) {
    assert.equal(hits(`  key: '${text}',`), 0, text)
  }
})

test('source: the upstream .desktop id is flagged, the UniWork one and comments are not', () => {
  const hit = run({
    'apps/shell/src/main/default-app.ts': "const LINUX_DESKTOP_ID = 'genoffice.desktop'",
  })
  assert.deepEqual(
    hit.violations.map((v) => v.match),
    ['genoffice.desktop'],
  )
  const ok = run({
    'apps/shell/src/main/default-app.ts': [
      "const LINUX_DESKTOP_ID = 'uniwork-office.desktop'",
      '// upstream used genoffice.desktop',
    ].join('\n'),
  })
  assert.equal(ok.violations.length, 0)
})

test('a permanent entry that matches nothing is reported separately from debt', () => {
  const { unused, unusedPermanent } = run({ 'apps/shell/src/main/a.ts': "const n = 'UniWork'" }, [
    {
      path: 'apps/shell/src/main/a.ts',
      pattern: 'GenOffice',
      kind: 'permanent',
      reason: 'stale: nothing matches this any more',
    },
  ])
  assert.equal(unused.length, 0)
  assert.equal(unusedPermanent.length, 1)
})

test('user-visible GitHub wording and repo links are violations, camel-case identifiers and comments are not', () => {
  const hits = (line, file = 'apps/shell/src/renderer/src/strings.ts') =>
    run({ [file]: line }).violations.length
  // hits: the word in any case, repo / API hosts, in catalogs and in string literals
  for (const text of [
    'Star on GitHub',
    'Gắn sao trên GitHub',
    'Open the repo on github',
    'see https://github.com/UNIAI-TEAM/uniwork-office',
    'api.github.com/repos/a/b',
    'raw.githubusercontent.com/a/b',
  ]) {
    assert.equal(hits(`  key: '${text}',`), 1, text)
  }
  assert.equal(hits("const URL = 'https://github.com/x/y'", 'apps/shell/src/main/a.ts'), 1)
  // non-hits: code identifiers, comments, out-of-scope files
  for (const line of [
    'window.aiOffice.openGitHubRepo()',
    'export const GITHUB_REPO_URL = u',
    'const githubStars = 0',
  ]) {
    assert.equal(hits(line, 'apps/shell/src/main/a.ts'), 0, line)
  }
  assert.equal(hits('// see github.com/foo/bar#12', 'apps/shell/src/main/a.ts'), 0)
  assert.equal(hits('Star on GitHub', 'LICENSE'), 0)
  assert.equal(hits('Star on GitHub', 'NOTICE'), 0)
  assert.equal(
    hits('"homepage": "https://github.com/UNIAI-TEAM/uniwork-office"', 'package.json'),
    0,
  )
})

test('GitHub allowlist entries are reasoned and suppress only their file', () => {
  const files = {
    'apps/markdown/src/main/image-host.ts': 'const u = `https://api.github.com/repos/${o}/${r}`',
    'apps/shell/src/main/a.ts': "const u = 'https://api.github.com/repos/${o}'",
  }
  const { violations, allowed } = run(files, [
    {
      path: 'apps/markdown/src/main/image-host.ts',
      pattern: 'api\\.github\\.com',
      kind: 'permanent',
      reason: 'third-party image host API endpoint the user configures',
    },
  ])
  assert.deepEqual(
    violations.map((v) => v.file),
    ['apps/shell/src/main/a.ts'],
  )
  assert.equal(allowed.length, 1)
})

test('analytics endpoints and GA4 credentials in product code or packaging config are violations', () => {
  const hits = (line, file) => run({ [file]: line }).violations.length
  for (const [line, file] of [
    ["const E = 'https://www.google-analytics.com/mp/collect'", 'apps/shell/src/main/a.ts'],
    ["const T = 'https://www.googletagmanager.com/gtag/js'", 'apps/docs/src/renderer/a.ts'],
    ['const q = `?measurement_id=${id}`', 'apps/shell/src/main/a.ts'],
    ['extraMetadata.genofficeAnalytics = { apiSecret }', 'apps/shell/electron-builder.cjs'],
    ['const id = process.env.GENOFFICE_GA4_API_SECRET', 'apps/shell/electron-builder.cjs'],
  ]) {
    assert.equal(hits(line, file), 1, line)
  }
  // a settings key that merely says "analytics" is fine
  assert.equal(hits("const k = 'analytics'", 'apps/shell/src/main/a.ts'), 0)
  assert.equal(hits('// google-analytics.com was removed', 'apps/shell/src/main/a.ts'), 0)
})
