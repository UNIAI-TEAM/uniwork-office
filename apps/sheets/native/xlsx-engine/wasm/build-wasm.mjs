#!/usr/bin/env node
// Builds the xlsx-sidecar WebAssembly reactor for the Sheets web frame (UNI-1016, CONTRACT C11)
// reproducibly and checks it against the committed checksum.
//
//   node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs [--verify|--update-checksum|--print-path]
//
// 1. `cargo fetch` of the parent crate (its own Cargo.lock) fills the registry.
// 2. cargo builds wasm32-wasip1 release with the toolchain pinned in rust-toolchain.toml and the
//    committed wasm/Cargo.lock (--locked), from a staging copy at
//    /tmp/uniwork-xlsx-sidecar-wasm/<input hash>/ with paths remapped, so the output does not
//    depend on where the checkout, the target dir or CARGO_HOME live.
// 3. wasm-opt -O2 runs when it is on PATH (recorded in the checksum file's tool line; the
//    checked-in checksum is for the module *without* wasm-opt unless that line says otherwise).
// 4. dist/xlsx-sidecar.wasm is compared with xlsx-sidecar.wasm.sha256. A mismatch fails the
//    build (a different toolchain or source than the committed checksum describes); after an
//    intended source change run --update-checksum and commit the new checksum.
//    The module is byte-identical on every machine of one platform (same toolchain, any checkout
//    path) but NOT across CPU architectures (measured 2026-10-10: linux-arm64 and linux-x64 build
//    different modules from the same inputs), so the checksum file holds one line per platform:
//    `<sha256>  xlsx-sidecar.wasm  <platform>-<arch>`; --update-checksum rewrites only the line of
//    the machine it runs on. A line without a platform matches every host (the old format).
//
// Inputs are hashed into dist/.stamp: an unchanged tree skips cargo entirely.
// WEB_SHEETS_WASM=<file> uses a prebuilt module instead of cargo (still checksum-verified).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const crateDir = resolve(here, '..')
const repoRoot = resolve(crateDir, '../../../..')
const distDir = join(here, 'dist')
export const WASM_OUT = join(distDir, 'xlsx-sidecar.wasm')
const CHECKSUM_FILE = join(here, 'xlsx-sidecar.wasm.sha256')
const STAMP = join(distDir, '.stamp')

const args = new Set(process.argv.slice(2))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function log(msg) {
  process.stderr.write(`[build-wasm] ${msg}\n`)
}

