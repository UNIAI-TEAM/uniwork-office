import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Lang } from '@genoffice/i18n'
import {
  CollabComposer,
  CollabPanel,
  collabStrings,
  useCollabThreads,
  type CollabAnchor,
  type CollabAnchorAdapter,
  type CollabController,
  type CollabLevel,
} from '@genoffice/ui/collab'
import '@genoffice/ui/tokens.css'
import '@genoffice/ui/collab.css'
import './harness.css'
import {
  DISCUSSION,
  LONG_QUOTE,
  MENTIONS,
  ME,
  OWN_ONE,
  RESOLVED,
  REVISIONS,
  THREAD_WITH_REPLIES,
  TOMBSTONES,
  anchorTrio,
  cm,
  docx,
  pdf,
  pptx,
  xlsx,
} from './fixtures'
import { fakeSource, type FakeSourceOptions } from './fake-source'

// every load starts without drafts left by an earlier visit, so each section shows its scripted state
try {
  for (const k of Object.keys(sessionStorage))
    if (k.startsWith('uw-collab-draft:')) sessionStorage.removeItem(k)
} catch {
  // storage can be blocked; drafts then simply cannot exist
}

/* ------------------------------------------------------------------ scenarios */

/** what a section does after its panel is ready (clicks and typing the way a person would) */
type Step =
  | { click: string }
  | { type: string; text: string }
  | { reload: true }
  | { reveal: string }
  | { startThread: CollabAnchor }
  | { wait: number }

interface Scenario {
  id: string
  group: 'S12' | 'S13' | 'S14'
  title: string
  note: string
  kind?: 'comment' | 'discussion'
  /** undefined (key absent) = the "own comments only" level */
  level?: CollabLevel
  source?: FakeSourceOptions
  /** anchors the editor cannot find (shown as "stale") */
  stale?: CollabAnchor[]
  activeSheet?: string
  /** pass a fake onViewVersion (the host's "View in version N" handler) to the controller */
  viewVersion?: boolean
  steps?: Step[]
  /** the state only holds while its control keeps focus: it autoplays alone (?only=<id>) or on Replay, never in the all-sections view */
  needsFocus?: boolean
}

const menu = (thread: string) => `[data-thread-id="${thread}"] .collab-menu-wrap > button`
const replyBtn = (thread: string) => `[data-thread-id="${thread}"] .collab-acts > .collab-link`
const TEXTBOX = 'textarea.collab-composer-input'

const docxTrio = anchorTrio(
  (i) => docx(i === 1 ? LONG_QUOTE : i === 2 ? 'A sentence that was rewritten' : 'Gone text'),
  'Anchored on a long quote: the label is cut and carries the full text.',
)
const xlsxTrio = anchorTrio(
  (i) =>
    i === 1 ? xlsx('Q3 plan', 'B7') : i === 2 ? xlsx('Budget', 'D4:F9') : xlsx('Budget', 'A1'),
  'This cell lives on another sheet, so the label names it.',
)
const pptxTrio = anchorTrio((i) => pptx(i - 1), 'The title on this slide needs a number.')
const pdfTrio = anchorTrio((i) => pdf(i * 2), 'Please double-check this table.')

