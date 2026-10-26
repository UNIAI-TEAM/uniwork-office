import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSyncCenterSnapshot } from '../src/main/uniwork-sync/sync-center'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { queuePopoverModelOf, failedReasonKeyOf } from '../src/renderer/src/queue-popover-model'
import { rowView } from '../src/renderer/src/sync-center-model'
import { chipModelOf } from '../src/renderer/src/uniwork-docs-model'
import type { SyncCenterRow } from '../src/shared/sync-center'
import {
  fakeServer,
  ooxml,
  openDoc,
  setup,
  storedIntent,
  useWorkDir,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4 fix-a): a refused conversion (422 legacy_conversion_invalid) is a failed save. The
 * failed-state surfaces - the pill, the queue popover and the Sync Center row - show its own
 * translated sentence (the changes stay in this copy), not the generic "unavailable".
 */

const table = (lang: 'vi' | 'en') =>
  ({ ...syncStrings[lang], ...uniworkDocumentStrings[lang] }) as Record<string, string>

describe('UNI-2212 a refused conversion in the failed-state surfaces', () => {
  it('a real 422 save reads as its own sentence in the pill, the popover and the Sync Center row', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const ctx = setup(server, { queue: true })
    const path = await openDoc(ctx)
    writeFileSync(path, await ooxml('xlsx', 'edits'))
    server.faults.push({
      route: 'commit',
      status: 422,
      code: 'legacy_conversion_invalid',
      reason: 'not_legacy',
    })
    await ctx.service.save(path)
    const status = (await ctx.service.docStatus(path))!
    expect(status).toMatchObject({ state: 'failed', error: 'legacy_conversion_invalid' })

    // the Sync Center row, projected by main from the real durable record
    const stored = (await storedIntent(ctx, path))!
    const snapshot = buildSyncCenterSnapshot({
      nowMs: Date.now(),
      sessionState: 'signed_in',
      online: true,
      paused: false,
      adminPaused: false,
      account: { name: 'A', email: 'a@example.com' },
      org: { id: 'org_a', name: 'Acme' },
      storeBudget: { used: 1, cap: 1 << 20 },
      intents: [
        {
          id: 'row-1',
          documentKey: 'k',
          documentId: stored.intent.documentId,
          orgId: 'org_a',
          title: 'Budget.xlsx',
          ext: 'xlsx',
          record: stored.intent as never,
          canEdit: true,
        },
      ],
    })
    const row = snapshot.tabs.attention[0] as SyncCenterRow
    expect(row).toMatchObject({ state: 'failed', failedReason: 'legacy_conversion' })

    for (const lang of ['en', 'vi'] as const) {
      const strings = table(lang)
      const sentence = strings.uwErrLegacyConversion!
      expect(sentence.length).toBeGreaterThan(20)
      // pill: the tooltip is the sentence, with or without the sync-center row
      for (const withRow of [row, undefined]) {
        const model = chipModelOf(status, {
          needsSignIn: false,
          failedReasonKey: failedReasonKeyOf(status, withRow),
        })
        expect(model).toMatchObject({ labelKey: 'uwChipError', tipKey: 'uwErrLegacyConversion' })
        expect(strings[model.tipKey]).toBe(sentence)
      }
      // popover: the first line is the sentence
      const popover = queuePopoverModelOf(status, row, 'chip')
      expect(popover.line1).toEqual({ key: 'uwErrLegacyConversion' })
      expect(strings[popover.line1.key]).toBe(sentence)
      // Sync Center row: the sub line is the sentence
      const view = rowView(row, { online: true })
      expect(view.sub).toEqual({ key: 'uwErrLegacyConversion' })
      expect(strings[view.sub.key]).toBe(sentence)
    }
  })

  it('every other failed reason keeps the generic line with its reason fragment', () => {
    const status = {
      path: '/p.docx',
      documentId: 'd',
      workspaceId: 'w',
      title: 'p.docx',
      format: 'docx',
      access: 'edit',
      state: 'failed',
      error: 'quota_exceeded',
    } as never
    const model = chipModelOf(status, {
      needsSignIn: false,
      failedReasonKey: failedReasonKeyOf(status, undefined),
    })
    expect(model).toMatchObject({ tipKey: 'uwTipFailed', reasonKey: 'uwReasonQuota' })
  })
})
