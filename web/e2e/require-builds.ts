// Playwright globalSetup of the web e2e (finding RF-4). The specs skip a module's tests when its
// `dist-web/<module>` bundle is missing, which keeps a plain `npx playwright test -c web/e2e` usable
// on a partial checkout. In CI that would turn the security proofs into a green run of skipped
// tests, so with WEB_E2E_REQUIRE_BUILD=1 a missing bundle aborts the run instead (and
// ./fail-on-skip-reporter.ts fails the run if any test still skipped).
//   WEB_E2E_REQUIRE_MODULES  comma list of modules that must be built (default: all six)
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const ALL_MODULES = 'docs,pdf,markdown,html,slides,sheets'

function requireBuilds(): boolean {
  const v = process.env.WEB_E2E_REQUIRE_BUILD
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
}

/** the same test the specs use: a version directory holding a manifest.json */
function isBuilt(module: string): boolean {
  const root = resolve(repoRoot, 'dist-web', module)
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

export default function globalSetup(): void {
  if (!requireBuilds()) return
  const modules = (process.env.WEB_E2E_REQUIRE_MODULES ?? ALL_MODULES)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const missing = modules.filter((m) => !isBuilt(m))
  if (missing.length > 0) {
    throw new Error(
      `WEB_E2E_REQUIRE_BUILD is set but dist-web has no build for: ${missing.join(', ')}. ` +
        `Run: npm run build:web -- --all`,
    )
  }
}
