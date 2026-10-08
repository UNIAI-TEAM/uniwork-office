#!/usr/bin/env node
// Upstream sync: brings genoffice changes into the UniWork fork as one patch,
// re-applies the brand and records the new upstream base, on a branch of its own.
//
//   node tools/rebrand/sync-upstream.mjs                   sync to the upstream default branch head
//   node tools/rebrand/sync-upstream.mjs --dry-run         do it all in a throwaway worktree, report only
//   node tools/rebrand/sync-upstream.mjs --continue        after resolving conflicts by hand: commit, rebrand, bump, check
//
// Options:
//   --to <sha|ref>        upstream commit (full 40-hex SHA) or ref name to sync to
//                         (default: the remote's HEAD after fetch; abbreviated SHAs are refused)
//   --base <sha>          override the absorbed base (default: tools/rebrand/UPSTREAM_BASE)
//   --remote <url|name>   upstream remote (default https://github.com/genspark-ai/genoffice.git)
//   --root <dir>          repo to operate on (default: the current checkout)
//   --branch <name>       sync branch (default upstream-sync/<target7>)
//   --report <file.md>    write the markdown report there, plus a .json sibling
//   --pr-body <file.md>   write the report cut below 60000 characters (a pull request body limit)
//   --exclude <glob>      leave matching upstream paths out of the patch (repeatable; listed in the report)
//   --prettier <path>     prettier.cjs used to format the files the rebrand touched
//                         (default: node_modules/prettier of the repo or its main checkout; skipped if absent)
//   --commit-conflicts    commit conflicted files with their markers and finish the remaining steps
//   --ci                  CI mode: --commit-conflicts, and a missing Prettier fails the run
//   --force               allow a target that does not descend from the base
//   --no-fetch            use refs already present locally (refs/upstream-sync/target by default)
//   --skip-checks         skip rebrand, formatting, brand scan, egress check and rebrand tests (toy repos)
//   --json                print the summary as JSON on stdout (logs always go to stderr)
//
// Exit codes:
//   0  up to date, already prepared, or synced cleanly with every check green
//   1  usage or runtime error (bad arguments, dirty tree, fetch failure, a target that does
//      not descend from the base, an unfinished sync branch, ...); a real run rolls back its branch
//   2  needs a human: conflicts, patches that could not be applied, a failing check (rebrand,
//      formatting, brand scan, egress check, rebrand tests); the report says which
//
// The checks never execute code from the patched tree: before applying, the script copies
// tools/ and the Prettier config of the checkout it runs from to a temp dir and runs the
// rebrand, brand scan, egress check (when package.json defines check:egress) and the
// rebrand tests from that copy with --root.
//
// Commits made in real mode (on the new branch, in this order, each only if it changes something):
//   chore(upstream): apply genoffice <base7>..<target7>
//   chore(rebrand): re-apply UniWork brand after upstream sync
//   chore(rebrand): bump UPSTREAM_BASE to <target7>
// See README.md ("Sync with upstream") for the human side of the flow.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_REMOTE = 'https://github.com/genspark-ai/genoffice.git'
export const BASE_FILE = 'tools/rebrand/UPSTREAM_BASE'
export const FETCH_REF_PREFIX = 'refs/upstream-sync'
const LIST_CAP = 200
export const PR_BODY_LIMIT = 60000
const HERE = dirname(fileURLToPath(import.meta.url))
/** Test files of the rebrand tooling, run from the trusted copy (never read from the patched tree). */
export const REBRAND_TESTS = ['brand-scan.test.mjs', 'rebrand.test.mjs', 'sync-upstream.test.mjs']

/**
 * Upstream paths that bring back things the fork removed or must adjust by hand
 * (see README "Known gaps"); hits are listed in the report's checklist.
 */
export const WATCH = [
  {
    test: (p) => /(^|\/)analytics[^/]*\.(ts|tsx|js|mjs)$/i.test(p),
    note: 'analytics tracker code: the fork deleted it; remove it again',
  },
  {
    test: (p) => /star-?prompt|github-?star/i.test(p),
    note: 'star prompt code: the fork removed it; remove it again',
  },
  {
    test: (p) => /^apps\/shell\/src\/renderer\/.*(onboarding|welcome)/i.test(p),
    note: 'first-run UI: check the offer panel / consent steps did not come back',
  },
  {
    test: (p) => /^skills\/[^/]+\/SKILL\.md$/.test(p),
    note: 'skill text changed: bump its metadata.version (check:skill-version)',
  },
  {
    test: (p) => p.startsWith('packaging/'),
    note: 'packaging recipe: still upstream-branded debt, review by hand',
  },
  {
    test: (p) => p.startsWith('.github/'),
    note: 'upstream CI / repo config: compare with ours before taking it',
  },
]

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const opts = {
    to: undefined,
    base: undefined,
    remote: DEFAULT_REMOTE,
    root: undefined,
    branch: undefined,
    report: undefined,
    prBody: undefined,
    exclude: [],
    prettier: undefined,
    dryRun: false,
    fetch: true,
    commitConflicts: false,
    ci: false,
    force: false,
    skipChecks: false,
    json: false,
    continue: false,
    help: false,
  }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--to':
        opts.to = value(i++, a)
        break
      case '--base':
        opts.base = value(i++, a)
        break
      case '--remote':
        opts.remote = value(i++, a)
        break
      case '--root':
        opts.root = value(i++, a)
        break
      case '--branch':
        opts.branch = value(i++, a)
        break
      case '--report':
        opts.report = value(i++, a)
        break
      case '--pr-body':
        opts.prBody = value(i++, a)
        break
      case '--exclude':
        opts.exclude.push(value(i++, a))
        break
      case '--prettier':
        opts.prettier = value(i++, a)
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--no-fetch':
        opts.fetch = false
        break
      case '--commit-conflicts':
        opts.commitConflicts = true
        break
      case '--ci':
        opts.ci = true
        opts.commitConflicts = true
        break
      case '--force':
        opts.force = true
        break
      case '--skip-checks':
        opts.skipChecks = true
        break
      case '--json':
        opts.json = true
        break
      case '--continue':
        opts.continue = true
        break
      case '-h':
      case '--help':
        opts.help = true
        break
      default:
        throw new UsageError(`unknown argument: ${a}`)
    }
  }
  if (opts.continue && opts.dryRun)
    throw new UsageError('--continue cannot be combined with --dry-run')
  if (opts.to !== undefined && SHORT_SHA.test(opts.to)) {
    throw new UsageError(
      `--to ${opts.to}: pass a full 40-hex SHA or a ref name, not an abbreviated SHA`,
    )
  }
  return opts
}

