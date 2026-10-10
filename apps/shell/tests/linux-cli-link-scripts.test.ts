import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUILD = join(__dirname, '..', 'build')

/**
 * The scripts are electron-builder templates over the package paths (/opt/<product>, /usr/bin).
 * A copy with the macros filled in as packaging does and the two roots swapped runs against a temp
 * tree; the system tools they call (update-alternatives, the desktop / mime caches, AppArmor) are
 * stubs on PATH that log their arguments, so nothing outside the tree is touched. The install dir
 * has a space, so every use must stay quoted.
 */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'uniwork-postinst-'))
  const opt = join(root, 'opt', 'UniWork Office')
  const bin = join(root, 'usr', 'bin')
  const stubs = join(root, 'stubs')
  const calls = join(root, 'calls.log')
  mkdirSync(join(opt, 'resources', 'cli'), { recursive: true })
  mkdirSync(bin, { recursive: true })
  mkdirSync(stubs)
  const launcher = join(opt, 'resources', 'cli', 'genoffice')
  writeFileSync(launcher, '#!/bin/sh\n')
  chmodSync(launcher, 0o755)
  writeFileSync(join(opt, 'uniwork-office'), '#!/bin/sh\n')
  writeFileSync(join(opt, 'chrome-sandbox'), '')
  // update-alternatives fails like it does for a non-root user, so the scripts fall back to ln
  for (const [tool, code] of [
    ['update-alternatives', 1],
    ['update-desktop-database', 0],
    ['update-mime-database', 0],
    ['apparmor_status', 1],
    ['unshare', 0],
  ] as const) {
    const stub = join(stubs, tool)
    writeFileSync(stub, `#!/bin/sh\necho "${tool} $*" >> "${calls}"\nexit ${code}\n`)
    chmodSync(stub, 0o755)
  }
  const script = (name: string) => {
    const file = join(root, name)
    const body = readFileSync(join(BUILD, name), 'utf-8')
      .replaceAll('${executable}', 'uniwork-office')
      .replaceAll('${sanitizedProductName}', 'UniWork Office')
      .replaceAll('/opt/UniWork Office', opt)
      .replaceAll('/usr/bin/', `${bin}/`)
    writeFileSync(file, body)
    return (arg = '') => {
      const r = spawnSync('bash', [file, arg], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
      })
      return { code: r.status, stderr: r.stderr }
    }
  }
  return {
    opt,
    launcher,
    link: join(bin, 'genoffice'),
    appLink: join(bin, 'uniwork-office'),
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf-8') : ''),
    install: script('linux-after-install.sh'),
    remove: script('linux-after-remove.sh'),
  }
}

describe.skipIf(process.platform === 'win32')('linux package scripts', () => {
  it("carry electron-builder's default steps (it skips its own scripts for custom ones)", () => {
    for (const name of ['linux-after-install.sh', 'linux-after-remove.sh']) {
      const body = readFileSync(join(BUILD, name), 'utf-8')
      // only the template macros electron-builder defines; any other ${x} fails packaging
      for (const macro of body.matchAll(/\$\{([a-zA-Z]+)\}/g)) {
        expect(['executable', 'sanitizedProductName']).toContain(macro[1])
      }
    }
    const t = makeRoot()
    expect(t.install()).toEqual({ code: 0, stderr: '' })
    expect(readlinkSync(t.appLink)).toBe(join(t.opt, 'uniwork-office'))
    expect(t.calls()).toContain('update-desktop-database /usr/share/applications')
    expect(t.calls()).toContain('update-mime-database /usr/share/mime')
  })

  it('drop the launcher link and an installed deployment profile on uninstall only', () => {
    const t = makeRoot()
    t.install()
    const profile = join(t.opt, 'resources', 'deployment-profile.json')
    writeFileSync(profile, '{}')
    expect(t.remove('upgrade').code).toBe(0)
    expect(existsSync(profile)).toBe(true)
    expect(existsSync(t.appLink)).toBe(true)
    expect(t.remove('remove').code).toBe(0)
    expect(existsSync(profile)).toBe(false)
    expect(existsSync(t.appLink)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('linux cli link scripts (genoffice#893)', () => {
  it('links a free name, a dead link and a link into the old install', () => {
    const t = makeRoot()
    expect(t.install()).toEqual({ code: 0, stderr: '' })
    expect(readlinkSync(t.link)).toBe(t.launcher)

    expect(t.remove('remove').code).toBe(0)
    expect(existsSync(t.link)).toBe(false)
    symlinkSync('/nowhere/cli/genoffice', t.link)
    expect(t.install()).toEqual({ code: 0, stderr: '' })
    expect(readlinkSync(t.link)).toBe(t.launcher)

    rmSync(t.link)
    symlinkSync(t.launcher.replace('/resources/', '/old-resources/'), t.link)
    expect(t.install()).toEqual({ code: 0, stderr: '' })
    expect(readlinkSync(t.link)).toBe(t.launcher)
  })

  it('leaves a foreign command or symlink alone and says so', () => {
    const t = makeRoot()
    writeFileSync(t.link, '#!/bin/sh\necho other\n')
    const r = t.install()
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('another program')
    expect(lstatSync(t.link).isSymbolicLink()).toBe(false)
    expect(readFileSync(t.link, 'utf-8')).toContain('other')
    expect(t.remove('remove').code).toBe(0)
    expect(existsSync(t.link)).toBe(true)

    rmSync(t.link)
    const vendor = join(t.launcher, '..', '..', '..', '..', 'vendor', 'cli', 'genoffice')
    mkdirSync(join(vendor, '..'), { recursive: true })
    writeFileSync(vendor, '#!/bin/sh\n')
    symlinkSync(vendor, t.link)
    expect(t.install().stderr).toContain('another program')
    expect(readlinkSync(t.link)).toBe(vendor)
    expect(t.remove('remove').code).toBe(0)
    expect(readlinkSync(t.link)).toBe(vendor)
  })

  it('keeps the link on an upgrade and drops only ours on uninstall', () => {
    const t = makeRoot()
    t.install()
    expect(t.remove('1').code).toBe(0)
    expect(readlinkSync(t.link)).toBe(t.launcher)
    expect(t.remove('upgrade').code).toBe(0)
    expect(existsSync(t.link)).toBe(true)
    expect(t.remove('0').code).toBe(0)
    expect(existsSync(t.link)).toBe(false)
  })
})
