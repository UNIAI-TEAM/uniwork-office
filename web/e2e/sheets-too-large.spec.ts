// SIZE-F1 / SIZE-fe-d2-9 (UNI-1861): dedicated CI e2e spec for the Sheets frame `too_large` size
// gate so the CI web-e2e job runs it without building the heavy 20k/50k/100k synthetic fixtures of
// `sheets.spec.ts`.
// Run: npx playwright test -c web/e2e sheets-too-large
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const repoRoot = resolve(__dirname, '../..')
const fixtures = resolve(repoRoot, 'web/e2e/.results/fixtures')

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web', 'sheets')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
  http: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [], http: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) p.http.push(`${r.status()} ${r.url()}`)
  })
  await page.addInitScript(() => {
    const list: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
    document.addEventListener('securitypolicyviolation', (e) =>
      list.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
  })
  return p
}

async function cspViolations(page: Page, frame: Frame): Promise<string[]> {
  return [
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
    ...(await frame.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  ]
}

async function openFrame(page: Page, query: string): Promise<Frame> {
  await page.goto(`/test-host/?module=sheets&${query}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

type HostEvent = { type: string; payload: Record<string, unknown> }
const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

test.beforeAll(async () => {
  mkdirSync(fixtures, { recursive: true })
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  )
  // 65 worksheet parts x ~8.1 MiB = ~526.5 MiB of uncompressed worksheet XML: above the frame's 512 MiB gate
  const pad = 'x'.repeat(8_500_000)
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${pad}</t></is></c></row></sheetData></worksheet>`
  for (let i = 1; i <= 65; i += 1) {
    zip.file(`xl/worksheets/sheet${i}.xml`, sheetXml)
  }
  writeFileSync(
    resolve(fixtures, 'Too-Large.xlsx'),
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    }),
  )
})

test.describe.configure({ mode: 'serial' })

for (const [lang, theme] of [
  ['en', 'light'],
  ['vi', 'dark'],
] as const) {
  test(`too_large: the host gets a fatal too_large, the frame shows its state (${lang}, ${theme})`, async ({
    page,
  }) => {
    test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
    const problems = await watch(page)
    const frame = await openFrame(page, `lang=${lang}&theme=${theme}&open=/fixtures/Too-Large.xlsx`)
    await expect(frame.getByTestId('sheets-too-large')).toBeVisible({ timeout: 60_000 })
    const fatal = (await hostEvents(page)).filter(
      (e) => e.type === 'error' && (e.payload.error as { code?: string })?.code === 'too_large',
    )
    expect(fatal).toHaveLength(1)
    expect(fatal[0]!.payload.fatal).toBe(true)
    const details = (fatal[0]!.payload.error as { details?: Record<string, number> }).details
    expect(details?.limitBytes).toBe(512 * 1024 * 1024)
    expect(details?.worksheetXmlBytes).toBeGreaterThan(512 * 1024 * 1024)
    const refused = (await hostEvents(page)).filter((e) => e.type === 'open_refused')
    expect(refused).toHaveLength(1)
    expect(refused[0]!.payload).toMatchObject({
      reason: 'too_large_to_open',
      measure: { kind: 'worksheet_xml_bytes', limit: 512 * 1024 * 1024 },
    })
    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })
}
