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
      'packages/cli/bin/genoffice.cmd': '"%~dp0..\\..\\GenOffice.exe" "%~dp0genoffice.cjs" %*\n',
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
        /\.\.\\UniWork Office\.exe" "%~dp0genoffice\.cjs"/,
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

test('CLI binary paths are fixed in the prettier-wrapped multi-line shape too', () => {
  // a long product name pushes the candidate list over 100 columns, so prettier wraps it
  const wrapped = (opt) =>
    [
      '    default:',
      '      return [',
      '        ...(shipped ? [shipped] : []),',
      `        '/opt/${opt}/genoffice',`,
      "        '/usr/bin/genoffice',",
      '      ]',
      '',
    ].join('\n')
  for (const opt of ['GenOffice', 'UniWork Office']) {
    withFiles({ 'packages/cli/src/resources.ts': wrapped(opt) }, (get) => {
      const res = get('packages/cli/src/resources.ts')
      assert.match(res, /'\/opt\/UniWork Office\/uniwork-office'/, opt)
      assert.ok(!res.includes('/usr/bin/'), `${opt}: no dead /usr/bin candidate`)
      assert.ok(!res.includes('genoffice'), `${opt}: no pre-rebrand binary name`)
    })
  }
})

test('en and vi errNoApiKey keep the UniWork wording after an upstream merge', () => {
  const upstreamEn = "    errNoApiKey: 'No API key configured for {provider}',\n"
  for (const file of [
    'apps/docs/src/main/docs-main.ts',
    'apps/sheets/src/main/sheets-main.ts',
    'apps/slides/src/main/i18n-main.ts',
  ]) {
    withFiles({ [file]: upstreamEn }, (get) => {
      assert.equal(
        get(file),
        "    errNoApiKey: 'AI is not activated. Purchase a plan to use the AI assistant.',\n",
      )
    })
  }
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
    },
    (get) => {
      assert.match(get('package.json'), /github\.com\/UNIAI-TEAM\/uniwork-office"/)
      assert.equal(
        get('apps/shell/src/main/updater.ts'),
        "const A = 'https://github.com/UNIAI-TEAM/uniwork-office/releases/latest'\nconst B = 'https://github.com/UNIAI-TEAM/uniwork-office/releases/latest'\n",
      )
    },
  )
})

test('first-run welcome copy is re-applied per locale and survives a merge', () => {
  const upstream = [
    'export const strings = {',
    '  zh: {',
    "    onbSubtitle1: '第一个开源的 AI 原生 Office 套件',",
    "    onbTitle2: '这只是一个开始',",
    '    onbBody2:',
    "      'UniWork Office 当前仅提供桌面编辑器。UniWork 身份认证、Work Graph 和云同步不在本阶段范围内。',",
    "    onbSkip: '跳过',",
    '  },',
    '  en: {',
    "    onbSubtitle1: 'Open document productivity runtime for the UniWork ecosystem',",
    "    onbBody1: 'Create docs. This is a desktop office runtime; platform integration is not part of GO-1.',",
    "    onbTitle2: 'This is just the beginning',",
    "    onbBody2: 'Not part of this phase.',",
    "    onbSkip: 'Skip',",
    '  },',
    "  'xx-XX': {",
    "    onbSubtitle1: 'Upstream wording of a locale without a copy',",
    '  },',
    '}',
    '',
  ].join('\n')
  withFiles({ 'apps/shell/src/renderer/src/strings.ts': upstream }, (get) => {
    const text = get('apps/shell/src/renderer/src/strings.ts')
    assert.match(text, /^ {4}onbSubtitle1: '文档、表格、演示和 PDF，尽在一个应用',$/m)
    assert.match(text, /^ {4}onbTitle2: 'AI at every step',$/m)
    // a value longer than the print width moves to its own line, like prettier lays it out
    assert.match(
      text,
      /^ {4}onbBody2:\n {6}'Draft, rewrite and explain right inside your documents\./m,
    )
    assert.match(
      text,
      /^ {4}onbSubtitle1: 'Upstream wording of a locale without a copy',$/m,
      'locales without a copy are untouched',
    )
    assert.match(text, /^ {4}onbSkip: 'Skip',$/m)
    assert.ok(!/GO-1|Work Graph|this phase|runtime/.test(text))
  })
})