function run(cmd, argv, opts = {}) {
  log(`${cmd} ${argv.join(' ')}`)
  execFileSync(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'], ...opts })
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (['target', '.vendor', 'dist', 'node_modules'].includes(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) listFiles(p, out)
    else out.push(p)
  }
  return out
}

/** hash of every input that can change the module */
function inputHash() {
  const h = createHash('sha256')
  for (const file of [
    ...listFiles(join(crateDir, 'src')),
    join(crateDir, 'Cargo.toml'),
    join(crateDir, 'Cargo.lock'),
    ...listFiles(here).filter((f) => !f.endsWith('.sha256')),
  ]) {
    h.update(relative(repoRoot, file))
    h.update(readFileSync(file))
  }
  return h.digest('hex')
}

const HOST = `${process.platform}-${process.arch}`

/** `<sha256>  xlsx-sidecar.wasm  [<platform>-<arch>]` lines -> [{sha, host|null}] */
export function parseChecksums(text) {
  const entries = []
  for (const line of text.split('\n')) {
    const [sha, , host] = line.trim().split(/\s+/)
    if (/^[0-9a-f]{64}$/.test(sha ?? '')) entries.push({ sha, host: host ?? null })
  }
  return entries
}

/** the checksum file with the line of `host` replaced (others kept, an unplatformed line dropped) */
export function withChecksum(text, host, sha) {
  const kept = parseChecksums(text).filter((e) => e.host && e.host !== host)
  kept.push({ sha, host })
  kept.sort((a, b) => a.host.localeCompare(b.host))
  return kept.map((e) => `${e.sha}  xlsx-sidecar.wasm  ${e.host}\n`).join('')
}

/** the checksum this machine's build must have, or null when the file has none for it */
export function expectedChecksum(
  text = existsSync(CHECKSUM_FILE) ? readFileSync(CHECKSUM_FILE, 'utf8') : '',
) {
  const entries = parseChecksums(text)
  return (entries.find((e) => e.host === HOST) ?? entries.find((e) => e.host === null))?.sha ?? null
}

function cargoHome() {
  return process.env.CARGO_HOME || join(homedir(), '.cargo')
}

/**
 * Cargo derives symbol metadata from a path dependency's absolute location, which
 * --remap-path-prefix does not touch: the same sources built from two checkouts differ. So the
 * sources are staged at a path that depends only on their content hash, identical on every
 * machine, and built there.
 */
function stage(stamp) {
  const root = join('/tmp', 'uniwork-xlsx-sidecar-wasm', stamp.slice(0, 16))
  const stagedCrate = join(root, 'xlsx-engine')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(stagedCrate, 'wasm'), { recursive: true })
  for (const name of ['src', 'Cargo.toml', 'Cargo.lock']) {
    cpSync(join(crateDir, name), join(stagedCrate, name), { recursive: true })
  }
  for (const name of ['src', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
    cpSync(join(here, name), join(stagedCrate, 'wasm', name), { recursive: true })
  }
  return { root, crate: stagedCrate, wasm: join(stagedCrate, 'wasm') }
}

function build(stamp) {
  const staged = stage(stamp)
  // fetch with the parent crate's lock so the registry holds the exact published crates
  run('cargo', ['fetch', '--manifest-path', join(staged.crate, 'Cargo.toml')], { cwd: staged.wasm })
  const targetDir = join(here, 'target')
  const remap = [
    `--remap-path-prefix=${staged.root}=/src`,
    `--remap-path-prefix=${targetDir}=/target`,
    `--remap-path-prefix=${cargoHome()}=/cargo`,
  ].join(' ')
  run(
    'cargo',
    ['build', '--release', '--locked', '--target', 'wasm32-wasip1', '--target-dir', targetDir],
    {
      cwd: staged.wasm, // rust-toolchain.toml is read from the working directory
      env: { ...process.env, RUSTFLAGS: remap, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
    },
  )
  mkdirSync(distDir, { recursive: true })
  cpSync(join(targetDir, 'wasm32-wasip1', 'release', 'xlsx_sidecar_wasm.wasm'), WASM_OUT)
  rmSync(staged.root, { recursive: true, force: true })
}

function main() {
  const stamp = inputHash()
  const prebuilt = process.env.WEB_SHEETS_WASM
  if (prebuilt) {
    mkdirSync(distDir, { recursive: true })
    cpSync(resolve(prebuilt), WASM_OUT)
    log(`using prebuilt ${prebuilt}`)
  } else if (!(
    existsSync(WASM_OUT) &&
    existsSync(STAMP) &&
    readFileSync(STAMP, 'utf8') === stamp
  )) {
    build(stamp)
    writeFileSync(STAMP, stamp)
  } else {
    log('inputs unchanged: reusing dist/xlsx-sidecar.wasm')
  }
  const actual = sha256(readFileSync(WASM_OUT))
  const bytes = statSync(WASM_OUT).size
  if (args.has('--update-checksum')) {
    const text = existsSync(CHECKSUM_FILE) ? readFileSync(CHECKSUM_FILE, 'utf8') : ''
    writeFileSync(CHECKSUM_FILE, withChecksum(text, HOST, actual))
    log(`wrote ${relative(repoRoot, CHECKSUM_FILE)} for ${HOST}: ${actual} (${bytes} bytes)`)
  } else {
    const expected = expectedChecksum()
    if (expected !== actual) {
      throw new Error(
        `xlsx-sidecar.wasm sha256 ${actual} does not match ${relative(repoRoot, CHECKSUM_FILE)} ` +
          `(${expected ?? `no line for ${HOST}`}). A different toolchain or engine source built it; ` +
          `after an intended engine change, or on a platform the file has no line for (${HOST}), ` +
          'run build-wasm.mjs --update-checksum and commit the checksum.',
      )
    }
    log(`verified ${actual} (${bytes} bytes)`)
  }
  if (args.has('--print-path')) process.stdout.write(`${WASM_OUT}\n`)
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  try {
    main()
  } catch (err) {
    log(String(err?.message ?? err))
    process.exit(1)
  }
}

export { main as buildSheetsWasm }
