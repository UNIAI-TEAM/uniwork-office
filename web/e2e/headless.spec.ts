// UNI-1013 headless entry (web/docs/bridge/headless.ts, contract: web/docs/protocol/README.md
// "Headless entry"): the built bundle, loaded TOP-LEVEL as index.html?headless=1&open=<fixture>,
// opens the document without a protocol host and runs the renderer's headless-export path.
//
// 1. engine path: the same page shim dev-uniwork's office-engine injects
//    (apps/office-engine/src/worker/docs-pdf.ts PAGE_SHIM, copied verbatim below) answers
//    exportPdf / printPdfBuffer / saveMergedPdf with page.pdf() using the engine's printParams;
//    the merged PDF must have the expected page count per fixture.
// 2. no shim: the bridge's own readiness signal (data-docs-headless) goes opening -> opened -> done
//    and the document is on screen.
// 3. framed: the same URL inside a same-origin iframe is inert (no fetch of ?open=, no signal).
// Every test fails on a console error or page error.
import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const OUT = resolve(repoRoot, 'web/e2e/.results/headless')
mkdirSync(OUT, { recursive: true })

const FIXTURES: Array<{ name: string; url: string; local?: string; text: string; pages: number }> =
  [
    { name: 'simple', url: '/fixtures/simple.docx', text: '第一段', pages: 1 },
    { name: 'kitchen-sink', url: '/fixtures/kitchen-sink.docx', text: '普通段落', pages: 1 },
    // not in fixtures/generated: served from web/fixtures like docs-web.spec.ts does
    {
      name: 'long',
      url: '/fixtures/long.docx',
      local: resolve(repoRoot, 'web/fixtures/long.docx'),
      text: 'Chapter 1',
      pages: 34,
    },
  ]

const headlessUrl = (doc: string) => `/index.html?headless=1&open=${encodeURIComponent(doc)}`

/** dev-uniwork apps/office-engine/src/worker/docs-pdf.ts PAGE_SHIM (verbatim) */
const PAGE_SHIM = `(() => {
  let real;
  let consumed = false;
  let next = 0;
  const pending = new Map();
  const call = (msg) => new Promise((ok) => {
    const id = ++next;
    pending.set(id, ok);
    window.__uePdf(JSON.stringify({ id, ...msg }));
  });
  window.__ueReply = (id, value) => {
    const ok = pending.get(id);
    pending.delete(id);
    if (ok) ok(value);
  };
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    get: () => real,
    set(v) {
      real = v;
      v.consumeHeadlessExport = async () => {
        if (consumed) return null;
        consumed = true;
        return { outPath: 'engine:output.pdf', format: 'pdf' };
      };
      v.headlessExportDone = (report) => { void call({ kind: 'done', ok: report && report.ok === true, error: report && report.error }); };
      v.exportPdf = (_name, w, h, _out, scale) => call({ kind: 'print', w, h, scale });
      v.printPdfBuffer = (w, h, scale) => call({ kind: 'part', w, h, scale });
      v.saveMergedPdf = (_name, parts) => call({ kind: 'merge', parts });
    },
  });
})();`