test('the Linux default-app desktop id follows desktopName', () => {
  withFiles(
    {
      'apps/shell/src/main/default-app.ts': [
        "const LINUX_DESKTOP_ID = 'genoffice.desktop'",
        "const WINDOWS_DEFAULT_APPS_URL = 'ms-settings:defaultapps'",
        '',
      ].join('\n'),
    },
    (get) => {
      const src = get('apps/shell/src/main/default-app.ts')
      assert.match(src, /LINUX_DESKTOP_ID = 'uniwork-office\.desktop'/)
      assert.ok(!src.includes('genoffice.desktop'))
    },
  )
})

// verbatim from `git show b08e2ebf:packages/cli/src/resources.ts` (the linux branch is one line there)
const UPSTREAM_RESOURCES_TAIL = [
  '    default:',
  "      return [...(shipped ? [shipped] : []), '/opt/GenOffice/genoffice', '/usr/bin/genoffice']",
  '  }',
  '}',
  '',
  'export function appBinaryForResources(resources: string, platform: NodeJS.Platform): string {',
  '  const install = dirname(resources)',
  "  if (platform === 'darwin') return join(install, 'MacOS', 'GenOffice')",
  "  if (platform === 'win32') return join(install, 'GenOffice.exe')",
  "  return join(install, 'genoffice')",
  '}',
  '',
].join('\n')

