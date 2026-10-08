// node --test tools/rebrand/sync-upstream.test.mjs
// Builds throwaway git repos (a fake upstream and a fork without shared history)
// under the OS temp dir; no network.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { BASE_FILE, parseArgs, renderReport, syncUpstream } from './sync-upstream.mjs'

// Same identity and line-ending behaviour on every platform, for the helpers below
// and for the git processes the script spawns (they inherit process.env).
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Sync Test',
  GIT_AUTHOR_EMAIL: 'sync-test@example.invalid',
  GIT_COMMITTER_NAME: 'Sync Test',
  GIT_COMMITTER_EMAIL: 'sync-test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'core.autocrlf',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'init.defaultBranch',
  GIT_CONFIG_VALUE_1: 'main',
  GIT_CONFIG_KEY_2: 'commit.gpgsign',
  GIT_CONFIG_VALUE_2: 'false',
  GIT_CONFIG_KEY_3: 'advice.detachedHead',
  GIT_CONFIG_VALUE_3: 'false',
})

const TMP = mkdtempSync(join(tmpdir(), 'sync-upstream-test-'))
after(() => rmSync(TMP, { recursive: true, force: true }))
let counter = 0

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString('utf8')
    .trim()

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    if (content === null) {
      rmSync(abs, { force: true })
      continue
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
}

function commitAll(dir, message) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '--allow-empty', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

const lines = (n, tag = '') =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join('\n') + '\n'
const PNG_V1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0xff, 0xfe, 10, 13, 0])
const PNG_V2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 8, 7, 0, 0xff, 0x00, 13, 10, 0, 42])

const BASE_TREE = {
  'a.txt': lines(20),
  'b.txt': lines(10),
  'logo.png': PNG_V1,
  'gone.txt': 'upstream deletes this\n',
}

const upstreams = new Map()

/** One fake upstream per change set, shared by the cases (they only fetch from it). */
function upstreamFor(upstreamChanges) {
  if (upstreams.has(upstreamChanges)) return upstreams.get(upstreamChanges)
  const upstream = join(TMP, `upstream-${upstreams.size}`)
  mkdirSync(upstream, { recursive: true })
  git(upstream, 'init', '-q')
  write(upstream, BASE_TREE)
  const base = commitAll(upstream, 'upstream base')
  let target = base
  if (upstreamChanges) {
    write(upstream, upstreamChanges)
    commitAll(upstream, 'upstream: first change')
    write(upstream, { 'later.txt': 'second upstream commit\n' })
    target = commitAll(upstream, 'upstream: second change')
  }
  upstreams.set(upstreamChanges, { upstream, base, target })
  return upstreams.get(upstreamChanges)
}

/**
 * upstreamChanges: files to write (null deletes) in the new upstream commits; omit for "no new commit".
 * forkChanges: divergent fork edits on top of the base tree (the fork shares no history with upstream).
 */
function setup({ upstreamChanges, forkChanges = {} } = {}) {
  const { upstream, base, target } = upstreamFor(upstreamChanges)
  const fork = join(TMP, `fork-${++counter}`)
  mkdirSync(fork, { recursive: true })
  git(fork, 'init', '-q')
  write(fork, {
    ...BASE_TREE,
    [BASE_FILE]: `${base}\n`,
    'fork-only.txt': 'UniWork\n',
    ...forkChanges,
  })
  commitAll(fork, 'fork: import with divergent edits')
  return { upstream, fork, base, target }
}

const quiet = () => {}
const run = (fork, upstream, extra = {}) =>
  syncUpstream({ root: fork, remote: upstream, checks: false, log: quiet, ...extra })

