// UNI-1011 W7: headless-Chromium proof for Docs-on-the-web.
// Run from repo root:  npx playwright test -c web/e2e
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const PORT = Number(process.env.E2E_PORT) || 4181

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts/,
  outputDir: resolve(repoRoot, 'web/e2e/.results'),
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  // never assume the server is running: start our own on PORT (reuse only if already healthy)
  webServer: {
    command: 'node web/server/server.mjs',
    cwd: repoRoot,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: true,
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
