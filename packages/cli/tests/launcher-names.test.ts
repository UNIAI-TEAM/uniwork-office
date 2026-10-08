import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpLaunch } from '../src/mcp-launch'
import { appBinaryForResources } from '../src/resources'

const repo = join(__dirname, '..', '..', '..')
const builder = readFileSync(join(repo, 'apps', 'shell', 'electron-builder.cjs'), 'utf8')
const sh = readFileSync(join(__dirname, '..', 'bin', 'genoffice'), 'utf8')
const cmd = readFileSync(join(__dirname, '..', 'bin', 'genoffice.cmd'), 'utf8')

/** `key: 'value'` at the top level (two-space indent) of the electron-builder config. */
function topLevel(key: string): string {
  const m = new RegExp(`^ {2}${key}: '([^']+)'`, 'm').exec(builder)
  if (!m) throw new Error(`${key} not found in electron-builder.cjs`)
  return m[1]
}

function linuxExecutable(): string {
  const m = /^ {4}executableName: '([^']+)'/m.exec(builder)
  if (!m) throw new Error('linux executableName not found in electron-builder.cjs')
  return m[1]
}

const slash = (p: string) => p.replace(/\\/g, '/')

// The shipped launchers (packages/cli/bin) run the CLI on the app's own binary as Node. They are
// not under src/, so a rename of the app binary breaks them without any compile error.
describe('CLI launcher binary names', () => {
  const productName = topLevel('productName')
  const executableName = linuxExecutable()

  it('starts the macOS executable named after productName', () => {
    expect(sh).toContain(`"$here/../../MacOS/${productName}"`)
  })

  it('starts the Windows executable named after productName', () => {
    expect(sh).toContain(`"$here/../../${productName}.exe"`)
    expect(cmd).toContain(`"%~dp0..\\..\\${productName}.exe"`)
  })

  it('starts the Linux executable named by executableName', () => {
    expect(sh).toContain(`app="$here/../../${executableName}"`)
  })

  it('does not name the pre-rebrand binaries', () => {
    expect(sh).not.toMatch(/GenOffice(?:\.exe)?"/)
    expect(sh).not.toContain('../../genoffice"')
    expect(cmd).not.toContain('GenOffice')
  })

  it('agrees with the binary names the CLI sources resolve', () => {
    expect(slash(appBinaryForResources('/Apps/X.app/Contents/Resources', 'darwin'))).toMatch(
      new RegExp(`/MacOS/${productName}$`),
    )
    expect(slash(appBinaryForResources('C:\\X\\resources', 'win32'))).toMatch(
      new RegExp(`/${productName}\\.exe$`),
    )
    expect(slash(appBinaryForResources('/opt/X/resources', 'linux'))).toMatch(
      new RegExp(`/${executableName}$`),
    )
    expect(mcpLaunch({ status: 'present', launcherDir: 'C:\\X\\resources\\cli' }).command).toBe(
      `C:\\X\\resources\\cli\\..\\..\\${productName}.exe`,
    )
  })
})
