// The web save conflict dialog (S5) every module shows: order and focus, the two-column table,
// the confirmation steps in the same card, the failure variants and the `save` answers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format } from '@genoffice/i18n'
import { setWebLanguage, webLanguage } from '../../docs/bridge/browser'
import {
  conflictSaveResult,
  headFromFile,
  rememberRemoteVersion,
  runConflictDialog,
  type ConflictHead,
  type ConflictIo,
  type ConflictOutcome,
  type OverwriteAttempt,
  type SaveCopyAttempt,
} from './conflict-dialog'
import { onFrameModal } from './frame-dialog'
import { webStrings, webText, type WebStringKey } from './i18n/strings-web'

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

  it('offline: the one shared reason is shown once, both buttons described by it', async () => {
    const done = runConflictDialog(io({ online: () => false }))
    await shown()
    const lines = [...card().querySelectorAll('.ow-dlg-reason')]
    expect(lines.map((l) => l.textContent)).toEqual([t('uwConflictOfflineWeb')])
    expect(btn('reload').getAttribute('aria-describedby')).toBe(lines[0]!.id)
    expect(btn('overwrite').getAttribute('aria-describedby')).toBe(lines[0]!.id)
    btn('cancel').click()
    await done
  })

  it('goes offline and back online while open: Reload and Overwrite follow, with the reason line', async () => {
    let on = true
    const reload = vi.fn(async () => true)
    const done = runConflictDialog(io({ online: () => on, reload }))
    await shown()
    expect(btn('reload').hasAttribute('aria-disabled')).toBe(false)
    expect(card().querySelectorAll('.ow-dlg-reason').length).toBe(0)

    on = false
    window.dispatchEvent(new Event('offline'))
    for (const id of ['reload', 'overwrite']) {
      expect(btn(id).getAttribute('aria-disabled')).toBe('true')
      expect(document.getElementById(btn(id).getAttribute('aria-describedby')!)!.textContent).toBe(
        t('uwConflictOfflineWeb'),
      )
    }
    // the click does nothing while offline: no step 2
    btn('reload').click()
    await flush()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])

    on = true
    window.dispatchEvent(new Event('online'))
    for (const id of ['reload', 'overwrite']) {
      expect(btn(id).hasAttribute('aria-disabled')).toBe(false)
      expect(btn(id).hasAttribute('aria-describedby')).toBe(false)
    }
    expect(card().querySelectorAll('.ow-dlg-reason').length).toBe(0)
    // the focus stays where it was
    expect(document.activeElement).toBe(btn('cancel'))
    btn('reload').click()
    await flush()
    expect(choices()).toContain('discard')
    btn('back').click()
    await flush()
    btn('cancel').click()
    await done
  })

  it('stops listening to the network once the dialog has settled', async () => {
    const online = vi.fn(() => true)
    const done = runConflictDialog(io({ online }))
    await pick('cancel')
    await done
    const calls = online.mock.calls.length
    window.dispatchEvent(new Event('offline'))
    expect(online.mock.calls.length).toBe(calls)
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
    // the outcome carries the server's reason, so the frame can show the organisation bar afterwards
    expect(await done).toEqual({
      kind: 'failed',
      code: 'forbidden',
      apiCode: 'organization_suspended',
    })
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
    // the reason speaks of the download, not of the overwrite that just failed
    const reason = card().querySelector<HTMLElement>('.ow-dlg-reasons')!.textContent
    expect(reason).toContain(t('uwConflictDownloadTooLarge'))
    expect(reason).not.toContain(t('uwConflictTooLarge'))
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

  describe('opened from the new-version bar (start: reload)', () => {
    it('opens the Reload confirm at once: no table, no Overwrite…; focus Back', async () => {
      const fake = io({ start: 'reload' })
      const done = runConflictDialog(fake)
      await shown()
      expect(card().querySelector('h2')!.textContent).toBe(t('uwConflictReloadTitle'))
      expect(card().querySelector('table')).toBeNull()
      expect(choices()).toEqual(['discard', 'back'])
      expect(document.activeElement).toBe(btn('back'))
      await pick('discard')
      expect(await done).toEqual({ kind: 'reloaded' })
      expect(fake.reload).toHaveBeenCalledTimes(1)
      // no save conflict to read: the head table is never fetched
      expect(fake.overwrite).not.toHaveBeenCalled()
    })

    it('Back (there is no step 1 to return to) ends it as cancelled', async () => {
      const fake = io({ start: 'reload' })
      const done = runConflictDialog(fake)
      await shown()
      btn('back').click()
      expect(await done).toEqual({ kind: 'cancelled' })
      expect(fake.reload).not.toHaveBeenCalled()
    })

    it('Escape ends it as cancelled', async () => {
      const fake = io({ start: 'reload' })
      const done = runConflictDialog(fake)
      await shown()
      keydown('Escape')
      expect(await done).toEqual({ kind: 'cancelled' })
      expect(fake.reload).not.toHaveBeenCalled()
    })

    it('a failed reload keeps the dialog with the line', async () => {
      const fake = io({ start: 'reload', reload: vi.fn(async () => false) })
      void runConflictDialog(fake)
      await pick('discard')
      expect(alertLine().textContent).toBe(t('uwConflictReloadFailed'))
      expect(choices()).toEqual(['discard', 'back'])
    })
  })

  describe('download cap (init.downloadMaxBytes, X-02 r2b)', () => {
    const reasons = () => card().querySelector<HTMLElement>('.ow-dlg-reasons')!

    async function openStep2(download: NonNullable<ConflictIo['download']>) {
      const done = runConflictDialog(io({ download }))
      await pick('reload')
      return { done }
    }

    it('my version over the cap: the download choice is aria-disabled with the too-large reason at open', async () => {
      const send = vi.fn(async () => {})
      const bytes = vi.fn(async () => new ArrayBuffer(101))
      await openStep2({ bytes, send, size: 101, maxBytes: 100 })
      expect(choices()).toEqual(['download', 'discard', 'back'])
      expect(btn('download').getAttribute('aria-disabled')).toBe('true')
      expect(reasons().textContent).toContain(t('uwConflictDownloadTooLarge'))
      expect(reasons().textContent).not.toContain(t('uwConflictTooLarge'))
      btn('download').click()
      await flush()
      expect(send).not.toHaveBeenCalled()
      expect(bytes).not.toHaveBeenCalled()
      // the other two choices keep working
      expect(btn('discard').getAttribute('aria-disabled')).toBeNull()
    })

    it('exactly the cap is allowed', async () => {
      const send = vi.fn(async () => {})
      await openStep2({ bytes: async () => new ArrayBuffer(100), send, size: 100, maxBytes: 100 })
      expect(btn('download').getAttribute('aria-disabled')).toBeNull()
      await pick('download')
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('under the cap is allowed', async () => {
      const send = vi.fn(async () => {})
      await openStep2({ bytes: async () => new ArrayBuffer(3), send, size: 3, maxBytes: 100 })
      expect(btn('download').getAttribute('aria-disabled')).toBeNull()
      await pick('download')
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('no cap from the host: as today, enabled until a 413 / too_large answer', async () => {
      const send = vi.fn(async () => {})
      await openStep2({ bytes: async () => new ArrayBuffer(1), send, size: 10 ** 9 })
      expect(btn('download').getAttribute('aria-disabled')).toBeNull()
      await pick('download')
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('a cap without a known size changes nothing', async () => {
      await openStep2({ bytes: async () => new ArrayBuffer(1), send: vi.fn(), maxBytes: 100 })
      expect(btn('download').getAttribute('aria-disabled')).toBeNull()
    })

    it('without the download capability there is still no download choice, cap or not', async () => {
      void runConflictDialog(io())
      await pick('reload')
      expect(choices()).toEqual(['discard', 'back'])
    })

    it('an over-cap version still reaches Discard and reload', async () => {
      const fake = io({
        download: { bytes: async () => new ArrayBuffer(5), send: vi.fn(), size: 5, maxBytes: 4 },
      })
      const done = runConflictDialog(fake)
      await pick('reload')
      await pick('discard')
      expect(await done).toEqual({ kind: 'reloaded' })
    })
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

describe('Save as a copy… (S5-03)', () => {
  const copy = () =>
    vi.fn(async (): Promise<SaveCopyAttempt> => ({ ok: true, title: 'Notes (copy)' }))

  it('sits between Reload latest and Overwrite… with edit access', async () => {
    void runConflictDialog(io({ saveCopy: copy() }))
    await shown()
    expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
    expect(btn('save-copy').textContent).toBe(t('uwConflictSaveCopy'))
    // DOM order = Tab order: Reload, copy, Overwrite
    const ids = [...card().querySelectorAll<HTMLElement>('button')].map((b) => b.dataset.choice)
    expect(ids.indexOf('reload')).toBeLessThan(ids.indexOf('save-copy'))
    expect(ids.indexOf('save-copy')).toBeLessThan(ids.indexOf('overwrite'))
  })

  it('is not offered without edit access or without a host path that makes the copy', async () => {
    void runConflictDialog(io({ saveCopy: copy(), canEdit: () => false }))
    await shown()
    expect(choices()).toEqual(['reload', 'cancel'])
    document.body.replaceChildren()
    void runConflictDialog(io())
    await shown()
    expect(choices()).toEqual(['reload', 'overwrite', 'cancel'])
  })

  it('offline: aria-disabled with its own reason, follows the network', async () => {
    let up = false
    void runConflictDialog(io({ saveCopy: copy(), online: () => up }))
    await shown()
    expect(btn('save-copy').getAttribute('aria-disabled')).toBe('true')
    expect(
      document.getElementById(btn('save-copy').getAttribute('aria-describedby')!)!.textContent,
    ).toBe(t('uwConflictSaveCopyOffline'))
    up = true
    window.dispatchEvent(new Event('online'))
    expect(btn('save-copy').hasAttribute('aria-disabled')).toBe(false)
  })

  it('opens its confirmation in the same card; Back returns to step 1 with the focus on it', async () => {
    const saveCopy = copy()
    void runConflictDialog(io({ saveCopy }))
    await pick('save-copy')
    expect(card().querySelector('.ow-dlg-title')!.textContent).toBe(t('uwConflictSaveCopyTitle'))
    expect(card().textContent).toContain('Trần An')
    expect(choices()).toEqual(['go', 'back'])
    expect(document.activeElement).toBe(btn('back'))
    btn('back').click()
    await flush()
    expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
    expect(document.activeElement).toBe(btn('save-copy'))
    expect(saveCopy).not.toHaveBeenCalled()
  })

  it('Create copy: back to step 1 with the Done line in success tone (role="status"), focus Cancel, no answer to the save (SVC-1)', async () => {
    const saveCopy = copy()
    const settled = vi.fn()
    void runConflictDialog(io({ saveCopy })).then(settled)
    await pick('save-copy')
    await pick('go')
    expect(saveCopy).toHaveBeenCalledTimes(1)
    expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
    const statusLine = card().querySelector<HTMLElement>('.ow-dlg-alert')!
    expect(statusLine.textContent).toBe(t('uwConflictSaveCopyDone', { title: 'Notes (copy)' }))
    expect(statusLine.getAttribute('role')).toBe('status')
    expect(statusLine.className).toBe('ow-dlg-alert success')
    expect(document.activeElement).toBe(btn('cancel'))
    await flush()
    expect(settled).not.toHaveBeenCalled()
  })

  it('a failed copy stays on the confirmation with the failure line in error tone (role="alert")', async () => {
    const saveCopy = vi.fn(async (): Promise<SaveCopyAttempt> => ({ ok: false }))
    const done = runConflictDialog(io({ saveCopy }))
    await pick('save-copy')
    await pick('go')
    expect(choices()).toEqual(['go', 'back'])
    expect(alertLine().textContent).toBe(t('uwConflictSaveCopyFailed'))
    expect(alertLine().getAttribute('role')).toBe('alert')
    expect(alertLine().className).toBe('ow-dlg-alert')
    // closing from there is a plain cancel: the host's save stays unanswered by any new version
    card().querySelector<HTMLButtonElement>('.ow-dlg-close')!.click()
    expect(await done).toEqual({ kind: 'cancelled' })
  })
})

describe('View differences (S5-04)', () => {
  const view = (text = 'diff body') => {
    const el = document.createElement('div')
    el.className = 'the-diff'
    el.textContent = text
    return el
  }

  it('is a button between the table and Reload latest, in DOM order, when the module has a compare view', async () => {
    void runConflictDialog(io({ viewDiff: async () => view() }))
    await shown()
    const diff = btn('diff')
    expect(diff.textContent).toBe(t('uwConflictViewDiff'))
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(card().querySelector('table')!, diff)).toBe(true)
    expect(follows(diff, btn('reload'))).toBe(true)
  })

  it('other modules leave it out', async () => {
    void runConflictDialog(io())
    await shown()
    expect(document.querySelector('[data-choice="diff"]')).toBeNull()
  })

  it('opens the comparison as a step of the same card; Back returns to step 1 with the focus on the link', async () => {
    const viewDiff = vi.fn(async () => view())
    const done = vi.fn()
    void runConflictDialog(io({ viewDiff })).then(done)
    await pick('diff')
    expect(viewDiff).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
    expect(card().querySelector('.the-diff')!.textContent).toBe('diff body')
    expect(card().querySelector('.ow-dlg-title')!.textContent).toBe(t('uwConflictViewDiff'))
    expect(choices()).toEqual(['back'])
    expect(document.activeElement).toBe(btn('back'))
    btn('back').click()
    await flush()
    expect(choices()).toEqual(['diff', 'reload', 'overwrite', 'cancel'])
    expect(document.activeElement).toBe(btn('diff'))
    expect(done).not.toHaveBeenCalled()
  })

  it('the X on the comparison cancels the whole dialog', async () => {
    const done = runConflictDialog(io({ viewDiff: async () => view() }))
    await pick('diff')
    card().querySelector<HTMLButtonElement>('.ow-dlg-close')!.click()
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('shows the comparison step at once with a pending line; Back, Esc and X answer while it loads (UXF-fe-d1-1)', async () => {
    let release!: (el: HTMLElement) => void
    const viewDiff = vi.fn(() => new Promise<HTMLElement>((r) => (release = r)))
    const done = vi.fn()
    void runConflictDialog(io({ viewDiff })).then(done)
    await pick('diff')
    // the step is on screen although the comparison is not built yet
    expect(card().querySelector('.ow-dlg-title')!.textContent).toBe(t('uwConflictViewDiff'))
    expect(choices()).toEqual(['back'])
    expect(card().textContent).toContain(t('uwConflictDiffPending'))
    expect(card().querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(document.activeElement).toBe(btn('back'))
    // the comparison replaces the pending line
    release(view())
    await flush()
    expect(card().textContent).not.toContain(t('uwConflictDiffPending'))
    expect(card().querySelector('.the-diff')!.textContent).toBe('diff body')
    expect(card().querySelector('[aria-busy="true"]')).toBeNull()
    expect(done).not.toHaveBeenCalled()
  })

  it('Esc while the comparison loads goes back to step 1; a late comparison is ignored', async () => {
    let release!: (el: HTMLElement) => void
    const done = vi.fn()
    void runConflictDialog(
      io({ viewDiff: () => new Promise<HTMLElement>((r) => (release = r)) }),
    ).then(done)
    await pick('diff')
    keydown('Escape')
    await flush()
    expect(choices()).toEqual(['diff', 'reload', 'overwrite', 'cancel'])
    expect(document.activeElement).toBe(btn('diff'))
    release(view('LATE-VIEW'))
    await flush()
    expect(card().textContent).not.toContain('LATE-VIEW')
    expect(done).not.toHaveBeenCalled()
  })

  it('the X while the comparison loads cancels the whole dialog', async () => {
    const done = runConflictDialog(io({ viewDiff: () => new Promise<HTMLElement>(() => {}) }))
    await pick('diff')
    card().querySelector<HTMLButtonElement>('.ow-dlg-close')!.click()
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('a compare view that throws shows the failed line with Back, never the raw error (UXF-fe-d1-2)', async () => {
    const done = vi.fn()
    void runConflictDialog(
      io({
        viewDiff: async () => {
          throw new Error('no panel')
        },
      }),
    ).then(done)
    await pick('diff')
    await flush()
    expect(card().textContent).toContain(t('uwConflictDiffFailed'))
    expect(card().textContent).not.toContain('no panel')
    expect(card().textContent).not.toContain(t('uwConflictDiffPending'))
    expect(choices()).toEqual(['back'])
    btn('back').click()
    await flush()
    expect(choices()).toEqual(['diff', 'reload', 'overwrite', 'cancel'])
    expect(done).not.toHaveBeenCalled()
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

describe('SIZE-F1: Overwrite / Save as a copy over limits.max_bytes', () => {
  const MB = 1024 * 1024

  it('stays on step 1 with uwConflictTooLargeWithLimit when sizeBytes > maxBytes on Overwrite or Save as a copy, while keeping download active', async () => {
    const send = vi.fn(async () => {})
    const overwrite = vi.fn(async (): Promise<OverwriteAttempt> => ({ ok: true }))
    const saveCopy = vi.fn(async () => ({ ok: true as const, title: 'Copy.docx' }))
    const maxBytes = 200 * MB
    const sizeBytes = 200 * MB + 1
    const fake = io({
      overwrite,
      saveCopy,
      sizeBytes,
      maxBytes,
      download: {
        bytes: async () => new ArrayBuffer(4),
        send,
        size: sizeBytes,
        maxBytes,
      },
    })
    const done = runConflictDialog(fake)

    // Overwrite stays on step 1 without calling io.overwrite
    await pick('overwrite')
    expect(overwrite).not.toHaveBeenCalled()
    expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
    expect(alertLine().textContent).toBe(
      format(t('uwConflictTooLargeWithLimit'), { size: '200.1 MB', max: '200 MB' }),
    )
    expect(alertLine().textContent).not.toContain('Download my copy')
    expect(alertLine().textContent).toContain('Reload latest')
    // Save as a copy also stays on step 1 without calling io.saveCopy, using copy-specific text (SVC-3)
    await pick('save-copy')
    expect(saveCopy).not.toHaveBeenCalled()
    expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
    expect(alertLine().textContent).toBe(
      format(t('uwConflictSaveCopyTooLargeWithLimit'), { size: '200.1 MB', max: '200 MB' }),
    )
    expect(alertLine().textContent).not.toContain('Download my copy')

    // Reload -> "Download my copy, then reload" stays active (not aria-disabled)
    await pick('reload')
    expect(btn('download').getAttribute('aria-disabled')).toBeNull()
    await pick('download')
    expect(send).toHaveBeenCalledTimes(1)
    await pick('go')
    expect(await done).toEqual({ kind: 'reloaded' })
  })

  it('server 413 too_large with details.max_bytes on Overwrite shows uwConflictTooLargeWithLimit and keeps download active', async () => {
    const send = vi.fn(async () => {})
    const fake = io({
      sizeBytes: 55 * MB,
      overwrite: vi.fn(async (): Promise<OverwriteAttempt> => ({
        ok: false,
        error: {
          code: 'too_large',
          message: 'HTTP 413',
          details: { max_bytes: 50 * MB },
        },
      })),
      download: {
        bytes: async () => new ArrayBuffer(4),
        send,
      },
    })
    const done = runConflictDialog(fake)
    await pick('overwrite')
    await pick('go')
    expect(alertLine().textContent).toBe(
      format(t('uwConflictTooLargeWithLimit'), { size: '55 MB', max: '50 MB' }),
    )
    await pick('reload')
    expect(btn('download').getAttribute('aria-disabled')).toBeNull()
    await pick('back')
    await pick('cancel')
    expect(await done).toEqual({ kind: 'cancelled' })
  })

  it('Save as a copy too-large (SVC-3): names actions that exist on step 1 in both vi and en, and maps file_too_large / too_large', async () => {
    const prevLang = webLanguage()
    try {
      // 1. Vietnamese (vi): server 413 file_too_large with details.max_bytes
      setWebLanguage('vi')
      const saveCopyVi = vi.fn(async (): Promise<SaveCopyAttempt> => ({
        ok: false,
        error: {
          code: 'too_large',
          status: 413,
          message: 'HTTP 413',
          details: { code: 'file_too_large', max_bytes: 200 * MB },
        },
      }))
      const doneVi = runConflictDialog(
        io({
          sizeBytes: 200 * MB + 1,
          saveCopy: saveCopyVi,
        }),
      )
      await pick('save-copy')
      await pick('go')
      expect(saveCopyVi).toHaveBeenCalledTimes(1)
      expect(choices()).toEqual(['reload', 'save-copy', 'overwrite', 'cancel'])
      expect(alertLine().getAttribute('role')).toBe('alert')
      expect(alertLine().textContent).toBe(
        format(webText('vi', 'uwConflictSaveCopyTooLargeWithLimit'), {
          size: '200,1 MB',
          max: '200 MB',
        }),
      )
      expect(alertLine().textContent).not.toContain('Tải bản của tôi')
      expect(alertLine().textContent).toContain('Tải lại bản mới nhất')
      await pick('cancel')
      expect(await doneVi).toEqual({ kind: 'cancelled' })

      // 2. English (en): server file_too_large with details.fields.max_bytes
      document.body.replaceChildren()
      setWebLanguage('en')
      let call = 0
      const saveCopyEn = vi.fn(async (): Promise<SaveCopyAttempt> => {
        call += 1
        return call === 1
          ? {
              ok: false,
              error: {
                code: 'invalid_arg',
                message: 'file_too_large',
                details: { apiCode: 'file_too_large', fields: { max_bytes: 50 * MB } },
              },
            }
          : {
              ok: false,
              error: {
                code: 'too_large',
                message: 'HTTP 413',
              },
            }
      })
      const doneEn = runConflictDialog(
        io({
          sizeBytes: 55 * MB,
          saveCopy: saveCopyEn,
        }),
      )
      await pick('save-copy')
      await pick('go')
      expect(alertLine().textContent).toBe(
        format(webText('en', 'uwConflictSaveCopyTooLargeWithLimit'), {
          size: '55 MB',
          max: '50 MB',
        }),
      )
      expect(alertLine().textContent).not.toContain('Download my copy')
      expect(alertLine().textContent).toContain('Reload latest')
      await pick('cancel')
      expect(await doneEn).toEqual({ kind: 'cancelled' })
    } finally {
      setWebLanguage(prevLang)
    }
  })

  it('SVF-7 / RFR2-1 / RFR2-2: step-1 too-large messages in all 19 locales never name the non-existent webSaveBlockDownload button and explain that Reload latest downloads the version', () => {
    for (const [lang, dict] of Object.entries(webStrings)) {
      expect(dict.uwConflictTooLargeWithLimit, `${lang} uwConflictTooLargeWithLimit`).not.toContain(
        dict.webSaveBlockDownload,
      )
      expect(dict.uwConflictSaveCopyTooLarge, `${lang} uwConflictSaveCopyTooLarge`).not.toContain(
        dict.webSaveBlockDownload,
      )
      expect(
        dict.uwConflictSaveCopyTooLargeWithLimit,
        `${lang} uwConflictSaveCopyTooLargeWithLimit`,
      ).not.toContain(dict.webSaveBlockDownload)
    }
    for (const lang of ['ar', 'he', 'hi', 'ko', 'th'] as const) {
      const dict = webStrings[lang]
      expect(dict.uwConflictTooLargeWithLimit).toContain(dict.uwConflictReloadTitle)
      expect(dict.uwConflictSaveCopyTooLarge).toContain(dict.uwConflictReloadTitle)
      expect(dict.uwConflictSaveCopyTooLargeWithLimit).toContain(dict.uwConflictReloadTitle)
    }
  })
})
