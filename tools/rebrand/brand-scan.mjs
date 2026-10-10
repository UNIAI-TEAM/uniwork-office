#!/usr/bin/env node
// Brand scan: fails when user-visible UniWork surfaces still carry the
// upstream brand (GenOffice / Genspark / genspark.ai, case-insensitive).
//
//   node tools/rebrand/brand-scan.mjs            scan the repo, exit 1 on a violation
//   node tools/rebrand/brand-scan.mjs --list     also print every allowlisted hit with its reason
//   node tools/rebrand/brand-scan.mjs --json     machine-readable result
//   node tools/rebrand/brand-scan.mjs --root <d> scan another checkout
//
// Scanned surfaces (everything else, e.g. LICENSE, NOTICE, docs/, tests, is
// out of scope by construction; see README.md):
//   catalog    i18n catalogs / string tables (all locales): values only, keys are code;
//              internal planning vocabulary (GO-1, UNI-1002, "this phase", Work Graph) is a violation too
//   package    package.json metadata (productName, description, author, homepage,
//              repository, build.*; not the npm name or dependency maps)
//   installer  electron-builder config and installer scripts under */build/ (comments too)
//   source     string literals / markup in apps/*/src and packages/*/src (comment lines skipped)
//   installer  also packages/cli/bin/** (the shipped launchers) and packaging/** (flatpak, nix, docker)
//   shipped    skills/** copied into users' agent directories, and the npm-published packages/cli/README.md
//   source     also scripts/mcp-stdio-bridge.js (its log lines reach the MCP client)
//
// Also flagged in the catalog / source scopes: GitHub (the word, github.com) and analytics-service
// endpoints (google-analytics.com, GA4 credentials; also in installer scope), see REPO_LINKS / TELEMETRY.
//
// Exemptions live in brand-allowlist.json, one reason per entry. Code
// identifiers (@genoffice/*, GENOFFICE_* env vars, font aliases, ...) are
// masked via NON_BRAND_TOKENS from table.mjs, the same list the rebrand uses.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NON_BRAND_TOKENS } from './table.mjs'
import { matchesAny } from './rebrand.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The upstream brand, matched case-insensitively. */
export const BRAND = /genoffice|genspark|genteam|mainfunc/gi
/**
 * Internal planning vocabulary that must not reach text users read: tracker ids (GO-1, GO-A8,
 * UNI-1002), the name of an unreleased platform piece (Work Graph), phase talk ("this phase",
 * "Phase 1", "plan v2", "not part of this phase") and spec-speak ("office runtime", "platform
 * integration"). Each pattern is narrow on purpose: UNIAI, uniAI, Unicode, "GO-TO", the Family
 * "milestones" feature and bare "phase" (moon phase, "phase" in lesson content) are not hits.
 * The vi pattern covers the Vietnamese catalogs, the primary locale.
 */
const INTERNAL_COPY = [
  /\bGO-(?:\d+|[A-Z]\d*)\b/g,
  /\bUNI-\d{3,}\b/g,
  /\bWork Graph\b/g,
  /\b(?:this|current|next|later|future|upcoming)\s+(?:phase|milestone)\b/gi,
  /\bphase\s*\d+\b/gi,
  /\bplan\s+v\d/gi,
  /\b(?:office|productivity)\s+runtime\b/gi,
  /\bplatform integration\b/gi,
  /giai đoạn\s+(?:này|\d+)/gi,
]
/**
 * The lowercase `genoffice` CLI command is masked everywhere (it is a functional id), so a
 * sentence that announces it next to a local-path placeholder ("genoffice is available at {path}")
 * passed the scan although it shows the upstream name and a raw install path. In catalog values
 * the command may be named where it has to be typed, but not tied to a path placeholder unless
 * the product is named too (the Integrations rows).
 */