/** Fake checks: the "rebrand" rewrites GenOffice in every tracked .txt file. */
function fakeChecks(seen = []) {
  return {
    rebrand(root) {
      seen.push(root)
      for (const f of git(root, 'ls-files').split('\n')) {
        if (!f.endsWith('.txt')) continue
        const p = join(root, f)
        const t = readFileSync(p, 'utf8')
        if (t.includes('GenOffice')) writeFileSync(p, t.replaceAll('GenOffice', 'UniWork Office'))
      }
      return { ran: true, ok: true }
    },
    format: () => ({ ran: true, ok: true }),
    brandScan: () => ({ ran: true, ok: true, violations: [], allowed: 0 }),
    tests: () => ({ ran: true, ok: true, pass: 3, fail: 0 }),
  }
}

function snapshot(fork) {
  return {
    refs: git(fork, 'for-each-ref', '--format=%(refname) %(objectname)')
      .split('\n')
      .filter((l) => !l.startsWith('refs/upstream-sync/'))
      .join('\n'),
    head: git(fork, 'rev-parse', 'HEAD'),
    branch: git(fork, 'symbolic-ref', '--short', 'HEAD'),
    status: git(fork, 'status', '--porcelain'),
    worktrees: git(fork, 'worktree', 'list', '--porcelain'),
    stash: git(fork, 'stash', 'list'),
  }
}

const CLEAN_CHANGES = {
  'a.txt': lines(20).replace('line 5\n', 'line 5 upstream GenOffice\n'),
  'c.txt': 'new upstream file for GenOffice\n',
  'logo.png': PNG_V2,
  'gone.txt': null,
}
const FORK_EDITS = { 'b.txt': lines(10).replace('line 1\n', 'line 1 fork\n') }
const CONFLICT_CHANGES = {
  ...CLEAN_CHANGES,
  'b.txt': lines(10).replace('line 1\n', 'line 1 upstream\n'),
}

test('parseArgs reads flags and rejects unknown ones', () => {
  const o = parseArgs(['--to', 'abc123', '--dry-run', '--exclude', '.github/**', '--json'])
  assert.equal(o.to, 'abc123')
  assert.equal(o.dryRun, true)
  assert.deepEqual(o.exclude, ['.github/**'])
  assert.equal(o.json, true)
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/)
  assert.throws(() => parseArgs(['--to']), /needs a value/)
})

test('up to date: no branch, no commit, exit 0', () => {
  const { fork, upstream } = setup()
  const before = snapshot(fork)
  const s = run(fork, upstream)
  assert.equal(s.status, 'up-to-date')
  assert.equal(s.exitCode, 0)
  assert.equal(s.behind, 0)
  assert.deepEqual(snapshot(fork), before)
  assert.match(renderReport(s), /up to date/)
})

test('clean apply: branch with patch, rebrand and base-bump commits', () => {
  const { fork, upstream, target } = setup({
    upstreamChanges: CLEAN_CHANGES,
    forkChanges: FORK_EDITS,
  })
  const seen = []
  const s = run(fork, upstream, { checks: fakeChecks(seen) })
  assert.equal(s.status, 'clean')
  assert.equal(s.exitCode, 0)
  assert.equal(s.behind, 2)
  assert.equal(s.target, target)
  assert.equal(s.branch, `upstream-sync/${target.slice(0, 7)}`)
  assert.equal(git(fork, 'symbolic-ref', '--short', 'HEAD'), s.branch)
  assert.deepEqual(git(fork, 'log', '--format=%s', 'main..HEAD').split('\n'), [
    `chore(rebrand): bump UPSTREAM_BASE to ${target.slice(0, 7)}`,
    'chore(rebrand): re-apply UniWork brand after upstream sync',
    `chore(upstream): apply genoffice ${s.base.slice(0, 7)}..${target.slice(0, 7)}`,
  ])
  assert.equal(readFileSync(join(fork, BASE_FILE), 'utf8'), `${target}\n`)
  assert.equal(s.apply.clean.length, 5)
  assert.deepEqual(s.apply.conflicted, [])
  assert.deepEqual(s.rebrand.changed.sort(), ['a.txt', 'c.txt'])
  assert.equal(readFileSync(join(fork, 'b.txt'), 'utf8'), FORK_EDITS['b.txt'])
  assert.match(readFileSync(join(fork, 'c.txt'), 'utf8'), /UniWork Office/)
  assert.equal(existsSync(join(fork, 'gone.txt')), false)
  assert.equal(git(fork, 'status', '--porcelain'), '')
  assert.deepEqual(seen, [fork])
  const report = renderReport(s)
  assert.ok(!report.includes(TMP), 'report must not leak local paths')
  assert.match(report, /5 clean, 0 conflicted, 0 failed/)
})

