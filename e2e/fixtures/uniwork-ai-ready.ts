/**
 * A ready UniWork AI state for the desktop editor specs. AI runs only on UniWork AI, and Send waits
 * while the composer note says why it cannot answer (signed out, no credits, ...), so a spec that
 * sends an instruction needs a session whose organization offers UniWork AI. The auth stub answers
 * the sign-in, the cloud status (`ready`) and the organization's office capabilities with
 * `ai_uniwork` on for every format. The session lives in memory (UNIWORK_AUTH_E2E_PLAIN_STORE), so
 * no OS keyring is needed. The model reply is not stubbed: a turn lands as a user message only.
 */
import { expect, type Page } from '@playwright/test'
import type { LaunchedApp } from '../helpers'
import { STUB_ORG, startUniworkAuthStub, type UniworkAuthStub } from './uniwork-auth-stub'
import { deliverUrl, shellEnv } from './uniwork-signin-steps'

export async function startUniworkAiStub(): Promise<UniworkAuthStub> {
  return startUniworkAuthStub({
    extend: ({ req, route, send }) => {
      if (req.method !== 'GET' || route !== `/orgs/${STUB_ORG.id}/office/capabilities`) {
        return false
      }
      send(200, {
        sync_feed: false,
        sync_write: false,
        offline_library: false,
        ai_uniwork: true,
        ai_uniwork_formats: ['docx', 'xlsx', 'pptx', 'pdf', 'markdown', 'html'],
        ttl_seconds: 300,
      })
      return true
    },
  })
}

/** the shell environment pointed at the stub, with the in-memory session store */
export function uniworkAiEnv(stub: UniworkAuthStub): Record<string, string> {
  return { ...shellEnv(stub), UNIWORK_AUTH_E2E_PLAIN_STORE: '1' }
}

/**
 * The composer holds an instruction and the disclosure was acknowledged while signed out: the
 * signed-out note shows, Send stays off and Enter sends nothing. The note's own Sign in starts the
 * sign-in the stub then answers; afterwards the disclosure asks again for the account (acknowledged
 * here) and Send opens.
 */
export async function signInFromComposerNote(
  launched: LaunchedApp,
  editorPage: Page,
  stub: UniworkAuthStub,
): Promise<void> {
  const note = editorPage.locator('.copilot .ai-uniwork-composer-note')
  const send = editorPage.locator('.copilot .ai-send-btn')
  await expect(note).toHaveAttribute('data-note-kind', 'signed-out')
  await expect(send).toBeDisabled()
  await editorPage.locator('.copilot textarea').press('Enter')
  await expect(editorPage.locator('.ai-msg-user')).toHaveCount(0)

  await note.locator('.ai-uniwork-composer-note-action').click()
  await expect.poll(() => stub.lastAttempt()?.state ?? '').not.toBe('')
  await deliverUrl(launched, uniworkAiEnv(stub), stub.approve())
  const ack = editorPage.locator('.copilot .ai-uniwork-disclosure-ack')
  await expect(async () => {
    if (await ack.isVisible()) await ack.click()
    await expect(send).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 60_000 })
  await expect(editorPage.locator('.copilot .ai-uniwork-composer-note')).toHaveCount(0)
}