/** docs-pdf.ts printParams, as page.pdf() options (desktop webContents.printToPDF parity) */
function pdfOptions(w: number, h: number, scale?: number) {
  return {
    width: `${w / 1440}in`,
    height: `${h / 1440}in`,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
    printBackground: true,
    preferCSSPageSize: false,
    ...(scale && scale > 0 && scale !== 1 ? { scale } : {}),
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

interface PrintCall {
  id: number
  kind: 'print' | 'part' | 'merge' | 'done'
  w?: number
  h?: number
  scale?: number
  parts?: string[]
  ok?: boolean
  error?: string
}

for (const fx of FIXTURES) {
  test(`engine path: ${fx.name} -> ${fx.pages}-page PDF`, async ({ page }) => {
    const errors = watchErrors(page)
    // the engine's viewport (docs-pdf.ts VIEWPORT)
    await page.setViewportSize({ width: 1360, height: 900 })
    const parts: Buffer[] = []
    let result: Buffer | null = null
    let printCalls = 0
    let settle!: (report: { ok: boolean; error?: string }) => void
    const finished = new Promise<{ ok: boolean; error?: string }>((r) => (settle = r))
    const answer = async (msg: PrintCall): Promise<unknown> => {
      switch (msg.kind) {
        case 'print':
          printCalls++
          result = await page.pdf(pdfOptions(msg.w ?? 0, msg.h ?? 0, msg.scale))
          return { ok: true, path: 'engine:output.pdf' }
        case 'part':
          printCalls++
          parts.push(await page.pdf(pdfOptions(msg.w ?? 0, msg.h ?? 0, msg.scale)))
          return { ok: true, base64: `ue-part:${parts.length - 1}` }
        case 'merge': {
          const merged = await PDFDocument.create()
          for (const marker of msg.parts ?? []) {
            const part = parts[Number(/^ue-part:(\d+)$/.exec(marker)?.[1] ?? NaN)]
            if (!part) throw new Error(`unknown part ${marker}`)
            const src = await PDFDocument.load(part)
            for (const p of await merged.copyPages(src, src.getPageIndices())) merged.addPage(p)
          }
          result = Buffer.from(await merged.save())
          return { ok: true, path: 'engine:output.pdf' }
        }
        default:
          return { ok: false, error: 'unknown_call' }
      }
    }
    await page.exposeFunction('__uePdf', (payload: string) => {
      const msg = JSON.parse(payload) as PrintCall
      if (msg.kind === 'done') return settle({ ok: msg.ok === true, error: msg.error })
      void answer(msg)
        .catch((err: unknown) => ({ ok: false, error: String(err) }))
        .then((value) =>
          page.evaluate(([id, v]) => (window as any).__ueReply(id, v), [msg.id, value] as const),
        )
        .catch(() => {})
    })
    await page.addInitScript(PAGE_SHIM)
    if (fx.local) {
      const body = readFileSync(fx.local)
      await page.route(`**${fx.url}`, (route) =>
        route.fulfill({
          body,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
    }

    const docFetch = page.waitForRequest((r) => r.url().endsWith(fx.url))
    await page.goto(headlessUrl(fx.url))
    expect((await docFetch).headers()['cookie']).toBeUndefined()
    const report = await finished
    expect(report, `renderer report: ${report.error ?? ''}`).toEqual({ ok: true, error: undefined })
    expect(result, 'renderer printed nothing').not.toBeNull()

    writeFileSync(resolve(OUT, `${fx.name}.pdf`), result!)
    const pageCount = (await PDFDocument.load(result!)).getPageCount()
    console.log(`headless ${fx.name}: ${pageCount} page(s), ${printCalls} print call(s)`)
    expect(pageCount).toBe(fx.pages)
    // the page is the read-only, light, top-level headless entry
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light')
    await expect(page.getByText(fx.text, { exact: false }).first()).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('no shim: the readiness signal fires and the document renders', async ({ page }) => {
  const errors = watchErrors(page)
  const states: string[] = []
  await page.exposeFunction('__recordHeadless', (state: string) => states.push(state))
  await page.addInitScript(() =>
    window.addEventListener('docs-web:headless', (e) =>
      (window as any).__recordHeadless((e as CustomEvent).detail.state),
    ),
  )
  await page.goto(headlessUrl('/fixtures/simple.docx'))
  await expect(page.locator('html')).toHaveAttribute('data-docs-headless', 'done', {
    timeout: 120_000,
  })
  const status = await page.evaluate(() => (window as any).__docsWebHeadless)
  expect(status.state).toBe('done')
  expect(status.prints.length).toBeGreaterThan(0)
  expect(states).toEqual(['opening', 'opened', 'done'])
  await expect(page.locator('.ProseMirror').getByText('第一段').first()).toBeVisible()
  expect(await page.locator('html').getAttribute('data-theme')).toBe('light')
  expect(errors).toEqual([])
})

test('framed: ?headless=1&open= is ignored', async ({ page }) => {
  const errors = watchErrors(page)
  const fetched: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/fixtures/')) fetched.push(r.url())
  })
  // a same-origin host page that embeds the bundle with the headless URL
  await page.route('**/__framed-headless.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><iframe id="f" style="width:1200px;height:800px" src="${headlessUrl('/fixtures/simple.docx')}"></iframe>`,
    }),
  )
  await page.goto('/__framed-headless.html')
  const frame = (await (await page.waitForSelector('#f')).contentFrame())!
  // the bridge has run and the renderer mounted (the frame waits for a host that never answers)
  await frame.waitForFunction(() => (window as any).__docsWebBridge === true)
  await frame.locator('#root > *').first().waitFor({ state: 'attached', timeout: 30_000 })
  expect(await frame.evaluate(() => (window as any).__docsWebHeadless)).toBeUndefined()
  expect(await frame.locator('html').getAttribute('data-docs-headless')).toBeNull()
  expect(await frame.evaluate(() => (window as any).desktop.consumeHeadlessExport())).toBeNull()
  expect(fetched).toEqual([])
  expect(errors).toEqual([])
})