export class UsageError extends Error {}

// ---------------------------------------------------------------- git helpers

/**
 * Returns git(args, { input, allowFailure }) bound to `cwd`. stdout comes back as a
 * Buffer-backed object so binary patches survive untouched; `.text` is the trimmed string.
 */
export function createGit(cwd, { env = process.env } = {}) {
  return function git(args, { input, allowFailure = false } = {}) {
    const res = spawnSync('git', ['-C', cwd, ...args], {
      input,
      env,
      maxBuffer: 1 << 30,
      windowsHide: true,
    })
    if (res.error) throw res.error
    const out = {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr.toString('utf8'),
      get text() {
        return res.stdout.toString('utf8').trim()
      },
    }
    if (res.status !== 0 && !allowFailure) {
      throw new Error(`git ${args.join(' ')} failed (${res.status}): ${out.stderr.trim()}`)
    }
    return out
  }
}

const short = (sha) => sha.slice(0, 7)
const FULL_SHA = /^[0-9a-f]{40}$/i
const SHORT_SHA = /^[0-9a-f]{4,39}$/i

function revParse(git, rev) {
  const r = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFailure: true })
  return r.status === 0 ? r.text : null
}

/** Tracked or untracked changes in the working tree (ignored files do not count). */
export function isDirty(git) {
  return git(['status', '--porcelain', '--untracked-files=normal']).text !== ''
}

export function readBase(root) {
  const file = join(root, BASE_FILE)
  if (!existsSync(file)) throw new Error(`${BASE_FILE} is missing; this is not a rebranded tree`)
  const sha = readFileSync(file, 'utf8').trim()
  if (!FULL_SHA.test(sha)) throw new Error(`${BASE_FILE} does not hold a full SHA`)
  return sha
}

/** Fetches target (and the base, if absent) into refs/upstream-sync/* and resolves both. */
export function resolveRange(git, { to, base, remote, fetch }) {
  const targetRef = `${FETCH_REF_PREFIX}/target`
  const baseRef = `${FETCH_REF_PREFIX}/base`
  if (to !== undefined && SHORT_SHA.test(to)) {
    throw new UsageError(`--to ${to}: pass a full 40-hex SHA or a ref name, not an abbreviated SHA`)
  }
  const localTarget = !fetch
  const localBase = revParse(git, base)
  const specs = []
  if (!localTarget) specs.push(`+${to ?? 'HEAD'}:${targetRef}`)
  if (!localBase) {
    if (!fetch) throw new Error(`upstream base ${base} is not available locally (drop --no-fetch)`)
    specs.push(`+${base}:${baseRef}`)
  }
  if (specs.length > 0) git(['fetch', '--no-tags', '--quiet', remote, ...specs])
  const target = revParse(git, localTarget ? (to ?? targetRef) : targetRef)
  if (!target) throw new Error(`cannot resolve upstream target ${to ?? targetRef}`)
  const baseSha = localBase ?? revParse(git, base)
  if (!baseSha) throw new Error(`cannot resolve upstream base ${base}`)
  // keep both commits reachable (and visible) under the private fetch namespace
  git(['update-ref', '--stdin'], {
    input: Buffer.from(`update ${baseRef} ${baseSha}\nupdate ${targetRef} ${target}\n`),
  })
  return { base: baseSha, target }
}

function pathspec(excludes) {
  return ['--', '.', ...excludes.map((g) => `:(exclude,glob)${g}`)]
}

const DIFF_FLAGS = [
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.quotepath=false',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
]

function splitZ(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean)
}

/** Commits behind, upstream commit list, and the per-file shape of base..target. */
export function rangeStats(git, base, target, { exclude = [] } = {}) {
  const behind = Number(git(['rev-list', '--count', `${base}..${target}`]).text)
  const ancestor =
    git(['merge-base', '--is-ancestor', base, target], { allowFailure: true }).status === 0
  const log = git([
    'log',
    '--no-color',
    '--format=%H %s',
    `-${LIST_CAP}`,
    `${base}..${target}`,
  ]).text
  const commits = log ? log.split('\n').map((l) => `${short(l)}${l.slice(40)}`) : []
  const ns = splitZ(
    git([...DIFF_FLAGS, '--name-status', '-z', base, target, ...pathspec(exclude)]).stdout,
  )
  const files = []
  for (let i = 0; i < ns.length; i += 2) files.push({ status: ns[i], path: ns[i + 1] })
  const num = splitZ(
    git([...DIFF_FLAGS, '--numstat', '-z', base, target, ...pathspec(exclude)]).stdout,
  )
  let insertions = 0
  let deletions = 0
  const binary = []
  for (const row of num) {
    const [add, del, path] = row.split('\t')
    if (add === '-') binary.push(path)
    else {
      insertions += Number(add)
      deletions += Number(del)
    }
  }
  let excluded = []
  if (exclude.length > 0) {
    const all = splitZ(git([...DIFF_FLAGS, '--name-only', '-z', base, target]).stdout)
    const kept = new Set(files.map((f) => f.path))
    excluded = all.filter((p) => !kept.has(p))
  }
  return { behind, ancestor, commits, files, insertions, deletions, binary, excluded }
}

