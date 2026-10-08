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
  'PUA|Grid|Sans|Serif|Gothic|Che|Poppins|Tamil|Fullwidth|Songti|Hiragino|MS|Batang|Myungjo|Heiti|MingLiU|Ethiopic|Box|UI'
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
    why: 'Ribbon / group labels "Genspark AI" -> "AI"',
    files: SRC,
    skipComments: true,
    replace: [[/(?<![A-Za-z0-9_])Genspark AI(?![A-Za-z])/g, 'AI']],
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
    id: 'cli-gui-binary-paths',
    why: 'CLI looks for the renamed app executable (executableName uniwork-office) on linux',
    files: ['packages/cli/src/resources.ts'],
    replace: [
      [
        /\['\/opt\/UniWork Office\/genoffice', '\/usr\/bin\/genoffice'\]/g,
        "['/opt/UniWork Office/uniwork-office', '/usr/bin/uniwork-office']",
      ],
    ],
  },
  {
    id: 'origin-repo-urls',
    why: 'Homepage / repository / releases / issues / stars links point at the UniWork origin repo (limited to the files the hand rebrand touched; other upstream URLs are tracked by the brand scan allowlist)',
    files: GITHUB_URL_FILES,
    replace: [
      [/github\.com\/genspark-ai\/genoffice/g, 'github.com/truongnt7/uniwork-office'],
      [
        /https:\/\/api\.github\.com\/repos\/genspark-ai\/genoffice/g,
        'https://api.github.com/repos/truongnt7/uniwork-office',
      ],
    ],
  },
  {
    id: 'onboarding-community-cta',
    why: 'GenTeam community link and the onboarding offer slide are disabled (no genoffice.ai link)',
    files: ['apps/shell/src/main/index.ts', 'apps/shell/src/renderer/src/Onboarding.tsx'],
    replace: [
      [/'https:\/\/genoffice\.ai\/join'/g, "'https://github.com/truongnt7/uniwork-office'"],
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
