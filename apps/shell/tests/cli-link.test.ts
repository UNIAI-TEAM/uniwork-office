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

describe('genoffice command on the PATH: only on request', () => {
  const installCliLink = vi.fn()
  const inspectCliLink = vi.fn()

  async function load() {
    vi.resetModules()
    installCliLink.mockReset()
    inspectCliLink.mockReset()
    vi.doMock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.2.3' } }))
    vi.doMock('@genoffice/cli/install', () => ({ installCliLink, inspectCliLink }))
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
    inspectCliLink.mockReturnValue({ status: 'missing', location: '/usr/local/bin/genoffice' })
    expect(mod.cliLinkStatus()).toEqual({
      state: 'absent',
      location: '/usr/local/bin/genoffice',
    })
    expect(installCliLink).not.toHaveBeenCalled()
  })

  it('the Settings request creates the link and reports where', async () => {
    const { dir, mod } = await load()
    installCliLink.mockReturnValue({ status: 'linked', location: '/opt/homebrew/bin/genoffice' })
    const state = mod.installCliLinkOnRequest(join(dir, 'app-settings.json'))
    expect(installCliLink).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ state: 'present', location: '/opt/homebrew/bin/genoffice' })
    expect(JSON.parse(readFileSync(join(dir, 'app-settings.json'), 'utf-8')).cliLink).toMatchObject(
      {
        status: 'linked',
        location: '/opt/homebrew/bin/genoffice',
      },
    )
  })

  it('maps blocked outcomes to the manual command', async () => {
    const { mod } = await load()
    expect(
      mod.toCliLinkState({
        status: 'unwritable',
        location: '/usr/local/bin/genoffice',
        manual: 'sudo ln -s a b',
      }),
    ).toEqual({ state: 'blocked', location: '/usr/local/bin/genoffice', manual: 'sudo ln -s a b' })
    expect(mod.toCliLinkState({ status: 'occupied' }).state).toBe('blocked')
    expect(mod.toCliLinkState({ status: 'unsupported' }).state).toBe('unsupported')
  })
})
