import { readFileSync, statSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' } }))

import { isEphemeralInstall, launcherFilePath, writeLauncherFile } from '../src/main/cli-link'

describe('genoffice launcher file', () => {
  it('lives in the genoffice auth directory, overridable like auth.json', () => {
    expect(launcherFilePath({})).toBe(join(process.env.HOME ?? '', '.genoffice', 'launcher'))
    expect(launcherFilePath({ GENOFFICE_AUTH_DIR: '/tmp/x' })).toBe(join('/tmp/x', 'launcher'))
  })

  it('writes one line, creates the directory, and only rewrites on change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-launcher-'))
    const file = join(dir, 'nested', 'launcher')
    expect(writeLauncherFile(file, '/Applications/GenOffice.app/Contents/Resources/cli')).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe('/Applications/GenOffice.app/Contents/Resources/cli\n')
    const before = statSync(file).mtimeMs
    expect(writeLauncherFile(file, '/Applications/GenOffice.app/Contents/Resources/cli')).toBe(
      false,
    )
    expect(statSync(file).mtimeMs).toBe(before)
    expect(writeLauncherFile(file, 'C:\\Programs\\GenOffice\\resources\\genoffice')).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe('C:\\Programs\\GenOffice\\resources\\genoffice\n')
  })

  it('treats dmg and AppImage mounts as temporary', () => {
    expect(isEphemeralInstall('/Volumes/GenOffice/GenOffice.app/Contents/Resources', {})).toBe(true)
    expect(isEphemeralInstall('/tmp/.mount_GenOfxyz/resources', {})).toBe(true)
    expect(isEphemeralInstall('/opt/GenOffice/resources', { APPIMAGE: '/home/u/G.AppImage' })).toBe(
      true,
    )
    expect(isEphemeralInstall('/Applications/GenOffice.app/Contents/Resources', {})).toBe(false)
  })
})

describe('the command on the PATH: only on request', () => {
  // one name on every OS (the desktop program keeps `uniwork-office`)
  const typed = 'uniwork-office-cli'
  const installCliLink = vi.fn()
  const inspectCliLink = vi.fn()
  const cleanupCliLinks = vi.fn()

  async function load() {
    vi.resetModules()
    installCliLink.mockReset()
    inspectCliLink.mockReset()
    cleanupCliLinks.mockReset()
    cleanupCliLinks.mockReturnValue({ removed: [], migrated: [], relinked: [] })
    vi.doMock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.2.3' } }))
    vi.doMock('@genoffice/cli/install', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@genoffice/cli/install')>()),
      installCliLink,
      inspectCliLink,
      cleanupCliLinks,
    }))
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-cli-req-'))
    process.env.GENOFFICE_AUTH_DIR = join(dir, 'auth')
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/UniWork Office.app/Contents/Resources',
      configurable: true,
    })
    return { dir, mod: await import('../src/main/cli-link') }
  }

  it('a launch records the launcher folder but never creates the link', async () => {
    const { dir, mod } = await load()
    mod.recordCliLauncher()
    expect(installCliLink).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, 'auth', 'launcher'), 'utf-8')).toBe(
      `${join('/Applications/UniWork Office.app/Contents/Resources', 'cli')}\n`,
    )
  })

  it('the status read never writes a link either', async () => {
    const { mod } = await load()
    inspectCliLink.mockReturnValue({
      status: 'missing',
      location: '/usr/local/bin/uniwork-office-cli',
    })
    expect(mod.cliLinkStatus()).toEqual({
      state: 'absent',
      command: typed,
      location: '/usr/local/bin/uniwork-office-cli',
    })
    expect(installCliLink).not.toHaveBeenCalled()
  })

  it('the Settings request creates the link and reports where', async () => {
    const { dir, mod } = await load()
    installCliLink.mockReturnValue({
      status: 'linked',
      location: '/opt/homebrew/bin/uniwork-office-cli',
    })
    const state = mod.installCliLinkOnRequest(join(dir, 'app-settings.json'))
    expect(installCliLink).toHaveBeenCalledTimes(1)
    expect(state).toEqual({
      state: 'present',
      command: typed,
      location: '/opt/homebrew/bin/uniwork-office-cli',
    })
    expect(JSON.parse(readFileSync(join(dir, 'app-settings.json'), 'utf-8')).cliLink).toMatchObject(
      {
        status: 'linked',
        location: '/opt/homebrew/bin/uniwork-office-cli',
      },
    )
  })

  it('maps blocked outcomes to the manual command', async () => {
    const { mod } = await load()
    expect(
      mod.toCliLinkState({
        status: 'unwritable',
        location: '/usr/local/bin/uniwork-office-cli',
        manual: 'sudo ln -s a b',
      }),
    ).toEqual({
      state: 'blocked',
      command: 'uniwork-office-cli',
      location: '/usr/local/bin/uniwork-office-cli',
      manual: 'sudo ln -s a b',
    })
    expect(mod.toCliLinkState({ status: 'occupied' }).state).toBe('blocked')
    expect(mod.toCliLinkState({ status: 'unsupported' }).state).toBe('unsupported')
  })

  it('names the same command on every OS, including Windows and deb/rpm', async () => {
    const { mod } = await load()
    for (const location of ['/usr/bin/uniwork-office-cli', 'C:\\app\\cli', '/a']) {
      expect(mod.toCliLinkState({ status: 'present', location })).toEqual({
        state: 'present',
        command: 'uniwork-office-cli',
        location,
      })
    }
  })
})

describe('launch-time cleanup of the links an earlier run created', () => {
  async function load(opts: { packaged: boolean; appImage?: boolean }) {
    vi.resetModules()
    const cleanupCliLinks = vi.fn(() => ({
      removed: ['/home/u/.local/bin/genoffice'],
      migrated: [],
      relinked: [],
    }))
    vi.doMock('electron', () => ({
      app: { isPackaged: opts.packaged, getVersion: () => '1.2.3' },
    }))
    vi.doMock('@genoffice/cli/install', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@genoffice/cli/install')>()),
      cleanupCliLinks,
    }))
    if (opts.appImage) process.env.APPIMAGE = '/home/u/UniWork-Office.AppImage'
    else delete process.env.APPIMAGE
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/UniWork Office/resources',
      configurable: true,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    return { cleanupCliLinks, log, mod: await import('../src/main/cli-link') }
  }

  it('sweeps with the shipped launcher from a permanent install, and logs what it removed', async () => {
    const { cleanupCliLinks, log, mod } = await load({ packaged: true })
    mod.healCliLinks()
    expect(cleanupCliLinks).toHaveBeenCalledTimes(1)
    const [opts] = cleanupCliLinks.mock.calls[0] as unknown as [{ launcher?: string }]
    expect(opts.launcher).toContain('genoffice')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('/home/u/.local/bin/genoffice'))
  })

  it('from an AppImage only removes dead links: no launcher is offered, so nothing is created', async () => {
    const { cleanupCliLinks, mod } = await load({ packaged: true, appImage: true })
    mod.healCliLinks()
    expect(cleanupCliLinks).toHaveBeenCalledWith({})
    delete process.env.APPIMAGE
  })

  it('does nothing in a dev run', async () => {
    const { cleanupCliLinks, mod } = await load({ packaged: false })
    mod.healCliLinks()
    expect(cleanupCliLinks).not.toHaveBeenCalled()
  })
})