function unmergedPaths(git) {
  const out = splitZ(git(['ls-files', '-u', '-z']).stdout)
  return [...new Set(out.map((l) => l.slice(l.indexOf('\t') + 1)))].sort()
}

function hasStagedChanges(git) {
  return git(['diff', '--cached', '--quiet'], { allowFailure: true }).status !== 0
}

/**
 * Applies base..target to the index and working tree with 3-way fallback.
 * Tries the whole patch first; if git rejects it atomically (a hunk without a
 * usable preimage), applies file by file so one bad file does not block the rest.
 * Returns { clean, conflicted, failed: [{path, error}], mode }.
 */
export function applyUpstreamPatch(git, base, target, files, { exclude = [] } = {}) {
  const patch = git([
    ...DIFF_FLAGS,
    '--binary',
    '--full-index',
    base,
    target,
    ...pathspec(exclude),
  ]).stdout
  const paths = files.map((f) => f.path)
  if (patch.length === 0) return { clean: [], conflicted: [], failed: [], mode: 'empty' }
  const whole = git(
    ['-c', 'core.autocrlf=false', 'apply', '-3', '--index', '--whitespace=nowarn', '-'],
    {
      input: patch,
      allowFailure: true,
    },
  )
  let mode = 'whole'
  const failed = []
  if (whole.status !== 0 && unmergedPaths(git).length === 0 && !hasStagedChanges(git)) {
    mode = 'per-file'
    for (const path of paths) {
      const one = git([
        ...DIFF_FLAGS,
        '--binary',
        '--full-index',
        base,
        target,
        '--',
        `:(literal)${path}`,
      ]).stdout
      const r = git(
        ['-c', 'core.autocrlf=false', 'apply', '-3', '--index', '--whitespace=nowarn', '-'],
        {
          input: one,
          allowFailure: true,
        },
      )
      if (r.status !== 0 && !unmergedPaths(git).includes(path)) {
        failed.push({ path, error: firstError(r.stderr) })
      }
    }
  } else if (whole.status !== 0 && unmergedPaths(git).length === 0) {
    // applied, but git still complained (should not happen with -3); surface it
    failed.push({ path: '(patch)', error: firstError(whole.stderr) })
  }
  const conflicted = unmergedPaths(git)
  const bad = new Set([...conflicted, ...failed.map((f) => f.path)])
  return { clean: paths.filter((p) => !bad.has(p)), conflicted, failed, mode }
}

function firstError(stderr) {
  const line = stderr.split('\n').find((l) => l.startsWith('error:')) ?? stderr.split('\n')[0]
  return (line ?? '').trim().slice(0, 300)
}

function commit(git, message) {
  git(['commit', '--quiet', '-F', '-'], { input: Buffer.from(message, 'utf8') })
  return git(['rev-parse', 'HEAD']).text
}

/**
 * Parses `git status --porcelain -z`: "XY path", where a rename or copy entry ("R" / "C"
 * in either column) is followed by a second NUL-terminated field holding the source path.
 * Returns every path involved (both sides of a rename), sorted.
 */
export function parsePorcelainZ(buf) {
  const fields = splitZ(buf)
  const paths = []
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    const xy = entry.slice(0, 2)
    paths.push(entry.slice(3))
    if (/[RC]/.test(xy) && i + 1 < fields.length) paths.push(fields[++i])
  }
  return [...new Set(paths)].sort()
}

/** Files changed in the working tree (modified, added, deleted, renamed) relative to HEAD. */
function worktreeChanges(git) {
  return parsePorcelainZ(git(['status', '--porcelain', '-z', '--untracked-files=all']).stdout)
}

// ---------------------------------------------------------------- default checks

function runNode(args, cwd) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, args, { cwd, env, maxBuffer: 1 << 28, windowsHide: true })
  if (r.error) throw r.error
  return { status: r.status, stdout: r.stdout.toString('utf8'), stderr: r.stderr.toString('utf8') }
}

function findPrettier(git, root, explicit) {
  if (explicit) return existsSync(explicit) ? resolve(explicit) : null
  const rel = join('node_modules', 'prettier', 'bin', 'prettier.cjs')
  const candidates = [join(root, rel)]
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    allowFailure: true,
  })
  if (common.status === 0) candidates.push(join(dirname(common.text), rel))
  return candidates.find((c) => existsSync(c)) ?? null
}

/**
 * Copies the tooling the checks run (tools/, the Prettier config and ignore file) from
 * `sourceRepo` (default: the checkout this script runs from, i.e. the pre-sync tree) to a
 * temp dir, so nothing the upstream patch brings in is ever executed. `egress` is true when
 * the source package.json defines check:egress and tools/check-egress.mjs exists.
 */
