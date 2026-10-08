// Regenerates docs/web-spike/screenshots/results.md from the results-<doc>.json files the spec writes.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHOTS = resolve(import.meta.dirname, '../../docs/web-spike/screenshots')
const rows = ['simple', 'kitchen-sink', 'long'].flatMap((doc) =>
  JSON.parse(readFileSync(resolve(SHOTS, `results-${doc}.json`), 'utf8')),
)
const cell = (v) =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
const lines = [
  '# W7 Playwright results (headless Chromium, last run)',
  '',
  'Rerun: `npx playwright test -c web/e2e && node web/e2e/make-results-md.mjs` (starts web/server on a per-checkout port itself; needs `npm run build:web` first).',
  'The marker string is random per run, so saved byte sizes vary by a few bytes between runs.',
  '',
  '| doc | step | result | ms | detail |',
  '|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.doc} | ${r.step} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.ms ?? ''} | ${cell(r.detail)} |`,
  ),
]
writeFileSync(resolve(SHOTS, 'results.md'), lines.join('\n') + '\n')
