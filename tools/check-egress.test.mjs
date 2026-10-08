import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inScope, scanText, scanTree } from './check-egress.mjs'

const SCRIPT = fileURLToPath(new URL('./check-egress.mjs', import.meta.url))
const roots = []

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-egress-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('scanText', () => {
  it('flags every blocked host and the CLI package, comments included', () => {
    const hits = scanText(
      [
        "fetch('https://www.genspark.ai/api/x')",
        '// see https://genoffice.ai/join',
        "const u = 'https://www.google-analytics.com/mp/collect'",
        '<script src="https://www.googletagmanager.com/gtag/js"></script>',
        '"@genspark/cli": "^1.4.2"',
        'const ok = "https://openrouter.ai/api/v1"',
      ].join('\n'),
    )
    assert.deepEqual(
      hits.map((h) => [h.line, h.pattern]),
      [
        [1, 'genspark.ai'],
        [2, 'genoffice.ai'],
        [3, 'google-analytics.com'],
        [4, 'googletagmanager.com'],
        [5, '@genspark/cli'],
      ],
    )
  })

  it('is case-insensitive and ignores look-alike words without the domain', () => {
    assert.equal(scanText('WWW.GENSPARK.AI').length, 1)
    assert.equal(scanText('genspark provider id, GenOffice package names').length, 0)
  })
})

describe('inScope', () => {
  it('covers shipped sources, manifests, the builder config, scripts and skills', () => {
    for (const p of [
      'apps/shell/src/main/index.ts',
      'packages/ai-search/src/gsk.ts',
      'packages/ai-search/package.json',
      'apps/docs/package.json',
      'apps/shell/electron-builder.cjs',
      'scripts/update-feed-utils.cjs',
      'skills/genoffice/SKILL.md',
    ]) {
      assert.equal(inScope(p), true, p)
    }
  })

  it('leaves out tests, packaging, tools, docs and build output', () => {
    for (const p of [
      'packages/ai-search/tests/gsk.test.ts',
      'apps/shell/src/main/updater.test.ts',
      'apps/docs/src/renderer/__tests__/x.ts',
      'packaging/flatpak/com.genoffice.app.json',
      'tools/rebrand/table.mjs',
      'README.md',
      'apps/shell/dist/main.js',
      'packages/cli/node_modules/x/index.js',
      'apps/shell/build/notarize-dmg.js',
    ]) {
      assert.equal(inScope(p), false, p)
    }
  })
})

describe('scanTree', () => {
  it('reports hits in scope only, with repo-relative paths', () => {
    const root = tree({
      'packages/a/src/x.ts': "const u = 'https://www.genspark.ai/'\n",
      'packages/a/tests/x.test.ts': "const u = 'https://www.genspark.ai/'\n",
      'packaging/docker/Dockerfile': 'genoffice.ai\n',
      'apps/b/package.json': '{"dependencies":{"@genspark/cli":"1"}}\n',
      'apps/b/src/ok.ts': 'export const x = 1\n',
    })
    const v = scanTree(root, { allowlist: [] })
    assert.deepEqual(
      v.map((h) => [h.path, h.line, h.pattern]),
      [
        ['apps/b/package.json', 1, '@genspark/cli'],
        ['packages/a/src/x.ts', 1, 'genspark.ai'],
      ].sort(),
    )
  })

  it('honours an allowlist entry for exactly that path and pattern', () => {
    const root = tree({ 'scripts/x.js': '// genspark.ai and genoffice.ai\n' })
    const v = scanTree(root, {
      allowlist: [{ path: 'scripts/x.js', pattern: 'genspark.ai', reason: 'test' }],
    })
    assert.deepEqual(
      v.map((h) => h.pattern),
      ['genoffice.ai'],
    )
  })
})

describe('CLI', () => {
  it('exits 1 with the hit listed, and 0 on a clean tree', () => {
    const dirty = tree({ 'skills/s/SKILL.md': 'See https://www.genspark.ai/\n' })
    const bad = spawnSync(process.execPath, [SCRIPT, '--root', dirty], { encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /skills\/s\/SKILL\.md:1 \[genspark\.ai\]/)
    const clean = tree({ 'skills/s/SKILL.md': 'nothing here\n' })
    const good = spawnSync(process.execPath, [SCRIPT, '--root', clean], { encoding: 'utf8' })
    assert.equal(good.status, 0, good.stderr)
  })
})
