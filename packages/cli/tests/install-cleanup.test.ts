import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_COMMAND, LEGACY_CLI_COMMANDS } from '../src/cli-command'
import {
  cleanupCliLinks,
  inspectCliLink,
  installCliLink,
  linkTarget,
  looksLikeAppLauncher,
} from '../src/install'
import { tempDir } from './helpers'

/** Names earlier versions linked the command under; `uniwork-office` is also the desktop program. */
const OLD_GENOFFICE = 'genoffice'
const OLD_UNIWORK = 'uniwork-office'
const NOTHING = { removed: [], migrated: [], relinked: [] }

/** A copy of the app: <root>/<where>/resources/cli/genoffice with its bundle beside it. */
function shipLauncher(root: string, where: string): string {
  const dir = join(root, where, 'resources', 'cli')
  mkdirSync(dir, { recursive: true })
  const launcher = join(dir, 'genoffice')
  writeFileSync(launcher, '#!/bin/sh\n')
  writeFileSync(join(dir, 'genoffice.cjs'), '')
  return launcher
}

/**
 * A deb/rpm layout: the app under opt/, /usr/bin/uniwork-office-cli -> its launcher,
 * /usr/bin/uniwork-office the desktop program.
 */
function packageRoot() {
  const root = tempDir()
  const launcher = shipLauncher(root, 'opt/UniWork Office')
  const usrBin = join(root, 'usr', 'bin')
  mkdirSync(usrBin, { recursive: true })
  const packageLauncher = join(usrBin, CLI_COMMAND)
  symlinkSync(launcher, packageLauncher)
  const gui = join(usrBin, 'uniwork-office')
  writeFileSync(gui, '#!/bin/sh\n')
  const userBin = join(root, 'home', '.local', 'bin')
  mkdirSync(userBin, { recursive: true })
  return { root, launcher, usrBin, packageLauncher, gui, userBin }
}

const gone = (path: string) => lstatSync(path, { throwIfNoEntry: false }) === undefined

describe('the command name', () => {
  it('is uniwork-office-cli on every OS and never the desktop program name', () => {
    expect(CLI_COMMAND).toBe('uniwork-office-cli')
    expect(CLI_COMMAND).not.toBe('uniwork-office')
    expect([...LEGACY_CLI_COMMANDS].sort()).toEqual([OLD_GENOFFICE, OLD_UNIWORK].sort())
  })
})

describe('linkTarget: the stable launcher on deb/rpm', () => {
  it('points at /usr/bin/uniwork-office-cli when the package link is the shipped file', () => {
    const p = packageRoot()
    expect(
      linkTarget(p.launcher, { platform: 'linux', env: {}, packageLauncher: p.packageLauncher }),
    ).toEqual({ launcher: p.packageLauncher })
  })

  it('keeps the shipped launcher for an AppImage run, a foreign package name, macOS and a tarball', () => {
    const p = packageRoot()
    const base = { packageLauncher: p.packageLauncher }
    expect(
      linkTarget(p.launcher, { ...base, platform: 'linux', env: { APPIMAGE: '/x.AppImage' } }),
    ).toEqual({ launcher: p.launcher })
    expect(linkTarget(p.launcher, { ...base, platform: 'darwin', env: {} })).toEqual({
      launcher: p.launcher,
    })
    // another copy of the app that is not the package's: the link goes to the launcher we run
    const tarball = shipLauncher(p.root, 'home/apps/UniWork Office')
    expect(linkTarget(tarball, { ...base, platform: 'linux', env: {} })).toEqual({
      launcher: tarball,
    })
    // a different program owning /usr/bin/uniwork-office-cli
    const other = tempDir()
    mkdirSync(join(other, 'bin'))
    writeFileSync(join(other, 'bin', CLI_COMMAND), 'other program')
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: join(other, 'bin', CLI_COMMAND),
      }),
    ).toEqual({ launcher: p.launcher })
    // no package link at all
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: join(other, 'absent'),
      }),
    ).toEqual({ launcher: p.launcher })
  })
})

