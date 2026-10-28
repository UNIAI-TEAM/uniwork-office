import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { setModuleLang, tFor } from '../src/renderer/i18n/locale'
import { localizeSaveError } from '../src/renderer/save-actions'

const mainSource = readFileSync(join(__dirname, '../src/main/sheets-main.ts'), 'utf8')

/** The English text of one of the main process' refusal constants. */
function mainRefusal(name: string): string {
  const match = new RegExp(`const ${name} =\\s*'([^']+)'`).exec(mainSource)
  if (!match?.[1]) throw new Error(`${name} not found in sheets-main.ts`)
  return match[1]
}

describe('encrypted workbooks on UniWork documents (Q1)', () => {
  beforeAll(() => setModuleLang('en'))

  const cases = [
    ['ENCRYPTED_UNIWORK_SAVE_REFUSED', 'appSaveErrEncryptedUniwork'],
    ['PASSWORD_CHANGE_UNIWORK_REFUSED', 'appPasswordChangeUniwork'],
    ['PASSWORD_CHANGE_READ_ONLY_REFUSED', 'appPasswordChangeReadOnly'],
    ['PASSWORD_CHANGE_RESTORED_REFUSED', 'appPasswordChangeRestored'],
  ] as const

  it.each(cases)('the renderer localizes the %s refusal', (constant, key) => {
    const message = mainRefusal(constant)
    // a password-protected save refusal also reaches the renderer wrapped by IPC
    expect(localizeSaveError(message)).toBe(tFor('en', key))
    expect(tFor('en', key)).toBe(message)
  })

  it('ships the refusals in Vietnamese and English', () => {
    for (const [, key] of cases) {
      expect(tFor('vi', key)).not.toBe(tFor('en', key))
      expect(tFor('vi', key).length).toBeGreaterThan(10)
    }
  })

  it('refuses the encrypted save before anything is written', () => {
    const guard = mainSource.indexOf('throw new Error(ENCRYPTED_UNIWORK_SAVE_REFUSED)')
    const write = mainSource.indexOf('await writeWorkbookTo(client, session, request, targetPath)')
    expect(guard).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(guard)
    expect(mainSource.slice(guard - 160, guard)).toContain(
      'session.password !== undefined && uniworkIsBound(userTargetPath)',
    )
  })

  it('refuses a password change on a bound or view-only document', () => {
    const handler = mainSource.indexOf('IPC_CHANNELS.updateWorkbookPassword')
    const body = mainSource.slice(handler, handler + 1800)
    expect(body).toContain('uniworkIsReadOnly(documentPath)')
    expect(body).toContain('uniworkIsBound(documentPath)')
    expect(body.indexOf('uniworkIsBound(documentPath)')).toBeLessThan(body.indexOf('encryptOoxml('))
    // a session restored from a recovery copy writes the copy, not the original
    expect(body).toContain('session.restoreTarget !== undefined')
    expect(body.indexOf('PASSWORD_CHANGE_RESTORED_REFUSED')).toBeLessThan(
      body.indexOf('encryptOoxml('),
    )
  })
})
