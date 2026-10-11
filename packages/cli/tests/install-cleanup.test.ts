import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLI_COMMAND,
  cleanupCliLinks,
  commandName,
  inspectCliLink,
  installCliLink,
  linkTarget,
  looksLikeAppLauncher,
  shadowsGui,
} from '../src/install'
import { tempDir } from './helpers'

const LEGACY = 'genoffice'

/** A copy of the app: <root>/<where>/resources/cli/genoffice with its bundle beside it. */
function shipLauncher(root: string, where: string): string {
  const dir = join(root, where, 'resources', 'cli')
  mkdirSync(dir, { recursive: true })
  const launcher = join(dir, 'genoffice')
  writeFileSync(launcher, '#!/bin/sh\n')
  writeFileSync(join(dir, 'genoffice.cjs'), '')
  return launcher
}

/** A deb/rpm layout: the app under opt/, /usr/bin/genoffice -> its launcher, /usr/bin/uniwork-office the GUI. */
function packageRoot() {
  const root = tempDir()
  const launcher = shipLauncher(root, 'opt/UniWork Office')
  const usrBin = join(root, 'usr', 'bin')
  mkdirSync(usrBin, { recursive: true })
  const packageLauncher = join(usrBin, 'genoffice')
  symlinkSync(launcher, packageLauncher)
  const gui = join(usrBin, 'uniwork-office')
  writeFileSync(gui, '#!/bin/sh\n')
  const userBin = join(root, 'home', '.local', 'bin')
  mkdirSync(userBin, { recursive: true })
  return { root, launcher, usrBin, packageLauncher, gui, userBin }
}

describe('linkTarget: the stable launcher on deb/rpm', () => {
  it('points at /usr/bin/genoffice when the package launcher is the shipped file, and names the GUI', () => {
    const p = packageRoot()
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: p.packageLauncher,
        packageGui: p.gui,
      }),
    ).toEqual({ launcher: p.packageLauncher, guiExecutable: p.gui })
    const noGui = join(p.root, 'no-gui')
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: p.packageLauncher,
        packageGui: noGui,
      }),
    ).toEqual({ launcher: p.packageLauncher })
  })

  it('keeps the shipped launcher for an AppImage run, a foreign /usr/bin/genoffice, macOS and a tarball', () => {
    const p = packageRoot()
    const base = { packageLauncher: p.packageLauncher, packageGui: p.gui }
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
    // a different program owning /usr/bin/genoffice
    const other = tempDir()
    mkdirSync(join(other, 'bin'))
    writeFileSync(join(other, 'bin', 'genoffice'), 'other program')
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: join(other, 'bin', 'genoffice'),
        packageGui: p.gui,
      }),
    ).toEqual({ launcher: p.launcher })
    // no package launcher at all
    expect(
      linkTarget(p.launcher, {
        platform: 'linux',
        env: {},
        packageLauncher: join(other, 'absent'),
        packageGui: p.gui,
      }),
    ).toEqual({ launcher: p.launcher })
  })
})

