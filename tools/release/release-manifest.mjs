#!/usr/bin/env node
// Writes the public release manifest releases.json (schema 1) that
// tools/release/apt-repo.sh uploads to the download bucket root. The schema is
// a contract with the /apps/office versions page; see "Download server and
// apt repository" in tools/release/README.md. Dependency-free on purpose: the
// mirror job runs it without npm ci.
//
//   node tools/release/release-manifest.mjs update --previous <releases.json or ''> \
//     --dir <release files> --channel dev --version 0.11.0-dev.3 --tag v0.11.0-dev.3 \
//     --git-sha <40 hex> [--notes-file <markdown>] [--deb-version <v>] \
//     --keep-versions 0.11.0-dev.3,0.11.0-dev.2 [--base-url https://uniworkos.com/downloads/office]
//   node tools/release/release-manifest.mjs versions --previous <releases.json> --channel dev
//
// `update` prints the new manifest: only this channel's entry changes, its
// releases are the kept versions that have an entry (newest first, the
// order --keep-versions gives). `versions` prints the versions a manifest
// lists for a channel, one per line.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 1
export const CHANNELS = ['dev', 'beta', 'stable']
export const DEFAULT_BASE_URL = 'https://uniworkos.com/downloads/office'

/** Installer and checksum files by name ending; anything else is not an asset. */
const ASSET_KINDS = [
  { suffix: '_win32_x64-setup.exe', platform: 'win32', arch: 'x64', kind: 'nsis' },
  { suffix: '_darwin_arm64.dmg', platform: 'darwin', arch: 'arm64', kind: 'dmg' },
  { suffix: '_darwin_x64.dmg', platform: 'darwin', arch: 'x64', kind: 'dmg' },
  { suffix: '_linux_x64.deb', platform: 'linux', arch: 'x64', kind: 'deb' },
  { suffix: '_linux_x64.AppImage', platform: 'linux', arch: 'x64', kind: 'appimage' },
]
const CHECKSUM_KINDS = {
  'SHA256SUMS-win32-x64.txt': { platform: 'win32', arch: 'x64' },
  'SHA256SUMS-darwin.txt': { platform: 'darwin', arch: 'all' },
  'SHA256SUMS-linux-x64.txt': { platform: 'linux', arch: 'x64' },
  SHA256SUMS: { platform: 'all', arch: 'all' },
}
const SIGNED_KEY = { win32: 'windows', darwin: 'macos', linux: 'linux' }

/** The asset row fields a file name implies, or undefined when it is not an asset. */
export function assetKindOf(file) {
  const checksums = CHECKSUM_KINDS[file]
  if (checksums) return { ...checksums, kind: 'checksums', signed: false }
  const match = ASSET_KINDS.find((entry) => file.endsWith(entry.suffix))
  if (!match) return undefined
  return {
    platform: match.platform,
    arch: match.arch,
    kind: match.kind,
    signed: !file.includes('_unsigned_'),
  }
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** One `releases[]` entry for the files in `dir`. */
export function buildRelease({
  dir,
  channel,
  version,
  tag,
  gitSha,
  notes,
  debVersion,
  baseUrl,
  publishedAt,
}) {
  const assets = []
  for (const file of readdirSync(dir).sort()) {
    const path = join(dir, file)
    if (!statSync(path).isFile()) continue
    const kind = assetKindOf(file)
    if (!kind) continue
    assets.push({
      platform: kind.platform,
      arch: kind.arch,
      kind: kind.kind,
      file,
      url: `${baseUrl}/${channel}/${version}/${file}`,
      size: statSync(path).size,
      sha256: sha256Of(path),
      signed: kind.signed,
    })
  }
  const signed = { windows: false, macos: false, linux: false }
  for (const asset of assets) {
    if (asset.kind !== 'checksums' && asset.signed) signed[SIGNED_KEY[asset.platform]] = true
  }
  return {
    version,
    channel,
    tag,
    published_at: publishedAt,
    git_sha: gitSha,
    notes_markdown: notes,
    notes_url: null,
    signed,
    apt: debVersion ? { suite: channel, package: 'uniwork-office', version: debVersion } : null,
    assets,
  }
}

/** The manifest after publishing `release` on its channel; other channels stay as they are. */
export function updateManifest(previous, release, { keepVersions, baseUrl, now }) {
  const manifest =
    previous &&
    previous.schema === SCHEMA &&
    previous.channels &&
    typeof previous.channels === 'object'
      ? previous
      : { schema: SCHEMA, channels: {} }
  const channel = release.channel
  const old = manifest.channels[channel]?.releases ?? []
  const same = old.find((entry) => entry.version === release.version)
  // a re-run of the same version keeps its first publication time
  const current = same?.published_at ? { ...release, published_at: same.published_at } : release
  const byVersion = new Map(old.map((entry) => [entry.version, entry]))
  byVersion.set(current.version, current)
  const releases = keepVersions.map((version) => byVersion.get(version)).filter(Boolean)
  // the key order of the frozen schema 1 sample
  return {
    schema: SCHEMA,
    generated_at: now,
    base_url: baseUrl,
    channels: {
      ...manifest.channels,
      [channel]: { latest: releases[0].version, apt_suite: channel, releases },
    },
  }
}

function readJson(path) {
  if (!path || !existsSync(path) || statSync(path).size === 0) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function parseArguments(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]
    if (!name.startsWith('--') || i + 1 >= rest.length) throw new Error(`bad argument: ${name}`)
    options[name.slice(2)] = rest[i + 1]
  }
  if (!['update', 'versions'].includes(command))
    throw new Error('command must be update or versions')
  if (!CHANNELS.includes(options.channel))
    throw new Error(`--channel must be one of ${CHANNELS.join(', ')}`)
  if (command === 'update') {
    for (const name of ['dir', 'version', 'tag', 'git-sha', 'keep-versions']) {
      if (!options[name]) throw new Error(`--${name} is required`)
    }
    if (!/^[0-9a-f]{40}$/.test(options['git-sha']))
      throw new Error('--git-sha must be 40 hex characters')
    const baseUrl = options['base-url'] ?? DEFAULT_BASE_URL
    if (!/^https:\/\/[^/]+(\/[^?#]*[^/?#])?$/.test(baseUrl))
      throw new Error('--base-url must be https without a trailing /')
    options['base-url'] = baseUrl
  }
  return { command, options }
}

function main(argv) {
  const { command, options } = parseArguments(argv)
  const previous = readJson(options.previous)
  if (command === 'versions') {
    for (const entry of previous?.channels?.[options.channel]?.releases ?? [])
      console.log(entry.version)
    return
  }
  const now = isoSeconds(new Date())
  const notesFile = options['notes-file']
  const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : ''
  const release = buildRelease({
    dir: resolve(options.dir),
    channel: options.channel,
    version: options.version,
    tag: options.tag,
    gitSha: options['git-sha'],
    notes: notes.trim() ? notes : null,
    debVersion: options['deb-version'] || null,
    baseUrl: options['base-url'],
    publishedAt: now,
  })
  const keepVersions = options['keep-versions'].split(',').filter(Boolean)
  if (!keepVersions.includes(options.version))
    throw new Error('--keep-versions must include --version')
  const manifest = updateManifest(previous, release, {
    keepVersions,
    baseUrl: options['base-url'],
    now,
  })
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`release-manifest: ${error.message}`)
    process.exit(1)
  }
}
