import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applicationsDirs,
  mimeappsPath,
  pruneMimeapps,
  pruneStaleSchemeHandlers,
} from '../src/main/uniwork-handler-entry'

const LIST = [
  '[Default Applications]',
  'x-scheme-handler/uniwork=uniwork-office.desktop',
  'x-scheme-handler/uniwork-office=uniwork-office.desktop;',
  'x-scheme-handler/https=firefox.desktop',
  'x-scheme-handler/uniwork-other=uniwork-office.desktop',
  'text/markdown=uniwork-office.desktop;org.gnome.gedit.desktop;',
  '',
  '[Added Associations]',
  'x-scheme-handler/uniwork-office-dev=other.desktop;uniwork-office.desktop;',
  '',
  '[Removed Associations]',
  'x-scheme-handler/uniwork=uniwork-office.desktop',
  '',
].join('\n')

describe('uniwork:// handler entry (Linux)', () => {
  it('drops this app’s dangling scheme entries and nothing else', () => {
    const { text, dropped } = pruneMimeapps(LIST, () => true)
    expect(dropped).toEqual([
      'uniwork-office.desktop',
      'uniwork-office.desktop',
      'uniwork-office.desktop',
    ])
    expect(text).toBe(
      [
        '[Default Applications]',
        'x-scheme-handler/https=firefox.desktop',
        // another scheme, and a file association, are not this cleanup's business
        'x-scheme-handler/uniwork-other=uniwork-office.desktop',
        'text/markdown=uniwork-office.desktop;org.gnome.gedit.desktop;',
        '',
        '[Added Associations]',
        // another program stays in a mixed list
        'x-scheme-handler/uniwork-office-dev=other.desktop;',
        '',
        '[Removed Associations]',
        'x-scheme-handler/uniwork=uniwork-office.desktop',
        '',
      ].join('\n'),
    )
  })

  it('keeps an entry whose desktop file exists, and another program’s handler of the scheme', () => {
    expect(pruneMimeapps(LIST, () => false)).toEqual({ text: LIST, dropped: [] })
    const foreign = '[Default Applications]\nx-scheme-handler/uniwork=someone-else.desktop\n'
    expect(pruneMimeapps(foreign, () => true)).toEqual({ text: foreign, dropped: [] })
  })

  it('rewrites ~/.config/mimeapps.list only when something was dropped', () => {
    const home = mkdtempSync(join(tmpdir(), 'uniwork-mime-'))
    const file = mimeappsPath({}, home)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, LIST)
    const apps = join(home, '.local', 'share', 'applications')
    mkdirSync(apps, { recursive: true })

    // the package is installed: its desktop file is there, the file stays byte for byte
    writeFileSync(join(apps, 'uniwork-office.desktop'), '[Desktop Entry]\n')
    expect(pruneStaleSchemeHandlers({ env: {}, home })).toEqual([])
    expect(readFileSync(file, 'utf-8')).toBe(LIST)

    // uninstalled (the file is gone): the leftovers go
    expect(
      pruneStaleSchemeHandlers({ env: {}, home, desktopFileExists: () => false }),
    ).toHaveLength(3)
    // the [Removed Associations] line is the user's own and stays
    expect(readFileSync(file, 'utf-8')).not.toContain(
      '[Default Applications]\nx-scheme-handler/uniwork=',
    )
    expect(readFileSync(file, 'utf-8')).toContain('x-scheme-handler/https=firefox.desktop')
    // a second launch has nothing left to do
    expect(pruneStaleSchemeHandlers({ env: {}, home, desktopFileExists: () => false })).toEqual([])
  })

  it('is silent without a mimeapps.list and follows the XDG dirs', () => {
    const home = mkdtempSync(join(tmpdir(), 'uniwork-mime-none-'))
    expect(pruneStaleSchemeHandlers({ env: {}, home })).toEqual([])
    expect(applicationsDirs({ XDG_DATA_HOME: '/d', XDG_DATA_DIRS: '/a:/b' }, '/h')).toEqual([
      join('/d', 'applications'),
      join('/a', 'applications'),
      join('/b', 'applications'),
    ])
    expect(mimeappsPath({ XDG_CONFIG_HOME: '/c' }, '/h')).toBe(join('/c', 'mimeapps.list'))
  })
})

describe('uniwork:// handler entry: writing the list back', () => {
  function setup(text: string) {
    const home = mkdtempSync(join(tmpdir(), 'uniwork-mime-write-'))
    const file = mimeappsPath({}, home)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    return { home, file }
  }

  it('keeps CRLF line endings, including on a rewritten line', () => {
    const crlf = LIST.replace(/\n/g, '\r\n')
    const { home, file } = setup(crlf)
    pruneStaleSchemeHandlers({ env: {}, home, desktopFileExists: () => false })
    const after = readFileSync(file, 'utf-8')
    expect(after).toContain('x-scheme-handler/uniwork-office-dev=other.desktop;\r\n')
    // no bare LF anywhere: every line of the user's file still ends in CRLF
    expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('goes through a temp file in the same dir and leaves nothing behind', () => {
    const { home, file } = setup(LIST)
    const dir = join(file, '..')
    const inodeBefore = statSync(file).ino
    pruneStaleSchemeHandlers({ env: {}, home, desktopFileExists: () => false })
    // a rename swaps the file: the old inode is not rewritten in place
    if (process.platform !== 'win32') expect(statSync(file).ino).not.toBe(inodeBefore)
    expect(readdirSync(dir)).toEqual(['mimeapps.list'])
  })

  it('writes through a symlinked list and keeps the link and the mode', () => {
    const home = mkdtempSync(join(tmpdir(), 'uniwork-mime-link-'))
    const real = join(home, 'dotfiles', 'mimeapps.list')
    mkdirSync(join(real, '..'), { recursive: true })
    writeFileSync(real, LIST, { mode: 0o640 })
    const file = mimeappsPath({}, home)
    mkdirSync(join(file, '..'), { recursive: true })
    try {
      symlinkSync(real, file)
    } catch {
      return // this host cannot create symlinks (Windows without the privilege)
    }
    expect(
      pruneStaleSchemeHandlers({ env: {}, home, desktopFileExists: () => false }),
    ).toHaveLength(3)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf-8')).not.toContain(
      '[Default Applications]\nx-scheme-handler/uniwork=',
    )
    expect(statSync(real).mode & 0o777).toBe(0o640)
  })
})
