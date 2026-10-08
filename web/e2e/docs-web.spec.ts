// UNI-1011 W7: for each of 3 docx fixtures, in the web build of the Docs renderer:
// open -> editable -> type marker -> bold -> insert table -> save -> reopen saved bytes -> assert.
// Every step is recorded (pass/fail + error) to docs/web-spike/screenshots/results.json and the
// test fails at the end if any step failed; a failed step does not stop independent later steps.
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import JSZip from 'jszip'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const SHOTS = resolve(repoRoot, 'docs/web-spike/screenshots')
mkdirSync(SHOTS, { recursive: true })

interface DocCase {
  name: string
  /** URL path the renderer is told to open */
  url: string
  /** local file served for that URL when it is not in fixtures/generated */
  local?: string
  /** text from the document that must be visible once it is loaded */
  expectText: string
  /** table count in the source file (for the table-count delta) */
  note: string
}

const DOCS: DocCase[] = [
  { name: 'simple', url: '/fixtures/simple.docx', expectText: '第一段', note: 'headline + 2 paragraphs' },
  {
    name: 'kitchen-sink',
    url: '/fixtures/kitchen-sink.docx',
    expectText: '普通段落',
    note: 'headings, list, link, 1 table (2x2), 1 inline image, equation',
  },
  {
    name: 'long',
    url: '/fixtures/long.docx',
    local: resolve(repoRoot, 'web/fixtures/long.docx'),
    expectText: 'Chapter 1',
    note: '50 chapters x 8 paras + 5 tables (~50 pages A4)',
  },
]

type StepResult = { doc: string; step: string; ok: boolean; ms: number; detail?: string }
const results: StepResult[] = []

const EDITOR = '.ProseMirror[contenteditable="true"]'

function attachConsole(page: Page, lines: string[]): void {
  const stamp = () => new Date().toISOString()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      lines.push(`${stamp()} console.${m.type()}: ${m.text()}  @ ${m.location().url}:${m.location().lineNumber}`)
  })
  page.on('pageerror', (e) => lines.push(`${stamp()} pageerror: ${e.message}\n${e.stack ?? ''}`))
  page.on('requestfailed', (r) =>
    lines.push(`${stamp()} requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`),
  )
  page.on('response', (r) => {
    if (r.status() >= 400) lines.push(`${stamp()} http ${r.status()}: ${r.url()}`)
  })
}

/** serve a body for `urlPath` (same origin) so the renderer can fetch it */
async function serveBytes(ctx: BrowserContext, urlPath: string, body: Buffer): Promise<void> {
  await ctx.route(`**${urlPath}`, (route) =>
    route.fulfill({
      status: 200,
      body,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'cache-control': 'no-store',
      },
    }),
  )
}

