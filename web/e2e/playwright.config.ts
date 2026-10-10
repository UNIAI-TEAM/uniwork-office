// UNI-1011 W7: headless-Chromium proof for Docs-on-the-web.
// Run from repo root:  npx playwright test -c web/e2e
import { defineConfig } from '@playwright/test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
// Default port is derived from the checkout path: several worktrees run this suite on one host and a
// fixed port silently tested another checkout's build (a stale server on :4181 answered). Override: E2E_PORT.
const PORT =
  Number(process.env.E2E_PORT) ||
  4300 + (createHash('sha1').update(repoRoot).digest().readUInt16BE(0) % 600)

// CI sets WEB_E2E_REQUIRE_BUILD=1: a missing dist-web bundle fails the run, a skipped test fails it
// (./require-builds.ts, ./fail-on-skip-reporter.ts); without it a missing bundle skips its specs.
const requireBuild =
  !!process.env.WEB_E2E_REQUIRE_BUILD && process.env.WEB_E2E_REQUIRE_BUILD !== '0'

export default defineConfig({
  testDir: __dirname,
  globalSetup: requireBuild ? resolve(__dirname, 'require-builds.ts') : undefined,
  testMatch: /.*\.spec\.ts/,
  outputDir: resolve(repoRoot, 'web/e2e/.results'),
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: requireBuild
    ? [['list'], [resolve(__dirname, 'fail-on-skip-reporter.ts')]]
    : [['list']],
  // always start our own server: reusing whatever answers on PORT would test an unknown build
  webServer: {
    command: 'node web/server/server.mjs',
    cwd: repoRoot,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: { args: ['--no-sandbox'] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