const SCENARIOS: Scenario[] = [
  {
    id: 's12-list-docx',
    group: 'S12',
    title: 'List · docx anchors (exact, cut long quote, stale, lost)',
    note: 'Exact threads first in document order, lost last. The long quote is cut with … and focusable.',
    source: { comments: docxTrio.comments },
    stale: docxTrio.stale,
  },
  {
    id: 's12-list-xlsx',
    group: 'S12',
    title: 'List · xlsx anchors (other sheet named, open sheet bare)',
    note: "Active sheet is 'Budget': Budget!D4:F9 shows the bare range, 'Q3 plan'!B7 names its sheet.",
    source: { comments: xlsxTrio.comments },
    stale: xlsxTrio.stale,
    activeSheet: 'Budget',
  },
  {
    id: 's12-list-pptx',
    group: 'S12',
    title: 'List · pptx anchors (slide 1, stale 2, lost 3)',
    note: 'Ordered by slide; the label counts slides from 1.',
    source: { comments: pptxTrio.comments },
    stale: pptxTrio.stale,
  },
  {
    id: 's12-list-pdf',
    group: 'S12',
    title: 'List · pdf anchors (page 2, stale 4, lost 6)',
    note: 'Ordered by page.',
    source: { comments: pdfTrio.comments },
    stale: pdfTrio.stale,
  },
  {
    id: 's12-lost-version',
    group: 'S12',
    title: 'List · docx lost anchor with "View in version N" (TVF-2)',
    note: 'The root lost comment shows the link in its own wrapping row above Reply · … · Resolve; its reply and the exact comment have no such row.',
    source: {
      comments: [
        cm({
          id: 'v-exact',
          anchor: docx('Net revenue grew 12%'),
          body: 'An anchored comment that still resolves.',
        }),
        cm({
          id: 'v-lost',
          anchor: docx('Gone text'),
          anchor_state: 'lost',
          anchor_version_id: 'v-old',
          anchor_version_no: 3,
          body: 'The text this was attached to has been deleted.',
          author_id: ME,
          display_name: 'You',
        }),
        cm({ id: 'v-reply', parent_id: 'v-lost', body: 'Open the old version to see it.' }),
      ],
    },
    viewVersion: true,
  },
  {
    id: 's12-resolved',
    group: 'S12',
    title: 'Resolved group (opened) + Reopen',
    note: 'The collapsed "Resolved · 2" group is opened by the script; resolved threads show the Resolved badge and Reopen.',
    source: { comments: RESOLVED },
    steps: [
      { click: '.collab-group-toggle' },
      { click: '[data-thread-id="x2"] .collab-replies-toggle' },
    ],
  },
  {
    id: 's12-tombstone',
    group: 'S12',
    title: 'Tombstones (deleted root, deleted reply)',
    note: 'A deleted root shows the deleted frame with no actions; the second thread has a deleted reply between live ones.',
    source: { comments: TOMBSTONES },
  },
  {
    id: 's12-thread-replies',
    group: 'S12',
    title: 'Thread with replies · body with mention + Markdown',
    note: 'Open threads start with their replies shown. Body: current-name mention chip, unavailable mention (token label, no link), bold, italic, code, link, paragraphs.',
    source: { comments: THREAD_WITH_REPLIES, mentions: MENTIONS },
  },
  {
    id: 's12-replies-collapsed',
    group: 'S12',
    title: 'Replies collapsed',
    note: 'The replies toggle ("Replies: 3") closed by the script: the thread keeps only the root and the toggle.',
    source: { comments: THREAD_WITH_REPLIES, mentions: MENTIONS },
    steps: [{ click: '[data-thread-id="r1"] .collab-replies-toggle' }],
  },
  {
    id: 's12-reply-composer',
    group: 'S12',
    title: 'Reply composer open',
    note: 'Click Reply: the reply composer opens under the thread with its placeholder, Send and Cancel.',
    source: { comments: THREAD_WITH_REPLIES, mentions: MENTIONS },
    steps: [{ click: replyBtn('r1') }],
  },
  {
    id: 's12-new-thread',
    group: 'S12',
    title: 'New thread composer (editor "Comment" command)',
    note: 'The root composer opens at the anchor’s place in the list, under its anchor label.',
    source: { comments: docxTrio.comments },
    stale: docxTrio.stale,
    steps: [{ startThread: docx('Quarterly results were above plan') }],
  },
  {
    id: 's12-edit',
    group: 'S12',
    title: 'Inline edit',
    note: 'More actions → Edit: Save and Cancel replace the actions row.',
    source: { comments: OWN_ONE },
    steps: [{ click: menu('o1') }, { click: '[data-action="edit"]' }],
  },
  {
    id: 's12-history',
    group: 'S12',
    title: 'Edit history',
    note: 'More actions → Edit history: current text first, then earlier versions (newest first).',
    source: { comments: OWN_ONE, revisions: REVISIONS },
    steps: [{ click: menu('o1') }, { click: '[data-action="history"]' }],
  },
  {
    id: 's12-history-error',
    group: 'S12',
    title: 'Edit history · load failed',
    note: 'The history call fails: an inline message with Retry.',
    source: { comments: OWN_ONE, revisions: 'error' },
    steps: [{ click: menu('o1') }, { click: '[data-action="history"]' }],
  },
  {
    id: 's12-delete-dialog',
    needsFocus: true,
    group: 'S12',
    title: 'Delete dialog',
    note: 'More actions → Delete: the one-step confirm dialog over the panel (focus on Cancel).',
    source: { comments: OWN_ONE },
    steps: [{ click: menu('o1') }, { click: '[data-action="delete"]' }],
  },
  {
    id: 's12-view-only',
    group: 'S12',
    title: 'View-only level',
    note: 'Level "view": the badge and line show; no Reply, Resolve, Edit or Delete anywhere.',
    level: 'view',
    source: { comments: THREAD_WITH_REPLIES, mentions: MENTIONS },
  },
  {
    id: 's12-level-own',
    group: 'S12',
    title: 'Own-comments-only level',
    note: 'No level given: Reply for all, Edit / Delete / Resolve only on the comments you wrote.',
    source: { comments: THREAD_WITH_REPLIES, mentions: MENTIONS },
  },
  {
    id: 's12-status-offline',
    group: 'S12',
    title: 'Status line · offline',
    note: 'The list loaded, then a reload failed with a network error: warn line, data kept, Send off.',
    level: 'edit',
    source: { comments: docxTrio.comments, later: { code: 'network' } },
    stale: docxTrio.stale,
    steps: [{ reload: true }],
  },
  {
    id: 's12-status-server-error',
    group: 'S12',
    title: 'Status line · server error',
    note: 'A reload failed with an internal error.',
    source: { comments: docxTrio.comments, later: { code: 'internal' } },
    stale: docxTrio.stale,
    steps: [{ reload: true }],
  },
  {
    id: 's12-status-signed-out',
    group: 'S12',
    title: 'Status line · signed out',
    note: 'A reload failed with unauthorized.',
    source: { comments: docxTrio.comments, later: { code: 'unauthorized' } },
    stale: docxTrio.stale,
    steps: [{ reload: true }],
  },
  {
    id: 's12-loading',
    group: 'S12',
    title: 'Loading',
    note: 'The first list never answers: skeleton cards.',
    source: { first: 'pending' },
  },
  {
    id: 's12-empty',
    group: 'S12',
    title: 'Empty',
    note: 'No comments yet (an editor can add).',
    source: { comments: [] },
  },
  {
    id: 's12-load-error',
    group: 'S12',
    title: 'Load error',
    note: 'The first list fails: message with Retry.',
    source: { first: { code: 'internal' } },
  },
  {
    id: 's12-no-access',
    group: 'S12',
    title: 'No access',
    note: 'The first list is forbidden: no Retry.',
    source: { first: { code: 'forbidden' } },
  },
  {
    id: 's12-conflict-deleted',
    group: 'S12',
    title: 'Conflict · comment_deleted',
    note: 'Reply, type and Send: the server says the thread was deleted. The thread becomes a deleted frame; the composer and draft stay; Copy content is offered.',
    source: {
      comments: THREAD_WITH_REPLIES,
      mentions: MENTIONS,
      createError: { code: 'conflict', detailsCode: 'comment_deleted' },
    },
    steps: [
      { click: replyBtn('r1') },
      { type: TEXTBOX, text: 'Following up on this thread.' },
      { click: '.collab-composer-send' },
    ],
  },
  {
    id: 's12-notice-deleted',
    group: 'S12',
    title: 'Panel notice · revealed comment was deleted',
    note: 'A reveal of a comment that is not in the list: the panel-level line at the top.',
    source: { comments: docxTrio.comments },
    stale: docxTrio.stale,
    steps: [{ reveal: 'no-such-comment' }],
  },
  {
    id: 's13-discussion',
    group: 'S13',
    title: 'Discussion with composer',
    note: 'Time order, no anchors, a deleted post, the composer fixed at the bottom.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION, mentions: MENTIONS },
  },
  {
    id: 's13-discussion-empty',
    group: 'S13',
    title: 'Discussion · empty',
    note: 'The empty copy and the composer.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: [] },
  },
  {
    id: 's13-discussion-view-only',
    group: 'S13',
    title: 'Discussion · view-only',
    note: 'No composer, no actions.',
    kind: 'discussion',
    level: 'view',
    source: { comments: DISCUSSION, mentions: MENTIONS },
  },
  {
    id: 's14-results',
    needsFocus: true,
    group: 'S14',
    title: 'Picker · results',
    note: 'Type "@Mi" in the Discussion composer: a listbox of people with the count line.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION.slice(0, 1), mentions: MENTIONS },
    steps: [{ type: TEXTBOX, text: 'Please look, @Mi' }],
  },
  {
    id: 's14-searching',
    needsFocus: true,
    group: 'S14',
    title: 'Picker · searching',
    note: 'The search never answers ("@slow"): the searching row.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION.slice(0, 1), mentions: MENTIONS },
    steps: [{ type: TEXTBOX, text: '@slow' }],
  },
  {
    id: 's14-no-match',
    needsFocus: true,
    group: 'S14',
    title: 'Picker · no match',
    note: 'Nobody matches "@zz": the no-match row names the query.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION.slice(0, 1), mentions: MENTIONS },
    steps: [{ type: TEXTBOX, text: '@zz' }],
  },
  {
    id: 's14-no-candidates',
    needsFocus: true,
    group: 'S14',
    title: 'Picker · no candidates',
    note: 'A bare "@" and nobody else has access: the no-candidates row.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION.slice(0, 1), mentions: MENTIONS, candidates: [] },
    steps: [{ type: TEXTBOX, text: '@' }],
  },
  {
    id: 's14-error',
    needsFocus: true,
    group: 'S14',
    title: 'Picker · error',
    note: 'The search fails ("@boom"): the error row with Retry.',
    kind: 'discussion',
    level: 'edit',
    source: { comments: DISCUSSION.slice(0, 1), mentions: MENTIONS },
    steps: [{ type: TEXTBOX, text: '@boom' }],
  },
]

