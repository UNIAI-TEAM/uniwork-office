// @vitest-environment jsdom
/**
 * G8-11 (UNI-1406) web frame Discussion panel (S13, lane contract §2 D4, §3.3): the claim per
 * module (invariant 8), the frame source over `comments.*` kind 'discussion', the mount (only for a
 * bound, signed-in session), `comments.changed` -> reload and `comments.reveal`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockPort, protocolError } from '../../../docs/bridge/testing/mock-port'
import { moduleFrameCapabilities } from '../../../docs/bridge/module-bridge'
import { createDocsFrameClient } from '../../../docs/protocol/client'
import { createDocsFrameHost } from '../../../docs/protocol/host'
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  type CommentsListResult,
  type DocumentComment,
  type OfficeModule,
} from '../../../docs/protocol/types'
import { ORIGIN, flush as flushWindows, wirePair } from '../../../docs/protocol/test/fake-windows'
import { FRAME_COMMENTS, frameCommentsClaim } from './claim'
import { createFrameDiscussionSource } from './source'
import { mountFrameDiscussion, type DiscussionPort } from './mount'
import { announceFrameSidePanel } from '../comments/side-panel'

// React's act() needs this flag in a plain jsdom test
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ME = '01J8X4USR0AAAAAAAAAAAAAAAA'

function post(over: Partial<DocumentComment> & { id: string }): DocumentComment {
  return {
    document_id: 'doc-1',
    author_id: ME,
    parent_id: null,
    body: `body ${over.id}`,
    kind: 'discussion',
    revision: 1,
    anchor: null,
    created_at: '2026-10-13T09:00:00Z',
    updated_at: '2026-10-13T09:00:00Z',
    display_name: 'An',
    ...over,
  }
}

function listOf(comments: DocumentComment[], token = 'lt1'): CommentsListResult {
  return { comments, mentions: [], list_token: token, unchanged: false }
}

/** the mock port plus the two comment hooks of the real client (changed event, reveal handler) */
function discussionPort(
  session: { comments?: boolean; level?: 'view' | 'edit' | 'manage' } = {},
  first: CommentsListResult = listOf([post({ id: 'p1' })]),
) {
  const mock = createMockPort({
    documentId: 'doc-1',
    capabilities: { save: true, comments: session.comments ?? true },
    user: { displayName: 'An', id: ME },
    ...(session.level ? { commentsLevel: session.level } : { commentsLevel: 'edit' }),
  } as never)
  mock.override('comments.list', () => first)
  const changed: Array<(p: { document_id: string }) => void> = []
  let revealHandler:
    ((p: { comment_id: string }, ctx: { signal: AbortSignal }) => unknown) | undefined
  const port: DiscussionPort = {
    ...mock.port,
    onCommentsChanged: (l) => (changed.push(l), () => {}),
    handleCommentsReveal: (h) => ((revealHandler = h as never), () => {}),
  }
  return {
    mock,
    port,
    sendChanged: () => changed.forEach((l) => l({ document_id: 'doc-1' })),
    reveal: async (id: string) =>
      (await revealHandler!({ comment_id: id }, { signal: new AbortController().signal })) as {
        revealed: boolean
      },
    hasRevealHandler: () => revealHandler !== undefined,
    lists: () => mock.calls.filter((c) => c.type === 'comments.list'),
  }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const disposers: Array<() => void> = []
afterEach(() => {
  act(() => {
    for (const d of disposers.splice(0)) d()
  })
  document.body.innerHTML = ''
  document.documentElement.className = ''
})

async function mount(p: ReturnType<typeof discussionPort>, opts = {}) {
  let dispose: () => void = () => {}
  await act(async () => {
    const pending = mountFrameDiscussion(p.port, opts)
    p.mock.init()
    dispose = await pending
  })
  disposers.push(dispose)
  await flush()
  return dispose
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-discussion-toggle]')
const panel = () => document.querySelector<HTMLElement>('aside.collab-panel')

// ---------------------------------------------------------------- claim (invariant 8, D4)

describe('frame claim per module (D4)', () => {
  it('markdown + html + docs (G8-12) claim comments; sheets, slides, pdf do not (until G8-13..15)', () => {
    expect(FRAME_COMMENTS).toEqual({
      markdown: true,
      html: true,
      docs: true,
      sheets: true,
      slides: false,
      pdf: false,
    })
    expect(frameCommentsClaim(true)).toEqual({ comments: true })
    expect(frameCommentsClaim(false)).toEqual({})
  })

  it('a module frame sends `comments` in ready only when its switch is on', () => {
    for (const module of ['markdown', 'html', 'sheets', 'slides', 'pdf'] as const) {
      const caps = moduleFrameCapabilities({ module, frameCapabilities: { save: true } })
      expect(caps.comments === true, module).toBe(FRAME_COMMENTS[module])
      expect(caps.save).toBe(true)
    }
    // an explicit switch wins over the table
    expect(
      moduleFrameCapabilities({ module: 'pdf', frameCapabilities: {}, frameComments: true })
        .comments,
    ).toBe(true)
    expect(
      moduleFrameCapabilities({ module: 'markdown', frameCapabilities: {}, frameComments: false })
        .comments,
    ).toBeUndefined()
  })

  it('every frame entry sets its switch explicitly (docs included)', () => {
    const root = join(__dirname, '..', '..', '..')
    const expected: Record<string, boolean> = {
      'modules/markdown/install.ts': true,
      'modules/html/install.ts': true,
      'modules/sheets/install.ts': true,
      'modules/slides/install.ts': false,
      'modules/pdf/install.ts': false,
      'docs/bridge/install.ts': true,
    }
    for (const [file, on] of Object.entries(expected)) {
      const src = readFileSync(join(root, file), 'utf8')
      expect(src, file).toMatch(new RegExp(`frameComments(: |\\s*=\\s*)${on}\\b`))
    }
  })

  it('G8-12: the Docs frame installs the comments API and keeps the Discussion panel silent on a miss', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'docs/bridge/install.ts'), 'utf8')
    // the editor S12 panel owns anchored ids and shows its own S15 line
    expect(src).toMatch(/mountFrameDiscussion\(client, \{ revealMissing: 'silent' \}\)/)
    expect(src).toMatch(/installFrameComments\(client\)/)
  })

  it('R8: the claim stays on across a re-handshake of the same document', async () => {
    const { host: hostWin, frame: frameWin } = wirePair()
    const init = {
      token: 'tok',
      tokenExpiresAt: Date.now() + 600_000,
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      apiBase: `${ORIGIN}/api`,
      apiMode: 'host-proxy' as const,
      locale: 'en',
      theme: 'light' as const,
      capabilities: { save: true, comments: true },
      commentsLevel: 'edit' as const,
      module: 'markdown' as OfficeModule,
    }
    const acks: boolean[] = []
    const host = createDocsFrameHost({
      self: hostWin,
      frame: () => frameWin,
      allowedOrigins: [ORIGIN],
      getInit: async () => init,
      refreshToken: async () => ({ token: 't2', tokenExpiresAt: Date.now() + 60_000 }),
      onInitialized: (ack: { capabilities: { comments?: boolean } }) =>
        acks.push(ack.capabilities.comments === true),
    } as never)
    const client = createDocsFrameClient({
      allowedOrigins: [ORIGIN],
      capabilities: moduleFrameCapabilities({
        module: 'markdown',
        frameCapabilities: { save: true },
      }),
      module: 'markdown',
      parent: hostWin,
      self: frameWin,
    })
    try {
      await host.whenReady()
      const s = await client.whenInitialized()
      expect(s.capabilities.comments).toBe(true)
      // every `ready` the frame sent carries the claim
      const readies = frameWin.sent.filter((m) => (m as { type?: string }).type === 'ready')
      expect(readies.length).toBeGreaterThan(0)
      for (const r of readies) {
        expect(
          (r as { payload: { capabilities: { comments?: boolean } } }).payload.capabilities
            .comments,
        ).toBe(true)
      }
      // the host re-keys the same document (a new ready instance): the effective claim never drops
      hostWin.deliver(
        {
          ns: PROTOCOL_NS,
          v: PROTOCOL_VERSION,
          id: 'f-rekey',
          kind: 'event',
          type: 'ready',
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: moduleFrameCapabilities({
              module: 'markdown',
              frameCapabilities: { save: true },
            }),
            instanceId: 'rekey',
            module: 'markdown',
          },
        },
        ORIGIN,
        frameWin,
      )
      await flushWindows(80)
      expect(s.capabilities.comments).toBe(true)
      expect(acks.length).toBeGreaterThanOrEqual(2)
      expect(acks.every(Boolean)).toBe(true)
    } finally {
      client.dispose()
      host.dispose()
    }
  })
})