export function trustedSnapshot({ sourceRepo = dirname(dirname(HERE)) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uniwork-sync-tools-'))
  cpSync(join(sourceRepo, 'tools'), join(dir, 'tools'), { recursive: true })
  const copy = (name) => {
    if (!existsSync(join(sourceRepo, name))) return null
    cpSync(join(sourceRepo, name), join(dir, name))
    return join(dir, name)
  }
  const prettierConfig = copy('.prettierrc.json') ?? copy('.prettierrc')
  const prettierIgnore = copy('.prettierignore') ?? join(dir, '.prettierignore-empty')
  if (!existsSync(prettierIgnore)) writeFileSync(prettierIgnore, '')
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(sourceRepo, 'package.json'), 'utf8')).scripts ?? {}
  } catch {}
  const egress =
    Boolean(scripts['check:egress']) && existsSync(join(dir, 'tools', 'check-egress.mjs'))
  return {
    dir,
    tools: join(dir, 'tools'),
    prettierConfig,
    prettierIgnore,
    egress,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * The real rebrand / format / scan / egress / test steps, run from a trustedSnapshot().
 * Tests replace them through `checks`. `strictFormat` (--ci) turns a missing Prettier into a failure.
 */
export function defaultChecks({ trusted, prettier, strictFormat = false, repoGit } = {}) {
  const rebrandDir = join(trusted.tools, 'rebrand')
  return {
    rebrand(root) {
      const script = join(rebrandDir, 'rebrand.mjs')
      if (!existsSync(script)) return { ran: false, note: 'rebrand.mjs not found' }
      const r = runNode([script, '--root', root], trusted.dir)
      return { ran: true, ok: r.status === 0, note: r.status === 0 ? '' : firstLine(r.stderr) }
    },
    format(root, files) {
      if (files.length === 0) return { ran: true, ok: true, note: 'nothing to format' }
      const bin = findPrettier(repoGit ?? createGit(root), root, prettier)
      if (!bin) {
        return strictFormat
          ? { ran: true, ok: false, note: 'prettier not found (required with --ci)' }
          : { ran: false, note: 'prettier not found; run `npm run format` before merging' }
      }
      // the base tree's config and ignore file, never the patched tree's
      const config = trusted.prettierConfig ? ['--config', trusted.prettierConfig] : ['--no-config']
      const args = [bin, '--write', '--ignore-unknown', '--no-editorconfig', ...config]
      args.push('--ignore-path', trusted.prettierIgnore, '--log-level', 'warn', '--', ...files)
      const r = runNode(args, root)
      return { ran: true, ok: r.status === 0, note: r.status === 0 ? '' : firstLine(r.stderr) }
    },
    brandScan(root) {
      const script = join(rebrandDir, 'brand-scan.mjs')
      if (!existsSync(script)) return { ran: false, note: 'brand-scan.mjs not found' }
      const r = runNode([script, '--root', root, '--json'], trusted.dir)
      try {
        const data = JSON.parse(r.stdout)
        return {
          ran: true,
          ok: data.violations.length === 0,
          violations: data.violations.map((v) => `${v.file}:${v.line} [${v.scope}] ${v.match}`),
          allowed: data.allowed.length,
          unusedDebt: data.unused.length,
        }
      } catch {
        return {
          ran: true,
          ok: false,
          violations: [],
          note: `brand-scan crashed: ${firstLine(r.stderr)}`,
        }
      }
    },
    egress(root) {
      if (!trusted.egress) return { ran: false, note: 'not present: no check:egress script' }
      const r = runNode(
        [join(trusted.tools, 'check-egress.mjs'), '--root', root, '--json'],
        trusted.dir,
      )
      let violations = []
      try {
        violations = JSON.parse(r.stdout).map((v) => `${v.path}:${v.line} [${v.pattern}]`)
      } catch {
        if (r.status !== 0) return { ran: true, ok: false, violations, note: firstLine(r.stderr) }
      }
      return { ran: true, ok: r.status === 0, violations }
    },
    tests() {
      const files = REBRAND_TESTS.map((t) => join(rebrandDir, t)).filter((p) => existsSync(p))
      if (files.length === 0) return { ran: false, note: 'no rebrand test files' }
      const r = runNode(['--test', '--test-reporter=tap', ...files], trusted.dir)
      const count = (k) => Number(r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? 0)
      return { ran: true, ok: r.status === 0, pass: count('pass'), fail: count('fail') }
    },
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function firstLine(s) {
  const plain = s.replace(ANSI, '')
  return (plain.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 300)
}

// ---------------------------------------------------------------- pipeline

function noopChecks() {
  const skip = { ran: false, note: 'skipped (--skip-checks)' }
  return {
    rebrand: () => skip,
    format: () => skip,
    brandScan: () => skip,
    egress: () => skip,
    tests: () => skip,
  }
}

function stateFile(git) {
  return git(['rev-parse', '--path-format=absolute', '--git-path', 'upstream-sync-state.json']).text
}

/** A check that throws (e.g. on a file left with conflict markers) fails instead of aborting the run. */
function guarded(fn) {
  try {
    return fn()
  } catch (e) {
    return { ran: true, ok: false, note: `crashed: ${firstLine(String(e.message))}` }
  }
}

/** Steps after the patch commit: rebrand (+format), bump UPSTREAM_BASE, scan, egress, test. */
function finish(git, root, summary, checks) {
  const reb = guarded(() => checks.rebrand(root))
  summary.rebrand = { ...reb, changed: [] }
  if (reb.ran) {
    const changed = worktreeChanges(git)
    summary.rebrand.changed = changed
    // files committed with conflict markers cannot be parsed, so they are not formatted
    const markers = new Set(summary.apply.conflicted)
    const existing = changed.filter((f) => !markers.has(f) && existsSync(join(root, f)))
    summary.format = guarded(() => checks.format(root, existing))
    if (changed.length > 0) {
      git(['add', '-A'])
      if (hasStagedChanges(git)) {
        summary.commitsCreated.push(
          commit(
            git,
            `chore(rebrand): re-apply UniWork brand after upstream sync\n\nAutomated run of tools/rebrand/rebrand.mjs after applying genoffice\n${short(summary.base)}..${short(summary.target)}.\n`,
          ),
        )
      }
    }
  } else summary.format = { ran: false, note: 'skipped with the rebrand step' }

  writeFileSync(join(root, BASE_FILE), `${summary.target}\n`)
  git(['add', '--', BASE_FILE])
  if (hasStagedChanges(git)) {
    summary.commitsCreated.push(
      commit(
        git,
        `chore(rebrand): bump UPSTREAM_BASE to ${short(summary.target)}\n\nThe tree now absorbs genoffice ${summary.target}.\n`,
      ),
    )
  }
  summary.brandScan = guarded(() => checks.brandScan(root))
  summary.egress = checks.egress
    ? guarded(() => checks.egress(root))
    : { ran: false, note: 'not present' }
  summary.tests = guarded(() => checks.tests(root))
}

function exitCodeOf(s) {
  if (s.status === 'up-to-date' || s.status === 'already-prepared') return 0
  const human = s.apply.conflicted.length > 0 || s.apply.failed.length > 0 || !checksOk(s)
  return human ? 2 : 0
}

/** The local or origin sync branch, if any, and whether its UPSTREAM_BASE already is the target. */
function existingPrepared(git, branch, target) {
  const found = []
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (!revParse(git, ref)) continue
    const r = git(['show', `${ref}:${BASE_FILE}`], { allowFailure: true })
    found.push({ ref, prepared: r.status === 0 && r.text === target })
  }
  return found.find((f) => f.prepared) ?? found[0] ?? null
}

/**
 * Runs the sync. `options` are parseArgs() output plus, for tests:
 *   checks  object with rebrand/format/brandScan/tests(root) functions, or false to skip them
 *   log     logger (default: stderr)
 * Returns the summary object; summary.exitCode is the process exit code.
 */
export function syncUpstream(options) {
  const started = Date.now()
  const log = options.log ?? ((m) => process.stderr.write(`[sync-upstream] ${m}\n`))
  const root = resolve(
    options.root ?? createGit(process.cwd())(['rev-parse', '--show-toplevel']).text,
  )
  const git = createGit(root)
  let trusted = null
  let checks
  if (options.checks === false || options.skipChecks) checks = noopChecks()
  else if (options.checks) checks = options.checks
  else {
    trusted = trustedSnapshot()
    checks = defaultChecks({
      trusted,
      prettier: options.prettier,
      strictFormat: Boolean(options.ci),
      repoGit: git,
    })
  }
  try {
    return runSync({ options, root, git, checks, log, started })
  } finally {
    trusted?.cleanup()
  }
}

function runSync({ options, root, git, checks, log, started }) {
  const exclude = options.exclude ?? []
  if (options.continue) return continueSync({ git, root, checks, log, started })

  const base = options.base ?? readBase(root)
  log(`resolving upstream range from ${short(base)} ...`)
  const range = resolveRange(git, {
    to: options.to ?? (options.fetch === false ? `${FETCH_REF_PREFIX}/target` : undefined),
    base,
    remote: options.remote ?? DEFAULT_REMOTE,
    fetch: options.fetch !== false,
  })
  const branch = options.branch ?? `upstream-sync/${short(range.target)}`
  const summary = {
    status: 'pending',
    dryRun: Boolean(options.dryRun),
    remote: displayRemote(options.remote ?? DEFAULT_REMOTE),
    base: range.base,
    target: range.target,
    branch,
    behind: 0,
    ancestor: true,
    commits: [],
    files: [],
    insertions: 0,
    deletions: 0,
    binary: [],
    excluded: [],
    apply: { clean: [], conflicted: [], failed: [], mode: 'none' },
    commitsCreated: [],
    rebrand: null,
    format: null,
    brandScan: null,
    egress: null,
    tests: null,
    watch: [],
    stoppedForConflicts: false,
  }
  const done = (status) => {
    summary.status = status
    summary.exitCode = exitCodeOf(summary)
    summary.durationMs = Date.now() - started
    return summary
  }

  if (range.base === range.target) {
    log('up to date: UPSTREAM_BASE already equals the target')
    return done('up-to-date')
  }
  const prior = existingPrepared(git, branch, range.target)
  if (prior?.prepared) {
    log(`already prepared: ${prior.ref} already absorbs ${short(range.target)}`)
    return done('already-prepared')
  }
  if (prior && !options.dryRun) {
    throw new Error(
      prior.ref.startsWith('refs/heads/')
        ? `branch ${branch} exists but is not finished; resolve it and run --continue, or delete it`
        : `origin/${branch} exists but does not absorb ${short(range.target)}; delete it or pass --branch (never force-pushed)`,
    )
  }

  Object.assign(summary, rangeStats(git, range.base, range.target, { exclude }))
  if (!summary.ancestor && !options.force) {
    throw new Error(
      `upstream base ${short(range.base)} is not an ancestor of ${short(range.target)} (rewritten or unrelated history); pass --force to sync anyway`,
    )
  }
  summary.watch = watchHits(git, range, summary.files)
  log(`${summary.behind} upstream commit(s), ${summary.files.length} file(s) changed`)

  if (options.dryRun) return dryRun({ git, summary, checks, exclude, log, done })

  if (isDirty(git)) throw new Error('working tree is not clean; commit or stash first')
  const original =
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }).text ||
    git(['rev-parse', 'HEAD']).text
  git(['switch', '--quiet', '-c', branch])
  log(`created branch ${branch}`)
  try {
    return applyAndFinish({ git, root, summary, checks, exclude, log, done, options })
  } catch (e) {
    rollback(git, original, branch, log)
    throw e
  }
}

