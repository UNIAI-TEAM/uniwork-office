import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./install.sh', import.meta.url))
const BUILDER = fileURLToPath(new URL('../../apps/shell/electron-builder.cjs', import.meta.url))
const FPR = '58A902322C8D45C433B525F51198D10926F34831'
const KEYRING = '/usr/share/keyrings/uniwork-office-archive-keyring.gpg'
const SOURCES = '/etc/apt/sources.list.d/uniwork-office.sources'
const BASE = 'https://uniworkos.com/downloads/office'

// The script writes absolute system paths; the cases below only run where those are free.
const skip =
  existsSync(SOURCES) || existsSync(KEYRING)
    ? `${SOURCES} or ${KEYRING} exists on this machine`
    : !existsSync('/etc/os-release')
      ? 'no /etc/os-release'
      : false
if (skip) console.log(`install-script cases that run the script are skipped: ${skip}`)

/** aptSourcesText(channel) as electron-builder.cjs defines it (extracted, not copied). */
function builderSourcesText(channel) {
  const source = readFileSync(BUILDER, 'utf8')
  const constant = (name) => source.match(new RegExp(`const ${name} = '([^']+)'`))[1]
  const fn = source.match(/function aptSourcesText\(channel\) \{[\s\S]*?\n\}\n/)[0]
  return new Function('APT_REPO_URL', 'APT_KEYRING_PATH', `${fn}\nreturn aptSourcesText`)(
    constant('APT_REPO_URL'),
    constant('APT_KEYRING_PATH'),
  )(channel)
}

let root
let stubs
let fakeRoot

const STUB_ENV_HELP = {
  id: '#!/bin/sh\necho "${STUB_UID:-0}"\n',
  dpkg: '#!/bin/sh\necho "${STUB_ARCH:-amd64}"\n',
  // fetches succeed unless STUB_FAIL names a part of the URL; every URL is logged
  curl: [
    '#!/bin/sh',
    'for a in "$@"; do out="$url"; url="$a"; done',
    'echo "$url" >>"$STUB_LOG"',
    'case "$url" in *"${STUB_FAIL:-@@none@@}"*) exit 22 ;; esac',
    'printf "fetched %s\\n" "$url" >"$out"',
    '',
  ].join('\n'),
  gpg: [
    '#!/bin/sh',
    'printf "pub:-:4096:1:AAAA:1:::::scESC:::::::\\nfpr:::::::::%s:\\n" "${STUB_FPR}"',
    '',
  ].join('\n'),
  'apt-get': '#!/bin/sh\necho "apt-get $*" >>"$STUB_LOG"\n',
  // install -D -m 0644 <src> <dst> lands below the fake root instead of the real system paths
  install: [
    '#!/bin/sh',
    'for a in "$@"; do src="$dst"; dst="$a"; done',
    'mkdir -p "$STUB_ROOT$(dirname "$dst")" && cp "$src" "$STUB_ROOT$dst"',
    '',
  ].join('\n'),
}

function runScript(args, env = {}) {
  const log = join(root, 'stub.log')
  writeFileSync(log, '')
  rmSync(fakeRoot, { recursive: true, force: true })
  mkdirSync(fakeRoot)
  const result = spawnSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      PATH: `${stubs}:${process.env.PATH}`,
      HOME: root,
      STUB_LOG: log,
      STUB_ROOT: fakeRoot,
      STUB_FPR: FPR,
      ...env,
    },
  })
  return { ...result, log: readFileSync(log, 'utf8') }
}

function written() {
  const out = spawnSync('find', [fakeRoot, '-type', 'f'], { encoding: 'utf8' }).stdout
  return out.split('\n').filter(Boolean)
}