// ---------------------------------------------------------------- source

describe('createFrameDiscussionSource', () => {
  it('lists and creates with kind discussion, whatever the caller asks', async () => {
    const p = discussionPort()
    p.mock.init()
    p.mock.override('comments.create', (payload) => ({
      comment: post({ id: 'n1', body: (payload as { body: string }).body }),
    }))
    const src = createFrameDiscussionSource(p.port)
    await src.list({ kind: 'comment' as never, since_token: 'lt0' })
    await src.create({ kind: 'comment' as never, body: 'hi', parent_id: 'p1' })
    expect(p.mock.calls.map((c) => [c.type, c.payload])).toEqual([
      ['comments.list', { kind: 'discussion', since_token: 'lt0' }],
      ['comments.create', { kind: 'discussion', body: 'hi', parent_id: 'p1' }],
    ])
  })

  it('forwards the id calls and mentions.search unchanged', async () => {
    const p = discussionPort()
    p.mock.init()
    for (const t of [
      'comments.update',
      'comments.delete',
      'comments.resolve',
      'comments.reopen',
      'comments.revisions',
      'mentions.search',
    ] as const) {
      p.mock.override(t, () => ({ ok: t }))
    }
    const src = createFrameDiscussionSource(p.port)
    await src.update({ comment_id: 'c', body: 'b' })
    await src.remove({ comment_id: 'c' })
    await src.resolve({ comment_id: 'c' })
    await src.reopen({ comment_id: 'c' })
    await src.revisions({ comment_id: 'c' })
    await src.searchMentions({ q: 'an', limit: 5 })
    expect(p.mock.calls.map((c) => [c.type, c.payload])).toEqual([
      ['comments.update', { comment_id: 'c', body: 'b' }],
      ['comments.delete', { comment_id: 'c' }],
      ['comments.resolve', { comment_id: 'c' }],
      ['comments.reopen', { comment_id: 'c' }],
      ['comments.revisions', { comment_id: 'c' }],
      ['mentions.search', { q: 'an', limit: 5 }],
    ])
  })

  it('maps protocol errors to the kit error (details.code first)', async () => {
    const p = discussionPort()
    p.mock.init()
    p.mock.override('comments.create', () => {
      throw new DocsProtocolError({
        code: 'conflict',
        message: 'deleted',
        retryable: false,
        details: { code: 'comment_deleted' },
      })
    })
    p.mock.override('comments.list', () => {
      throw protocolError('network')
    })
    p.mock.override('mentions.search', () => {
      throw new Error('boom')
    })
    const src = createFrameDiscussionSource(p.port)
    await expect(src.create({ kind: 'discussion', body: 'x' })).rejects.toEqual({
      code: 'conflict',
      detailsCode: 'comment_deleted',
      retryable: false,
    })
    await expect(src.list({})).rejects.toMatchObject({ code: 'network' })
    await expect(src.searchMentions({ q: '' })).rejects.toMatchObject({ code: 'internal' })
  })
})