test('binary files in the diff apply byte for byte', () => {
  const { fork, upstream } = setup({ upstreamChanges: { 'logo.png': PNG_V2, 'new.bin': PNG_V1 } })
  const s = run(fork, upstream)
  assert.equal(s.exitCode, 0)
  assert.deepEqual(s.binary.sort(), ['logo.png', 'new.bin'])
  assert.ok(readFileSync(join(fork, 'logo.png')).equals(PNG_V2))
  assert.ok(readFileSync(join(fork, 'new.bin')).equals(PNG_V1))
})

test('conflicts stop after apply and leave the tree for a human; --continue finishes', () => {
  const { fork, upstream, target } = setup({
    upstreamChanges: CONFLICT_CHANGES,
    forkChanges: FORK_EDITS,
  })
  const s = run(fork, upstream)
  assert.equal(s.status, 'conflicts')
  assert.equal(s.exitCode, 2)
  assert.equal(s.stoppedForConflicts, true)
  assert.deepEqual(s.apply.conflicted, ['b.txt'])
  assert.equal(s.apply.clean.length, 5)
  assert.deepEqual(s.apply.failed, [])
  assert.equal(git(fork, 'log', '--format=%s', 'main..HEAD'), '')
  assert.match(git(fork, 'ls-files', '-u'), /b\.txt/)
  assert.match(readFileSync(join(fork, 'b.txt'), 'utf8'), /<<<<<<<[\s\S]*>>>>>>>/)
  assert.match(renderReport(s), /--continue/)

  writeFileSync(join(fork, 'b.txt'), lines(10).replace('line 1\n', 'line 1 fork and upstream\n'))
  git(fork, 'add', 'b.txt')
  const c = syncUpstream({ root: fork, continue: true, checks: false, log: quiet })
  assert.equal(c.status, 'clean')
  assert.equal(c.exitCode, 0)
  assert.deepEqual(c.apply.resolvedByHand, ['b.txt'])
  assert.equal(git(fork, 'log', '--format=%s', 'main..HEAD').split('\n').length, 2)
  assert.equal(readFileSync(join(fork, BASE_FILE), 'utf8'), `${target}\n`)
  assert.equal(git(fork, 'status', '--porcelain'), '')
})

test('--commit-conflicts commits the markers and finishes the remaining steps', () => {
  const { fork, upstream, target } = setup({
    upstreamChanges: CONFLICT_CHANGES,
    forkChanges: FORK_EDITS,
  })
  const s = run(fork, upstream, { commitConflicts: true, checks: fakeChecks() })
  assert.equal(s.status, 'conflicts')
  assert.equal(s.exitCode, 2)
  assert.equal(s.stoppedForConflicts, false)
  assert.deepEqual(s.apply.conflicted, ['b.txt'])
  assert.equal(s.commitsCreated.length, 3)
  assert.equal(git(fork, 'ls-files', '-u'), '')
  assert.equal(git(fork, 'status', '--porcelain'), '')
  assert.match(git(fork, 'show', 'HEAD:b.txt'), /<<<<<<</)
  assert.match(
    git(fork, 'log', '-1', '--format=%B', 'HEAD~2'),
    /WITH conflict markers[\s\S]*- b\.txt/,
  )
  assert.equal(readFileSync(join(fork, BASE_FILE), 'utf8'), `${target}\n`)
})