/** Undoes a failed real run: back to the original ref, the new branch deleted. */
function rollback(git, original, branch, log) {
  git(['reset', '--quiet', '--hard', 'HEAD'], { allowFailure: true })
  // the tree was clean (untracked files included) before the run, so this only drops its leftovers
  git(['clean', '-fdq'], { allowFailure: true })
  const back = FULL_SHA.test(original)
    ? git(['switch', '--quiet', '--detach', original], { allowFailure: true })
    : git(['switch', '--quiet', original], { allowFailure: true })
  if (back.status === 0) git(['branch', '-D', branch], { allowFailure: true })
  log(`rolled back: back on ${original}${back.status === 0 ? `, ${branch} deleted` : ''}`)
}

function applyAndFinish({
  git,
  root,
  summary,
  checks,
  exclude,
  log,
  done,
  options,
  persist = true,
}) {
  summary.apply = applyUpstreamPatch(git, summary.base, summary.target, summary.files, { exclude })
  const { clean, conflicted, failed } = summary.apply
  log(`apply: ${clean.length} clean, ${conflicted.length} conflicted, ${failed.length} failed`)
  if (conflicted.length > 0 && !options.commitConflicts && !options.dryRun) {
    summary.stoppedForConflicts = true
    if (persist) writeFileSync(stateFile(git), JSON.stringify(stateOf(summary), null, 2))
    log('stopped: resolve the conflicts, `git add` them, then run sync-upstream.mjs --continue')
    return done('conflicts')
  }
  if (conflicted.length > 0) git(['add', '-A', '--', ...conflicted.map((p) => `:(literal)${p}`)])
  if (hasStagedChanges(git)) {
    summary.commitsCreated.push(commit(git, applyMessage(summary)))
  }
  finish(git, root, summary, checks)
  return done(
    summary.apply.conflicted.length + summary.apply.failed.length > 0
      ? 'conflicts'
      : checksOk(summary)
        ? 'clean'
        : 'checks-failed',
  )
}

