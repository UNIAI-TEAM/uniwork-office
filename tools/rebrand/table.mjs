// UniWork rebrand table. Consumed by tools/rebrand/rebrand.mjs and by
// tools/rebrand/brand-scan.mjs (the scan shares NON_BRAND_TOKENS so the two
// tools agree on what is a code identifier rather than a visible brand).
//
// Derived from `git diff 616a7acf 11945d6d` (the hand rebrand of upstream
// genoffice) plus the later brand decisions already present on main.
// Internal package names (@genoffice/*), import paths, code identifiers,
// env var names (GENOFFICE_*), the `genoffice` CLI command, font family
// aliases and document-content markers stay untouched on purpose.
//
// A rule is { id, why, files, exclude?, skipComments?, replace: [[RegExp, string | fn]] }.
// `files` / `exclude` are repo-relative globs. `skipComments` leaves
// whole-line comments alone (the brand word in a comment is not user-visible
// and rewriting it would only make upstream merges noisier).

import { ONBOARDING_COPY } from './onboarding-copy.mjs'

const SRC_EXT = '{ts,tsx,mts,cts,js,mjs,cjs,html,md,json}'

/** Product source that can carry user-visible strings. */
export const SRC = [`apps/*/src/**/*.${SRC_EXT}`, `packages/*/src/**/*.${SRC_EXT}`]

/** Never rewritten by any text rule (document data, tests, attribution). */
export const GLOBAL_EXCLUDE = [
  'LICENSE*',
  'NOTICE',
  'ee/**',
  'fixtures/**',
  'e2e/**',
  'docs/**',
  'skills/**',
  '.github/**',
  'package-lock.json',
  '**/node_modules/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/fixtures/**',
  '**/fonts/**',
  'tools/rebrand/**',
  // documents the removed upstream lockup by name
  '**/UNIWORK_BRAND_ASSET_REQUIRED.md',
  // document content / engine data (CLAUDE.md rule 4)
  'packages/{docx-engine,pptx-engine,pptx-render,pptx-ops,xlsx-gateway,pdf2docx,html2docx,file-parse,font-metrics,pipelines}/**',
]

// Brand words that are really code identifiers, font-family aliases or
// stored-document markers. `GenOffice` followed by one of these is not the
// product name.
const FONT_ALIAS =
  'PUA|Grid|Sans|Serif|Gothic|Che|Poppins|Tamil|Fullwidth|Songti|Hiragino|MS|Batang|Myungjo|Heiti|MingLiU|Ethiopic|Box|UI|Hangul|DM|SimSun|YaHei'
const DATA_MARKER = 'visual'