describe('the command must not shadow the app (deb/rpm)', () => {
  it('a dir counts as shadowing unless it comes strictly after the GUI dir on the PATH', () => {
    const env = { PATH: '/home/u/.local/bin:/usr/local/bin:/usr/bin:/opt/late/' }
    const gui = '/usr/bin/uniwork-office'
    expect(shadowsGui('/home/u/.local/bin', gui, env)).toBe(true)
    expect(shadowsGui('/usr/local/bin', gui, env)).toBe(true)
    expect(shadowsGui('/usr/bin', gui, env)).toBe(true)
    expect(shadowsGui('/opt/late', gui, env)).toBe(false)
    // off the PATH: the hint we print would put it in front
    expect(shadowsGui('/home/u/bin', gui, env)).toBe(true)
    // nothing to shadow: no GUI executable (every other platform), or the GUI is not reachable by name
    expect(shadowsGui('/usr/local/bin', undefined, env)).toBe(false)
    expect(shadowsGui('/usr/local/bin', gui, { PATH: '/usr/local/bin:/bin' })).toBe(false)
  })

  it('creates no user link before /usr/bin and reports the package launcher as the ready command', () => {
    const p = packageRoot()
    const env = { HOME: join(p.root, 'home'), PATH: `${p.userBin}:${p.usrBin}` }
    const opts = {
      launcher: p.packageLauncher,
      guiExecutable: p.gui,
      platform: 'linux' as const,
      candidateDirs: [p.userBin],
      env,
    }
    const expected = { status: 'present', location: p.packageLauncher, command: 'genoffice' }
    expect(inspectCliLink(opts)).toEqual(expected)
    expect(installCliLink(opts)).toEqual(expected)
    expect(existsSync(join(p.userBin, CLI_COMMAND))).toBe(false)
    expect(commandName(expected, 'linux')).toBe('genoffice')
  })

  it('links a dir that comes after the GUI dir, and links normally when there is no GUI to shadow', () => {
    const p = packageRoot()
    const late = join(p.root, 'late-bin')
    mkdirSync(late)
    const env = { HOME: join(p.root, 'home'), PATH: `${p.usrBin}:${late}` }
    expect(
      installCliLink({
        launcher: p.packageLauncher,
        guiExecutable: p.gui,
        platform: 'linux',
        candidateDirs: [p.userBin, late],
        env,
      }),
    ).toEqual({ status: 'linked', location: join(late, CLI_COMMAND) })
    expect(readlinkSync(join(late, CLI_COMMAND))).toBe(p.packageLauncher)
    expect(existsSync(join(p.userBin, CLI_COMMAND))).toBe(false)

    // an AppImage or tarball user has no /usr/bin/uniwork-office: the user dir is fine, as before
    const plain = tempDir()
    const bin = join(plain, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(plain, 'app')
    expect(
      installCliLink({ launcher, platform: 'linux', candidateDirs: [bin], env: { PATH: bin } }),
    ).toEqual({ status: 'linked', location: join(bin, CLI_COMMAND) })
  })

  it('falls back to the usual outcome when the package launcher is not on the PATH', () => {
    const p = packageRoot()
    const env = { HOME: join(p.root, 'home'), PATH: p.userBin }
    const r = inspectCliLink({
      launcher: p.packageLauncher,
      guiExecutable: p.gui,
      platform: 'linux',
      candidateDirs: [p.userBin],
      env,
    })
    // the GUI dir is not on the PATH either, so nothing shadows and the user dir takes the link
    expect(r.status).toBe('missing')
    expect(r.command).toBeUndefined()
  })
})

describe('cleanupCliLinks: launch-time housekeeping (a)', () => {
  it('removes a link whose package or mount is gone, in both command names', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(dir, 'app')
    symlinkSync('/nonexistent-opt/UniWork Office/resources/cli/genoffice', join(bin, LEGACY))
    symlinkSync('/nonexistent-tmp/.mount_UniWorxyz/resources/cli/genoffice', join(bin, CLI_COMMAND))
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report.removed.sort()).toEqual([join(bin, CLI_COMMAND), join(bin, LEGACY)].sort())
    expect(lstatSync(join(bin, CLI_COMMAND), { throwIfNoEntry: false })).toBeUndefined()
    expect(lstatSync(join(bin, LEGACY), { throwIfNoEntry: false })).toBeUndefined()

    // the shapes the app installs are ours when dead; a vendor's or npm's path is not
    expect(looksLikeAppLauncher('/usr/bin/genoffice')).toBe(true)
    expect(looksLikeAppLauncher('/opt/vendor/cli/genoffice')).toBe(false)
    expect(looksLikeAppLauncher('/usr/lib/node_modules/genoffice/bin/genoffice.js')).toBe(false)
  })

  it('works from a temporary mount: dead links go, nothing is created or repointed', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const older = shipLauncher(dir, 'older')
    symlinkSync(older, join(bin, LEGACY))
    symlinkSync('/gone/resources/cli/genoffice', join(bin, CLI_COMMAND))
    const report = cleanupCliLinks({ platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report).toEqual({ removed: [join(bin, CLI_COMMAND)], migrated: [], relinked: [] })
    expect(readlinkSync(join(bin, LEGACY))).toBe(older)
  })

  it('migrates the pre-rename genoffice link to the new name at the current launcher', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(dir, 'app')
    symlinkSync(launcher, join(bin, LEGACY))
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report).toEqual({ removed: [], migrated: [join(bin, LEGACY)], relinked: [] })
    expect(readlinkSync(join(bin, CLI_COMMAND))).toBe(launcher)
    expect(lstatSync(join(bin, LEGACY), { throwIfNoEntry: false })).toBeUndefined()
    // a second launch has nothing left to do
    expect(cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })).toEqual(
      { removed: [], migrated: [], relinked: [] },
    )
  })

  it('moves a link at an old install to the current launcher, and a versioned path to the stable one', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const old = shipLauncher(dir, 'old-install')
    const launcher = shipLauncher(dir, 'app')
    symlinkSync(old, join(bin, CLI_COMMAND))
    symlinkSync(old, join(bin, LEGACY))
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report.relinked).toEqual([join(bin, CLI_COMMAND)])
    expect(report.migrated).toEqual([join(bin, LEGACY)])
    expect(readlinkSync(join(bin, CLI_COMMAND))).toBe(launcher)
    expect(existsSync(join(bin, LEGACY))).toBe(false)

    // (b) for an existing link: the versioned /opt path becomes the package's stable launcher
    const p = packageRoot()
    symlinkSync(p.launcher, join(p.userBin, LEGACY))
    const late = cleanupCliLinks({
      launcher: p.packageLauncher,
      platform: 'linux',
      candidateDirs: [p.userBin],
      env: { PATH: p.userBin },
    })
    expect(late.migrated).toEqual([join(p.userBin, LEGACY)])
    expect(readlinkSync(join(p.userBin, CLI_COMMAND))).toBe(p.packageLauncher)
  })

  it('never touches a link or file it did not create', () => {
    const dir = tempDir()
    const launcher = shipLauncher(dir, 'app')
    const dirs: string[] = []
    const mk = (name: string, make: (bin: string) => void) => {
      const bin = join(dir, name)
      mkdirSync(bin)
      make(bin)
      dirs.push(bin)
    }
    // a regular file, npm's link (alive), another vendor's launcher (alive and dead), a relative foreign link
    mk('file', (b) => writeFileSync(join(b, LEGACY), 'someone else'))
    mk('npm', (b) => {
      const target = join(dir, 'lib', 'node_modules', 'genoffice', 'bin', 'genoffice.js')
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, '')
      symlinkSync(target, join(b, LEGACY))
      symlinkSync(target, join(b, CLI_COMMAND))
    })
    mk('vendor-alive', (b) => {
      const vendor = join(dir, 'opt', 'vendor', 'cli', 'genoffice')
      mkdirSync(join(vendor, '..'), { recursive: true })
      writeFileSync(vendor, '#!/bin/sh\n')
      symlinkSync(vendor, join(b, LEGACY))
    })
    mk('vendor-dead', (b) => {
      symlinkSync(join(dir, 'gone', 'vendor', 'cli', 'genoffice'), join(b, LEGACY))
      symlinkSync('/usr/lib/node_modules/genoffice/bin/genoffice.js', join(b, CLI_COMMAND))
    })
    const before = dirs.map((d) =>
      [LEGACY, CLI_COMMAND].map((n) => {
        const st = lstatSync(join(d, n), { throwIfNoEntry: false })
        return st?.isSymbolicLink() ? readlinkSync(join(d, n)) : st ? 'file' : null
      }),
    )
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: dirs, env: {} })
    expect(report).toEqual({ removed: [], migrated: [], relinked: [] })
    const after = dirs.map((d) =>
      [LEGACY, CLI_COMMAND].map((n) => {
        const st = lstatSync(join(d, n), { throwIfNoEntry: false })
        return st?.isSymbolicLink() ? readlinkSync(join(d, n)) : st ? 'file' : null
      }),
    )
    expect(after).toEqual(before)
  })

  it('leaves our legacy link alone when the new name is taken by another program', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = shipLauncher(dir, 'app')
    symlinkSync(launcher, join(bin, LEGACY))
    writeFileSync(join(bin, CLI_COMMAND), 'someone else')
    const report = cleanupCliLinks({ launcher, platform: 'linux', candidateDirs: [bin], env: {} })
    expect(report).toEqual({ removed: [], migrated: [], relinked: [] })
    expect(readlinkSync(join(bin, LEGACY))).toBe(launcher)
    expect(lstatSync(join(bin, CLI_COMMAND)).isSymbolicLink()).toBe(false)
  })

  it('on deb/rpm drops a legacy user link instead of shadowing the app, since /usr/bin/genoffice answers', () => {
    const p = packageRoot()
    symlinkSync(p.launcher, join(p.userBin, LEGACY))
    const report = cleanupCliLinks({
      launcher: p.packageLauncher,
      guiExecutable: p.gui,
      platform: 'linux',
      candidateDirs: [p.userBin],
      env: { PATH: `${p.userBin}:${p.usrBin}` },
    })
    expect(report).toEqual({ removed: [join(p.userBin, LEGACY)], migrated: [], relinked: [] })
    expect(existsSync(join(p.userBin, CLI_COMMAND))).toBe(false)
    // the package's own launcher is never in the swept dirs and stays
    expect(readlinkSync(p.packageLauncher)).toBe(p.launcher)
  })

  it('keeps macOS naming and leaves Windows alone', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = join(dir, 'UniWork Office.app', 'Contents', 'Resources', 'cli', 'genoffice')
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '#!/bin/sh\n')
    writeFileSync(join(launcher, '..', 'genoffice.cjs'), '')
    symlinkSync(launcher, join(bin, LEGACY))
    const win = cleanupCliLinks({ launcher, platform: 'win32', candidateDirs: [bin], env: {} })
    expect(win).toEqual({ removed: [], migrated: [], relinked: [] })
    expect(readlinkSync(join(bin, LEGACY))).toBe(launcher)
    const mac = cleanupCliLinks({ launcher, platform: 'darwin', candidateDirs: [bin], env: {} })
    expect(mac.migrated).toEqual([join(bin, LEGACY)])
    expect(readlinkSync(join(bin, CLI_COMMAND))).toBe(launcher)
    // macOS never reports a package command: the typed name is the command
    expect(commandName({}, 'darwin')).toBe(CLI_COMMAND)
  })

  it('leaves the Windows PATH flow and its command name as they were', () => {
    expect(commandName({}, 'win32')).toBe('genoffice')
    expect(commandName({}, 'linux')).toBe(CLI_COMMAND)
    const launcher = 'C:\\UniWork Office\\resources\\cli\\genoffice.cmd'
    const run = () => ({ ok: true, stdout: 'linked\n' })
    expect(installCliLink({ launcher, platform: 'win32', runPowerShell: run })).toEqual({
      status: 'linked',
      location: 'C:\\UniWork Office\\resources\\cli',
    })
  })
})