async function openDoc(page: Page, urlPath: string, expectText: string): Promise<void> {
  await page.goto(`/?open=${encodeURIComponent(urlPath)}`)
  const loaded = () =>
    page
      .locator(EDITOR)
      .first()
      .getByText(expectText, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
  try {
    await loaded()
  } catch (err) {
    // no ?open support (or it failed): fall back to the startup hook W5 exposes
    const hasHook = await page.evaluate(
      () => typeof (window as any).__docsWeb?.openUrl === 'function',
    )
    if (!hasHook) throw err
    await page.evaluate((u) => (window as any).__docsWeb.openUrl(u), urlPath)
    await loaded()
  }
}

/** ProseMirror model summary (tiptap exposes the editor on the .ProseMirror element) */
async function model(page: Page, marker = ''): Promise<string> {
  return page.evaluate((marker) => {
    const e = (document.querySelector('.ProseMirror') as any)?.editor
    if (!e) return 'no editor handle'
    const kids = e.state.doc.content.content.slice(-4)
    return `${e.state.doc.childCount} blocks; last: ` + kids.map((n: any) => `${n.type.name}:${JSON.stringify(n.textContent.slice(0, 30))}${n.firstChild?.marks?.length ? '[' + n.firstChild.marks.map((m: any) => m.type.name) + ']' : ''}`).join(' / ') + ` sel=${e.state.selection.from}-${e.state.selection.to}` + (marker ? ` hasMarker=${e.state.doc.textContent.includes(marker)}` : '')
  }, marker)
}

/** Large docs open progressively (phased-content.ts): read-only while the tail streams. Wait for it to settle. */
async function waitForFullLoad(page: Page): Promise<string> {
  const t0 = Date.now()
  let last = -1
  let stableFor = 0
  await expect
    .poll(
      async () => {
        const st = await page.evaluate(() => {
          const e = (document.querySelector('.ProseMirror') as any)?.editor
          return e ? { n: e.state.doc.childCount, editable: e.isEditable } : null
        })
        if (!st || !st.editable) { last = -1; stableFor = 0; return false }
        stableFor = st.n === last ? stableFor + 1 : 0
        last = st.n
        return stableFor >= 3
      },
      { intervals: [400], timeout: 60_000, message: 'editor never became editable with a stable block count' },
    )
    .toBe(true)
  return `fully loaded (${last} blocks, editable) after ${Date.now() - t0}ms`
}

/** PM syncs the DOM selection asynchronously after Ctrl+End etc.: wait until the model caret stops moving. */
async function settleCaret(page: Page): Promise<number> {
  let prev = -2
  let same = 0
  await expect
    .poll(
      async () => {
        const pos = await page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.state.selection.from as number)
        same = pos === prev ? same + 1 : 0
        prev = pos
        return same >= 3
      },
      { intervals: [150], timeout: 10_000 },
    )
    .toBe(true)
  return prev
}

async function tableCount(page: Page): Promise<number> {
  return page.locator(`${EDITOR} table`).count()
}

/** Capture the saved docx: download event (preferred) or window.__docsWeb.lastSaved(). */
async function saveAndCapture(page: Page): Promise<Buffer> {
  await page.locator(EDITOR).first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {})
  const dl = page.waitForEvent('download', { timeout: 20_000 }).then(async (d) => {
    const path = await d.path()
    return { how: 'download', bytes: readFileSync(path!), name: d.suggestedFilename() }
  })
  const hook = (async () => {
    // poll lastSaved(); only counts if the shim exposes it
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500)
      const v = await page.evaluate(async () => {
        const f = (window as any).__docsWeb?.lastSaved
        if (typeof f !== 'function') return null
        const r = await f()
        if (!r) return null
        const b: any = r.bytes ?? r.data ?? r
        return Array.from(new Uint8Array(b.buffer ? b.buffer : b))
      })
      if (v && v.length > 100) return { how: 'lastSaved', bytes: Buffer.from(v), name: '' }
    }
    throw new Error('no lastSaved()')
  })()
  await page.keyboard.press('Control+s')
  const winner = await Promise.any([dl, hook]).catch((e: AggregateError) => {
    throw new Error(`save produced neither a download nor lastSaved(): ${e.errors.map((x) => x.message).join(' | ')}`)
  })
  test.info().annotations.push({ type: 'save', description: `${winner.how} ${winner.name} ${winner.bytes.length}B` })
  return winner.bytes
}

