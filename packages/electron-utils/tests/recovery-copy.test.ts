<<<<<<< ours
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newerCopyMtime } from '../src/recovery-copy'

describe('newerCopyMtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recovery-copy-'))
  const file = join(dir, 'a.docx')
  const copy = join(dir, 'a.copy.docx')
  writeFileSync(file, 'x')
  writeFileSync(copy, 'y')
  const at = (path: string, seconds: number) => utimesSync(path, seconds, seconds)

  it('returns the copy mtime when the copy is newer', () => {
    at(file, 1_000)
    at(copy, 2_000)
    expect(newerCopyMtime(copy, file)).toBe(2_000_000)
  })

  it('returns null when the copy is older or as old', () => {
    at(file, 2_000)
    at(copy, 1_000)
    expect(newerCopyMtime(copy, file)).toBeNull()
    at(copy, 2_000)
    expect(newerCopyMtime(copy, file)).toBeNull()
  })

  it('returns null when either file is missing', () => {
    expect(newerCopyMtime(join(dir, 'none.docx'), file)).toBeNull()
    expect(newerCopyMtime(copy, join(dir, 'none.docx'))).toBeNull()
=======
import { describe, expect, it } from 'vitest'

import { recoveryCopyDiskNewer } from '../src/recovery-copy'

describe('recoveryCopyDiskNewer', () => {
  it('is false when the recovery copy postdates the original (plain crash)', () => {
    expect(recoveryCopyDiskNewer(2_000, 1_000)).toBe(false)
  })

  it('is true when the original was modified after the copy was written', () => {
    expect(recoveryCopyDiskNewer(1_000, 2_000)).toBe(true)
  })

  it('treats equal timestamps as disk-newer so the user still sees the warning', () => {
    expect(recoveryCopyDiskNewer(1_000, 1_000)).toBe(true)
>>>>>>> theirs
  })
})
