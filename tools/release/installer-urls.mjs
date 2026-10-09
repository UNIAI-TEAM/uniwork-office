#!/usr/bin/env node
// Builds the OFFICE_INSTALLER_<CHANNEL>_URLS value the UniWork server reads: a
// compact JSON map {"<platform>": "<https url>"} for one release channel.
//
//   node tools/release/installer-urls.mjs --channel dev \
//     --base-url https://github.com/<owner>/<repo>/releases/download/<tag> \
//     --dir <directory holding the installers>     # or --files a.exe,b.dmg
//
// The platform keys, their order and the file extension per key mirror the
// server's installer contract. Only dev and beta exist (stable waits for signed
// builds). An installer-shaped file without the `unsigned` label, or one that
// carries another channel's version, is refused rather than skipped, so a beta
// asset can never end up in the dev variable. Anything else in the directory
// (checksums, mac zips, url files) is ignored. See tools/release/README.md.
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Same keys, same order as the server's installer platform list. */
export const INSTALLER_PLATFORMS = [
  'win32-x64',
  'win32-x64-zip',
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-deb',
  'linux-x64-appimage',
]
export const INSTALLER_CHANNELS = ['dev', 'beta']

/** The file-name ending per platform key (the release artifact names end this way). */
export const PLATFORM_SUFFIX = {
  'win32-x64': '_win32_x64-setup.exe',
  'win32-x64-zip': '_win32_x64.zip',
  'darwin-arm64': '_darwin_arm64.dmg',
  'darwin-x64': '_darwin_x64.dmg',
  'linux-x64-deb': '_linux_x64.deb',
  'linux-x64-appimage': '_linux_x64.AppImage',
}

// The server takes the version from `_<semver>_` in the basename.
const VERSION = /_([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)_/
// Characters a release host serves verbatim and the server's filename check accepts.
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertChannel(channel) {
  if (!INSTALLER_CHANNELS.includes(channel)) {
    throw new Error(`channel must be one of ${INSTALLER_CHANNELS.join(', ')}, got: ${channel}`)
  }
}

/**
 * The platform key of an installer file for `channel`, or undefined when the
 * file is not an installer. Throws for an installer that is unsigned-unlabelled,
 * of another channel, or has a name the server would not accept.
 */
export function installerPlatformOf(fileName, channel) {
  assertChannel(channel)
  const platform = INSTALLER_PLATFORMS.find((key) => fileName.endsWith(PLATFORM_SUFFIX[key]))
  if (!platform) return undefined
  if (!SAFE_FILE_NAME.test(fileName)) throw new Error(`unsafe installer file name: ${fileName}`)
  if (!fileName.includes('_unsigned_')) {
    throw new Error(`${fileName} has no "unsigned" label (signed builds are not released yet)`)
  }
  const version = VERSION.exec(fileName)?.[1]
  if (!version) throw new Error(`${fileName} carries no _<version>_`)
  const fileChannel = /-([A-Za-z]+)\.[0-9]+$/.exec(version)?.[1]
  if (fileChannel !== channel) {
    throw new Error(`${fileName} is not a ${channel} build (version ${version})`)
  }
  return platform
}

/** `{platform: url}` for one channel, in contract order. */
export function buildInstallerUrls({ channel, baseUrl, files }) {
  assertChannel(channel)
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new Error(`base URL must be absolute, got: ${baseUrl}`)
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('base URL must be https without credentials, query or fragment')
  }
  const prefix = base.href.replace(/\/+$/, '')
  const urls = {}
  const versions = new Set()
  for (const file of files) {
    const platform = installerPlatformOf(file, channel)
    if (!platform) continue
    if (urls[platform]) {
      throw new Error(
        `two ${channel} installers for ${platform}: ${urls[platform].split('/').pop()} and ${file}`,
      )
    }
    urls[platform] = `${prefix}/${file}`
    versions.add(VERSION.exec(file)[1])
  }
  if (Object.keys(urls).length === 0) {
    throw new Error(`no unsigned ${channel} installer among ${files.length} file(s)`)
  }
  if (versions.size > 1) {
    throw new Error(`installers of different versions: ${[...versions].join(', ')}`)
  }
  return Object.fromEntries(
    INSTALLER_PLATFORMS.filter((key) => urls[key]).map((key) => [key, urls[key]]),
  )
}

export function parseArguments(argv) {
  const options = {}
  const names = {
    '--channel': 'channel',
    '--base-url': 'baseUrl',
    '--dir': 'dir',
    '--files': 'files',
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]]
    if (!key) throw new Error(`unknown argument: ${argv[index]}`)
    if (argv[index + 1] === undefined) throw new Error(`${argv[index]} needs a value`)
    options[key] = argv[index + 1]
  }
  if (!options.channel || !options.baseUrl || !options.dir === !options.files) {
    throw new Error(
      'usage: installer-urls.mjs --channel dev|beta --base-url <https base> (--dir <directory> | --files a,b)',
    )
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const files = options.files
      ? options.files
          .split(',')
          .map((file) => file.trim())
          .filter(Boolean)
      : readdirSync(resolve(options.dir)).filter((name) =>
          statSync(join(resolve(options.dir), name)).isFile(),
        )
    const urls = buildInstallerUrls({ channel: options.channel, baseUrl: options.baseUrl, files })
    process.stdout.write(`${JSON.stringify(urls)}\n`)
  } catch (error) {
    process.stderr.write(`installer-urls: ${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