/* ------------------------------------------------------------------ autoplay */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// sections play one after the other: a menu or a picker closes when another section moves focus
let queue: Promise<void> = Promise.resolve()
function enqueue(job: () => Promise<void>): void {
  queue = queue.then(job, job)
}

async function waitFor(root: HTMLElement, selector: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 60; i++) {
    const el = root.querySelector<HTMLElement>(selector)
    if (el) return el
    await sleep(50)
  }
  return null
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

async function runStep(root: HTMLElement, ctl: CollabController, step: Step): Promise<void> {
  if ('wait' in step) return sleep(step.wait)
  if ('reload' in step) return ctl.reload()
  if ('reveal' in step) {
    await ctl.reveal(step.reveal).catch(() => undefined)
    return
  }
  if ('startThread' in step) return ctl.startThread({ anchor: step.startThread })
  const el = await waitFor(root, 'click' in step ? step.click : step.type)
  if (!el) return
  if ('click' in step) {
    el.click()
    await sleep(60)
    return
  }
  el.focus()
  nativeValue?.call(el, step.text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(450)
}

/* ------------------------------------------------------------------ section */

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function Panel({ s, lang, autoplay }: { s: Scenario; lang: Lang; autoplay: boolean }) {
  const kind = s.kind ?? 'comment'
  const host = useMemo(
    () => ({
      documentId: `harness-${s.id}`,
      kind,
      level: s.level,
      myUserId: ME,
      lang,
      platform: IS_MAC ? ('mac' as const) : ('other' as const),
    }),
    [s, kind, lang],
  )
  const source = useMemo(() => fakeSource(s.source), [s])
  const strings = collabStrings(lang)
  const adapter = useMemo<CollabAnchorAdapter | undefined>(() => {
    if (kind === 'discussion') return undefined
    const stale = new Set((s.stale ?? []).map((a) => JSON.stringify(a)))
    return {
      order: (a) =>
        typeof a.slide_index === 'number' ? a.slide_index : typeof a.page === 'number' ? a.page : 0,
      locate: (a) => !stale.has(JSON.stringify(a)),
      goTo: () => undefined,
      activeSheet: () => s.activeSheet,
    }
  }, [s, kind])
  const ctl = useCollabThreads(source, host, {
    adapter,
    strings,
    ...(s.viewVersion
      ? { openVersionId: 'v-head', onViewVersion: () => ({ opened: true }) }
      : undefined),
  })
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  const frame = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  // run the scripted steps once the first load settled (any state but loading)
  useEffect(() => {
    if (started.current || ctl.state === 'loading' || !frame.current) return
    started.current = true
    if (!autoplay) return
    const root = frame.current
    enqueue(async () => {
      await sleep(150)
      for (const step of s.steps ?? []) {
        if (!root.isConnected) return
        try {
          await runStep(root, ctlRef.current, step)
        } catch {
          // a missing control must not stop the page; the section just shows the state it reached
        }
      }
    })
  }, [ctl.state, s, autoplay])

  return (
    <div className="h-frame" ref={frame}>
      <CollabPanel
        controller={ctl}
        strings={strings}
        onClose={() => undefined}
        renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
      />
    </div>
  )
}

function Section({ s, lang, only }: { s: Scenario; lang: Lang; only: boolean }) {
  const [nonce, setNonce] = useState(0)
  const replay = () => {
    try {
      for (const k of Object.keys(sessionStorage))
        if (k.includes(`harness-${s.id}`)) sessionStorage.removeItem(k)
    } catch {
      // storage can be blocked; the draft then simply stays
    }
    setNonce((n) => n + 1)
  }
  return (
    <section className="h-sec" id={s.id} aria-label={s.title}>
      <div className="h-sec-head">
        <h3>{s.title}</h3>
        <code>{s.id}</code>
        <button type="button" onClick={replay}>
          Replay
        </button>
      </div>
      <p className="h-sec-note">
        {s.note}
        {s.needsFocus && !only && !nonce
          ? ' (Focus-dependent: press Replay, or open with ?only=' + s.id + '.)'
          : ''}
      </p>
      <Panel
        key={`${s.id}-${lang}-${nonce}`}
        s={s}
        lang={lang}
        autoplay={!s.needsFocus || only || nonce > 0}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ page */

type Theme = 'light' | 'dark'

function param<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(location.search).get(name)
  return allowed.includes(v as T) ? (v as T) : fallback
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => param('theme', ['light', 'dark'], 'light'))
  const [lang, setLang] = useState<Lang>(() => param('lang', ['vi', 'en'], 'vi') as Lang)
  const [width, setWidth] = useState<number>(() =>
    Number(param('width', ['300', '360', '420'], '360')),
  )
  const only = new URLSearchParams(location.search).get('only')
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = lang
    const q = new URLSearchParams(location.search)
    q.set('theme', theme)
    q.set('lang', lang)
    q.set('width', String(width))
    history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`)
  }, [theme, lang, width])

  useEffect(() => {
    const mq = matchMedia('(pointer: coarse)')
    const on = () => setCoarse(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const shown = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS
  const groups = ['S12', 'S13', 'S14'] as const
  const groupTitle = {
    S12: 'S12 · Comments panel',
    S13: 'S13 · Discussion',
    S14: 'S14 · @-mention picker',
  }

  return (
    <>
      <header className="h-bar">
        <h1>Collab panel harness</h1>
        <span className="h-seg" role="group" aria-label="Theme">
          {(['light', 'dark'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t}
            </button>
          ))}
        </span>
        <span className="h-seg" role="group" aria-label="Language">
          {(['vi', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l}
            </button>
          ))}
        </span>
        <span className="h-seg" role="group" aria-label="Panel width">
          {[300, 360, 420].map((w) => (
            <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w}px
            </button>
          ))}
        </span>
        <span className="h-note">
          pointer: coarse = <strong>{coarse ? 'yes (44px targets)' : 'no (24px targets)'}</strong>
          {' · '}the browser decides: open with touch emulation (e.g. Playwright hasTouch +
          isMobile) to see the coarse layout
        </span>
      </header>
      <nav className="h-nav" aria-label="Sections">
        {shown.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.id}
          </a>
        ))}
        {only && <a href={`?theme=${theme}&lang=${lang}&width=${width}`}>show all</a>}
      </nav>
      <main className="h-main" style={{ ['--h-width' as string]: `${width}px` }}>
        {groups.map((g) => {
          const list = shown.filter((s) => s.group === g)
          if (list.length === 0) return null
          return (
            <div key={g}>
              <h2 className="h-group">{groupTitle[g]}</h2>
              <div className="h-grid">
                {list.map((s) => (
                  <Section key={s.id} s={s} lang={lang} only={only !== null} />
                ))}
              </div>
            </div>
          )
        })}
      </main>
    </>
  )
}

// no StrictMode: its second effect pass would call the fake source twice and skip the scripted first answer
createRoot(document.getElementById('root')!).render(<App />)
