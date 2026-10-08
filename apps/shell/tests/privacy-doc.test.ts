import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(?:ts|tsx|cjs|mjs|js)$/.test(name)) out.push(path)
  }
  return out
}

describe('usage statistics', () => {
  it('PRIVACY.md says the app collects none and names no analytics events', () => {
    const privacy = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8')
    expect(privacy).toMatch(/does not collect usage statistics/i)
    expect(privacy).not.toMatch(/google analytics|measurement protocol|`client_id`|GA4/i)
    expect(privacy).not.toMatch(/^- `[a-z_]+` —/m)
  })

  it('no shell or packaging code can send an event to Google Analytics', () => {
    const files = [
      ...sourceFiles(join(ROOT, 'apps/shell/src')),
      join(ROOT, 'apps/shell/electron-builder.cjs'),
    ]
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/google-analytics\.com|measurement_id|GA4_API_SECRET/i)
      expect(text, file).not.toMatch(/\banalytics\.track\(|genofficeAnalytics/)
    }
  })
})