const CLI_COMMAND_WITH_PATH =
  /\bgenoffice\b[^'"`]*\{(?:path|dir|folder|location)\}|\{(?:path|dir|folder|location)\}[^'"`]*\bgenoffice\b/gi
/**
 * Repo and open-source calls to action are not product copy: the user-visible UI names no
 * GitHub, links no repository and asks for no star. Matches the word (any case) and the hosts;
 * camel-case identifiers (openGitHubRepo) are not hits. Applied to catalog values and
 * string-literal lines of apps/*\/src and packages/*\/src (comment lines skipped); allowlist only
 * licence / attribution text, third-party product names and functional URLs, each with a reason.
 */
const REPO_LINKS = [/\bgithub\b/gi, /github(?:usercontent)?\.com/gi]
/**
 * The product reports nothing to analytics services (PRIVACY.md): a Google Analytics /
 * Tag Manager endpoint, a GA4 measurement id or the old injected credentials in product code
 * or packaging config is a violation, whatever the surrounding copy says.
 */
const TELEMETRY = [
  /google-analytics\.com|googletagmanager\.com/gi,
  /\bmeasurement_id\b|GA4_(?:API_SECRET|MEASUREMENT_ID)|genofficeAnalytics/g,
]
/** Org / domain forms that are never code identifiers, even though they embed the lowercase brand. */
const BRAND_LOCATOR = /genoffice\.ai|genspark\.ai|genspark-ai\/|genoffice:\/\//gi

const TEXT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|html|md|json|css|sh|nsh|plist|yml|yaml)$/i

const PACKAGE_SKIP_KEYS = new Set([
  'name',
  'bin',
  'main',
  'module',
  'types',
  'exports',
  'files',
  'scripts',
  'workspaces',
  'overrides',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'engines',
])

const SKIP_ALWAYS = ['**/node_modules/**', 'package-lock.json', 'tools/rebrand/**']
const TEST_PATHS = [
  '**/tests/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  'e2e/**',
  '**/fixtures/**',
]
const CATALOG_PATHS = [
  'apps/*/src/**/i18n/**/*.ts',
  'apps/*/src/**/i18n-*.ts',
  'apps/*/src/**/strings*.ts',
  'packages/i18n/src/**/*.ts',
]

/** Which scan scope a repo-relative path belongs to (null = not scanned). */
export function scopeOf(file) {
  if (matchesAny(file, SKIP_ALWAYS)) return null
  if (/(^|\/)package\.json$/.test(file)) return 'package'
  if (matchesAny(file, TEST_PATHS)) return null
  if (matchesAny(file, ['apps/*/electron-builder.*', 'apps/*/build/**'])) {
    return TEXT_EXT.test(file) ? 'installer' : null
  }
  // launchers and package recipes ship with or beside the installers; any text file counts
  // (extension-less launchers included), binaries are skipped by the NUL check in scan()
  if (matchesAny(file, ['packages/cli/bin/**', 'packaging/**'])) return 'installer'
  if (matchesAny(file, ['skills/**/*.md', 'packages/cli/README.md'])) return 'shipped'
  if (file === 'scripts/mcp-stdio-bridge.js') return 'source'
  if (matchesAny(file, CATALOG_PATHS)) return 'catalog'
  if (matchesAny(file, ['apps/*/src/**', 'packages/*/src/**'])) {
    return TEXT_EXT.test(file) && !matchesAny(file, ['**/fonts/**']) ? 'source' : null
  }
  return null
}

/** Strips the identifier part of a catalog line so only the translated value is scanned. */
function catalogValue(line) {
  return line.replace(/^\s*(?:['"][^'"]+['"]|[A-Za-z0-9_$.-]+)\s*:\s*/, '')
}

const IDENTIFIER_WITH_BRAND = /[A-Za-z0-9_]*(?:genoffice|genspark|genteam)[A-Za-z0-9_]*/gi

/**
 * A token that merely contains the brand is a code identifier when something
 * identifier-like touches it (genofficeAuthPath, GenSparkAccountStatus,
 * openGenTeam, __genofficeDebug, GENTEAM_URL). A brand word followed by plain
 * lowercase letters is an inflection (Czech "Gensparku") and stays a hit.
 */
function isIdentifier(token) {
  const at = token.search(/genoffice|genspark|genteam/i)
  const word = token.match(/genoffice|genspark|genteam/i)[0]
  const prefix = token.slice(0, at)
  const suffix = token.slice(at + word.length)
  return prefix.length > 0 || /^[A-Z0-9_]/.test(suffix)
}

function mask(text) {
  let out = text
  for (const re of NON_BRAND_TOKENS) out = out.replace(re, (m) => ' '.repeat(m.length))
  return out.replace(IDENTIFIER_WITH_BRAND, (m) => (isIdentifier(m) ? ' '.repeat(m.length) : m))
}