function checksOk(s) {
  return ![s.rebrand, s.format, s.brandScan, s.egress, s.tests].some(
    (c) => c?.ran && c.ok === false,
  )
}

function applyMessage(s) {
  const lines = [
    `chore(upstream): apply genoffice ${short(s.base)}..${short(s.target)}`,
    '',
    `Upstream ${s.base}..${s.target}: ${s.behind} commit(s), ${s.files.length} file(s).`,
  ]
  if (s.apply.conflicted.length > 0) {
    lines.push('', 'Committed WITH conflict markers (resolve before merging):')
    for (const p of s.apply.conflicted) lines.push(`- ${p}`)
  }
  if (s.apply.failed.length > 0) {
    lines.push('', 'Not applied (no 3-way merge possible; port by hand):')
    for (const f of s.apply.failed) lines.push(`- ${f.path}`)
  }
  if (s.excluded.length > 0) lines.push('', `Left out by --exclude: ${s.excluded.length} file(s).`)
  return `${lines.join('\n')}\n`
}

function stateOf(s) {
  const {
    base,
    target,
    branch,
    behind,
    ancestor,
    commits,
    files,
    insertions,
    deletions,
    binary,
    excluded,
    apply,
    watch,
    remote,
  } = s
  return {
    base,
    target,
    branch,
    behind,
    ancestor,
    commits,
    files,
    insertions,
    deletions,
    binary,
    excluded,
    apply,
    watch,
    remote,
  }
}

function dryRun({ git, summary, checks, exclude, log, done }) {
  const tmp = mkdtempSync(join(tmpdir(), 'uniwork-sync-'))
  const wt = join(tmp, 'wt')
  try {
    git(['worktree', 'add', '--detach', '--quiet', wt, 'HEAD'])
    const wtGit = createGit(wt)
    log('dry run: applying in a throwaway worktree')
    // the detached worktree's commits stay unreachable; nothing lands in the real repo
    const result = applyAndFinish({
      git: wtGit,
      root: wt,
      summary,
      checks,
      exclude,
      log,
      done,
      options: { dryRun: true },
      persist: false,
    })
    result.dryRunCommits = result.commitsCreated.length
    result.commitsCreated = []
    return result
  } finally {
    git(['worktree', 'remove', '--force', wt], { allowFailure: true })
    rmSync(tmp, { recursive: true, force: true })
    git(['worktree', 'prune'], { allowFailure: true })
  }
}

function continueSync({ git, root, checks, log, started }) {
  const file = stateFile(git)
  if (!existsSync(file)) throw new Error('nothing to continue: no stopped sync in this repo')
  const summary = {
    ...JSON.parse(readFileSync(file, 'utf8')),
    status: 'pending',
    dryRun: false,
    commitsCreated: [],
    rebrand: null,
    format: null,
    brandScan: null,
    egress: null,
    tests: null,
    stoppedForConflicts: false,
  }
  const head = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }).text
  if (head !== summary.branch) throw new Error(`switch to ${summary.branch} before --continue`)
  const left = unmergedPaths(git)
  if (left.length > 0) throw new Error(`still unmerged: ${left.join(', ')}`)
  git(['add', '-A'])
  summary.apply.resolvedByHand = summary.apply.conflicted
  summary.apply.conflicted = []
  if (hasStagedChanges(git)) {
    summary.commitsCreated.push(
      commit(
        git,
        `${applyMessage(summary).trimEnd()}\n\nConflicts resolved by hand:\n${summary.apply.resolvedByHand.map((p) => `- ${p}`).join('\n')}\n`,
      ),
    )
  }
  finish(git, root, summary, checks)
  rmSync(file, { force: true })
  summary.status =
    summary.apply.failed.length > 0 ? 'conflicts' : checksOk(summary) ? 'clean' : 'checks-failed'
  summary.exitCode = exitCodeOf(summary)
  summary.durationMs = Date.now() - started
  log(`continued: ${summary.status}`)
  return summary
}

function watchHits(git, range, files) {
  const hits = []
  for (const f of files) {
    const w = WATCH.find((x) => x.test(f.path))
    if (w) hits.push({ path: f.path, note: w.note })
  }
  const tracked = git(
    [
      ...DIFF_FLAGS,
      '--name-only',
      '-z',
      '-G',
      'analytics\\.track\\(|gtag\\(',
      range.base,
      range.target,
    ],
    { allowFailure: true },
  )
  if (tracked.status === 0) {
    for (const p of splitZ(tracked.stdout)) {
      if (!hits.some((h) => h.path === p)) {
        hits.push({
          path: p,
          note: 'touches analytics calls: the fork removed them; check none came back',
        })
      }
    }
  }
  return hits
}

