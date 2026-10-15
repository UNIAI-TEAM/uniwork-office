import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  allowsAutomaticWorkbookRecovery,
  clearRecoveryFile,
  MAX_AUTOMATIC_RECOVERY_WORKSHEET_XML_BYTES,
  writeRecoveryFile,
} from '../src/main/recovery-policy'

describe('automatic workbook recovery policy', () => {
  it('allows normal workbooks and older sidecar metadata', () => {
    expect(allowsAutomaticWorkbookRecovery([{ sourceXmlBytes: 8 * 1024 * 1024 }])).toBe(true)
    expect(allowsAutomaticWorkbookRecovery([{}])).toBe(true)
  })

  it('disables background rewriting when any worksheet XML entry is oversized', () => {
    expect(
      allowsAutomaticWorkbookRecovery([
        { sourceXmlBytes: 4 * 1024 * 1024 },
        { sourceXmlBytes: MAX_AUTOMATIC_RECOVERY_WORKSHEET_XML_BYTES + 1 },
      ]),
    ).toBe(false)
  })

  it('accepts an entry at the memory-safe limit', () => {
    expect(
      allowsAutomaticWorkbookRecovery([
        { sourceXmlBytes: MAX_AUTOMATIC_RECOVERY_WORKSHEET_XML_BYTES },
      ]),
    ).toBe(true)
  })
})

describe('recovery copy clear epoch (G5-11 d2-5)', () => {
  it('a recovery write in flight while the copy is cleared does not leave the file behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheets-recovery-epoch-'))
    try {
      const key = join(dir, 'Budget.xlsx')
      const target = join(dir, 'sheets-autosave', 'abc.xlsx')
      const kept = await writeRecoveryFile(key, target, async () => {
        // the sign-out sweep runs while the sidecar is still writing
        clearRecoveryFile(key, target)
        await writeFile(target, 'workbook plaintext')
      })
      expect(kept).toBe(false)
      expect(existsSync(target)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a write with no clear in flight keeps its copy, and a later clear removes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheets-recovery-epoch-'))
    try {
      const key = join(dir, 'Budget.xlsx')
      const target = join(dir, 'sheets-autosave', 'abc.xlsx')
      const kept = await writeRecoveryFile(key, target, async () => {
        await writeFile(target, 'workbook')
      })
      expect(kept).toBe(true)
      expect(existsSync(target)).toBe(true)
      clearRecoveryFile(key, target)
      expect(existsSync(target)).toBe(false)
      writeFileSync(target, 'again')
      clearRecoveryFile(key, target)
      expect(existsSync(target)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
