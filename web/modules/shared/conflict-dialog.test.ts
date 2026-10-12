// The web save conflict dialog (S5) every module shows: order and focus, the two-column table,
// the confirmation steps in the same card, the failure variants and the `save` answers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format } from '@genoffice/i18n'
import { webLanguage } from '../../docs/bridge/browser'
import {
  conflictSaveResult,
  headFromFile,
  rememberRemoteVersion,
  runConflictDialog,
  type ConflictHead,
  type ConflictIo,
  type ConflictOutcome,
  type OverwriteAttempt,
} from './conflict-dialog'
import { onFrameModal } from './frame-dialog'
import { webText, type WebStringKey } from './i18n/strings-web'

const t = (key: WebStringKey, params?: Record<string, string>) =>
  webText(webLanguage(), key, params)
const flush = () => new Promise((r) => setTimeout(r, 0))
const keydown = (key: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))

const card = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!
const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-choice="${id}"]`)!
const choices = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-choice]')].map((b) => b.dataset.choice)
const alertLine = () => card().querySelector<HTMLElement>('[role="alert"]')!

const HEAD: ConflictHead = {
  revision: '12',
  modifiedAt: Date.UTC(2026, 9, 12, 8),
  author: 'Trần An',
}

function io(over: Partial<ConflictIo> = {}): ConflictIo & {
  overwrite: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
} {
  return {
    title: 'This document was changed elsewhere',
    body: 'Your changes are kept.',
    reloadLabel: 'Reload latest',
    overwriteLabel: 'Overwrite…',
    cancelLabel: 'Cancel',
    baseRevision: '11',
    readHead: async () => HEAD,
    overwrite: vi.fn(async (): Promise<OverwriteAttempt> => ({ ok: true, versionId: 'v13' })),
    reload: vi.fn(async () => true),
    canEdit: () => true,
    online: () => true,
    ...over,
  } as never
}

async function shown(): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    if (document.querySelector('[data-choice]')) return card()
    await flush()
  }
  throw new Error('no conflict dialog')
}

async function pick(id: string): Promise<void> {
  await shown()
  for (let i = 0; i < 50 && !document.querySelector(`[data-choice="${id}"]`); i++) await flush()
  btn(id).click()
  await flush()
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('step 1', () => {
  it('DOM order = Tab order: table, Reload latest, Overwrite…, Cancel, X; first focus Cancel', async () => {
    const editor = document.createElement('button')
    editor.textContent = 'editor'
    document.body.append(editor)
    editor.focus()
    const done = runConflictDialog(io())
    await shown()
    await flush()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    // Reload latest is the primary, yet the first focus is Cancel (Enter never discards)
    expect(btn('reload').className).toBe('ow-dlg-btn primary')
    expect(btn('overwrite').className).toBe('ow-dlg-btn danger')
    expect(document.activeElement).toBe(btn('cancel'))
    // Tab: Cancel -> X -> Reload -> Overwrite -> Cancel
    keydown('Tab')
    expect(document.activeElement).toBe(card().querySelector('.ow-dlg-close'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('reload'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('overwrite'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('cancel'))
    // the table sits before the actions in the DOM
    const table = card().querySelector('table')!
    expect(table.compareDocumentPosition(btn('reload')) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // the rest of the frame is inert while the dialog is open
    expect(editor.hasAttribute('inert')).toBe(true)
    keydown('Escape')
    expect(await done).toEqual({ kind: 'cancelled' })
    expect(editor.hasAttribute('inert')).toBe(false)
    // closing returns the focus to where it was
    expect(document.activeElement).toBe(editor)
  })

  it('two-column table from both heads: base revision vs the head revision, time and author', async () => {
    void runConflictDialog(io())
    await shown()
    await flush()
    const cells = [...card().querySelectorAll('table tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    )
    expect(cells[0]).toEqual(['', t('uwConflictColMine'), t('uwConflictColServer')])
    expect(cells[1]).toEqual([
      t('uwConflictRowVersion'),
      format(t('uwConflictBasedOn'), { n: '11' }),
      '12',
    ])
    expect(cells[3]).toEqual([t('uwConflictRowBy'), t('uwConflictMineUnsaved'), 'Trần An'])
    expect(card().querySelectorAll('tbody th[scope="row"]')).toHaveLength(3)
  })

  it('without a known author the server column says "a member"', async () => {
    void runConflictDialog(io({ readHead: async () => ({ revision: '12' }) }))
    await shown()
    await flush()
    expect(card().querySelector('tbody tr:last-child td:last-child')!.textContent).toBe(
      t('uwAuthorFallback'),
    )
  })

  it('the alert row is always in the tree (empty, not display:none) and the title can take focus', async () => {
    void runConflictDialog(io())
    await shown()
    const alert = alertLine()
    expect(alert).not.toBeNull()
    expect(alert.textContent).toBe('')
    expect(alert.style.display).not.toBe('none')
    expect(card().querySelector('h2')!.getAttribute('tabindex')).toBe('-1')
  })

  it('without edit access: no Overwrite…, the no-edit line, Reload latest + Cancel', async () => {
    void runConflictDialog(io({ canEdit: () => false }))
    await shown()
    expect(choices()).toEqual(['reload', 'cancel'])
    expect(card().textContent).toContain(t('uwConflictNoEdit'))
  })

  it('offline: Reload and Overwrite are aria-disabled with the reason, still in the Tab loop', async () => {
    const done = runConflictDialog(io({ online: () => false }))
    await shown()
    for (const id of ['reload', 'overwrite']) {
      const b = btn(id)
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(b.hasAttribute('disabled')).toBe(false)
      expect(document.getElementById(b.getAttribute('aria-describedby')!)!.textContent).toBe(
        t('uwConflictOfflineWeb'),
      )
    }
    // a click does nothing; Tab still reaches it
    btn('overwrite').click()
    await flush()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    keydown('Tab')
    keydown('Tab')
    expect(document.activeElement).toBe(btn('reload'))
    btn('cancel').click()
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('reports modal open while it shows and closed when it settles', async () => {
    const seen: boolean[] = []
    const off = onFrameModal((open) => seen.push(open))
    const done = runConflictDialog(io())
    await pick('cancel')
    await done
    off()
    expect(seen).toEqual([true, false])
  })
})

describe('Overwrite…', () => {
  it('opens the confirmation in the same card, focus Back; Back returns focus to Overwrite…', async () => {
    void runConflictDialog(io())
    await pick('overwrite')
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
    expect(card().querySelector('h2')!.textContent).toBe(t('uwConflictOverwriteTitle'))
    expect(card().textContent).toContain(
      format(t('uwConflictOverwriteConfirm'), { next: '13', server: '12', author: 'Trần An' }),
    )
    expect(choices()).toEqual(['go', 'back'])
    expect(btn('go').className).toBe('ow-dlg-btn danger')
    expect(document.activeElement).toBe(btn('back'))
    btn('back').click()
    await flush()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    expect(document.activeElement).toBe(btn('overwrite'))
  })

  it('confirmed: a new version, answered ok with its versionId', async () => {
    const fake = io()
    const done = runConflictDialog(fake)
    await pick('overwrite')
    await pick('go')
    const outcome = await done
    expect(outcome).toEqual({ kind: 'overwritten', versionId: 'v13' })
    expect(fake.overwrite).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('a second 409: the table follows the new head, the head-moved line, back to step 1 on Cancel', async () => {
    let head: ConflictHead = HEAD
    const fake = io({
      readHead: async () => head,
      overwrite: vi.fn(async (): Promise<OverwriteAttempt> => {
        head = { revision: '13', author: 'Lê Bình' }
        return { ok: false, error: { code: 'conflict', message: 'HTTP 409' } }
      }),
    })
    const done = runConflictDialog(fake)
    await pick('overwrite')
    await pick('go')
    await flush()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    expect(alertLine().textContent).toBe(format(t('uwConflictHeadMoved'), { n: '13' }))
    expect(card().querySelector('tbody tr td:last-child')!.textContent).toBe('13')
    expect(document.activeElement).toBe(btn('cancel'))
    // asking again names the new head
    await pick('overwrite')
    expect(card().textContent).toContain(
      format(t('uwConflictOverwriteConfirm'), { next: '14', server: '13', author: 'Lê Bình' }),
    )
    await pick('back')
    await pick('cancel')
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  const failing = (code: string, details?: Record<string, unknown>) =>
    io({
      overwrite: vi.fn(
        async (): Promise<OverwriteAttempt> =>
          ({ ok: false, error: { code, message: code, ...(details ? { details } : {}) } }) as never,
      ),
    })

  it('401: the session line in the dialog; closing answers unauthorized', async () => {
    const done = runConflictDialog(failing('unauthorized'))
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(t('uwConflictSessionWeb'))
    keydown('Escape')
    expect(await done).toEqual({ kind: 'failed', code: 'unauthorized' })
  })

  it('403: the revoked variant with Close and the title focused; answers forbidden', async () => {
    const done = runConflictDialog(failing('forbidden'))
    await pick('overwrite')
    await pick('go')
    expect(card().textContent).toContain(t('uwRemoteRevokedWeb'))
    expect(choices()).toEqual(['close'])
    expect(document.activeElement).toBe(card().querySelector('h2'))
    btn('close').click()
    expect(await done).toEqual({ kind: 'failed', code: 'forbidden' })
  })

  it('403 organization suspended: the blocked sentence with its reason', async () => {
    const done = runConflictDialog(failing('forbidden', { apiCode: 'organization_suspended' }))
    await pick('overwrite')
    await pick('go')
    expect(card().textContent).toContain(
      format(t('uwRemoteOrgBlockedWeb'), { reason: t('uwReasonSuspended') }),
    )
    btn('close').click()
    expect(await done).toEqual({ kind: 'failed', code: 'forbidden' })
  })

  it('410: the deleted variant; answers not_found', async () => {
    const done = runConflictDialog(failing('not_found'))
    await pick('overwrite')
    await pick('go')
    expect(card().textContent).toContain(t('uwRemoteDeleted'))
    btn('close').click()
    expect(await done).toEqual({ kind: 'failed', code: 'not_found' })
  })

  it('413: the too-large line at step 1 and the download choice turns aria-disabled', async () => {
    const send = vi.fn(async () => {})
    const fake = failing('too_large')
    fake.download = { bytes: async () => new ArrayBuffer(4), send }
    const done = runConflictDialog(fake)
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(t('uwConflictTooLarge'))
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    await pick('reload')
    expect(btn('download').getAttribute('aria-disabled')).toBe('true')
    btn('download').click()
    await flush()
    expect(send).not.toHaveBeenCalled()
    await pick('back')
    await pick('cancel')
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('5xx: the overwrite-failed line, buttons still work; closing answers internal', async () => {
    const done = runConflictDialog(failing('internal'))
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(t('uwConflictOverwriteFailed'))
    await pick('cancel')
    expect(await done).toEqual({ kind: 'failed', code: 'internal' })
  })

  it('a retry that meets another 409 forgets the earlier 401: Cancel answers cancelled', async () => {
    let head: ConflictHead = HEAD
    const attempts: OverwriteAttempt[] = [
      { ok: false, error: { code: 'unauthorized', message: 'HTTP 401' } },
      { ok: false, error: { code: 'conflict', message: 'HTTP 409' } },
    ]
    const fake = io({
      readHead: async () => head,
      overwrite: vi.fn(async (): Promise<OverwriteAttempt> => {
        const next = attempts.shift()!
        if (next.ok === false && next.error.code === 'conflict') head = { revision: '13' }
        return next
      }),
    })
    const done = runConflictDialog(fake)
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(t('uwConflictSessionWeb'))
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(format(t('uwConflictHeadMoved'), { n: '13' }))
    await pick('cancel')
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('a retry that meets 413 forgets an earlier 5xx: Cancel answers cancelled', async () => {
    const attempts: OverwriteAttempt[] = [
      { ok: false, error: { code: 'internal', message: 'HTTP 500' } },
      { ok: false, error: { code: 'too_large', message: 'HTTP 413' } },
    ]
    const done = runConflictDialog(io({ overwrite: vi.fn(async () => attempts.shift()!) }))
    await pick('overwrite')
    await pick('go')
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(t('uwConflictTooLarge'))
    await pick('cancel')
    expect(await done).toEqual({ kind: 'cancelled' })
  })
})

describe('Reload latest (web)', () => {
  it('without the download capability: discard-and-reload and Back only, focus Back', async () => {
    const fake = io()
    const done = runConflictDialog(fake)
    await pick('reload')
    expect(card().querySelector('h2')!.textContent).toBe(t('uwConflictReloadTitle'))
    expect(card().textContent).toContain(t('uwConflictReloadWebBody'))
    expect(choices()).toEqual(['discard', 'back'])
    expect(document.activeElement).toBe(btn('back'))
    await pick('discard')
    expect(await done).toEqual({ kind: 'reloaded' })
    expect(fake.reload).toHaveBeenCalledTimes(1)
  })

  it('Back returns to step 1 with the focus on Reload latest', async () => {
    void runConflictDialog(io())
    await pick('reload')
    await pick('back')
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
    expect(document.activeElement).toBe(btn('reload'))
  })

  it('with download: sends the bytes, asks to check the file, never reloads on its own', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer
    const send = vi.fn(async () => {})
    const fake = io({ download: { bytes: async () => data, send } })
    const done = runConflictDialog(fake)
    await pick('reload')
    expect(choices()).toEqual(['download', 'discard', 'back'])
    await pick('download')
    expect(send).toHaveBeenCalledWith(data)
    expect(card().textContent).toContain(t('uwConflictDownloadCheck'))
    expect(document.activeElement).toBe(card().querySelector('h2'))
    expect(fake.reload).not.toHaveBeenCalled()
    // Back: step 2 with the focus on the download choice, which works again
    await pick('back')
    expect(document.activeElement).toBe(btn('download'))
    await pick('download')
    expect(send).toHaveBeenCalledTimes(2)
    await pick('go')
    expect(await done).toEqual({ kind: 'reloaded' })
    expect(fake.reload).toHaveBeenCalledTimes(1)
  })

  it('a failed download stays on step 2 with the line and does not reload', async () => {
    const fake = io({
      download: {
        bytes: async () => new ArrayBuffer(1),
        send: async () => Promise.reject(new Error('refused')),
      },
    })
    void runConflictDialog(fake)
    await pick('reload')
    await pick('download')
    expect(alertLine().textContent).toBe(t('uwConflictDownloadFailed'))
    expect(choices()).toEqual(['download', 'discard', 'back'])
    expect(fake.reload).not.toHaveBeenCalled()
  })

  it('without edit access there is no download choice', async () => {
    void runConflictDialog(
      io({
        canEdit: () => false,
        download: { bytes: async () => new ArrayBuffer(1), send: vi.fn() },
      }),
    )
    await pick('reload')
    expect(choices()).toEqual(['discard', 'back'])
  })

  it('a reload that fails keeps the dialog with the reload-failed line', async () => {
    const fake = io({ reload: vi.fn(async () => false) })
    void runConflictDialog(fake)
    await pick('reload')
    await pick('discard')
    expect(alertLine().textContent).toBe(t('uwConflictReloadFailed'))
    expect(choices()).toEqual(['discard', 'back'])
  })

  it('the X on a confirmation step cancels the whole dialog', async () => {
    const done = runConflictDialog(io())
    await pick('reload')
    card().querySelector<HTMLButtonElement>('.ow-dlg-close')!.click()
    expect(await done).toEqual({ kind: 'cancelled' })
  })
})

describe('save answers and heads', () => {
  const file = { fileId: 'f1', name: 'A.docx', versionId: 'v12' }
  it('maps every outcome to the save contract', () => {
    const cases: [ConflictOutcome, unknown][] = [
      [
        { kind: 'overwritten', versionId: 'v13' },
        { ok: true, file, versionId: 'v13' },
      ],
      [{ kind: 'reloaded' }, { ok: true, file }],
      [{ kind: 'cancelled' }, { ok: false, error: { code: 'cancelled' } }],
      [
        { kind: 'failed', code: 'unauthorized' },
        { ok: false, error: { code: 'unauthorized' } },
      ],
      [
        { kind: 'failed', code: 'forbidden' },
        { ok: false, error: { code: 'forbidden' } },
      ],
      [
        { kind: 'failed', code: 'not_found' },
        { ok: false, error: { code: 'not_found' } },
      ],
      [
        { kind: 'failed', code: 'internal' },
        { ok: false, error: { code: 'internal' } },
      ],
    ]
    for (const [outcome, want] of cases)
      expect(conflictSaveResult(outcome, file)).toMatchObject(want as object)
    expect(conflictSaveResult({ kind: 'reloaded' }, file)).not.toHaveProperty('versionId')
  })

  it('reads the head revision from `revision`, else a decimal etag, and the author from remoteVersion', () => {
    rememberRemoteVersion({
      document_id: 'd',
      revision: '7',
      version_id: 'v7',
      saved_at: '2026-10-12T08:00:00Z',
      author_name: 'An',
    })
    expect(headFromFile({ fileId: 'd', name: 'x', revision: '7' })).toMatchObject({
      revision: '7',
      author: 'An',
    })
    expect(headFromFile({ fileId: 'd', name: 'x', etag: '8' })).toEqual({ revision: '8' })
    expect(headFromFile({ fileId: 'd', name: 'x', etag: '"d-v2"' })).toEqual({})
  })
})