describe('install.sh', () => {
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'install-script-test-'))
    stubs = join(root, 'stubs')
    fakeRoot = join(root, 'fake-root')
    mkdirSync(stubs)
    for (const [name, body] of Object.entries(STUB_ENV_HELP)) {
      writeFileSync(join(stubs, name), body)
      chmodSync(join(stubs, name), 0o755)
    }
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('is valid POSIX sh and runs everything from main on the last line', () => {
    const syntax = spawnSync('sh', ['-n', SCRIPT], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
    const lines = readFileSync(SCRIPT, 'utf8').trimEnd().split('\n')
    assert.equal(lines[0], '#!/bin/sh')
    assert.equal(lines.at(-1), 'main "$@"')
    // no top-level command besides `set` and the function definitions: a cut-off download runs nothing
    const topLevel = lines.filter((line) => /^[^\s#}]/.test(line) && !/^[a-z_]+\(\) \{$/.test(line))
    assert.deepEqual(topLevel, ['set -eu', 'main "$@"'])
  })

  for (const channel of ['dev', 'beta', 'stable']) {
    it(`writes the exact deb822 source electron-builder ships for ${channel}`, { skip }, () => {
      const result = runScript(channel === 'stable' ? [] : [channel])
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.equal(readFileSync(join(fakeRoot, SOURCES), 'utf8'), builderSourcesText(channel))
      assert.equal(readFileSync(join(fakeRoot, KEYRING), 'utf8'), `fetched ${BASE}/apt/key.gpg\n`)
      assert.match(result.log, new RegExp(`${BASE}/apt/dists/${channel}/InRelease`))
      // update first, then install, both non-interactive
      const aptCalls = result.log.split('\n').filter((line) => line.startsWith('apt-get '))
      assert.deepEqual(aptCalls, ['apt-get update -q', 'apt-get install -y -q uniwork-office'])
      assert.deepEqual(written().sort(), [join(fakeRoot, KEYRING), join(fakeRoot, SOURCES)].sort())
    })
  }

  it('points the written source at UNIWORK_OFFICE_REPO_URL (test hook)', { skip }, () => {
    const result = runScript(['dev'], { UNIWORK_OFFICE_REPO_URL: 'http://127.0.0.1:9/b' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readFileSync(join(fakeRoot, SOURCES), 'utf8'),
      builderSourcesText('dev').replace(`${BASE}/apt`, 'http://127.0.0.1:9/b/apt'),
    )
  })

  it('exits 2 with the usage for another channel or extra arguments, before anything else', () => {
    for (const args of [['nightly'], ['dev', 'beta']]) {
      const result = runScript(args, { STUB_UID: '1000' })
      assert.equal(result.status, 2, args.join(' '))
      assert.match(result.stderr, /usage: curl -fsSL .*install\.sh \| sudo sh -s --/)
      assert.deepEqual(written(), [])
      assert.equal(result.log, '')
    }
  })

  it('refuses without root and says to use sudo', () => {
    const result = runScript(['dev'], { STUB_UID: '1000' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /run it with sudo/)
    assert.deepEqual(written(), [])
    assert.equal(result.log, '')
  })

  it('refuses a machine that is not amd64', () => {
    const result = runScript(['dev'], { STUB_ARCH: 'arm64' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /amd64 only/)
    assert.deepEqual(written(), [])
    assert.equal(result.log, '')
  })

  it('refuses an unpublished channel with the dev hint and changes nothing', () => {
    const result = runScript([], { STUB_FAIL: '/dists/stable/InRelease' })
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      new RegExp(
        `channel stable is not published yet; try: curl -fsSL ${BASE}/install\\.sh \\| sudo sh -s -- dev`,
      ),
    )
    assert.deepEqual(written(), [])
    assert.ok(!result.log.includes('apt-get'))
    assert.ok(!result.log.includes('key.gpg'))
  })

  it('refuses a key with another fingerprint and writes nothing', () => {
    const result = runScript(['dev'], { STUB_FPR: '0000000000000000000000000000000000000000' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, new RegExp(`expected ${FPR}; nothing was changed`))
    assert.deepEqual(written(), [])
    assert.ok(!result.log.includes('apt-get'))
  })
})
