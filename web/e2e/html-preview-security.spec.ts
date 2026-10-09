// GO-B4 H2 (UNI-1014, CONTRACT C15(1)): the HTML preview runs the document's scripts like the app,
// and a hostile document still reaches neither the frame, the host nor the UniWork API.
// Production build (`npm run build:web -- --module html`) in the protocol test host, under the
// exact headers.json the host sends (frame policy on index.html, the preview's own sandboxed
// policy on preview.html). The page records what each probe got (`window.__probe`), the test
// server records every request it saw (GET /__e2e/requests), the browser records every request
// it started; the test host's state (store, saves, events) must not move.
// Run: npx playwright test -c web/e2e html-preview-security
import { test, expect, type Frame, type Page } from '@playwright/test'
import {
  built,
  cspViolations,
  encode,
  hostState,
  openModule,
  serveFixture,
  watch,
} from './text-modules'

test.skip(!built('html'), 'no dist-web/html build: npm run build:web -- --module html')

const HOSTILE_PATH = '/e2e-fixtures/HostileScripts.html'

// Everything runs inside the preview (opaque origin). `O` is the app origin (the preview's URL
// still names it), `ALT` the same server under another host name.
const HOSTILE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Hostile scripts</title>
<script>
  window.__violations = []
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__violations.push(e.violatedDirective.split(' ')[0] + ' ' + e.blockedURI))
</script>
</head><body>
<h1 id="h">Hostile scripts fixture</h1>
<p id="p">Paragraph the page must not be able to edit through the frame.</p>
<form id="post" action="/api/v1/h2-probe/form" method="post"><input name="q" value="secret"></form>
<form id="post-blank" action="/test-host/h2-probe-form-blank" method="post" target="_blank"></form>
<pre id="results">pending</pre>
<script>
;(async () => {
  const O = new URL(document.URL).origin
  const ALT = O.replace('localhost', '127.0.0.1')
  const r = {}
  const verdict = (e) => 'blocked:' + (e && e.name ? e.name : 'Error')
  const sync = (k, f) => { try { r[k] = 'ok:' + String(f()).slice(0, 120) } catch (e) { r[k] = verdict(e) } }
  const later = async (k, f, ms = 3000) => {
    try {
      r[k] = 'ok:' + String(await Promise.race([f(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))])).slice(0, 120)
    } catch (e) { r[k] = verdict(e) }
  }
  sync('origin', () => self.origin)
  // the frame and the host: cross-origin to the opaque preview
  sync('parentDocument', () => parent.document.title)
  sync('topDocument', () => top.document.title)
  sync('parentHtmlApi', () => parent.htmlApi.save)
  sync('topHost', () => JSON.stringify(top.__host.files()))
  sync('parentLocation', () => parent.location.href)
  sync('parentFrames', () => parent.frames.length)
  // the app origin's cookie and storage
  sync('cookieRead', () => document.cookie)
  sync('cookieWrite', () => (document.cookie = 'h2=1'))
  sync('localStorage', () => localStorage.getItem('h2-secret'))
  sync('sessionStorage', () => sessionStorage.length)
  sync('indexedDB', () => indexedDB.open('uniwork-office-frame-drafts'))
  // forged protocol envelopes and inspector messages, to the frame and to the host
  const env = (kind, type, payload, id) => ({ ns: 'uniwork.office.docs', v: 1, kind, type, id, payload })
  for (const w of [parent, top]) {
    w.postMessage(env('event', 'ready', { module: 'html' }, 'h2-1'), '*')
    w.postMessage(env('request', 'api.save', { fileId: 'f1', data: new ArrayBuffer(4), etag: '*' }, 'h2-2'), '*')
    w.postMessage(env('request', 'api.saveAs', { name: 'pwned.html', data: new ArrayBuffer(4) }, 'h2-3'), '*')
    w.postMessage(env('response', 'init', { ok: true }, 'h2-4'), '*')
    w.postMessage(env('event', 'save', { reason: 'user' }, 'h2-5'), '*')
    for (let version = 0; version < 8; version++) {
      w.postMessage({ type: 'gx:textEditCommit', version, sid: 1, textNodeIndex: 0, newText: 'FORGED-WINDOW' }, '*')
      w.postMessage({ type: 'gx:htmlEditCommit', version, sid: 2, html: '<b>FORGED-WINDOW</b>' }, '*')
      w.postMessage({ type: 'gx:keyCommand', version, command: 'delete' }, '*')
    }
  }
  // malformed traffic on the inspector's own port: the frame's strict parser drops it
  const port = window.__gxPreviewPort
  if (port) {
    port.postMessage({ type: 'gx:resize', version: 1, sid: 1, styles: { 'color;background': 'red' } })
    port.postMessage({ type: 'gx:htmlEditCommit', version: 1, sid: 'x', html: 'FORGED-PORT' })
    port.postMessage({ type: 'gx:keyCommand', version: 1, command: 'constructor' })
    port.postMessage({ type: 'gx:textEditCommit', version: 'all', sid: 1, textNodeIndex: 0, newText: 'FORGED-PORT' })
    port.postMessage({ ns: 'uniwork.office.html.preview', type: 'init', html: 'FORGED-PORT' })
  }
  r.port = port ? 'present' : 'absent'
  // network to the UniWork API / test host (same server, two host names)
  await later('fetchPost', () => fetch(O + '/api/v1/h2-probe/fetch', { method: 'POST', body: 'x', credentials: 'include' }).then((x) => x.status))
  await later('fetchGet', () => fetch(O + '/test-host/h2-probe-fetch-get').then((x) => x.status))
  await later('fetchAlt', () => fetch(ALT + '/api/v1/h2-probe/fetch-alt', { mode: 'no-cors' }).then((x) => x.type))
  await later('xhr', () => new Promise((ok, no) => {
    const x = new XMLHttpRequest()
    x.open('POST', O + '/api/v1/h2-probe/xhr')
    x.onload = () => ok(x.status)
    x.onerror = () => no(new Error('xhr'))
    x.send('x')
  }))
  await later('websocket', () => new Promise((ok, no) => {
    const ws = new WebSocket(O.replace(/^http/, 'ws') + '/api/v1/h2-probe/ws')
    ws.onopen = () => ok('open')
    ws.onerror = () => no(new Error('ws'))
  }))
  sync('beacon', () => navigator.sendBeacon(O + '/api/v1/h2-probe/beacon', 'x'))
  await later('eventSource', () => new Promise((ok, no) => {
    const es = new EventSource(O + '/api/v1/h2-probe/sse')
    es.onopen = () => ok('open')
    es.onerror = () => { es.close(); no(new Error('sse')) }
  }))
  await later('img', () => new Promise((ok, no) => {
    const i = new Image()
    i.onload = () => ok('loaded')
    i.onerror = () => no(new Error('img'))
    i.src = O + '/api/v1/h2-probe/img'
  }))
  await later('script', () => new Promise((ok, no) => {
    const s = document.createElement('script')
    s.onload = () => ok('loaded')
    s.onerror = () => no(new Error('script'))
    s.src = O + '/api/v1/h2-probe/script.js'
    document.head.append(s)
  }))
  await later('nestedFrame', () => new Promise((ok) => {
    const f = document.createElement('iframe')
    f.src = O + '/test-host/h2-probe-frame'
    f.onload = () => ok('load event')
    document.body.append(f)
  }), 1500)
  // navigation of the frame / host, popups with an opener
  sync('topNav', () => { top.location.href = O + '/test-host/h2-probe-topnav'; return 'assigned' })
  sync('parentNav', () => { parent.location.href = O + '/test-host/h2-probe-parentnav'; return 'assigned' })
  sync('popupBlank', () => {
    const w = window.open('', '_blank')
    if (!w) return 'null'
    try { return 'opener-parent:' + w.opener.parent.document.title } catch (e) { return 'opener-parent:' + verdict(e) }
  })
  sync('popupOpener', () => {
    const w = window.open('about:blank', 'h2popup')
    return w ? 'window' : 'null'
  })
  // form posts to the app origin
  sync('formPost', () => { document.getElementById('post').submit(); return 'submitted' })
  sync('formPostBlank', () => { document.getElementById('post-blank').submit(); return 'submitted' })
  await new Promise((ok) => setTimeout(ok, 1500))
  window.__probe = r
  document.getElementById('results').textContent = JSON.stringify(r)
})()
</script>
</body></html>
`

interface LoggedRequest {
  kind: string
  method: string
  url: string
  origin: string | null
  cookie: string | null
}

async function serverLog(page: Page): Promise<LoggedRequest[]> {
  const res = await page.request.get('/__e2e/requests')
  return (await res.json()) as LoggedRequest[]
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().includes('/preview.html'))
}

test('html preview: a hostile document with scripts reaches neither frame, host nor API', async ({
  page,
  context,
}) => {
  const problems = await watch(page)
  const popups: Page[] = []
  context.on('page', (p) => popups.push(p))
  // probe requests the browser answered (reached a server) / refused before sending
  const answered: string[] = []
  const refused: string[] = []
  context.on('response', (r) => answered.push(`${r.request().method()} ${r.url()}`))
  context.on('requestfailed', (r) => refused.push(`${r.failure()?.errorText} ${r.url()}`))
  await serveFixture(page, HOSTILE_PATH, encode(HOSTILE), 'text/html')
  // the app origin's own state the preview must not see
  await page.goto('/test-host/?module=html')
  await page.evaluate(() => {
    document.cookie = 'h2session=secret-cookie; path=/; SameSite=Lax'
    localStorage.setItem('h2-secret', 'secret-storage')
  })
  const frame = await openModule(page, 'html', { open: HOSTILE_PATH, lang: 'en' })
  await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  const before = await hostState(page)
  const eventsBefore = await page.evaluate(
    () => (window as unknown as { __host: { events: unknown[] } }).__host.events.length,
  )

  // the scripts preview: preview.html, sandboxed opaque, credentialless
  const iframe = frame.locator('iframe.preview-frame')
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-popups allow-modals',
  )
  await expect(iframe).toHaveAttribute('credentialless', '')
  await expect(iframe).toHaveAttribute('src', /\/preview\.html\?v=\d+$/)
  await expect
    .poll(() => previewFrame(page)?.evaluate(() => document.title))
    .toBe('Hostile scripts')
  const preview = previewFrame(page)!
  await expect
    .poll(() => preview.evaluate(() => (window as unknown as { __probe?: unknown }).__probe), {
      timeout: 30_000,
    })
    .toBeTruthy()
  const probe = (await preview.evaluate(
    () => (window as unknown as { __probe: Record<string, string> }).__probe,
  )) as Record<string, string>
  const violations = (await preview.evaluate(
    () => (window as unknown as { __violations: string[] }).__violations,
  )) as string[]

  // the document's scripts ran, in an opaque origin, with the inspector's port
  expect(probe.origin).toBe('ok:null')
  expect(probe.port).toBe('present')
  // frame and host out of reach
  for (const k of ['parentDocument', 'topDocument', 'parentHtmlApi', 'topHost', 'parentLocation'])
    expect(probe[k], k).toBe('blocked:SecurityError')
  // no cookie, no storage of the app origin
  for (const k of ['cookieRead', 'cookieWrite', 'localStorage', 'sessionStorage', 'indexedDB'])
    expect(probe[k], k).toMatch(/^blocked:/)
  // no network to the API / test host: connect-src 'none', no 'self' in the preview policy
  for (const k of [
    'fetchPost',
    'fetchGet',
    'fetchAlt',
    'xhr',
    'websocket',
    'eventSource',
    'img',
    'script',
  ])
    expect(probe[k], k).toMatch(/^blocked:/)
  // sendBeacon only says whether it queued the request; the policy refuses it afterwards
  // (connect-src violation below, nothing in the server log)
  expect(probe.beacon).toMatch(/^ok:(true|false)$/)
  expect(violations).toContain(`connect-src ${new URL(page.url()).origin}/api/v1/h2-probe/beacon`)
  // a nested frame of the page gets an error page (frame-src 'none'), not the test host
  expect(violations.some((v) => v.startsWith('frame-src'))).toBe(true)
  // navigation of the frame / host refused (sandbox without allow-top-navigation)
  expect(page.url()).toMatch(/\/test-host\/\?module=html/)
  expect(frame.url()).toMatch(/\/office-frame\/html\/[^/]+\/index\.html$/)
  // popups: none can reach the frame through its opener
  expect(probe.popupBlank).toMatch(/^ok:(null|opener-parent:blocked:SecurityError)$/)
  for (const p of popups) {
    const opener = await p.evaluate(() => {
      try {
        return window.opener ? `opener:${String(window.opener.parent.document)}` : 'no opener'
      } catch (e) {
        return `blocked:${(e as Error).name}`
      }
    })
    expect(opener).toMatch(/^(no opener|blocked:SecurityError)$/)
  }
  expect(probe.formPost).toBe('ok:submitted')

  // every blocked attempt is one of the intended policy refusals in the preview
  const directives = new Set(violations.map((v) => v.split(' ')[0]))
  for (const d of directives)
    expect(['connect-src', 'form-action', 'img-src', 'script-src-elem', 'frame-src']).toContain(d)
  expect(directives).toContain('connect-src')
  expect(directives).toContain('form-action')

  await page.waitForTimeout(1_500)
  // the server never saw a probe (no request left the preview), the browser never started one
  const probes = (await serverLog(page)).filter((r) => r.url.includes('h2-probe'))
  expect(probes).toEqual([])
  expect(answered.filter((r) => r.includes('h2-probe'))).toEqual([])
  for (const r of refused.filter((x) => x.includes('h2-probe')))
    expect(r).toMatch(/^(csp|net::ERR_BLOCKED_BY_CSP) /)

  // no state change: the store, saves and host events are where they were
  const after = await hostState(page)
  expect(after).toEqual(before)
  expect(after.lastSaved).toBeNull()
  const hostEvents = await page.evaluate(() =>
    (window as unknown as { __host: { events: Array<{ type: string }> } }).__host.events.map(
      (e) => e.type,
    ),
  )
  expect(hostEvents.length).toBe(eventsBefore)
  // the frame took none of the forged edits
  await frame.getByRole('tab', { name: /^Source$/ }).click()
  await expect(frame.locator('.cm-content')).toContainText('Hostile scripts fixture')
  expect(await frame.locator('.status-dirty, [data-dirty="true"]').count()).toBe(0)

  // frame + host: no CSP violation at all (the preview's refusals stay in the preview), no errors
  expect(await cspViolations(page, frame)).toEqual([])
  expect(problems.page).toEqual([])
  expect(problems.external).toEqual([])
  // console errors only from the preview's intended refusals
  const unexpected = problems.console.filter(
    (m) => !/h2-probe|Content Security Policy|sandboxed|Blocked form submission|navigat/i.test(m),
  )
  expect(unexpected).toEqual([])

  // last (it changes the store): a save without edits writes the authored bytes exactly, so none
  // of the forged edits reached the source
  await frame.locator('.cm-content').click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(encode(HOSTILE)))
})