// ---------------------------------------------------------------- mount

describe('mountFrameDiscussion', () => {
  it('no button, no panel, no request when the document is not bound (no comments capability)', async () => {
    const p = discussionPort({ comments: false })
    await mount(p)
    expect(toggle()).toBeNull()
    expect(panel()).toBeNull()
    expect(p.lists()).toHaveLength(0)
    expect(p.hasRevealHandler()).toBe(false)
  })

  it('bound: the document bar toggle opens the Discussion panel; Esc closes it and focus returns', async () => {
    const p = discussionPort()
    await mount(p)
    const btn = toggle()!
    expect(btn).not.toBeNull()
    expect(btn.textContent).toBe('Discussion')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(panel()).toBeNull()
    // the list is loaded while closed (a reveal needs it)
    expect(p.lists()).toHaveLength(1)
    expect(p.lists()[0].payload).toEqual({ kind: 'discussion' })

    await act(async () => btn.click())
    await flush()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const aside = panel()!
    expect(aside).not.toBeNull()
    expect(document.getElementById(btn.getAttribute('aria-controls')!)!.contains(aside)).toBe(true)
    expect(aside.textContent).toContain('body p1')
    expect(document.documentElement.classList.contains('uw-disc-open')).toBe(true)

    await act(async () => {
      aside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(btn)
    expect(document.documentElement.classList.contains('uw-disc-open')).toBe(false)
  })

  it('comments.changed reloads the list (with the held token)', async () => {
    const p = discussionPort()
    await mount(p)
    expect(p.lists()).toHaveLength(1)
    p.mock.override('comments.list', () => listOf([post({ id: 'p1' }), post({ id: 'p2' })], 'lt2'))
    await act(async () => p.sendChanged())
    await flush()
    expect(p.lists()).toHaveLength(2)
    expect(p.lists()[1].payload).toEqual({ kind: 'discussion', since_token: 'lt1' })
  })

  it('reveal of a discussion post opens the panel and focuses its thread', async () => {
    const p = discussionPort({}, listOf([post({ id: 'p1' }), post({ id: 'r1', parent_id: 'p1' })]))
    await mount(p)
    let result: { revealed: boolean } | undefined
    await act(async () => {
      result = await p.reveal('r1')
    })
    await flush()
    expect(result).toEqual({ revealed: true })
    expect(panel()).not.toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    const heading = document.querySelector('[data-thread-id="p1"] [data-thread-heading]')
    expect(document.activeElement).toBe(heading)
  })

  it('reveal of an id that is not a discussion post answers revealed:false (S15 notice in the panel)', async () => {
    const p = discussionPort()
    await mount(p)
    let result: { revealed: boolean } | undefined
    await act(async () => {
      result = await p.reveal('nope')
    })
    await flush()
    expect(result).toEqual({ revealed: false })
    // markdown / html: the frame panel is the page's only panel, so it shows the S15 line
    expect(panel()!.textContent).toContain('This discussion post was deleted')
  })

  it("revealMissing 'silent': a miss keeps the panel closed", async () => {
    const p = discussionPort()
    await mount(p, { revealMissing: 'silent' })
    let result: { revealed: boolean } | undefined
    await act(async () => {
      result = await p.reveal('nope')
    })
    await flush()
    expect(result).toEqual({ revealed: false })
    expect(panel()).toBeNull()
  })

  it('view level: the panel shows no composer', async () => {
    const p = discussionPort({ level: 'view' })
    await mount(p)
    await act(async () => toggle()!.click())
    await flush()
    expect(panel()!.querySelector('textarea')).toBeNull()
  })

  it('the dispose removes the bar and the panel', async () => {
    const p = discussionPort()
    const dispose = await mount(p)
    act(() => dispose())
    expect(toggle()).toBeNull()
    expect(document.querySelector('.uw-disc')).toBeNull()
  })
})

// ---------------------------------------------------------------- W11G webfix (G8-11 review + visual r1)

describe('Esc follows the kit (F3)', () => {
  /**
   * Esc on a fake kit field inside the panel: a plain textarea whose handler consumes (or ignores)
   * Esc the way the kit's composer does, so the frame rule is tested apart from the kit's own
   * Esc behaviour (which the kit lane owns)
   */
  async function escOn(p: ReturnType<typeof discussionPort>, consume: boolean) {
    await mount(p)
    await act(async () => toggle()!.click())
    await flush()
    const area = document.createElement('textarea')
    area.addEventListener('keydown', (e) => consume && e.preventDefault())
    panel()!.append(area)
    await act(async () => {
      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
  }

  it('Esc in the composer that the kit did not consume closes the panel and focuses the toggle', async () => {
    const p = discussionPort()
    await escOn(p, false)
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('Esc that the kit consumed (picker, composer cancel) keeps the panel open', async () => {
    const p = discussionPort()
    await escOn(p, true)
    expect(panel()).not.toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('narrow overlay shields the editor (visual F2)', () => {
  /** jsdom has no matchMedia: a stub whose `narrow` state the test flips */
  function stubMedia(narrow: boolean) {
    const listeners = new Set<() => void>()
    const state = { narrow }
    const win = window as unknown as { matchMedia?: unknown }
    const prev = win.matchMedia
    win.matchMedia = (query: string) => ({
      get matches() {
        return /max-width/.test(query) ? state.narrow : !state.narrow
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    })
    return {
      set: (v: boolean) => {
        state.narrow = v
        listeners.forEach((l) => l())
      },
      restore: () => {
        win.matchMedia = prev
      },
    }
  }
  const editor = () => document.getElementById('root')!

  const withEditor = () => {
    const root = document.createElement('div')
    root.id = 'root'
    root.innerHTML = '<button id="tb">tool</button>'
    document.body.append(root)
  }

  it('below 640px the editor is inert + aria-hidden while the panel is open, restored on close', async () => {
    const media = stubMedia(true)
    try {
      withEditor()
      const p = discussionPort()
      await mount(p)
      expect(editor().hasAttribute('inert')).toBe(false)
      await act(async () => toggle()!.click())
      await flush()
      expect(editor().hasAttribute('inert')).toBe(true)
      expect(editor().getAttribute('aria-hidden')).toBe('true')
      // the bar (toggle) stays outside the shielded editor
      expect(editor().contains(toggle())).toBe(false)
      await act(async () => toggle()!.click())
      await flush()
      expect(editor().hasAttribute('inert')).toBe(false)
      expect(editor().hasAttribute('aria-hidden')).toBe(false)
    } finally {
      media.restore()
    }
  })

  it('from 640px up the editor stays live (the panel sits beside it)', async () => {
    const media = stubMedia(false)
    try {
      withEditor()
      const p = discussionPort()
      await mount(p)
      await act(async () => toggle()!.click())
      await flush()
      expect(editor().hasAttribute('inert')).toBe(false)
      expect(editor().hasAttribute('aria-hidden')).toBe(false)
    } finally {
      media.restore()
    }
  })

  it('follows a viewport resize while open, and the dispose restores the editor', async () => {
    const media = stubMedia(false)
    try {
      withEditor()
      const p = discussionPort()
      const dispose = await mount(p)
      await act(async () => toggle()!.click())
      await flush()
      act(() => media.set(true))
      expect(editor().hasAttribute('inert')).toBe(true)
      act(() => media.set(false))
      expect(editor().hasAttribute('inert')).toBe(false)
      act(() => media.set(true))
      expect(editor().hasAttribute('inert')).toBe(true)
      act(() => dispose())
      expect(editor().hasAttribute('inert')).toBe(false)
      expect(editor().hasAttribute('aria-hidden')).toBe(false)
    } finally {
      media.restore()
    }
  })

  it('the stylesheet lifts the panel above the editor chrome below 640px (own stacking context)', () => {
    const css = readFileSync(join(__dirname, 'discussion.css'), 'utf8')
    const narrow = /@media \(max-width: 639\.98px\)\s*{([\s\S]*?)\n}\n/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/html\.uw-disc-open #root\s*{[^}]*isolation:\s*isolate/)
    const z = (sel: string) =>
      Number(new RegExp(`${sel}\\s*{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1])
    expect(z('\\.uw-disc')).toBeGreaterThan(0)
  })
})

describe('toggle look matches the shell pill (visual F5)', () => {
  it('has the chat icon (decorative) and a label span; the accessible name stays the label', async () => {
    const p = discussionPort()
    await mount(p)
    const btn = toggle()!
    const svg = btn.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(btn.querySelector('.uw-disc-toggle-label')!.textContent).toBe('Discussion')
    expect(btn.textContent).toBe('Discussion')
  })

  it('css: pill with border, accent-soft when open with --text label (contrast >= 4.5), tokens only', () => {
    const css = readFileSync(join(__dirname, 'discussion.css'), 'utf8')
    const rule = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      expect(at).toBeGreaterThanOrEqual(0)
      return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    }
    const base = rule('.uw-disc-toggle')
    expect(base).toMatch(/border-radius:\s*14px/)
    expect(base).toMatch(/border:\s*1px solid var\(--border\)/)
    expect(base).toMatch(/display:\s*inline-flex/)
    const open = rule(".uw-disc-toggle[aria-expanded='true']")
    expect(open).toMatch(/background:\s*var\(--accent-soft\)/)
    expect(open).toMatch(/border-color:\s*var\(--accent\)/)
    // --accent on --accent-soft is 4.18:1 in markdown dark; --text on it is >= 8.4 in every app and theme
    expect(open).toMatch(/color:\s*var\(--text\)/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })
})

// ---------------------------------------------------------------- W12G focusfix (V12-2-1)

describe("the editor's panel opening closes Discussion without moving focus", () => {
  it('Discussion closed: editor open:true leaves the focus alone and announces nothing', async () => {
    const p = discussionPort()
    await mount(p)
    const field = document.createElement('textarea')
    document.body.append(field)
    field.focus()
    const seen: Array<{ owner: string; open: boolean }> = []
    const listener = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('uniwork:frame-side-panel', listener)
    await act(async () => announceFrameSidePanel('editor', true))
    await flush()
    window.removeEventListener('uniwork:frame-side-panel', listener)
    expect(document.activeElement).toBe(field)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    // only the editor's own announcement went by: Discussion said nothing
    expect(seen).toEqual([{ owner: 'editor', open: true }])
  })

  it('Discussion open: editor open:true closes it and does not take the focus', async () => {
    const p = discussionPort()
    await mount(p)
    await act(async () => toggle()!.click())
    await flush()
    expect(panel()).not.toBeNull()
    const field = document.createElement('textarea')
    document.body.append(field)
    field.focus()
    await act(async () => announceFrameSidePanel('editor', true))
    await flush()
    expect(panel()).toBeNull()
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(field)
    expect(document.activeElement).not.toBe(toggle())
  })

  it('the close button still returns focus to the toggle', async () => {
    const p = discussionPort()
    await mount(p)
    await act(async () => toggle()!.click())
    await flush()
    const close = panel()!.querySelector<HTMLButtonElement>('.collab-close')
    expect(close).not.toBeNull()
    await act(async () => close!.click())
    await flush()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('the toggle itself closes the open panel and keeps the focus on the toggle', async () => {
    const p = discussionPort()
    await mount(p)
    await act(async () => toggle()!.click())
    await flush()
    await act(async () => toggle()!.click())
    await flush()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })
})
