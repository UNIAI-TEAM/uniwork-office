import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isInDocDir, resolveSafeRelativeImagePath } from '../src/main/asset-lifecycle'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
describe('isInDocDir (md-asset:// serve gate)', () => {
  it('allows sibling images of filesystem-root documents', () => {
    expect(isInDocDir('/a.png', '/', '/')).toBe(true)
    expect(isInDocDir('C:\\a.png', 'C:\\', '\\')).toBe(true)
  })

  it('allows siblings of nested documents and rejects the rest', () => {
    expect(isInDocDir('/docs/a.png', '/docs', '/')).toBe(true)
    expect(isInDocDir('/other/a.png', '/docs', '/')).toBe(false)
    // Prefix attacks: a sibling directory sharing the name prefix is outside
    expect(isInDocDir('/docs-evil/a.png', '/docs', '/')).toBe(false)
    expect(isInDocDir('C:\\docs\\a.png', 'C:\\docs', '\\')).toBe(true)
    expect(isInDocDir('C:\\docs-evil\\a.png', 'C:\\docs', '\\')).toBe(false)
  })

  it('never serves the directory itself', () => {
    expect(isInDocDir('/docs', '/docs', '/')).toBe(false)
    expect(isInDocDir('/', '/', '/')).toBe(false)
  })
})

describe('resolveSafeRelativeImagePath (md-asset:// decoded path)', () => {
  it('serves a file whose name contains a literal % when decoded once (50% off.png)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-asset-percent-'))
    tempDirectories.push(dir)
    const doc = join(dir, 'notes.md')
    const img = join(dir, '50% off.png')
    await writeFile(doc, '![sale](50%25%20off.png)')
    await writeFile(img, 'png-bytes')

    // URL pathname from md-asset://.../50%25%20off.png decoded once by registerImageProtocol:
    const target = resolve(decodeURIComponent(`${dir}/50%25%20off.png`))
    const docDir = resolve(dirname(doc))
    expect(isInDocDir(target, docDir)).toBe(true)
    const resolved = await resolveSafeRelativeImagePath(doc, relative(docDir, target), {
      decoded: true,
    })
    expect(resolved).not.toBeNull()
    expect(resolved?.endsWith('50% off.png')).toBe(true)
  })

  it('still rejects path traversal and symlinks escaping the document directory when decoded: true', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'md-asset-escape-'))
    tempDirectories.push(outer)
    const dir = join(outer, 'sub')
    await mkdir(dir)
    const doc = join(dir, 'notes.md')
    const secret = join(outer, 'secret.png')
    const link = join(dir, '50% off.png')
    await writeFile(doc, '# note')
    await writeFile(secret, 'secret')
    await symlink(secret, link)

    expect(await resolveSafeRelativeImagePath(doc, '../secret.png', { decoded: true })).toBeNull()
    expect(await resolveSafeRelativeImagePath(doc, '50% off.png', { decoded: true })).toBeNull()
  })
})
