/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type {
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView,
} from '../src/shared/uniwork-conflict'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkConflictDialog } from '../src/renderer/src/UniworkConflictDialog'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'

/**
 * FD-11 S5: Save a copy (conflict dialog, G5-12) gets the same Location
 * control as New / Upload. Default = the source's own folder (today's
 * behaviour, nothing extra is sent); a chosen folder goes out as the
 * save-copy action's `targetFolder`. Without the source's workspace on the
 * view (an older main) the control is not shown.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkFolderStrings.en

function makeView(extra: Record<string, unknown> = {}): UniworkConflictView {
  return {
    sessionId: 's1',
    path: '/w/contract.docx',
    documentId: 'doc-1',
    title: 'Contract.docx',
    module: 'docs',
    mine: { baseVersion: 11 },
    server: { version: 12, savedAt: '2026-10-14T08:00:00Z', by: 'Lan' },
    canEdit: true,
    online: true,
    headOffline: false,
    intent: 'none',
    keepDraft: 'ok',
    draftCap: 3,
    aiRunning: false,
    locked: 'none',
    notice: null,
    noticeArg: null,
    ...extra,
  } as UniworkConflictView
}

let host: HTMLDivElement
let root: Root
let onAct: ReturnType<typeof vi.fn>

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function render(view: UniworkConflictView) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkConflictDialog, {
          view,
          onAct,
          onClosed: () => undefined,
          onViewChange: () => undefined,
        }),
      ),
    )
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function toSaveCopyStep() {
  await click($('[data-conflict-action="save-copy"]'))
}

beforeEach(() => {
  window.aiOffice = {
    uniworkFolderTree: vi.fn(async () => ({
      ok: true,
      value: [
        { id: 'a', parentId: null, title: 'Alpha', position: 0, children: [] },
        { id: 'b', parentId: null, title: 'Beta', position: 1, children: [] },
      ],
    })),
  } as unknown as HomeApi
  onAct = vi.fn(async (_s: string, _a: UniworkConflictAction): Promise<UniworkConflictReply> => ({
    kind: 'closed',
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Save a copy: Location (S5)', () => {
  it('is not shown when the view has no workspace (older main); the copy goes as before', async () => {
    await render(makeView())
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')).toBeNull()
    await click($('[data-conflict-action="save-copy-go"]'))
    expect(onAct).toHaveBeenCalledWith('s1', { kind: 'save-copy', stopAi: false })
  })

  it("defaults to the source's folder and sends nothing extra when left alone", async () => {
    await render(makeView({ workspaceId: 'w1', parentId: 'a' }))
    await toSaveCopyStep()
    const location = $('[data-conflict-action="copy-location"]')!
    expect(location.textContent).toBe('Documents (root) › Alpha')
    await click($('[data-conflict-action="save-copy-go"]'))
    expect(onAct).toHaveBeenCalledWith('s1', { kind: 'save-copy', stopAi: false })
  })

  it('a chosen folder goes out as targetFolder', async () => {
    await render(makeView({ workspaceId: 'w1', parentId: 'a' }))
    await toSaveCopyStep()
    await click($('[data-conflict-action="copy-location"]'))
    const picker = $('.uwf-picker')!
    // the picker sits inside the dialog, so the dialog's inert sweep does not silence it
    expect($('.uw-conflict-dialog')!.contains(picker)).toBe(true)
    const beta = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Beta'),
    )!
    await click(beta)
    await click(
      Array.from(picker.querySelectorAll('button')).find((b) => b.textContent === en.ufChoose),
    )
    expect($('.uwf-picker')).toBeNull()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe('Documents (root) › Beta')
    await click($('[data-conflict-action="save-copy-go"]'))
    expect(onAct).toHaveBeenCalledWith('s1', {
      kind: 'save-copy',
      stopAi: false,
      targetFolder: { workspaceId: 'w1', folderId: 'b' },
    })
  })

  it('Escape in the picker closes the picker only, not the conflict dialog', async () => {
    await render(makeView({ workspaceId: 'w1', parentId: null }))
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe(en.ufLocationRoot)
    await click($('[data-conflict-action="copy-location"]'))
    await act(async () => {
      $('.uwf-picker [role="treeitem"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await flush()
    expect($('.uwf-picker')).toBeNull()
    expect(onAct).not.toHaveBeenCalled()
    expect($('[data-conflict-action="save-copy-go"]')).not.toBeNull()
  })

  it('shows "Same folder as the original" when parentId is undefined (offline/unknown parent) rather than top level (R1-3)', async () => {
    await render(makeView({ workspaceId: 'w1' }))
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe(en.ufSameFolder)
    await click($('[data-conflict-action="save-copy-go"]'))
    expect(onAct).toHaveBeenCalledWith('s1', { kind: 'save-copy', stopAi: false })
  })

  it('falls back to "Same folder as the original" instead of staying on "…" when loadFolderTree fails or rejects (R1-10)', async () => {
    window.aiOffice!.uniworkFolderTree = vi.fn(async () => ({
      ok: false as const,
      error: 'network' as const,
    }))
    await render(makeView({ workspaceId: 'w1', parentId: 'a' }))
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe(en.ufSameFolder)

    window.aiOffice!.uniworkFolderTree = vi.fn(() => Promise.reject(new Error('ipc down')))
    await render(makeView({ sessionId: 's2', workspaceId: 'w2', parentId: 'a' }))
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe(en.ufSameFolder)
  })

  it('resets a chosen copyFolder when view.sessionId changes (R1-14)', async () => {
    await render(makeView({ sessionId: 's1', workspaceId: 'w1', parentId: 'a' }))
    await toSaveCopyStep()
    await click($('[data-conflict-action="copy-location"]'))
    const picker = $('.uwf-picker')!
    const beta = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Beta'),
    )!
    await click(beta)
    await click(
      Array.from(picker.querySelectorAll('button')).find((b) => b.textContent === en.ufChoose),
    )
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe('Documents (root) › Beta')

    // A new conflict session arrives on the same mounted dialog instance
    await render(makeView({ sessionId: 's2', workspaceId: 'w1', parentId: 'a' }))
    await toSaveCopyStep()
    expect($('[data-conflict-action="copy-location"]')!.textContent).toBe(
      'Documents (root) › Alpha',
    )
    await click($('[data-conflict-action="save-copy-go"]'))
    expect(onAct).toHaveBeenCalledWith('s2', { kind: 'save-copy', stopAi: false })
  })
})
