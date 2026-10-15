import { unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { RecoveryClearEpochs } from '@genoffice/electron-utils/recovery-copy'

/**
 * The current xlsx patcher materializes worksheet XML as JavaScript strings.
 * Rewriting a large entry can therefore require several times its uncompressed
 * size in the Electron main process. Automatic recovery is best-effort and
 * must not make an otherwise responsive workbook crash in the background.
 */
export const MAX_AUTOMATIC_RECOVERY_WORKSHEET_XML_BYTES = 64 * 1024 * 1024

export function allowsAutomaticWorkbookRecovery(
  sheets: readonly { readonly sourceXmlBytes?: number | undefined }[],
): boolean {
  return sheets.every(
    (sheet) =>
      sheet.sourceXmlBytes === undefined ||
      sheet.sourceXmlBytes <= MAX_AUTOMATIC_RECOVERY_WORKSHEET_XML_BYTES,
  )
}

/**
 * Bumped by every clear of a recovery copy: a write that started before the
 * bump must not leave the file it lands behind (stale-recovery race, e.g. the
 * shell's sign-out sweep deleting the account's copies mid-write). Keyed by the
 * normalized path and held only while a write is in flight.
 */
const recoveryClearEpochs = new RecoveryClearEpochs()

/** Deletes the recovery copy `target` of `key` (the path it recovers); a missing file is fine. */
export function clearRecoveryFile(key: string, target: string): void {
  recoveryClearEpochs.bump(key)
  try {
    unlinkSync(target)
  } catch {
    /* nothing to clean */
  }
}

/**
 * Writes the recovery copy `target` of `key` through `write`. Resolves false
 * when a clear ran while the write was in flight: the landed file is undone.
 */
export async function writeRecoveryFile(
  key: string,
  target: string,
  write: () => Promise<unknown>,
): Promise<boolean> {
  // snapshot before any await
  const ticket = recoveryClearEpochs.begin(key)
  try {
    await mkdir(dirname(target), { recursive: true })
    await write()
    if (recoveryClearEpochs.cleared(ticket)) {
      clearRecoveryFile(key, target)
      return false
    }
    return true
  } finally {
    recoveryClearEpochs.end(ticket)
  }
}

/** open clear-epoch entries (tests): bounded by the writes in flight */
export function recoveryEpochEntries(): number {
  return recoveryClearEpochs.size
}
