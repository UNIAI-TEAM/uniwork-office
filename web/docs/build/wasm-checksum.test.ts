import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

// The sheets engine module is byte-identical per platform, not across CPU architectures, so the
// committed checksum file has one line per platform (build-wasm.mjs).
const WASM_DIR = resolve(__dirname, '../../../apps/sheets/native/xlsx-engine/wasm')
const ARM = 'a'.repeat(64)
const X64 = 'b'.repeat(64)
const LEGACY = 'c'.repeat(64)

interface Entry {
  sha: string
  host: string | null
}
interface Mod {
  parseChecksums(text: string): Entry[]
  withChecksum(text: string, host: string, sha: string): string
  expectedChecksum(text: string): string | null
}
const load = (): Promise<Mod> =>
  import(/* @vite-ignore */ pathToFileURL(resolve(WASM_DIR, 'build-wasm.mjs')).href)

describe('xlsx-sidecar wasm checksum file', () => {
  it('parses one line per platform and the old single-line format', async () => {
    const { parseChecksums } = await load()
    expect(
      parseChecksums(
        `${ARM}  xlsx-sidecar.wasm  linux-arm64\n${X64}  xlsx-sidecar.wasm  linux-x64\n`,
      ),
    ).toEqual([
      { sha: ARM, host: 'linux-arm64' },
      { sha: X64, host: 'linux-x64' },
    ])
    expect(parseChecksums(`${LEGACY}  xlsx-sidecar.wasm\n`)).toEqual([{ sha: LEGACY, host: null }])
    expect(parseChecksums('not a checksum\n\n')).toEqual([])
  })

  it('--update-checksum rewrites only the line of its own platform', async () => {
    const { withChecksum, parseChecksums } = await load()
    const text = `${ARM}  xlsx-sidecar.wasm  linux-arm64\n${X64}  xlsx-sidecar.wasm  linux-x64\n`
    const next = withChecksum(text, 'linux-x64', 'd'.repeat(64))
    expect(parseChecksums(next)).toEqual([
      { sha: ARM, host: 'linux-arm64' },
      { sha: 'd'.repeat(64), host: 'linux-x64' },
    ])
    // an old unplatformed line is replaced by the platform's own, a new platform is added
    expect(
      parseChecksums(withChecksum(`${LEGACY}  xlsx-sidecar.wasm\n`, 'darwin-arm64', ARM)),
    ).toEqual([{ sha: ARM, host: 'darwin-arm64' }])
  })

  it('the committed file has a valid line for linux-x64 (CI) and linux-arm64 (the VPS)', async () => {
    const { parseChecksums } = await load()
    const entries = parseChecksums(
      readFileSync(resolve(WASM_DIR, 'xlsx-sidecar.wasm.sha256'), 'utf8'),
    )
    const hosts = entries.map((e) => e.host)
    expect(hosts).toContain('linux-x64')
    expect(hosts).toContain('linux-arm64')
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it('expects the line of the running platform, else an unplatformed one, else none', async () => {
    const { expectedChecksum } = await load()
    const host = `${process.platform}-${process.arch}`
    expect(
      expectedChecksum(`${ARM}  xlsx-sidecar.wasm  ${host}\n${X64}  xlsx-sidecar.wasm  other-x\n`),
    ).toBe(ARM)
    expect(expectedChecksum(`${LEGACY}  xlsx-sidecar.wasm\n`)).toBe(LEGACY)
    expect(expectedChecksum(`${X64}  xlsx-sidecar.wasm  other-x\n`)).toBeNull()
  })
})