function displayRemote(remote) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote) || /^[\w.-]+@[\w.-]+:/.test(remote)) {
    return remote.replace(/\/\/[^/@]+@/, '//')
  }
  return isAbsolute(remote) || remote.includes('/') || remote.includes('\\')
    ? '(local path)'
    : remote
}

// ---------------------------------------------------------------- report

/**
 * Wraps untrusted text (upstream commit subjects, git errors, scan hits) in a code span, so
 * GitHub renders no @mentions, #references or markup from it. The fence is one backtick
 * longer than the longest backtick run inside.
 */
export function codeSpan(text) {
  const t = String(text).replace(/\r?\n/g, ' ')
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(longest + 1)
  const pad = longest > 0 ? ' ' : ''
  return `${fence}${pad}${t}${pad}${fence}`
}

function capped(list, fmt = (x) => x) {
  const out = list.slice(0, LIST_CAP).map((x) => `- ${fmt(x)}`)
  if (list.length > LIST_CAP) out.push(`- ... and ${list.length - LIST_CAP} more`)
  return out.length > 0 ? out : ['- none']
}

function checkLine(c, detail = '') {
  if (!c) return 'not run'
  if (!c.ran) return `skipped (${c.note})`
  return `${c.ok ? 'pass' : 'FAIL'}${detail}${c.note ? ` (${codeSpan(c.note)})` : ''}`
}

const TRUNCATED_NOTE =
  '> Report truncated to fit a pull request body; the full report (markdown and JSON) is in the ' +
  "workflow run's `upstream-sync-report` artifact."

/**
 * Markdown report; repo-relative paths only, so it can be a PR body as is. With `maxLength`
 * it is cut at a line boundary below that size and ends with a pointer to the full report.
 */
export function renderReport(s, { maxLength } = {}) {
  const full = reportLines(s).join('\n')
  if (!maxLength || full.length <= maxLength) return full
  const budget = maxLength - TRUNCATED_NOTE.length - 32
  let cutText = full.slice(0, full.lastIndexOf('\n', budget))
  const open = (cutText.match(/<details>/g) ?? []).length
  const closed = (cutText.match(/<\/details>/g) ?? []).length
  if (open > closed) cutText += '\n\n</details>'
  return `${cutText}\n\n${TRUNCATED_NOTE}\n`
}