test('cli-gui-binary-paths matches the real upstream shape of resources.ts', () => {
  withFiles({ 'packages/cli/src/resources.ts': UPSTREAM_RESOURCES_TAIL }, (get) => {
    const res = get('packages/cli/src/resources.ts')
    assert.match(
      res,
      /return \[\.\.\.\(shipped \? \[shipped\] : \[\]\), '\/opt\/UniWork Office\/uniwork-office'\]/,
    )
    assert.match(res, /join\(install, 'MacOS', 'UniWork Office'\)/)
    assert.match(res, /join\(install, 'UniWork Office\.exe'\)/)
    assert.match(res, /return join\(install, 'uniwork-office'\)/)
    assert.ok(!/\/usr\/bin|genoffice'/.test(res), 'no stale upstream linux names left')
  })
})

test('"Genspark AI" becomes "AI" only as a label, not inside a sentence', () => {
  withFiles(
    {
      'apps/html/src/renderer/components/Ribbon.tsx':
        '<span>Genspark AI</span>\n<Group label="Genspark AI">\n<strong>Genspark AI</strong>\n',
      'apps/shell/src/renderer/src/strings.ts':
        "  cloudSubtitle: 'Projects created on the web with Genspark AI. Editing continues in your browser.',\n  cloudPt: 'Projetos criados na web com o Genspark AI.',\n",
    },
    (get) => {
      assert.equal(
        get('apps/html/src/renderer/components/Ribbon.tsx'),
        '<span>AI</span>\n<Group label="AI">\n<strong>AI</strong>\n',
      )
      const s = get('apps/shell/src/renderer/src/strings.ts')
      assert.match(s, /with UniWork AI\. Editing continues/)
      assert.match(s, /com o UniWork AI\./)
    },
  )
})

test('the post-install ln -s hint quotes the spaced install dir', () => {
  withFiles(
    {
      'apps/shell/build/linux-after-install.sh':
        'echo "genoffice: $link is another program; run: ln -s $launcher $link" >&2\n',
    },
    (get) => {
      assert.equal(
        get('apps/shell/build/linux-after-install.sh'),
        'echo "genoffice: $link is another program; run: ln -s \\"$launcher\\" \\"$link\\"" >&2\n',
      )
    },
  )
})

test('GitHub, GenTeam and usage-statistics strings are dropped from every locale and stay dropped', () => {
  const upstream = [
    'export const strings = {',
    '  en: {',
    "    setGithub: 'Open Source',",
    "    starOnGitHub: 'Star on GitHub',",
    '    starPromptTitleN: "You\'ve opened {n} documents",',
    '    starPromptBody:',
    "      'UniWork Office is free and open source. A star on GitHub is the best way to support the team.',",
    "    setAnalytics: 'Send anonymous usage statistics',",
    '    setAnalyticsDesc:',
    "      'Uses Google Analytics 4; Google receives your public IP address.',",
    "    setAnalyticsOther: 'a different key that merely starts the same',",
    "    onbCredits: 'Active contributors get **1,000+ credits**',",
    "    onbJoinGenTeam: 'Join GenTeam',",
    "    onbSkip: 'Skip',",
    '  },',
    '  vi: {',
    "    starPromptGo: 'Gắn sao trên GitHub',",
    "    onbStarHint: 'Nếu bạn thích UniWork Office, hãy gắn sao.',",
    "    onbSkip: 'Bỏ qua',",
    '  },',
    '}',
    '',
  ].join('\n')
  withFiles({ 'apps/shell/src/renderer/src/strings.ts': upstream }, (get) => {
    const text = get('apps/shell/src/renderer/src/strings.ts')
    assert.ok(
      !/GitHub|Analytics|starPrompt|onbStarHint|onbCredits|onbJoinGenTeam|setGithub/.test(
        text.replace('setAnalyticsOther', ''),
      ),
    )
    assert.match(text, /setAnalyticsOther: 'a different key that merely starts the same'/)
    assert.equal((text.match(/onbSkip/g) ?? []).length, 2)
    assert.match(text, /^ {4}onbSkip: 'Bỏ qua',$/m)
  })
})

test('step 3 of the welcome dialog is rewritten in every locale, double-quoted upstream values included', () => {
  const upstream = [
    'export const strings = {',
    '  pt: {',
    "    onbTitle3: 'Grátis para todos',",
    '    onbBody3: "Sem licenças. Sem anúncios. Sem marcas d\'água.",',
    '  },',
    '  vi: {',
    "    onbTitle3: 'Miễn phí cho mọi người',",
    "    onbBody3: 'Không phí bản quyền. Không quảng cáo. Không watermark.',",
    '  },',
    '}',
    '',
  ].join('\n')
  withFiles({ 'apps/shell/src/renderer/src/strings.ts': upstream }, (get) => {
    const text = get('apps/shell/src/renderer/src/strings.ts')
    assert.match(text, /^ {4}onbTitle3: 'Tudo pronto',$/m)
    assert.match(
      text,
      /^ {4}onbBody3: 'Abra um arquivo ou crie um novo documento para começar\.',$/m,
    )
    assert.match(text, /^ {4}onbTitle3: 'Bạn đã sẵn sàng',$/m)
    assert.ok(!/Miễn phí|licenças|watermark/i.test(text))
  })
})

// ---- app icon overlay: the UniWork Office "Page" logo, every size the packagers and the app read ----

const ASSETS = new URL('./assets/', import.meta.url)
const asset = (rel) => readFileSync(new URL(rel, ASSETS))
const pngSize = (buf) => {
  assert.equal(buf.subarray(1, 4).toString(), 'PNG')
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

test('the icon overlay carries every Linux hicolor size at its real dimensions', () => {
  for (const n of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    assert.deepEqual(pngSize(asset(`apps/shell/build/icons/${n}x${n}.png`)), [n, n], `${n}`)
    assert.deepEqual(
      asset(`apps/shell/build/icons/${n}x${n}/apps/uniwork-office.png`),
      asset(`apps/shell/build/icons/${n}x${n}.png`),
      `${n} hicolor copy`,
    )
  }
  assert.deepEqual(pngSize(asset('apps/shell/build/icon.png')), [1024, 1024])
  assert.deepEqual(pngSize(asset('apps/shell/build/icon-mac.png')), [1024, 1024])
  assert.deepEqual(pngSize(asset('apps/shell/src/renderer/src/assets/app-icon.png')), [512, 512])
})

test('icon.ico holds 16..256 px entries and icon.icns the PNG slots macOS reads', () => {
  const ico = asset('apps/shell/build/icon.ico')
  assert.equal(ico.readUInt16LE(2), 1, 'icon resource type')
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256)
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])

  const icns = asset('apps/shell/build/icon.icns')
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  const slots = {}
  for (let at = 8; at < icns.length;) {
    const type = icns.subarray(at, at + 4).toString('ascii')
    const len = icns.readUInt32BE(at + 4)
    slots[type] = pngSize(icns.subarray(at + 8, at + len))[0]
    at += len
  }
  assert.deepEqual(slots, {
    icp4: 16,
    icp5: 32,
    icp6: 64,
    ic07: 128,
    ic08: 256,
    ic09: 512,
    ic10: 1024,
    ic11: 32,
    ic12: 64,
    ic13: 256,
    ic14: 512,
  })
})