/**
 * Lowercase brand forms that are code identifiers elsewhere but are
 * installer-visible in packaging metadata: reverse-DNS app ids, executable /
 * package / desktop / artifact names. Checked on the raw line in the package
 * and installer scopes only.
 */
const PACKAGING_IDENTITY =
  /com\.(?:genoffice|genspark)\b|(?:executableName|packageName|desktopName|artifactName|appId|productName)\W+[^,\n]*?(?:genoffice|genspark)/gi

/**
 * The upstream .desktop id is a packaging identity even when it sits in source: apps/shell
 * `default-app.ts` hands it to `xdg-mime default`, so a stale id silently breaks the Linux
 * "set as default app" feature (review-r2 R2-1). Lowercase `genoffice` is otherwise masked as
 * the CLI command, hence the explicit check.
 */
const DESKTOP_ID = /\bgenoffice\.desktop\b/gi

/** All brand matches in one line of text: org/domain forms first, then masked brand words. */
export function brandMatches(text, scope = 'source') {
  const hits = []
  for (const m of text.matchAll(BRAND_LOCATOR)) hits.push(m[0])
  if (scope === 'package' || scope === 'installer') {
    for (const m of text.matchAll(PACKAGING_IDENTITY)) hits.push(m[0])
  }
  if (scope === 'source') for (const m of text.matchAll(DESKTOP_ID)) hits.push(m[0])
  if (scope === 'catalog' || scope === 'source') {
    for (const re of REPO_LINKS) for (const m of text.matchAll(re)) hits.push(m[0])
  }
  if (scope === 'source' || scope === 'installer') {
    for (const re of TELEMETRY) for (const m of text.matchAll(re)) hits.push(m[0])
  }
  // the Integrations rows name the product first ("UniWork Office (genoffice) ... ({path})"): there the path is the answer
  if (scope === 'catalog' && !text.includes('UniWork Office')) {
    for (const m of text.matchAll(CLI_COMMAND_WITH_PATH)) hits.push(m[0])
  }
  if (scope === 'catalog' || scope === 'source') {
    for (const re of INTERNAL_COPY) for (const m of text.matchAll(re)) hits.push(m[0])
  }
  const masked = mask(text).replace(BRAND_LOCATOR, (m) => ' '.repeat(m.length))
  for (const m of masked.matchAll(BRAND)) hits.push(m[0])
  return hits
}

function* packageStrings(node, key = '') {
  if (typeof node === 'string') yield node
  else if (Array.isArray(node)) for (const v of node) yield* packageStrings(v, key)
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (PACKAGE_SKIP_KEYS.has(k)) continue
      yield* packageStrings(v, k)
    }
  }
}

/**
 * Blanks whole-line comments (// and block comments that start a line, JSX
 * {/* *\/}, HTML comments) so only code and markup remain. Only line-leading
 * comment starts count: a glob such as 'apps/*\/src' inside a string must not
 * open a block comment.
 */
function stripComments(lines, file) {
  const html = /\.html$/.test(file)
  if (!html && !/\.(?:ts|tsx|mts|cts|js|mjs|cjs|css)$/.test(file)) return lines
  let close = null // terminator of the block comment we are inside, if any
  return lines.map((line) => {
    let rest = line
    if (close === null) {
      if (!html && /^\s*\/\//.test(line)) return ''
      const m = /^\s*(?:(<!--)|\{?(\/\*))/.exec(line)
      if (!m || (m[1] && !html)) return line
      close = m[1] ? '-->' : '*/'
      rest = line.slice(m[0].length)
    }
    const at = rest.indexOf(close)
    if (at < 0) return ''
    const tail = rest.slice(at + close.length)
    close = null
    return tail
  })
}

/** Candidate [lineNumber, text] pairs of one file for its scope. */
export function candidates(scope, text, file = '') {
  const lines = text.split(/\r?\n/)
  if (scope === 'package') {
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return lines.map((l, i) => [i + 1, l])
    }
    const out = []
    for (const s of packageStrings(json)) {
      const at = lines.findIndex((l) => l.includes(JSON.stringify(s).slice(1, -1)))
      out.push([at < 0 ? 1 : at + 1, s])
    }
    return out
  }
  const out = []
  const code = scope === 'installer' || scope === 'shipped' ? lines : stripComments(lines, file)
  code.forEach((line, i) => {
    if (!line.trim()) return
    out.push([i + 1, scope === 'catalog' ? catalogValue(line) : line])
  })
  return out
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString('utf8').split('\0').filter(Boolean)
  } catch {
    const acc = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else acc.push(relative(root, p).split(sep).join('/'))
      }
    }
    walk(root)
    return acc
  }
}