for (const d of DOCS) {
  test(`docs-web: ${d.name}`, async ({ page, context }) => {
    const consoleLines: string[] = []
    attachConsole(page, consoleLines)
    const marker = `E2EMARK${d.name.replace(/\W/g, '').toUpperCase()}${Date.now().toString(36).toUpperCase()}`
    const shot = (step: string, p: Page = page) =>
      p.screenshot({ path: resolve(SHOTS, `${d.name}-${step}.png`) }).catch(() => {})
    const failed: Record<string, boolean> = {}

    async function step(name: string, needs: string[], fn: () => Promise<string | void>): Promise<void> {
      const t0 = Date.now()
      const blocked = needs.filter((n) => failed[n])
      if (blocked.length) {
        results.push({ doc: d.name, step: name, ok: false, ms: 0, detail: `skipped: needs ${blocked.join(',')}` })
        failed[name] = true
        return
      }
      try {
        const detail = await fn()
        results.push({ doc: d.name, step: name, ok: true, ms: Date.now() - t0, detail: detail || undefined })
      } catch (e) {
        failed[name] = true
        results.push({ doc: d.name, step: name, ok: false, ms: Date.now() - t0, detail: String((e as Error).message).replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join(' ⏎ ') })
        await shot(`${name}-FAILED`)
      }
    }

    if (d.local) await serveBytes(context, d.url, readFileSync(d.local))

    let tablesBefore = 0
    let saved: Buffer | null = null

    await step('open', [], async () => {
      const t0 = Date.now()
      await openDoc(page, d.url, d.expectText)
      const loaded = await waitForFullLoad(page)
      tablesBefore = await tableCount(page)
      await shot('open')
      return `text visible in ${Date.now() - t0}ms; ${loaded}; tables=${tablesBefore}`
    })

    await step('editable', ['open'], async () => {
      await expect(page.locator(EDITOR).first()).toBeVisible()
      await page.locator(EDITOR).first().click()
      const focused = await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))
      expect(focused, 'focus is inside .ProseMirror').toBe(true)
    })

    await step('type-marker', ['editable'], async () => {
      await page.keyboard.press('Control+End')
      await settleCaret(page)
      await page.keyboard.press('Enter')
      await page.keyboard.type(marker, { delay: 15 })
      await expect(page.locator(EDITOR).first()).toContainText(marker)
      const m = await model(page, marker)
      expect(m, 'marker in the PM model, not just the DOM').toContain('hasMarker=true')
      await shot('typed')
      return m
    })

    await step('bold', ['type-marker'], async () => {
      await page.keyboard.press('Shift+Home')
      const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(sel, 'selection covers marker').toContain(marker)
      // PM learns of a DOM selection change asynchronously (selectionchange); wait until its model selection
      // is a real range, otherwise Ctrl+B races and only toggles a stored mark at the caret
      await expect
        .poll(() => page.evaluate(() => { const e = (document.querySelector('.ProseMirror') as any).editor; return e.state.selection.to - e.state.selection.from }))
        .toBeGreaterThanOrEqual(marker.length)
      await page.keyboard.press('Control+b')
      const readBold = () =>
        page.evaluate((m) => {
          const walker = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT)
          let n: Node | null
          while ((n = walker.nextNode())) {
            if (n.textContent?.includes(m)) {
              const el = n.parentElement!
              return { inStrong: !!el.closest('strong,b'), weight: getComputedStyle(el).fontWeight, tag: el.tagName }
            }
          }
          return null
        }, marker)
      const isB = (b: Awaited<ReturnType<typeof readBold>>) =>
        !!b && (b.inStrong || Number(b.weight) >= 600 || b.weight === 'bold')
      let via = 'Ctrl+B'
      try {
        await expect.poll(async () => isB(await readBold()), { timeout: 3_000 }).toBe(true)
      } catch {
        // Ctrl+B did not take: try the ribbon button (Home tab, "Bold" tip) before declaring failure
        via = `ribbon button (Ctrl+B had no effect; DOM after Ctrl+B: ${JSON.stringify(await readBold())}; model: ${await model(page, marker)})`
        await page.locator('.ribbon-tab:not(.ribbon-tab-file)').nth(0).click()
        await page.locator('button[data-tip^="Bold"], button[data-tip^="加粗"]').first().click()
      }
      const bold = await readBold()
      expect(bold, 'marker text node found').not.toBeNull()
      expect(isB(bold), `marker bold in DOM ${JSON.stringify(bold)}`).toBe(true)
      await shot('bold')
      return `${via}: ${JSON.stringify(bold)}`
    })

    await step('insert-table', ['editable'], async () => {
      // Ribbon: 2nd regular tab = Insert (开始/Home first), Table split button -> 2x2 cell of the grid picker.
      // Collapse caret out of the marker run first: press End to deselect, then new paragraph for the table.
      // collapse the marker selection (a still-selected marker would be replaced by Enter): click into the
      // doc, then Ctrl+End = end of the last paragraph (the marker paragraph), then a new empty paragraph
      await page.locator(EDITOR).first().getByText(marker).first().click()
      await page.keyboard.press('Control+End')
      await settleCaret(page)
      await expect
        .poll(() => page.evaluate(() => { const e = (document.querySelector('.ProseMirror') as any).editor; return e.state.selection.empty }))
        .toBe(true)
      await page.keyboard.press('Enter')
      expect(await model(page, marker), 'marker survived the paragraph split').toContain('hasMarker=true')
      await page.locator('.ribbon-tab:not(.ribbon-tab-file)').nth(1).click()
      await page.locator('button.rb-big', { hasText: /^(表格|Table)$/ }).first().click()
      await page.locator('.table-picker-grid button.table-cell').nth(11).click() // 2x2 grid cell: index = row*10+col = 11
      await expect.poll(() => tableCount(page), { message: 'table count increased' }).toBeGreaterThan(tablesBefore)
      await shot('table')
      return `tables ${tablesBefore} -> ${await tableCount(page)}`
    })

    await step('save', ['open'], async () => {
      saved = await saveAndCapture(page)
      const zip = await JSZip.loadAsync(saved)
      expect(zip.file('word/document.xml'), 'saved bytes are a docx').toBeTruthy()
      writeFileSync(resolve(SHOTS, `${d.name}-saved.docx`), saved)
      await shot('saved')
      return `${saved.length} bytes`
    })

    await step('saved-xml', ['save', 'bold'], async () => {
      const zip = await JSZip.loadAsync(saved!)
      const xml = await zip.file('word/document.xml')!.async('string')
      expect(xml, 'marker in document.xml').toContain(marker)
      // find the run holding the marker and check its rPr for <w:b/>
      const idx = xml.indexOf(marker)
      const runStart = Math.max(xml.lastIndexOf('<w:r>', idx), xml.lastIndexOf('<w:r ', idx))
      const run = xml.slice(runStart, xml.indexOf('</w:r>', idx) + 6)
      expect(run, `<w:b/> in marker run: ${run.slice(0, 300)}`).toMatch(/<w:b(\/>|\s[^>]*\/>)(?![^<]*w:val="(0|false)")/)
      const tbl = (xml.match(/<w:tbl>/g) ?? []).length
      expect(tbl, 'w:tbl count in saved xml > source').toBeGreaterThan(tablesBefore)
      return `run=${run.slice(0, 160)} | w:tbl=${tbl}`
    })

    await step('reopen', ['save'], async () => {
      const page2 = await context.newPage()
      attachConsole(page2, consoleLines)
      const savedUrl = `/fixtures/${d.name}-saved-${Date.now()}.docx`
      await serveBytes(context, savedUrl, saved!)
      await openDoc(page2, savedUrl, marker)
      await shot('reopened', page2)
      const bold = await page2.evaluate((m) => {
        const walker = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT)
        let n: Node | null
        while ((n = walker.nextNode())) {
          if (n.textContent?.includes(m)) {
            const el = n.parentElement!
            return { inStrong: !!el.closest('strong,b'), weight: getComputedStyle(el).fontWeight }
          }
        }
        return null
      }, marker)
      const tablesAfter = await page2.locator(`${EDITOR} table`).count()
      await page2.close()
      expect(bold, 'marker found after reopen').not.toBeNull()
      expect(bold!.inStrong || Number(bold!.weight) >= 600, `marker bold after reopen ${JSON.stringify(bold)}`).toBe(true)
      expect(tablesAfter, 'table count after reopen > before').toBeGreaterThan(tablesBefore)
      return `marker bold=${JSON.stringify(bold)}; tables ${tablesBefore} -> ${tablesAfter}`
    })

    writeFileSync(resolve(SHOTS, `console-${d.name}.txt`), consoleLines.join('\n') + (consoleLines.length ? '\n' : '(no console errors/warnings, pageerrors, failed or >=400 requests)\n'))
    writeFileSync(resolve(SHOTS, `results-${d.name}.json`), JSON.stringify(results.filter((r) => r.doc === d.name), null, 2))
    const bad = results.filter((r) => r.doc === d.name && !r.ok)
    expect(bad, `failed steps: ${bad.map((b) => b.step + ' (' + b.detail + ')').join('; ')}`).toEqual([])
  })
}
