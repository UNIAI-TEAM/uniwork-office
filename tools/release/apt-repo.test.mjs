import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./apt-repo.sh', import.meta.url))
const TOOLS = ['apt-ftparchive', 'dpkg-deb', 'gpg', 'gpgv', 'xz']
const missing = TOOLS.filter((tool) => spawnSync('sh', ['-c', `command -v ${tool}`]).status !== 0)
const skip =
  missing.length > 0 ? `needs ${missing.join(', ')} (apt-utils provides apt-ftparchive)` : false
if (skip) console.log(`apt-repo tests skipped: ${skip}`)

const PASSPHRASE = 'test-only passphrase 7c1f'
const POOL = 'apt/pool/main/u/uniwork-office'
const GIT_SHA = '70840f8d3c0ffee0000000000000000000000001'
const BASE = 'https://uniworkos.com/downloads/office'

let root
let gnupg
let keyFpr
let secretKey
let otherSecretKey
let keyring
const outputs = []

function gpg(args, options = {}) {
  return execFileSync(
    'gpg',
    ['--batch', '--homedir', gnupg, '--pinentry-mode', 'loopback', ...args],
    {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    },
  )
}

function makeKey(uid) {
  gpg(['--passphrase', PASSPHRASE, '--quick-gen-key', uid, 'ed25519', 'sign', 'never'])
  const listing = gpg(['--with-colons', '--list-secret-keys', uid])
  const fpr = listing
    .split('\n')
    .find((line) => line.startsWith('fpr:'))
    .split(':')[9]
  const secret = gpg(['--passphrase', PASSPHRASE, '--armor', '--export-secret-keys', fpr])
  return { fpr, secret }
}

/** A release directory like the merged installers-* artifacts, with a tiny real deb. */
function makeRelease(version, channel) {
  const dir = mkdtempSync(join(root, `release-${version}-`))
  const pkg = join(dir, 'pkg')
  mkdirSync(join(pkg, 'DEBIAN'), { recursive: true })
  mkdirSync(join(pkg, 'opt', 'uniwork-office'), { recursive: true })
  writeFileSync(join(pkg, 'opt', 'uniwork-office', 'VERSION'), `${version}\n`)
  writeFileSync(
    join(pkg, 'DEBIAN', 'control'),
    [
      'Package: uniwork-office',
      `Version: ${version}`,
      'Architecture: amd64',
      'Maintainer: Test <test@example.invalid>',
      'Description: test package',
      '',
    ].join('\n'),
  )
  const prefix = `UniWork-Office_${version}_unsigned`
  execFileSync(
    'dpkg-deb',
    ['--root-owner-group', '--build', pkg, join(dir, `${prefix}_linux_x64.deb`)],
    {
      stdio: 'pipe',
    },
  )
  rmSync(pkg, { recursive: true })
  const exe = `${prefix}_win32_x64-setup.exe`
  const appImage = `${prefix}_linux_x64.AppImage`
  writeFileSync(join(dir, exe), `exe ${version}`)
  writeFileSync(join(dir, appImage), `appimage ${version}`)
  writeFileSync(join(dir, `${prefix}_darwin_arm64.dmg`), `dmg ${version}`)
  writeFileSync(
    join(dir, `${channel}.yml`),
    `version: ${version}\nfiles:\n  - url: ${exe}\n    sha512: x\n    size: 1\npath: ${exe}\nsha512: x\n`,
  )
  writeFileSync(
    join(dir, `${channel}-linux.yml`),
    `version: ${version}\nfiles:\n  - url: ${appImage}\n    sha512: x\n    size: 1\npath: ${appImage}\nsha512: x\n`,
  )
  writeFileSync(join(dir, 'SHA256SUMS-linux-x64.txt'), 'sums\n')
  return dir
}

function run(args, { target, secret = secretKey, extraEnv = {} } = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    APT_REPO_TARGET_DIR: target,
    APT_REPO_EXPECT_FPR: keyFpr,
    APT_GPG_PRIVATE_KEY: secret,
    APT_GPG_PASSPHRASE: PASSPHRASE,
    ...extraEnv,
  }
  const shaArgs = args.includes('--git-sha') ? [] : ['--git-sha', GIT_SHA]
  const result = spawnSync('bash', [SCRIPT, ...args, ...shaArgs], { env, encoding: 'utf8' })
  outputs.push(result.stdout, result.stderr)
  return result
}