/** Validates allowlist entries (reason required) and compiles their patterns. */
export function compileAllowlist(entries) {
  for (const e of entries) {
    if (!e.path || !e.reason || !['permanent', 'debt'].includes(e.kind)) {
      throw new Error(
        `brand-allowlist entry needs path, a reason and kind permanent|debt: ${JSON.stringify(e)}`,
      )
    }
  }
  return entries.map((e) => ({ ...e, re: e.pattern ? new RegExp(e.pattern) : null, used: 0 }))
}

export function loadAllowlist(file = join(HERE, 'brand-allowlist.json')) {
  return compileAllowlist(JSON.parse(readFileSync(file, 'utf8')).entries ?? [])
}

function allowedBy(allow, file, line, scope) {
  return allow.find(
    (e) =>
      matchesAny(file, [e.path]) && (!e.scope || e.scope === scope) && (!e.re || e.re.test(line)),
  )
}

/**
 * Scans `files` (or every tracked file under root). `read(file)` may be
 * injected by tests. Returns { violations, allowed, unused (debt), unusedPermanent }.
 */
export function scan({ root, files, allow, read } = {}) {
  const allowlist = allow ?? loadAllowlist()
  const readFile = read ?? ((f) => readFileSync(join(root, f), 'utf8'))
  const violations = []
  const allowed = []
  for (const file of files ?? listFiles(root)) {
    const scope = scopeOf(file)
    if (!scope) continue
    let text
    try {
      text = readFile(file)
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    for (const [line, candidate] of candidates(scope, text, file)) {
      const hits = brandMatches(candidate, scope)
      if (hits.length === 0) continue
      const rawLine = text.split(/\r?\n/)[line - 1] ?? candidate
      const entry = allowedBy(allowlist, file, rawLine, scope)
      const record = { file, line, scope, match: hits[0], text: rawLine.trim().slice(0, 200) }
      if (entry) {
        entry.used++
        allowed.push({ ...record, reason: entry.reason, kind: entry.kind })
      } else violations.push(record)
    }
  }
  // debt entries must go once fixed; a permanent entry that matches nothing is a stale exemption
  // that could hide a future hit, so it is reported as well (as a warning)
  const unused = allowlist.filter((e) => e.kind === 'debt' && e.used === 0)
  const unusedPermanent = allowlist.filter((e) => e.kind === 'permanent' && e.used === 0)
  return { violations, allowed, unused, unusedPermanent }
}

function main(argv) {
  const rootArg = argv.indexOf('--root')
  const root = resolve(
    rootArg >= 0
      ? argv[rootArg + 1]
      : execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim(),
  )
  const { violations, allowed, unused, unusedPermanent } = scan({ root })
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          violations,
          allowed,
          unused: unused.map((e) => e.path),
          unusedPermanent: unusedPermanent.map((e) => e.path),
        },
        null,
        2,
      ),
    )
  } else {
    if (argv.includes('--list')) {
      for (const a of allowed) {
        console.log(`allowed [${a.kind}] ${a.file}:${a.line} (${a.match}) - ${a.reason}`)
      }
    }
    for (const v of violations)
      console.log(`${v.file}:${v.line} [${v.scope}] ${v.match} :: ${v.text}`)
    const debt = allowed.filter((a) => a.kind === 'debt').length
    console.log(
      `brand-scan: ${violations.length} violation(s), ${allowed.length} allowlisted hit(s) (${debt} known debt)`,
    )
    for (const e of unused) {
      console.log(
        `warning: debt entry no longer matches anything, remove it: ${e.path} ${e.pattern ?? ''}`,
      )
    }
    for (const e of unusedPermanent) {
      console.log(
        `warning: permanent entry matches nothing, check it is still needed: ${e.path} ${e.pattern ?? ''}`,
      )
    }
    if (violations.length > 0) {
      console.error(
        'brand-scan failed: rebrand the string (node tools/rebrand/rebrand.mjs) or, for a real exception, add a reasoned entry to tools/rebrand/brand-allowlist.json.',
      )
    }
  }
  if (violations.length > 0) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