test('the logo SVG is the icon source of truth and is never copied into the repo', () => {
  const svg = asset('_source/uniwork-office-logo.svg').toString('utf8')
  assert.match(svg, /<svg\s[^>]*viewBox="0 0 512 512"/)
  assert.doesNotMatch(svg, /<svg\s[^>]*\swidth=/, 'sized by the generator at each render')
  withTree((root) => {
    const { overlays } = rebrand(root)
    assert.ok(!overlays.some((f) => f.startsWith('_source/')), 'overlays: ' + overlays.join(', '))
  })
})

test('the standalone Docs app ships the same icons as the shell', () => {
  for (const f of ['icon.png', 'icon-mac.png', 'icon.ico', 'icon.icns']) {
    assert.deepEqual(asset(`apps/docs/build/${f}`), asset(`apps/shell/build/${f}`), f)
  }
})

test('Integrations prose names the product and keeps the command in parentheses, idempotently', () => {
  const upstream = [
    'export const strings = {',
    '  en: {',
    "    intgStep2Note: 'The assistant runs the genoffice command line itself; you never type it.',",
    "    intgCliTitle: 'Advanced: genoffice command line',",
    "    intgCliReady: 'genoffice {v} · ready in your terminal ({path})',",
    '    intgCliNotOnPath:',
    "      'genoffice {v} · not on PATH; found via ~/.genoffice/launcher. To type genoffice yourself, run this once:',",
    "    intgMcpStdioDesc: 'The assistant launches genoffice mcp itself.',",
    "    intgCopy: 'Copy genoffice',",
    '  },',
    '}',
    '',
  ].join('\n')
  withFiles({ 'apps/shell/src/renderer/src/strings.ts': upstream }, (get) => {
    const text = get('apps/shell/src/renderer/src/strings.ts')
    assert.match(text, /runs the UniWork Office \(genoffice\) command line itself/)
    assert.match(text, /intgCliTitle: 'Advanced: UniWork Office command line'/)
    assert.match(text, /intgCliReady: 'UniWork Office \(genoffice\) \{v\} · ready/)
    assert.match(
      text,
      /'UniWork Office \(genoffice\) \{v\} · not on PATH; found via ~\/\.genoffice\/launcher\. To type genoffice yourself/,
    )
    assert.match(text, /launches UniWork Office \(genoffice mcp\) itself/)
    assert.match(text, /intgCopy: 'Copy genoffice'/, 'other keys are untouched')
  })
})

test('the fork banner loses the internal ticket sentence but keeps the attribution line', () => {
  const old = [
    '> **UniWork Office fork.** The canonical product README is [`README.md`](../../README.md).',
    '>',
    '> This repository is currently a desktop office runtime. UniWork platform integration is not part of GO-1.',
    '',
    '# GenOffice',
    '',
  ].join('\n')
  withFiles({ 'docs/i18n/README.fr.md': old, 'docs/i18n/README.de.md': '# GenOffice\n' }, (get) => {
    const fr = get('docs/i18n/README.fr.md')
    assert.ok(!/GO-1|desktop office runtime/.test(fr))
    assert.match(fr, /^> \*\*UniWork Office fork\.\*\*/)
    assert.equal((fr.match(/UniWork Office fork/g) ?? []).length, 1)
    const de = get('docs/i18n/README.de.md')
    assert.match(de, /^> \*\*UniWork Office fork\.\*\*.*\n\n# GenOffice/s)
  })
})

test('shell maintainer / vendor map onto legal.json, and legal.json keeps its attribution', () => {
  const legal =
    '{ "upstream": { "name": "GenOffice", "copyright": "Copyright 2026 Mainfunc, Inc." } }\n'
  withFiles(
    {
      'apps/shell/electron-builder.cjs': [
        'const config = {',
        "  linux: { maintainer: 'Mainfunc, Inc. <team@genspark.ai>', vendor: 'Mainfunc, Inc.' },",
        "  deb: { maintainer: 'UniWork Office', vendor: 'UniWork Office' },",
        '}',
        '',
      ].join('\n'),
      'apps/shell/src/shared/legal.json': legal,
    },
    (get) => {
      const builder = get('apps/shell/electron-builder.cjs')
      assert.ok(!builder.includes('Mainfunc'), builder)
      assert.equal(builder.split('maintainer: `${legal.company} <${legal.email}>`').length, 3)
      assert.equal(builder.split('vendor: legal.company').length, 3)
      assert.equal(get('apps/shell/src/shared/legal.json'), legal, 'attribution is never rebranded')
    },
  )
})