test('a file the fork deleted cannot be 3-way merged: reported as failed, the rest applies', () => {
  const { fork, upstream } = setup({
    upstreamChanges: CLEAN_CHANGES,
    forkChanges: { 'a.txt': null },
  })
  const s = run(fork, upstream, { commitConflicts: true })
  assert.equal(s.exitCode, 2)
  assert.equal(s.apply.mode, 'per-file')
  assert.deepEqual(
    s.apply.failed.map((f) => f.path),
    ['a.txt'],
  )
  assert.ok(existsSync(join(fork, 'c.txt')))
  assert.equal(git(fork, 'status', '--porcelain'), '')
})

test('dry run changes nothing in the repo and is repeatable', () => {
  const { fork, upstream } = setup({ upstreamChanges: CONFLICT_CHANGES, forkChanges: FORK_EDITS })
  const before = snapshot(fork)
  const seen = []
  const first = run(fork, upstream, { dryRun: true, checks: fakeChecks(seen) })
  const second = run(fork, upstream, { dryRun: true, checks: fakeChecks(seen) })
  for (const s of [first, second]) {
    assert.equal(s.dryRun, true)
    assert.equal(s.exitCode, 2)
    assert.deepEqual(s.apply.conflicted, ['b.txt'])
    assert.equal(s.apply.clean.length, 5)
    assert.deepEqual(s.commitsCreated, [])
    assert.equal(s.dryRunCommits, 3)
  }
  assert.equal(seen.length, 2)
  assert.ok(
    seen.every((r) => r !== fork && !existsSync(r)),
    'checks ran in a removed scratch worktree',
  )
  assert.deepEqual(snapshot(fork), before)
})

test('already prepared: a second run with the same target changes nothing', () => {
  const { fork, upstream } = setup({ upstreamChanges: CLEAN_CHANGES, forkChanges: FORK_EDITS })
  const first = run(fork, upstream)
  assert.equal(first.exitCode, 0)
  git(fork, 'switch', '-q', 'main')
  const before = snapshot(fork)
  const again = run(fork, upstream)
  assert.equal(again.status, 'already-prepared')
  assert.equal(again.exitCode, 0)
  assert.deepEqual(snapshot(fork), before)
  const dry = run(fork, upstream, { dryRun: true })
  assert.equal(dry.status, 'already-prepared')
})

test('refuses a dirty working tree', () => {
  const { fork, upstream } = setup({ upstreamChanges: CLEAN_CHANGES })
  writeFileSync(join(fork, 'b.txt'), 'local edit\n')
  const branches = git(fork, 'branch', '--format=%(refname)')
  assert.throws(() => run(fork, upstream), /not clean/)
  assert.equal(git(fork, 'branch', '--format=%(refname)'), branches)
})

test('--exclude leaves paths out of the patch and lists them', () => {
  const { fork, upstream } = setup({ upstreamChanges: CLEAN_CHANGES })
  const s = run(fork, upstream, { exclude: ['c.txt'] })
  assert.equal(s.exitCode, 0)
  assert.deepEqual(s.excluded, ['c.txt'])
  assert.equal(existsSync(join(fork, 'c.txt')), false)
})

test('a failing or crashing check makes the run exit 2 instead of aborting', () => {
  const { fork, upstream } = setup({ upstreamChanges: CLEAN_CHANGES })
  const checks = {
    ...fakeChecks(),
    brandScan: () => ({ ran: true, ok: false, violations: ['c.txt:1 [source] GenOffice'] }),
    tests: () => {
      throw new Error('package.json: Unexpected token <')
    },
  }
  const s = run(fork, upstream, { checks })
  assert.equal(s.status, 'checks-failed')
  assert.equal(s.exitCode, 2)
  assert.match(s.tests.note, /crashed/)
  assert.equal(readFileSync(join(fork, BASE_FILE), 'utf8'), `${s.target}\n`)
  assert.match(renderReport(s), /Brand scan: FAIL[\s\S]*c\.txt:1/)
})