function reportLines(s) {
  const r = []
  const range = `${short(s.base)}..${short(s.target)}`
  const title = {
    'up-to-date': 'up to date',
    'already-prepared': 'already prepared',
    clean: 'clean',
    conflicts: s.stoppedForConflicts ? 'stopped on conflicts' : 'needs conflict resolution',
    'checks-failed': 'checks failed',
  }[s.status]
  r.push(`# Upstream sync ${range}: ${title}${s.dryRun ? ' (dry run)' : ''}`, '')
  const a = s.apply
  // the loud part first, so it survives truncation of a long report
  if (a.failed.length > 0) {
    r.push(
      '> [!CAUTION]',
      `> **${a.failed.length} upstream file(s) were NOT applied** (no 3-way merge possible).`,
      '> UPSTREAM_BASE is bumped anyway, so their upstream changes would be lost:',
      '> **do not merge this until every file listed under "Not applied" is ported by hand.**',
      '',
    )
  }
  if (a.conflicted.length > 0 && !s.stoppedForConflicts) {
    r.push(
      '> [!WARNING]',
      `> ${a.conflicted.length} file(s) are committed WITH conflict markers; resolve them before merging`,
      "> (CI's conflict-marker check fails until then).",
      '',
    )
  }
  const failedChecks = [
    ['rebrand', s.rebrand],
    ['formatting', s.format],
    ['brand scan', s.brandScan],
    ['egress check', s.egress],
    ['rebrand tests', s.tests],
  ].filter(([, c]) => c?.ran && c.ok === false)
  if (failedChecks.length > 0) {
    r.push('> [!WARNING]', `> Failed checks: ${failedChecks.map(([n]) => n).join(', ')}.`, '')
  }
  r.push(`| | |`, `| --- | --- |`)
  r.push(`| Upstream | ${s.remote} |`)
  r.push(`| Base (UPSTREAM_BASE) | \`${s.base}\` |`)
  r.push(`| Target | \`${s.target}\` |`)
  r.push(
    `| Commits behind | ${s.behind}${s.ancestor === false ? ' (base is NOT an ancestor of the target)' : ''} |`,
  )
  r.push(`| Branch | \`${s.branch}\` |`)
  if (s.dryRun && s.dryRunCommits !== undefined)
    r.push(`| Commits a real run makes | ${s.dryRunCommits} |`)
  else if (!s.dryRun) r.push(`| Commits made | ${s.commitsCreated.length} |`)
  r.push(`| Exit code | ${s.exitCode} |`)
  r.push(`| Wall time | ${(s.durationMs / 1000).toFixed(1)} s |`, '')
  if (s.status === 'up-to-date') {
    r.push('Nothing to do: the tree already absorbs the upstream target.', '')
    return r
  }
  if (s.status === 'already-prepared') {
    r.push(
      `Nothing to do: \`${s.branch}\` already carries this sync. Delete that branch to prepare it again.`,
      '',
    )
    return r
  }
  if (a.failed.length > 0) {
    r.push(
      `## Not applied: ${a.failed.length} file(s), port by hand`,
      '',
      ...capped(a.failed, (f) => `\`${f.path}\`: ${codeSpan(f.error)}`),
      '',
    )
  }
  if (a.conflicted.length > 0) {
    r.push(
      s.stoppedForConflicts
        ? `## Conflicted: ${a.conflicted.length} file(s), left in the working tree`
        : `## Conflicted: ${a.conflicted.length} file(s), committed with markers`,
      '',
      ...capped(a.conflicted, (p) => `\`${p}\``),
      '',
    )
  }
  if (a.resolvedByHand?.length > 0)
    r.push('## Conflicts resolved by hand', '', ...capped(a.resolvedByHand, (p) => `\`${p}\``), '')
  r.push(
    `## Patch result: ${a.clean.length} clean, ${a.conflicted.length + (a.resolvedByHand?.length ?? 0)} conflicted, ${a.failed.length} failed`,
    '',
  )
  if (!s.stoppedForConflicts) {
    const rb = s.rebrand
    r.push(`## Checks`, '')
    r.push(
      `- Rebrand: ${rb?.ran ? `${checkLine(rb)}, ${rb.changed.length} file(s) changed` : checkLine(rb)}`,
    )
    for (const p of (rb?.changed ?? []).slice(0, LIST_CAP)) r.push(`  - \`${p}\``)
    r.push(`- Formatting of rebranded files: ${checkLine(s.format)}`)
    const bs = s.brandScan
    r.push(
      `- Brand scan: ${checkLine(bs, bs?.ran ? `, ${bs.violations?.length ?? 0} violation(s), ${bs.allowed ?? 0} allowlisted hit(s)` : '')}`,
    )
    for (const v of (bs?.violations ?? []).slice(0, 50)) r.push(`  - ${codeSpan(v)}`)
    const eg = s.egress
    r.push(
      `- Egress check: ${checkLine(eg, eg?.ran && eg.violations ? `, ${eg.violations.length} hit(s)` : '')}`,
    )
    for (const v of (eg?.violations ?? []).slice(0, 50)) r.push(`  - ${codeSpan(v)}`)
    const t = s.tests
    r.push(
      `- Rebrand tests: ${checkLine(t, t?.ran && t.pass !== undefined ? `, ${t.pass} passed, ${t.fail} failed` : '')}`,
      '',
    )
  }
  if (s.watch.length > 0) {
    r.push(
      '## Watch list (upstream touched paths the fork adjusts by hand)',
      '',
      ...capped(s.watch, (w) => `\`${w.path}\`: ${w.note}`),
      '',
    )
  }
  r.push('## Next steps', '')
  if (s.stoppedForConflicts) {
    r.push(
      '1. Resolve every conflicted file: keep the UniWork brand and teacher-edu work, upstream wins elsewhere.',
      '2. `git add` the resolved files, then run `node tools/rebrand/sync-upstream.mjs --continue`.',
    )
  } else {
    if (a.failed.length > 0) {
      r.push(
        `1. Port the files that did not apply by hand: \`git diff ${short(s.base)} ${short(s.target)} -- <file>\`. Do not merge before.`,
      )
    }
    if (a.conflicted.length > 0) {
      r.push(
        '1. Check out the branch and resolve the conflict markers in the files above; commit the result.',
      )
    }
    if (s.excluded.length > 0)
      r.push('1. Review the excluded upstream paths and port what the fork needs.')
    r.push(
      '1. Work through the watch list and the "Known gaps" in tools/rebrand/README.md (analytics / star prompt code, skill version bump).',
      '1. Run `npm run format`, `npm run check:brand`, `npm run rebrand:check` and the app tests; review the diff of each commit.',
      '1. Merge by hand once CI is green; nothing is merged automatically.',
    )
  }
  r.push('')
  r.push(`## Upstream commits (${s.behind})`, '')
  r.push(...capped(s.commits, (c) => `\`${c.slice(0, 7)}\` ${codeSpan(c.slice(8))}`), '')
  if (s.excluded.length > 0) {
    r.push(
      `## Left out by --exclude (${s.excluded.length}, port by hand)`,
      '',
      ...capped(s.excluded, (p) => `\`${p}\``),
      '',
    )
  }
  r.push(
    `## Files changed upstream: ${s.files.length} (+${s.insertions} / -${s.deletions}, ${s.binary.length} binary)`,
    '',
    `<details><summary>File list</summary>`,
    '',
    ...capped(s.files, (f) => `${f.status} \`${f.path}\``),
    '',
    '</details>',
    '',
  )
  return r
}

export function writeReport(file, summary) {
  const md = resolve(file)
  mkdirSync(dirname(md), { recursive: true })
  writeFileSync(md, renderReport(summary))
  const json = /\.md$/i.test(md) ? md.replace(/\.md$/i, '.json') : `${md}.json`
  writeFileSync(json, `${JSON.stringify(summary, null, 2)}\n`)
  return { md, json }
}

/** The report cut below PR_BODY_LIMIT characters, for `gh pr create --body-file`. */
export function writePrBody(file, summary) {
  const out = resolve(file)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, renderReport(summary, { maxLength: PR_BODY_LIMIT }))
  return out
}

// ---------------------------------------------------------------- CLI

async function main(argv) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    process.stderr.write(
      `sync-upstream: ${e.message}\nsee the header of tools/rebrand/sync-upstream.mjs\n`,
    )
    return 1
  }
  if (opts.help) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    process.stdout.write(
      `${src
        .split('\nimport ')[0]
        .replace(/^#!.*\n/, '')
        .replace(/^\/\/ ?/gm, '')}\n`,
    )
    return 0
  }
  try {
    const summary = syncUpstream(opts)
    if (opts.report) writeReport(opts.report, summary)
    if (opts.prBody) writePrBody(opts.prBody, summary)
    if (opts.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    else {
      process.stdout.write(renderReport(summary))
    }
    return summary.exitCode
  } catch (e) {
    process.stderr.write(`sync-upstream: ${e.message}\n`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