describe('deb/rpm: the command has its own name, so the app does not skip the link', () => {
  it('reports the package link as ready when its dir is on the PATH, and makes no second link', () => {
    const p = packageRoot()
    const env = { HOME: join(p.root, 'home'), PATH: `${p.userBin}:${p.usrBin}` }
    const opts = {
      launcher: p.packageLauncher,
      platform: 'linux' as const,
      candidateDirs: [p.userBin],
      env,
    }
    const expected = { status: 'present', location: p.packageLauncher }
    expect(inspectCliLink(opts)).toEqual(expected)
    expect(installCliLink(opts)).toEqual(expected)
    expect(existsSync(join(p.userBin, CLI_COMMAND))).toBe(false)
  })

  it('links in a user dir ahead of /usr/bin on the PATH without touching the desktop program', () => {
    // nothing shadows the app any more: the link is named uniwork-office-cli, not uniwork-office
    const p = packageRoot()
    const env = { HOME: join(p.root, 'home'), PATH: `${p.userBin}:${p.usrBin}` }
    const opts = {
      launcher: p.launcher, // the package link is not what this run links to (e.g. not found)
      platform: 'linux' as const,
      candidateDirs: [p.userBin],
      env,
    }
    expect(inspectCliLink(opts)).toEqual({
      status: 'missing',
      location: join(p.userBin, CLI_COMMAND),
      manual: expect.stringContaining(CLI_COMMAND),
    })
    expect(installCliLink(opts)).toEqual({
      status: 'linked',
      location: join(p.userBin, CLI_COMMAND),
    })
    expect(readlinkSync(join(p.userBin, CLI_COMMAND))).toBe(p.launcher)
    expect(existsSync(join(p.userBin, 'uniwork-office'))).toBe(false)
    expect(lstatSync(p.gui).isSymbolicLink()).toBe(false)
  })

  it('falls back to a user link when the package link dir is not on the PATH', () => {
    const p = packageRoot()
    const env = { HOME: join(p.root, 'home'), PATH: p.userBin }
    const r = inspectCliLink({
      launcher: p.packageLauncher,
      platform: 'linux',
      candidateDirs: [p.userBin],
      env,
    })
    expect(r.status).toBe('missing')
    expect(r.location).toBe(join(p.userBin, CLI_COMMAND))
  })

  it('links normally for an AppImage or tarball user', () => {
    const plain = tempDir()
    const bin = join(plain, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(plain, 'app')
    expect(
      installCliLink({ launcher, platform: 'linux', candidateDirs: [bin], env: { PATH: bin } }),
    ).toEqual({ status: 'linked', location: join(bin, CLI_COMMAND) })
  })
})

describe('cleanupCliLinks: launch-time housekeeping (a)', () => {
  it('removes a link whose package or mount is gone, under every name we ever used', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(dir, 'app')
    symlinkSync('/nonexistent-opt/UniWork Office/resources/cli/genoffice', join(bin, OLD_GENOFFICE))
    symlinkSync('/nonexistent-opt/Dev/resources/cli/genoffice', join(bin, OLD_UNIWORK))
    symlinkSync('/nonexistent-tmp/.mount_UniWorxyz/resources/cli/genoffice', join(bin, CLI_COMMAND))
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report.removed.sort()).toEqual(
      [join(bin, CLI_COMMAND), join(bin, OLD_GENOFFICE), join(bin, OLD_UNIWORK)].sort(),
    )
    for (const name of [CLI_COMMAND, OLD_GENOFFICE, OLD_UNIWORK]) {
      expect(gone(join(bin, name)), name).toBe(true)
    }

    // the shapes the app installs are ours when dead; a vendor's, npm's or the GUI path is not
    expect(looksLikeAppLauncher('/usr/bin/uniwork-office-cli')).toBe(true)
    expect(looksLikeAppLauncher('/usr/bin/genoffice')).toBe(true)
    expect(looksLikeAppLauncher('/usr/bin/uniwork-office')).toBe(false)
    expect(looksLikeAppLauncher('/opt/UniWork Office/uniwork-office')).toBe(false)
    expect(looksLikeAppLauncher('/opt/vendor/cli/genoffice')).toBe(false)
    expect(looksLikeAppLauncher('/usr/lib/node_modules/genoffice/bin/genoffice.js')).toBe(false)
  })

  it('works from a temporary mount: dead links go, nothing is created or repointed', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const older = shipLauncher(dir, 'older')
    symlinkSync(older, join(bin, OLD_GENOFFICE))
    symlinkSync(older, join(bin, OLD_UNIWORK))
    symlinkSync('/gone/resources/cli/genoffice', join(bin, CLI_COMMAND))
    const report = cleanupCliLinks({ platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report).toEqual({ removed: [join(bin, CLI_COMMAND)], migrated: [], relinked: [] })
    expect(readlinkSync(join(bin, OLD_GENOFFICE))).toBe(older)
    expect(readlinkSync(join(bin, OLD_UNIWORK))).toBe(older)
  })

  it('migrates the old genoffice and uniwork-office command links to the new name', () => {
    for (const old of [OLD_GENOFFICE, OLD_UNIWORK]) {
      const dir = tempDir()
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      const launcher = shipLauncher(dir, 'app')
      symlinkSync(launcher, join(bin, old))
      const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
      expect(report, old).toEqual({ removed: [], migrated: [join(bin, old)], relinked: [] })
      expect(readlinkSync(join(bin, CLI_COMMAND)), old).toBe(launcher)
      expect(gone(join(bin, old)), old).toBe(true)
      // a second launch has nothing left to do
      expect(
        cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} }),
        old,
      ).toEqual(NOTHING)
    }
  })

  it('moves a link at a versioned path of this install to the stable package link', () => {
    // (b) for an existing link: the versioned /opt path becomes the package's stable link
    const p = packageRoot()
    const opts = {
      launcher: p.packageLauncher,
      platform: 'linux' as const,
      candidateDirs: [p.userBin],
      env: { PATH: p.userBin }, // the package link's dir is not on this PATH, so it is not "answering"
    }
    symlinkSync(p.launcher, join(p.userBin, CLI_COMMAND))
    expect(cleanupCliLinks(opts)).toEqual({
      removed: [],
      migrated: [],
      relinked: [join(p.userBin, CLI_COMMAND)],
    })
    expect(readlinkSync(join(p.userBin, CLI_COMMAND))).toBe(p.packageLauncher)
    // settled: the next launch has nothing to do
    expect(cleanupCliLinks(opts)).toEqual(NOTHING)

    for (const old of [OLD_GENOFFICE, OLD_UNIWORK]) {
      const legacy = packageRoot()
      symlinkSync(legacy.launcher, join(legacy.userBin, old))
      const late = cleanupCliLinks({
        launcher: legacy.packageLauncher,
        platform: 'linux',
        candidateDirs: [legacy.userBin],
        env: { PATH: legacy.userBin },
      })
      expect(late.migrated, old).toEqual([join(legacy.userBin, old)])
      expect(readlinkSync(join(legacy.userBin, CLI_COMMAND)), old).toBe(legacy.packageLauncher)
    }
  })

  it('leaves a live link into another install root alone, even one of this app in another place', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const old = shipLauncher(dir, 'old-install')
    const launcher = shipLauncher(dir, 'app')
    for (const name of [CLI_COMMAND, OLD_GENOFFICE, OLD_UNIWORK]) symlinkSync(old, join(bin, name))
    expect(cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })).toEqual(
      NOTHING,
    )
    for (const name of [CLI_COMMAND, OLD_GENOFFICE, OLD_UNIWORK]) {
      expect(readlinkSync(join(bin, name)), name).toBe(old)
    }
  })

  it('never takes a live launcher of the upstream app, which has the same layout (Linux and macOS)', () => {
    const dir = tempDir()
    const ours = shipLauncher(dir, 'opt/UniWork Office')
    const upstream = shipLauncher(dir, 'opt/Genoffice')
    const mac = join(
      dir,
      'Applications',
      'Genoffice.app',
      'Contents',
      'Resources',
      'cli',
      'genoffice',
    )
    mkdirSync(join(mac, '..'), { recursive: true })
    writeFileSync(mac, '#!/bin/sh\n')
    writeFileSync(join(mac, '..', 'genoffice.cjs'), '')
    const macOurs = join(
      dir,
      'Applications',
      'UniWork Office.app',
      'Contents',
      'Resources',
      'cli',
      'genoffice',
    )
    mkdirSync(join(macOurs, '..'), { recursive: true })
    writeFileSync(macOurs, '#!/bin/sh\n')
    writeFileSync(join(macOurs, '..', 'genoffice.cjs'), '')

    for (const [platform, theirs, launcher] of [
      ['linux', upstream, ours],
      ['darwin', mac, macOurs],
    ] as const) {
      const bin = join(dir, `bin-${platform}`)
      mkdirSync(bin)
      // the upstream app's own command, and names of ours that point at it
      for (const name of [CLI_COMMAND, OLD_GENOFFICE, OLD_UNIWORK]) {
        symlinkSync(theirs, join(bin, name))
      }
      const report = cleanupCliLinks({ launcher, platform, candidateDirs: [bin], env: {} })
      expect(report, platform).toEqual(NOTHING)
      for (const name of [CLI_COMMAND, OLD_GENOFFICE, OLD_UNIWORK]) {
        expect(readlinkSync(join(bin, name)), `${platform} ${name}`).toBe(theirs)
      }
    }
  })

  it('two installed channels do not repoint the shared link back and forth', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const stable = shipLauncher(dir, 'opt/UniWork Office')
    const dev = shipLauncher(dir, 'opt/UniWork Office Dev')
    const run = (launcher: string) =>
      cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    symlinkSync(stable, join(bin, CLI_COMMAND))
    for (const launcher of [dev, stable, dev, stable]) {
      expect(run(launcher)).toEqual(NOTHING)
      expect(readlinkSync(join(bin, CLI_COMMAND))).toBe(stable)
    }
  })

  it('never touches a link or file it did not create', () => {
    const dir = tempDir()
    const launcher = shipLauncher(dir, 'app')
    const dirs: string[] = []
    const names = [OLD_GENOFFICE, OLD_UNIWORK, CLI_COMMAND]
    const mk = (name: string, make: (bin: string) => void) => {
      const bin = join(dir, name)
      mkdirSync(bin)
      make(bin)
      dirs.push(bin)
    }
    // a regular file, npm's link (alive), another vendor's launcher (alive and dead), a relative foreign link
    mk('file', (b) => {
      for (const name of names) writeFileSync(join(b, name), 'someone else')
    })
    mk('npm', (b) => {
      const target = join(dir, 'lib', 'node_modules', 'genoffice', 'bin', 'genoffice.js')
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, '')
      for (const name of names) symlinkSync(target, join(b, name))
    })
    mk('vendor-alive', (b) => {
      const vendor = join(dir, 'opt', 'vendor', 'cli', 'genoffice')
      mkdirSync(join(vendor, '..'), { recursive: true })
      writeFileSync(vendor, '#!/bin/sh\n')
      for (const name of names) symlinkSync(vendor, join(b, name))
    })
    mk('vendor-dead', (b) => {
      symlinkSync(join(dir, 'gone', 'vendor', 'cli', 'genoffice'), join(b, OLD_GENOFFICE))
      symlinkSync(join(dir, 'gone', 'vendor', 'bin', 'uniwork-office'), join(b, OLD_UNIWORK))
      symlinkSync('/usr/lib/node_modules/genoffice/bin/genoffice.js', join(b, CLI_COMMAND))
    })
    const snapshot = () =>
      dirs.map((d) =>
        names.map((n) => {
          const st = lstatSync(join(d, n), { throwIfNoEntry: false })
          return st?.isSymbolicLink() ? readlinkSync(join(d, n)) : st ? 'file' : null
        }),
      )
    const before = snapshot()
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: dirs, env: {} })
    expect(report).toEqual(NOTHING)
    expect(snapshot()).toEqual(before)
  })

  it('never touches the desktop program or a link to it, live or dead', () => {
    // /usr/bin/uniwork-office is the app itself: not a launcher, so no name of ours claims it
    const p = packageRoot()
    const guiInOpt = join(p.root, 'opt', 'UniWork Office', 'uniwork-office')
    writeFileSync(guiInOpt, '#!/bin/sh\n')
    const bin = join(p.root, 'sweep', 'live')
    const deadBin = join(p.root, 'sweep', 'dead')
    const fileBin = join(p.root, 'sweep', 'file')
    for (const d of [bin, deadBin, fileBin]) mkdirSync(d, { recursive: true })
    symlinkSync(p.gui, join(bin, OLD_UNIWORK))
    symlinkSync(guiInOpt, join(bin, OLD_GENOFFICE))
    symlinkSync(join(p.root, 'removed', 'uniwork-office'), join(deadBin, OLD_UNIWORK))
    symlinkSync('/opt/UniWork Office/uniwork-office', join(deadBin, OLD_GENOFFICE))
    writeFileSync(join(fileBin, OLD_UNIWORK), '#!/bin/sh\n')
    for (const launcher of [p.packageLauncher, p.launcher, undefined]) {
      const report = cleanupCliLinks({
        ...(launcher ? { launcher } : {}),
        platform: 'linux',
        candidateDirs: [bin, deadBin, fileBin],
        env: { PATH: `${bin}:${p.usrBin}` },
      })
      expect(report, String(launcher)).toEqual(NOTHING)
    }
    expect(readlinkSync(join(bin, OLD_UNIWORK))).toBe(p.gui)
    expect(readlinkSync(join(bin, OLD_GENOFFICE))).toBe(guiInOpt)
    expect(lstatSync(join(deadBin, OLD_UNIWORK)).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(deadBin, OLD_GENOFFICE)).isSymbolicLink()).toBe(true)
    expect(lstatSync(join(fileBin, OLD_UNIWORK)).isFile()).toBe(true)
    expect(lstatSync(p.gui).isFile()).toBe(true)
  })

  it('leaves our old link alone when the new name is taken by another program', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(dir, 'app')
    symlinkSync(launcher, join(bin, OLD_GENOFFICE))
    symlinkSync(launcher, join(bin, OLD_UNIWORK))
    writeFileSync(join(bin, CLI_COMMAND), 'someone else')
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report).toEqual(NOTHING)
    expect(readlinkSync(join(bin, OLD_GENOFFICE))).toBe(launcher)
    expect(readlinkSync(join(bin, OLD_UNIWORK))).toBe(launcher)
    expect(lstatSync(join(bin, CLI_COMMAND)).isSymbolicLink()).toBe(false)
  })

  it('on deb/rpm drops old user links instead of migrating when /usr/bin/uniwork-office-cli answers', () => {
    const p = packageRoot()
    symlinkSync(p.launcher, join(p.userBin, OLD_GENOFFICE))
    symlinkSync(p.launcher, join(p.userBin, OLD_UNIWORK))
    symlinkSync(p.launcher, join(p.userBin, CLI_COMMAND))
    const report = cleanupCliLinks({
      launcher: p.packageLauncher,
      platform: 'linux',
      candidateDirs: [p.userBin],
      env: { PATH: `${p.userBin}:${p.usrBin}` },
    })
    expect(report.removed.sort()).toEqual(
      [OLD_GENOFFICE, OLD_UNIWORK, CLI_COMMAND].map((n) => join(p.userBin, n)).sort(),
    )
    expect(report.migrated).toEqual([])
    expect(report.relinked).toEqual([])
    expect(existsSync(join(p.userBin, CLI_COMMAND))).toBe(false)
    // the package's own link and the GUI are never in the swept dirs and stay
    expect(readlinkSync(p.packageLauncher)).toBe(p.launcher)
    expect(lstatSync(p.gui).isFile()).toBe(true)
  })

  it('keeps macOS naming and leaves Windows alone', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = join(dir, 'UniWork Office.app', 'Contents', 'Resources', 'cli', 'genoffice')
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '#!/bin/sh\n')
    writeFileSync(join(launcher, '..', 'genoffice.cjs'), '')
    symlinkSync(launcher, join(bin, OLD_GENOFFICE))
    symlinkSync(launcher, join(bin, OLD_UNIWORK))
    const win = cleanupCliLinks({ launcher, platform: 'win32', candidateDirs: [bin], env: {} })
    expect(win).toEqual(NOTHING)
    expect(readlinkSync(join(bin, OLD_GENOFFICE))).toBe(launcher)
    const mac = cleanupCliLinks({ launcher, platform: 'darwin', candidateDirs: [bin], env: {} })
    expect(mac.migrated.sort()).toEqual([join(bin, OLD_GENOFFICE), join(bin, OLD_UNIWORK)].sort())
    expect(readlinkSync(join(bin, CLI_COMMAND))).toBe(launcher)
  })

  it('leaves the Windows PATH flow as it was: the launcher folder, now answering to the command name', () => {
    const launcher = 'C:\\UniWork Office\\resources\\cli\\genoffice.cmd'
    const run = () => ({ ok: true, stdout: 'linked\n' })
    expect(installCliLink({ launcher, platform: 'win32', runPowerShell: run })).toEqual({
      status: 'linked',
      location: 'C:\\UniWork Office\\resources\\cli',
    })
  })
})
