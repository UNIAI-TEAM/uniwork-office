// Egress gate: shipped code must not name a Genspark / GenOffice cloud host,
// a Google Analytics / ads endpoint or the @genspark/cli package. Comments count
// too (cheap and simple); the few reasoned exemptions live in ALLOWLIST below.
// Host patterns also match the escaped forms used in regex literals and RegExp
// strings (`genspark\.ai`, `genspark\\.ai`). A host split across strings or
// built at runtime ('genspark' + '.ai', ['genspark', 'ai'].join('.'),
// percent-encoding) is out of reach of a text scan; review catches those.
// Scope is what ships: app sources, scripts, native sidecars and build
// resources, package sources, package manifests, app build configs, the
// uniai-pwa web app, scripts/ and skills/. Tests and packaging/ are out of
// scope. Usage: node tools/check-egress.mjs [--root <dir>] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** a literal dot, optionally escaped once (regex literal) or twice (RegExp string) */
const DOT = String.raw`\\{0,2}\.`
const host = (...labels) => new RegExp(labels.join(DOT), 'i')

export const PATTERNS = [
  { id: 'genspark.ai', re: host('genspark', 'ai') },
  { id: 'genspark.com', re: host('genspark', 'com') },
  { id: 'gensparkcdn', re: /gensparkcdn/i },
  { id: 'genoffice.ai', re: host('genoffice', 'ai') },
  { id: 'mainfunc.ai', re: host('mainfunc', 'ai') },
  { id: 'google-analytics.com', re: host('google-analytics', 'com') },
  { id: 'analytics.google.com', re: host('analytics', 'google', 'com') },
  { id: 'googletagmanager.com', re: host('googletagmanager', 'com') },
  { id: 'doubleclick.net', re: host('doubleclick', 'net') },
  { id: 'gtag(', re: /\bgtag\s*\(/ },
  { id: '@genspark/cli', re: /@genspark\/cli/i },
]

/**
 * Reasoned exemptions: { path (repo-relative, forward slashes), pattern id, reason }.
 * Keep it short; every entry needs a reason a reviewer can check.
 */
export const ALLOWLIST = []

const SCOPE = [
  /^apps\/[^/]+\/(src|scripts|native|build)\//,
  /^apps\/uniai-pwa\//,
  /^apps\/[^/]+\/(electron-builder\.cjs|[\w.-]*\.config\.ts)$/,
  /^packages\/[^/]+\/src\//,
  /^apps\/[^/]+\/package\.json$/,
  /^packages\/[^/]+\/package\.json$/,
  /^scripts\//,
  /^skills\//,
]

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'target', '.git'])

const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff?|woff2?|ttf|otf|eot|wasm|node|exe|dll|so|dylib|zip|gz|pdf|docx|xlsx|pptx|mp[34]|wav|ogg)$/i

/** true when a repo-relative path is shipped code this gate covers */
export function inScope(path) {
  const p = path.split(sep).join('/')
  if (TEST_PATH.test(p)) return false
  if (p.split('/').some((part) => SKIP_DIRS.has(part))) return false
  return SCOPE.some((re) => re.test(p))
}

/** every pattern hit in one file's text, as { line, pattern, text } */
export function scanText(text) {
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const { id, re } of PATTERNS) {
      if (re.test(lines[i])) hits.push({ line: i + 1, pattern: id, text: lines[i].trim() })
    }
  }
  return hits
}

function allowed(path, pattern, allowlist) {
  return allowlist.some((a) => a.path === path && a.pattern === pattern)
}

function* walk(root, dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(root, join(dir, entry.name))
    } else if (entry.isFile()) {
      yield relative(root, join(dir, entry.name)).split(sep).join('/')
    }
  }
}

/** scans the tree under `root`; returns the violations not covered by the allowlist */
export function scanTree(root, { allowlist = ALLOWLIST } = {}) {
  const violations = []
  for (const top of ['apps', 'packages', 'scripts', 'skills']) {
    const dir = join(root, top)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    for (const path of walk(root, dir)) {
      if (!inScope(path) || BINARY_EXT.test(path)) continue
      const text = readFileSync(join(root, path), 'utf8')
      for (const hit of scanText(text)) {
        if (!allowed(path, hit.pattern, allowlist)) violations.push({ path, ...hit })
      }
    }
  }
  return violations
}

function main(argv) {
  let root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = resolve(argv[++i] ?? '')
    else if (argv[i] === '--json') json = true
    else {
      console.error(`Unexpected argument: ${argv[i]}`)
      return 2
    }
  }
  const violations = scanTree(root)
  if (json) {
    console.log(JSON.stringify(violations, null, 2))
  } else if (violations.length) {
    console.error('Egress check failed: shipped code names a blocked host or package.')
    for (const v of violations) console.error(`  ${v.path}:${v.line} [${v.pattern}] ${v.text}`)
    console.error(`${violations.length} hit(s). Remove them or add a reasoned ALLOWLIST entry.`)
  } else {
    console.log('Egress check passed.')
  }
  return violations.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