function publish(
  target,
  version,
  channel = 'dev',
  extra = [],
  dir = makeRelease(version, channel),
) {
  const result = run(['--dir', dir, '--channel', channel, '--version', version, ...extra], {
    target,
  })
  assert.equal(result.status, 0, `${version}: ${result.stdout}\n${result.stderr}`)
  return result
}

function files(target) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(target, path))
    }
  }
  if (existsSync(target)) walk(target)
  return out.sort()
}

function versionsIn(target, channel = 'dev') {
  const packages = readFileSync(
    join(target, `apt/dists/${channel}/main/binary-amd64/Packages`),
    'utf8',
  )
  return [...packages.matchAll(/^Version: (.+)$/gm)].map((match) => match[1])
}

function manifestOf(target) {
  return JSON.parse(readFileSync(join(target, 'releases.json'), 'utf8'))
}

function manifestVersions(target, channel = 'dev') {
  return manifestOf(target).channels[channel].releases.map((entry) => entry.version)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function releaseSha256(release) {
  const section = release.split(/^SHA256:\n/m)[1].split(/^\S/m)[0]
  return section
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .map(([hash, size, path]) => ({ hash, size: Number(size), path }))
}

describe('apt-repo.sh', { skip }, () => {
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'apt-repo-test-'))
    gnupg = join(root, 'gnupg')
    mkdirSync(gnupg, { mode: 0o700 })
    const key = makeKey('Apt Repo Test <apt-repo-test@example.invalid>')
    keyFpr = key.fpr
    secretKey = key.secret
    otherSecretKey = makeKey('Other Test <other-test@example.invalid>').secret
    keyring = join(root, 'test-keyring.gpg')
    writeFileSync(keyring, execFileSync('gpg', ['--batch', '--homedir', gnupg, '--export', keyFpr]))
  })

  after(() => {
    spawnSync('gpgconf', ['--homedir', gnupg, '--kill', 'all'])
    rmSync(root, { recursive: true, force: true })
  })

  it('publishes a first version: installers, pool, signed indexes, key, update feed', () => {
    const target = join(root, 'first')
    publish(target, '0.11.0-dev.1')
    const all = files(target)
    for (const key of [
      'apt/key.gpg',
      'apt/key.asc',
      `${POOL}/uniwork-office_0.11.0-dev.1_amd64.deb`,
      'apt/dists/dev/main/binary-amd64/Packages',
      'apt/dists/dev/main/binary-amd64/Packages.gz',
      'apt/dists/dev/main/binary-amd64/Packages.xz',
      'apt/dists/dev/Release',
      'apt/dists/dev/Release.gpg',
      'apt/dists/dev/InRelease',
      'dev/0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_linux_x64.deb',
      'dev/0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_darwin_arm64.dmg',
      'dev/0.11.0-dev.1/SHA256SUMS-linux-x64.txt',
      'dev/0.11.0-dev.1/dev.yml',
      'dev/0.11.0-dev.1/SHA256SUMS',
      'update/dev/UniWork-Office_0.11.0-dev.1_unsigned_win32_x64-setup.exe',
      'update/dev/UniWork-Office_0.11.0-dev.1_unsigned_linux_x64.AppImage',
      'update/dev/dev.yml',
      'update/dev/dev-linux.yml',
    ]) {
      assert.ok(all.includes(key), `missing ${key}`)
    }
    assert.ok(!all.some((key) => key.startsWith('update/dev/') && key.endsWith('.dmg')))
    assert.ok(!all.some((key) => key.endsWith('.part')))

    const keyListing = execFileSync(
      'gpg',
      ['--batch', '--with-colons', '--show-keys', join(target, 'apt/key.gpg')],
      {
        encoding: 'utf8',
      },
    )
    assert.match(keyListing, new RegExp(`^fpr:+${keyFpr}:`, 'm'))
    assert.match(
      readFileSync(join(target, 'apt/key.asc'), 'utf8'),
      /^-----BEGIN PGP PUBLIC KEY BLOCK-----/,
    )
    assert.doesNotMatch(readFileSync(join(target, 'apt/key.asc'), 'utf8'), /PRIVATE/)

    const sums = readFileSync(join(target, 'dev/0.11.0-dev.1/SHA256SUMS'), 'utf8')
    const deb = 'UniWork-Office_0.11.0-dev.1_unsigned_linux_x64.deb'
    assert.match(
      sums,
      new RegExp(`^${sha256(join(target, 'dev/0.11.0-dev.1', deb))}  ${deb}$`, 'm'),
    )

    const packages = readFileSync(join(target, 'apt/dists/dev/main/binary-amd64/Packages'), 'utf8')
    assert.match(
      packages,
      new RegExp(
        `^Filename: pool/main/u/uniwork-office/uniwork-office_0.11.0-dev.1_amd64.deb$`,
        'm',
      ),
    )
    assert.match(
      packages,
      new RegExp(
        `^SHA256: ${sha256(join(target, POOL, 'uniwork-office_0.11.0-dev.1_amd64.deb'))}$`,
        'm',
      ),
    )
  })

  it('signs InRelease and Release.gpg with the key, and Release names the Packages files it ships', () => {
    const target = join(root, 'first')
    const dists = join(target, 'apt/dists/dev')
    execFileSync('gpgv', ['--keyring', keyring, join(dists, 'InRelease')], { stdio: 'pipe' })
    execFileSync(
      'gpgv',
      ['--keyring', keyring, join(dists, 'Release.gpg'), join(dists, 'Release')],
      {
        stdio: 'pipe',
      },
    )
    const release = readFileSync(join(dists, 'Release'), 'utf8')
    assert.match(release, /^Origin: UniWork$/m)
    assert.match(release, /^Label: UniWork Office$/m)
    assert.match(release, /^Suite: dev$/m)
    assert.match(release, /^Codename: dev$/m)
    assert.match(release, /^Architectures: amd64$/m)
    assert.match(release, /^Components: main$/m)
    assert.match(release, /^Acquire-By-Hash: yes$/m)
    assert.doesNotMatch(release, /^Valid-Until:/m)
    // apt fetches by-hash with the strongest hash listed; only by-hash/SHA256 exists
    assert.doesNotMatch(release, /^(MD5Sum|SHA1|SHA512):/m)
    assert.ok(readFileSync(join(dists, 'InRelease'), 'utf8').includes(release.trimEnd()))

    const entries = releaseSha256(release)
    assert.deepEqual(entries.map((entry) => entry.path).sort(), [
      'main/binary-amd64/Packages',
      'main/binary-amd64/Packages.gz',
      'main/binary-amd64/Packages.xz',
    ])
    for (const { hash, size, path } of entries) {
      assert.equal(sha256(join(dists, path)), hash, path)
      assert.equal(readFileSync(join(dists, path)).length, size, path)
      assert.equal(
        sha256(join(dists, 'main/binary-amd64/by-hash/SHA256', hash)),
        hash,
        `by-hash ${path}`,
      )
    }
  })

  it('adds a second version, newest first, and re-running a version changes nothing', () => {
    const target = join(root, 'first')
    const dir = makeRelease('0.11.0-dev.2', 'dev')
    publish(target, '0.11.0-dev.2', 'dev', [], dir)
    assert.deepEqual(versionsIn(target), ['0.11.0-dev.2', '0.11.0-dev.1'])
    const packages = readFileSync(join(target, 'apt/dists/dev/main/binary-amd64/Packages'), 'utf8')
    const before = files(target)

    // a re-run of the same build (same artifacts)
    publish(target, '0.11.0-dev.2', 'dev', [], dir)
    assert.deepEqual(versionsIn(target), ['0.11.0-dev.2', '0.11.0-dev.1'])
    assert.equal(
      readFileSync(join(target, 'apt/dists/dev/main/binary-amd64/Packages'), 'utf8'),
      packages,
    )
    // the re-run only ends the grace of what the run before named
    const now = files(target)
    assert.ok(now.every((key) => before.includes(key)))
    for (const key of before.filter((entry) => !now.includes(entry))) {
      assert.match(key, /\/by-hash\/SHA256\/|^update\/dev\/UniWork-Office_0\.11\.0-dev\.1_/)
    }
    execFileSync('gpgv', ['--keyring', keyring, join(target, 'apt/dists/dev/InRelease')], {
      stdio: 'pipe',
    })
  })

  it('keeps --keep versions and deletes pool files one run after they leave the index', () => {
    const target = join(root, 'keep')
    const dev1 = `${POOL}/uniwork-office_0.11.0-dev.1_amd64.deb`
    const dev2 = `${POOL}/uniwork-office_0.11.0-dev.2_amd64.deb`
    publish(target, '0.11.0-dev.1', 'dev', ['--keep', '2'])
    publish(target, '0.11.0-dev.2', 'dev', ['--keep', '2'])
    publish(target, '0.11.0-dev.10', 'dev', ['--keep', '2'])
    // dev.1 left the index in this run; the previous index still names it
    assert.deepEqual(versionsIn(target), ['0.11.0-dev.10', '0.11.0-dev.2'])
    let all = files(target)
    assert.ok(all.includes(dev1), 'grace: dev.1 stays one run')
    assert.ok(
      all.some((key) => key.startsWith('dev/0.11.0-dev.1/')),
      'grace: the previous manifest lists dev.1',
    )
    assert.deepEqual(manifestVersions(target), ['0.11.0-dev.10', '0.11.0-dev.2'])

    publish(target, '0.11.0-dev.11', 'dev', ['--keep', '2'])
    assert.deepEqual(versionsIn(target), ['0.11.0-dev.11', '0.11.0-dev.10'])
    all = files(target)
    assert.ok(!all.includes(dev1), 'dev.1 is gone after its grace run')
    assert.ok(
      !all.some((key) => key.startsWith('dev/0.11.0-dev.1/')),
      'installers beyond --keep are pruned',
    )
    assert.ok(
      all.some((key) => key.startsWith('dev/0.11.0-dev.2/')),
      'grace: dev.2 installers stay one run',
    )
    assert.ok(all.includes(dev2), 'grace: dev.2 stays one run')
    assert.ok(!all.includes('update/dev/UniWork-Office_0.11.0-dev.2_unsigned_win32_x64-setup.exe'))
    assert.ok(all.includes('update/dev/UniWork-Office_0.11.0-dev.10_unsigned_win32_x64-setup.exe'))

    // by-hash holds exactly the files of the current and the previous Release
    const byHash = all.filter((key) => key.includes('/by-hash/SHA256/'))
    assert.equal(byHash.length, 6)

    // another suite never prunes this one's pool files
    publish(target, '0.11.0-beta.1', 'beta', ['--keep', '2'])
    all = files(target)
    assert.ok(all.includes(`${POOL}/uniwork-office_0.11.0-dev.11_amd64.deb`))
    assert.ok(all.includes(`${POOL}/uniwork-office_0.11.0-dev.10_amd64.deb`))
    assert.deepEqual(versionsIn(target), ['0.11.0-dev.11', '0.11.0-dev.10'])
    assert.deepEqual(versionsIn(target, 'beta'), ['0.11.0-beta.1'])
    assert.deepEqual(manifestVersions(target), ['0.11.0-dev.11', '0.11.0-dev.10'])
    assert.deepEqual(manifestVersions(target, 'beta'), ['0.11.0-beta.1'])
  })

  it('writes releases.json: schema 1, newest first, other channels untouched', () => {
    const target = join(root, 'manifest')
    const dir = makeRelease('0.11.0-dev.1', 'dev')
    // a mac signing run drops the unsigned label from the dmg name
    renameSync(
      join(dir, 'UniWork-Office_0.11.0-dev.1_unsigned_darwin_arm64.dmg'),
      join(dir, 'UniWork-Office_0.11.0-dev.1_darwin_arm64.dmg'),
    )
    writeFileSync(join(dir, 'SHA256SUMS-darwin.txt'), 'sums\n')
    const notes = join(root, 'notes.md')
    writeFileSync(notes, 'Fixes **things** <script>alert(1)</script>\n')
    const result = run(
      ['--dir', dir, '--channel', 'dev', '--version', '0.11.0-dev.1', '--notes-file', notes],
      {
        target,
      },
    )
    assert.equal(result.status, 0, result.stderr)
    publish(target, '0.11.0-beta.1', 'beta')
    const beta = manifestOf(target).channels.beta
    publish(target, '0.11.0-dev.2')

    const manifest = manifestOf(target)
    assert.equal(manifest.schema, 1)
    assert.match(manifest.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    assert.equal(manifest.base_url, BASE)
    assert.deepEqual(Object.keys(manifest.channels).sort(), ['beta', 'dev'])
    assert.deepEqual(manifest.channels.beta, beta)
    const dev = manifest.channels.dev
    assert.equal(dev.latest, '0.11.0-dev.2')
    assert.equal(dev.apt_suite, 'dev')
    assert.deepEqual(manifestVersions(target), ['0.11.0-dev.2', '0.11.0-dev.1'])

    const [second, first] = dev.releases
    assert.equal(second.notes_markdown, null)
    assert.equal(first.notes_markdown, 'Fixes **things** <script>alert(1)</script>\n')
    assert.equal(first.channel, 'dev')
    assert.equal(first.tag, 'v0.11.0-dev.1')
    assert.equal(first.git_sha, GIT_SHA)
    assert.equal(first.notes_url, null)
    assert.match(first.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    assert.deepEqual(first.signed, { windows: false, macos: true, linux: false })
    assert.deepEqual(second.signed, { windows: false, macos: false, linux: false })
    assert.deepEqual(first.apt, {
      suite: 'dev',
      package: 'uniwork-office',
      version: '0.11.0-dev.1',
    })

    const rows = first.assets.map(
      ({ platform, arch, kind, signed }) => `${platform}/${arch}/${kind}/${signed}`,
    )
    assert.deepEqual(rows.sort(), [
      'all/all/checksums/false',
      'darwin/all/checksums/false',
      'darwin/arm64/dmg/true',
      'linux/x64/appimage/false',
      'linux/x64/checksums/false',
      'linux/x64/deb/false',
      'win32/x64/nsis/false',
    ])
    for (const asset of first.assets) {
      const key = `dev/0.11.0-dev.1/${asset.file}`
      assert.equal(asset.url, `${BASE}/${key}`)
      assert.equal(asset.sha256, sha256(join(target, key)), key)
      assert.equal(asset.size, readFileSync(join(target, key)).length, key)
    }
  })

  it('refuses a key with another fingerprint before uploading anything', () => {
    const target = join(root, 'wrong-key')
    const dir = makeRelease('0.11.0-dev.1', 'dev')
    const result = run(['--dir', dir, '--channel', 'dev', '--version', '0.11.0-dev.1'], {
      target,
      secret: otherSecretKey,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, new RegExp(`expected ${keyFpr}`))
    assert.deepEqual(files(target), [])
  })

  it('refuses the fingerprint override on GitHub Actions', () => {
    const target = join(root, 'actions')
    const dir = makeRelease('0.11.0-dev.1', 'dev')
    const result = run(['--dir', dir, '--channel', 'dev', '--version', '0.11.0-dev.1'], {
      target,
      extraEnv: { GITHUB_ACTIONS: 'true' },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /test hook/)
    assert.deepEqual(files(target), [])
  })

  it('refuses a deb whose version is not --version', () => {
    const target = join(root, 'mismatch')
    const dir = makeRelease('0.11.0-dev.1', 'dev')
    const result = run(['--dir', dir, '--channel', 'dev', '--version', '0.11.0-dev.2'], { target })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /expected 0\.11\.0-dev\.2/)
    assert.deepEqual(files(target), [])
  })

  it('prints the plan on --dry-run and writes nothing', () => {
    const target = join(root, 'first')
    const before = files(target)
    const dir = makeRelease('0.11.0-dev.3', 'dev')
    const result = run(
      ['--dir', dir, '--channel', 'dev', '--version', '0.11.0-dev.3', '--keep', '1', '--dry-run'],
      {
        target,
        secret: '',
        extraEnv: { APT_GPG_PASSPHRASE: '' },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.split('\n')
    const order = [
      'PUT dev/0.11.0-dev.3/SHA256SUMS (Cache-Control: no-cache)',
      `PUT ${POOL}/uniwork-office_0.11.0-dev.3_amd64.deb`,
      'PUT apt/dists/dev/main/binary-amd64/Packages (Cache-Control: no-cache)',
      'PUT apt/dists/dev/InRelease (Cache-Control: no-cache)',
      'PUT update/dev/dev-linux.yml (Cache-Control: no-cache)',
      'PUT releases.json (Cache-Control: no-cache) (Content-Type: application/json; charset=utf-8)',
    ].map((line) => lines.indexOf(line))
    assert.ok(
      order.every((index) => index >= 0),
      result.stdout,
    )
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    )
    // --keep 1, but the previous manifest still lists dev.1 and dev.2: one run of grace
    assert.ok(!lines.some((line) => line.startsWith('DELETE dev/')), result.stdout)
    assert.deepEqual(files(target), before)
  })

  it('never prints a secret', () => {
    const body = secretKey.split('\n').filter((line) => line.length >= 40)
    assert.ok(body.length > 0)
    for (const output of outputs) {
      assert.ok(!output.includes(PASSPHRASE), 'passphrase in the output')
      for (const line of body) assert.ok(!output.includes(line), 'private key text in the output')
    }
  })
})