export const NON_BRAND_TOKENS = [
  new RegExp(`GenOffice\\s+(?:${FONT_ALIAS}|${DATA_MARKER})\\b`, 'g'),
  /GenOffice\s+\[/g, // font-alias matcher regex source
  /webSearch\('GenOffice'/g, // search connectivity probe query
  /[A-Za-z0-9_]GenOffice|GenOffice[A-Za-z0-9_]/g,
  /[A-Za-z0-9_]Genspark|Genspark[A-Z0-9_]/g,
  /@genoffice\//gi,
  /@genspark(?=['"/])/gi, // npm scope of the vendored gsk CLI package
  /\?\.genspark\b/g, // legacy provider settings key (settings.providers?.genspark)
  /['"`]genspark['"`]/g, // legacy provider id literal
  /(?<![A-Za-z0-9_])genoffice(?![A-Za-z0-9_]|\.ai\b)/g, // the `genoffice` CLI command, its launcher and ~/.genoffice
  /GENOFFICE_[A-Z0-9_]+/g,
  /GENSPARK_[A-Z0-9_]+/g,
  /\b(?:genoffice|genspark|genteam)[._:-][A-Za-z0-9_.:-]*/g,
  /[A-Za-z0-9_.:-]+[._:-](?:genoffice|genspark|genteam)\b/g,
]

const GITHUB_URL_FILES = [
  'package.json',
  'apps/shell/package.json',
  'apps/shell/src/main/index.ts',
  'apps/shell/src/main/tab-manager.ts',
  'apps/shell/src/main/updater.ts',
  'apps/shell/src/renderer/src/SettingsModal.tsx',
  'apps/docs/src/renderer/App.tsx',
  'packages/electron-utils/src/github-menu.ts',
  'apps/uniai-pwa/app.js',
]

const aiBadgeSvg = (classLine) => `    <svg
${classLine}      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 6.25 13.15 10.1 17 11.25 13.15 12.4 12 16.25 10.85 12.4 7 11.25 10.85 10.1 Z"
        fill="currentColor"
      />
    </svg>`

const AI_BADGE_DOC =
  '/** Generic AI badge (not a vendor mark). Function name kept for call sites. */'

/**
 * Replaces the Genspark sparkle artwork inside `GensparkMark` with the generic
 * AI badge. The function name and signature stay (call sites unchanged).
 */
function genericAiBadge(text) {
  const head = text.search(/(?:\/\*\*[^]*?\*\/\s*)?export function GensparkMark\(/)
  if (head < 0) return text
  const fn = text.indexOf('export function GensparkMark(', head)
  const svgStart = text.indexOf('<svg', fn)
  const svgEnd = text.indexOf('</svg>', svgStart)
  if (svgStart < 0 || svgEnd < 0) return text
  const lineStart = text.lastIndexOf('\n', svgStart) + 1
  // keep a className hook on the <svg> (slides styles it)
  const cls = /^\s*className="[^"]*"\s*$/m.exec(text.slice(svgStart, text.indexOf('>', svgStart)))
  const classLine = cls ? `${cls[0].trimEnd()}\n` : ''
  let out = text.slice(0, lineStart) + aiBadgeSvg(classLine) + text.slice(svgEnd + '</svg>'.length)
  // doc comment right above the function
  out = out.replace(
    /\/\*\*(?:(?!\*\/)[^])*\*\/(\s*\nexport function GensparkMark\()/,
    (_m, tail) => `${AI_BADGE_DOC}${tail}`,
  )
  return out
}

/** Terminal columns of a string the way prettier counts them (wide CJK = 2, U+0300-036F = 0). */
function columns(text) {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c >= 0x300 && c <= 0x36f) continue // prettier skips only these combining marks
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
    n += wide ? 2 : 1
  }
  return n
}

/**
 * Sets the first-run welcome keys (onboarding-copy.mjs) inside each locale block of the shell
 * string table, written the way prettier lays out a long property (value on its own line).
 */
function onboardingCopy(text) {
  let out = text
  for (const [locale, copy] of Object.entries(ONBOARDING_COPY)) {
    const header = new RegExp(`^  (?:${locale}|'${locale}'): \\{\\n`, 'm').exec(out)
    if (!header) continue
    const start = header.index + header[0].length
    const end = out.indexOf('\n  },\n', start)
    if (end < 0) continue
    let block = out.slice(start, end)
    for (const [key, value] of Object.entries(copy)) {
      const line = `    ${key}: '${value}',`
      const next = columns(line) <= 100 ? line : `    ${key}:\n      '${value}',`
      const prop = new RegExp(`^    ${key}:[ \\t]*(?:\\n[ \\t]*)?'(?:[^'\\\\\\n]|\\\\.)*',$`, 'm')
      block = prop.test(block) ? block.replace(prop, () => next) : block
    }
    out = out.slice(0, start) + block + out.slice(end)
  }
  return out
}

const PRODUCT_NAME = new RegExp(
  `(?<![A-Za-z0-9_@])GenOffice(?![A-Za-z0-9_])(?!-(?![A-Z]))(?!\\s+(?:${FONT_ALIAS}|${DATA_MARKER})\\b)`,
  'g',
)

export const rules = [
  // ---------------------------------------------------------------- names
  {
    id: 'module-names',
    why: 'App module product names: "GenOffice Docs" -> "UniWork Docs" (also Sheets, Slides, PDF, Markdown, HTML): productName, window titles, <title>, help menus, AI system prompts',
    files: [...SRC, 'apps/*/package.json'],
    skipComments: true,
    replace: [[/GenOffice (Docs|Sheets|Slides|PDF|Markdown|HTML)(?![A-Za-z0-9])/g, 'UniWork $1']],
  },
  {
    id: 'user-agent',
    why: 'AI provider User-Agent token',
    files: SRC,
    skipComments: true,
    replace: [
      [/GenOffice(?=\/\$\{)/g, 'UniWorkOffice'],
      [/(AI_DEFAULT_USER_AGENT = ')GenOffice'/g, "$1UniWorkOffice'"],
    ],
  },
  {
    id: 'pdf-assistant-name',
    why: 'PDF AI system prompt names the module, not the suite',
    files: ['apps/pdf/src/renderer/ai/pdf-skill.ts'],
    skipComments: true,
    replace: [[/GenOffice's PDF assistant/g, "UniWork PDF's assistant"]],
  },
  {
    id: 'cli-description',
    why: 'CLI package description / README lead sentence',
    files: ['packages/cli/package.json', 'packages/cli/README.md'],
    ignoreGlobalExclude: true,
    replace: [[/(is|:) the GenOffice command line/g, '$1 the UniWork Office command line']],
  },
  {
    id: 'ai-panel-title-i18n',
    why: 'Vendor heading in every locale catalog: AI panel title "Genspark" -> "uniAI", ribbon button "Genspark" -> "AI"',
    files: ['apps/*/src/renderer/i18n/**/*.ts'],
    replace: [
      [/^(\s*aiPanelTitle\s*:\s*['"])Genspark(['"])/gm, '$1uniAI$2'],
      [/^(\s*ribbonAiAssistant\s*:\s*['"])Genspark(['"])/gm, '$1AI$2'],
    ],
  },
  {
    id: 'ai-label',
    why: 'Ribbon / group labels "Genspark AI" -> "AI". Only label contexts (element text `<span>Genspark AI</span>`, `label="..."`, `title="..."`, `aria-label="..."`): in a sentence (the 20-locale cloudSubtitle) "Genspark AI" is a vendor name and falls through to genspark-account ("UniWork AI"), not "com o AI" / "Mit AI"',
    files: SRC,
    skipComments: true,
    replace: [[/(?<=>|\blabel="|\btitle="|\baria-label=")Genspark AI(?=<|")/g, 'AI']],
  },
  {
    id: 'ai-panel-brand',
    why: 'AI side-panel header and aria-label: vendor name -> "uniAI"',
    files: ['apps/*/src/renderer/ai/{AiPanel,AiChatPanel}.tsx'],
    replace: [
      [/aria-label="Genspark"/g, 'aria-label="uniAI"'],
      [/^(\s*)Genspark(\s*)$/gm, '$1uniAI$2'],
    ],
  },
  {
    id: 'ai-badge-mark',
    why: 'Genspark sparkle artwork (GensparkMark) -> generic AI badge; function name kept for call sites',
    files: [
      'apps/docs/src/renderer/components/icons.tsx',
      'apps/slides/src/renderer/components/icons.tsx',
      'apps/sheets/src/renderer/ribbon-icons.tsx',
      'apps/{html,markdown,pdf}/src/renderer/ai/AiPanel.tsx',
    ],
    transform: genericAiBadge,
  },
  {
    id: 'ai-mark-css-class',
    why: 'Slides badge CSS hook genspark-mark -> ai-mark',
    files: ['apps/slides/src/renderer/components/icons.tsx', 'apps/slides/src/renderer/styles.css'],
    replace: [[/genspark-mark/g, 'ai-mark']],
  },
  {
    id: 'slides-media-model-note',
    why: 'Slides tool schema: the model override is a cloud-account feature',
    files: ['apps/slides/src/renderer/ai/slides-skill.ts'],
    replace: [[/Genspark only —/g, 'UniWork cloud only —']],
  },
  {
    id: 'credit-topup-url',
    why: 'Credits-exhausted messages in every locale point at the UniWork top-up page instead of genspark.ai',
    files: ['apps/*/src/**/i18n/**/*.ts', 'apps/*/src/**/i18n-*.ts', 'apps/*/src/**/strings*.ts'],
    skipComments: true,
    replace: [
      [/genspark\.ai\/pricing/g, 'uniwork.app/pricing'],
      [/(?<![A-Za-z0-9.\/])genspark\.ai(?![A-Za-z0-9\/-])/g, 'uniwork.app'],
    ],
  },
  {
    id: 'genspark-account',
    why: 'Vendor account wording in every locale / error / prompt string: "Genspark" -> "UniWork" (keeps trailing inflection, e.g. Czech "Gensparku")',
    files: SRC,
    skipComments: true,
    replace: [[/(?<![A-Za-z0-9_])Genspark(?![A-Z0-9_])/g, 'UniWork']],
  },
  {
    id: 'product-name',
    why: 'Plain product name "GenOffice" -> "UniWork Office": window/tab titles, About, default author, Documents folder, userData dir ("... Dev"), installer scripts',
    files: [...SRC, 'apps/*/package.json', 'apps/shell/build/*.sh'],
    skipComments: true,
    skipLines: [/webSearch\('GenOffice'/, /GenOffice\s+\[A-Za-z/],
    replace: [[PRODUCT_NAME, 'UniWork Office']],
  },
  {
    id: 'product-name-compound',
    why: 'Dutch compound "GenOffice-venster" (the hyphenated-compound guard in product-name keeps code names like GenOffice-Docs out, but this one is prose)',
    files: ['apps/shell/src/renderer/src/strings.ts'],
    replace: [[/GenOffice-venster/g, 'UniWork Office-venster']],
  },
  {
    id: 'vi-no-api-key',
    why: 'Main-process vi errNoApiKey keeps the UniWork wording (no active AI plan), matching the en entry; the upstream "no API key configured for {provider}" text comes back with every merge of these three dictionaries',
    files: [
      'apps/docs/src/main/docs-main.ts',
      'apps/sheets/src/main/sheets-main.ts',
      'apps/slides/src/main/i18n-main.ts',
    ],
    replace: [
      [
        /errNoApiKey: 'Chưa cấu hình khóa API cho \{provider\}'/g,
        "errNoApiKey: 'Chưa kích hoạt / mua gói AI. Hãy mua gói để dùng Trợ lý AI.'",
      ],
    ],
  },
  {
    id: 'ai-search-description',
    why: 'ai-search package description lists the search providers; "Genspark" -> "UniWork" like every other vendor mention',
    files: ['packages/ai-search/package.json'],
    replace: [[/\(Genspark, Serper/g, '(UniWork, Serper']],
  },
  {
    id: 'pptx-ops-prompt-preview',
    why: 'Slide op prompt tells the model what the app preview shows; the engine package is excluded from rewrites, this single prose line is not engine data',
    files: ['packages/pptx-ops/src/prompts/ops/text.md'],
    ignoreGlobalExclude: true,
    replace: [[/the GenOffice preview/g, 'the UniWork Office preview']],
  },
  {
    id: 'builder-config-names',
    why: 'electron-builder config: product name everywhere including its comments (packaging config is scanned in full)',
    files: ['apps/shell/electron-builder.cjs'],
    replace: [
      [/GenOffice (Docs|Sheets|Slides|PDF|Markdown|HTML)(?![A-Za-z0-9])/g, 'UniWork $1'],
      // file-name examples in comments (GenOffice-<v>.dmg) are renamed too
      [/(?<![A-Za-z0-9_@])GenOffice(?![A-Za-z0-9_])/g, 'UniWork Office'],
    ],
  },

  // ----------------------------------------------------------- packaging
  {
    id: 'app-ids',
    why: 'electron-builder appId: com.genoffice.app -> com.uniwork.office, com.genoffice.<module> -> com.uniwork.<module>',
    files: ['apps/*/package.json', 'apps/shell/electron-builder.cjs'],
    replace: [
      [/com\.genoffice\.app\b/g, 'com.uniwork.office'],
      [/com\.genoffice\.(docs|sheets|slides|pdf|markdown|html)\b/g, 'com.uniwork.$1'],
    ],
  },
  {
    id: 'docs-artifact-name',
    why: 'Docs installer artifact name (upstream AIDocx-*) -> UniWork-Docs-*',
    files: ['apps/docs/package.json'],
    replace: [[/"artifactName": "AIDocx-/g, '"artifactName": "UniWork-Docs-']],
  },
  {
    id: 'shell-builder-identity',
    why: 'Shell installer identity: artifactName (dmg/nsis/AppImage), linux executableName, deb/rpm package + artifact names, maintainer/vendor',
    files: ['apps/shell/electron-builder.cjs'],
    replace: [
      [/'Mainfunc, Inc\. <team@genspark\.ai>'/g, "'UniWork Office'"],
      [/executableName: 'genoffice'/g, "executableName: 'uniwork-office'"],
      [
        /artifactName: 'genoffice_\$\{version\}_\$\{arch\}\.deb'/g,
        "artifactName: 'UniWork-Office_${version}_${arch}.deb'",
      ],
      [
        /artifactName: 'genoffice-\$\{version\}\.\$\{arch\}\.rpm'/g,
        "artifactName: 'UniWork-Office-${version}.${arch}.rpm'",
      ],
      [/packageName: 'genoffice'/g, "packageName: 'uniwork-office'"],
      // top-level artifactName: added right after the top-level productName, only when absent
      [
        /^(  productName: 'UniWork Office',\n)(?!  artifactName:)/m,
        "$1  artifactName: 'UniWork-Office-${version}-${arch}.${ext}',\n",
      ],
    ],
  },
  {
    id: 'shell-desktop-name',
    why: 'Linux .desktop id (X11 app_id / StartupWMClass)',
    files: ['apps/shell/package.json'],
    replace: [[/"desktopName": "genoffice\.desktop"/g, '"desktopName": "uniwork-office.desktop"']],
  },
  {
    id: 'linux-default-app-desktop-id',
    why: "Settings > General 'Open .docx/.xlsx/.pptx in UniWork Office' writes this desktop id into mimeapps.list (xdg-mime default); it must be the .desktop file the package ships, i.e. desktopName in apps/shell/package.json (asserted by apps/shell/tests/default-app.test.ts)",
    files: ['apps/shell/src/main/default-app.ts'],
    skipComments: true,
    replace: [[/'genoffice\.desktop'/g, "'uniwork-office.desktop'"]],
  },
  {
    id: 'linux-ln-hint-quotes',
    why: 'The post-install hint `run: ln -s $launcher $link` is copied by users; the install dir is /opt/UniWork Office (a space), so both variables are quoted',
    files: ['apps/shell/build/linux-after-install.sh'],
    replace: [[/run: ln -s \$launcher \$link/g, 'run: ln -s \\"$launcher\\" \\"$link\\"']],
  },
  {
    id: 'cli-gui-binary-paths',
    why: "Matches upstream's real shape (`git show b08e2ebf:packages/cli/src/resources.ts`: `'/opt/GenOffice/genoffice', '/usr/bin/genoffice'` on one line; asserted by rebrand.test.mjs), whether or not product-name already ran. CLI looks for the renamed app executable (executableName uniwork-office) on linux. The deb/rpm post-install only links the launcher at /usr/bin/genoffice, so upstream's second candidate (/usr/bin/<app>) is dropped, not renamed",
    files: ['packages/cli/src/resources.ts'],
    replace: [
      [
        /'\/opt\/(?:GenOffice|UniWork Office)\/genoffice',\s*'\/usr\/bin\/genoffice'/g,
        "'/opt/UniWork Office/uniwork-office'",
      ],
      [/join\(install, 'genoffice'\)/g, "join(install, 'uniwork-office')"],
    ],
  },
  {
    id: 'cli-launchers',
    why: 'Shipped CLI launchers start the renamed app binary: MacOS/UniWork Office, UniWork Office.exe and the linux executableName uniwork-office (must match productName / executableName in apps/shell/electron-builder.cjs; asserted by packages/cli/tests/launcher-names.test.ts)',
    files: ['packages/cli/bin/genoffice', 'packages/cli/bin/genoffice.cmd'],
    replace: [
      [PRODUCT_NAME, 'UniWork Office'],
      [/(app="\$here\/\.\.\/\.\.\/)genoffice"/g, '$1uniwork-office"'],
    ],
  },
  {
    id: 'cli-readme-names',
    why: 'npm-published CLI README: product name in prose and paths, vendor account wording (the README is in the brand-scan scope)',
    files: ['packages/cli/README.md'],
    ignoreGlobalExclude: true,
    replace: [
      [PRODUCT_NAME, 'UniWork Office'],
      [/(?<![A-Za-z0-9_])Genspark(?![A-Z0-9_])/g, 'UniWork'],
    ],
  },
  {
    id: 'mcp-bridge-log',
    why: "MCP stdio bridge log lines show up in the MCP client's server log (comment lines are left alone)",
    files: ['scripts/mcp-stdio-bridge.js'],
    skipComments: true,
    replace: [[PRODUCT_NAME, 'UniWork Office']],
  },
  {
    id: 'origin-repo-urls',
    why: 'Homepage / repository / releases / issues / stars links point at the UniWork team repo UNIAI-TEAM/uniwork-office. The earlier fork truongnt7/uniwork-office is rewritten too (limited to the files the hand rebrand touched plus the PWA download links; other upstream URLs are tracked by the brand scan allowlist)',
    files: GITHUB_URL_FILES,
    // comments cite upstream issues (github.com/genspark-ai/genoffice/issues/15): those stay upstream's
    skipComments: true,
    skipLines: [/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\//],
    replace: [
      [
        /github\.com\/(?:genspark-ai\/genoffice|truongnt7\/uniwork-office)/g,
        'github.com/UNIAI-TEAM/uniwork-office',
      ],
      [
        /https:\/\/api\.github\.com\/repos\/(?:genspark-ai\/genoffice|truongnt7\/uniwork-office)/g,
        'https://api.github.com/repos/UNIAI-TEAM/uniwork-office',
      ],
    ],
  },
  {
    id: 'onboarding-copy',
    why: "First-run welcome copy (subtitle, slide 2, footnote; onbBody1 for en / vi) is UniWork product copy, not upstream's and not planning vocabulary: the values live in tools/rebrand/onboarding-copy.mjs and are re-applied in every locale after a sync",
    files: ['apps/shell/src/renderer/src/strings.ts'],
    transform: onboardingCopy,
  },
  {
    id: 'skills-install-source',
    why: 'Settings > Integrations shows `npx skills add <owner/repo>`; the skills CLI installs skills/genoffice from the team repo (public, ships the same skill), not from the upstream repo',
    files: ['apps/shell/src/renderer/src/IntegrationsPane.tsx'],
    replace: [
      [/npx skills add genspark-ai\/genoffice/g, 'npx skills add UNIAI-TEAM/uniwork-office'],
    ],
  },
  {
    id: 'skills-product-name',
    why: 'Skill and slide-guide text ships into users\' agent directories and the CLI guide command: the product word "GenOffice" becomes "UniWork Office" and the vendor account word "Genspark" becomes "UniWork"; the skill name, the `genoffice` command, genoffice:// URIs and GENOFFICE_* variables stay. Bump metadata.version in skills/genoffice/SKILL.md after a change (tools/check-skill-version.mjs)',
    files: ['skills/genoffice/SKILL.md', 'packages/pipelines/src/slides/guides/*.md'],
    ignoreGlobalExclude: true,
    replace: [
      [PRODUCT_NAME, 'UniWork Office'],
      [/(?<![A-Za-z0-9_])Genspark(?![A-Z0-9_])/g, 'UniWork'],
    ],
  },
  {
    id: 'onboarding-community-cta',
    why: 'GenTeam community link and the onboarding offer slide are disabled (no genoffice.ai link)',
    files: ['apps/shell/src/main/index.ts', 'apps/shell/src/renderer/src/Onboarding.tsx'],
    replace: [
      [/'https:\/\/genoffice\.ai\/join'/g, "'https://github.com/UNIAI-TEAM/uniwork-office'"],
      [/(titleKey: 'onbTitle2', subtitleKey: 'onbBody2', showOffer: )true/g, '$1false'],
    ],
  },

  // ------------------------------------------------------------ docs i18n
  {
    id: 'docs-i18n-fork-banner',
    why: 'docs/i18n/README.<lang>.md are upstream translations kept for attribution; each carries a UniWork fork banner pointing at the canonical README',
    files: ['docs/i18n/README.*.md'],
    ignoreGlobalExclude: true,
    transform: (text) => {
      if (text.includes('> **UniWork Office fork.**')) return text
      return `${FORK_BANNER}\n${text}`
    },
  },
]

export const FORK_BANNER = [
  '> **UniWork Office fork.** The canonical product README is [`README.md`](../../README.md). This file is the upstream GenOffice translation, kept for attribution. It is not a UniWork localized product guide.',
  '>',
  '> This repository is currently a desktop office runtime. UniWork platform integration is not part of GO-1.',
  '',
].join('\n')

/**
 * Files copied verbatim over their target (path under tools/rebrand/assets/
 * mirrors the repo path). Artwork only; no code.
 */
export const OVERLAY_NOTE =
  'Every file under tools/rebrand/assets/ is copied to the same repo-relative path.'
