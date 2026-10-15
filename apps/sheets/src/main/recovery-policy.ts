import { unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

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
 * shell's sign-out sweep deleting the account's copies mid-write).
 */
const recoveryClearEpochs = new Map<string, number>()

/** Deletes the recovery copy `target` of `key` (the path it recovers); a missing file is fine. */
export function clearRecoveryFile(key: string, target: string): void {
  recoveryClearEpochs.set(key, (recoveryClearEpochs.get(key) ?? 0) + 1)
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
  const epoch = recoveryClearEpochs.get(key) ?? 0
  await mkdir(dirname(target), { recursive: true })
  await write()
  if ((recoveryClearEpochs.get(key) ?? 0) !== epoch) {
    clearRecoveryFile(key, target)
    return false
  }
  return true
}
