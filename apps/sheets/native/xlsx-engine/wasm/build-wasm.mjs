#!/usr/bin/env node
// Builds the xlsx-sidecar WebAssembly reactor for the Sheets web frame (UNI-1016, CONTRACT C11)
// reproducibly and checks it against the committed checksum.
//
//   node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs [--verify|--update-checksum|--print-path]
//
// 1. `cargo fetch` of the parent crate (its own Cargo.lock) puts zip 0.6.6 in the registry.
// 2. That crate is copied to .vendor/zip-0.6.6 with `default = ["deflate"]` (no bzip2/zstd C
//    code; see Cargo.toml) and its registry sha256 is checked first.
// 3. cargo builds wasm32-wasip1 release with the toolchain pinned in rust-toolchain.toml, the
//    committed wasm/Cargo.lock (--locked) and source paths remapped, so the output does not
//    depend on where the checkout or CARGO_HOME live.
// 4. wasm-opt -O2 runs when it is on PATH (recorded in the checksum file's tool line; the
//    checked-in checksum is for the module *without* wasm-opt unless that line says otherwise).
// 5. dist/xlsx-sidecar.wasm is compared with xlsx-sidecar.wasm.sha256. A mismatch fails the
//    build (a different toolchain or source than the committed checksum describes); after an
//    intended source change run --update-checksum and commit the new checksum.
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

const ZIP_VERSION = '0.6.6'
// sha256 of zip-0.6.6/Cargo.toml as published on crates.io (the file we rewrite)
const ZIP_CARGO_TOML_SHA256 = '7cb213851ac9541dc7dd3ce163ef72c302985c9fb7d5bfed8859cb7988afd766'

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

function expectedChecksum() {
  if (!existsSync(CHECKSUM_FILE)) return null
  return readFileSync(CHECKSUM_FILE, 'utf8').split(/\s+/)[0] || null
}

function cargoHome() {
  return process.env.CARGO_HOME || join(homedir(), '.cargo')
}

function vendorZip() {
  const registry = join(cargoHome(), 'registry', 'src')
  const source = readdirSync(registry)
    .map((index) => join(registry, index, `zip-${ZIP_VERSION}`))
    .find((p) => existsSync(p))
  if (!source) throw new Error(`zip-${ZIP_VERSION} is not in ${registry} (cargo fetch failed?)`)
  const toml = readFileSync(join(source, 'Cargo.toml'))
  if (sha256(toml) !== ZIP_CARGO_TOML_SHA256) {
    throw new Error(`unexpected zip-${ZIP_VERSION}/Cargo.toml (sha256 ${sha256(toml)})`)
  }
  const target = join(here, '.vendor', `zip-${ZIP_VERSION}`)
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  const patched = toml.toString('utf8').replace(/^default = \[[^\]]*\]/m, 'default = ["deflate"]')
  if (patched === toml.toString('utf8')) throw new Error('zip default features not found')
  writeFileSync(join(target, 'Cargo.toml'), patched)
  // the registry's checksum manifest no longer matches the edited file; a path crate needs none
  rmSync(join(target, '.cargo-checksum.json'), { force: true })
}

function build() {
  // fetch with the parent crate's lock so zip 0.6.6 is the exact published crate
  run('cargo', ['fetch', '--manifest-path', join(crateDir, 'Cargo.toml')], { cwd: here })
  vendorZip()
  const remap = [
    `--remap-path-prefix=${repoRoot}=/src`,
    `--remap-path-prefix=${cargoHome()}=/cargo`,
  ].join(' ')
  run(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--target',
      'wasm32-wasip1',
      '--target-dir',
      join(here, 'target'),
    ],
    {
      cwd: here, // rust-toolchain.toml is read from the working directory
      env: { ...process.env, RUSTFLAGS: remap, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
    },
  )
  mkdirSync(distDir, { recursive: true })
  cpSync(join(here, 'target', 'wasm32-wasip1', 'release', 'xlsx_sidecar_wasm.wasm'), WASM_OUT)
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
    build()
    writeFileSync(STAMP, stamp)
  } else {
    log('inputs unchanged: reusing dist/xlsx-sidecar.wasm')
  }
  const actual = sha256(readFileSync(WASM_OUT))
  const bytes = statSync(WASM_OUT).size
  if (args.has('--update-checksum')) {
    writeFileSync(CHECKSUM_FILE, `${actual}  xlsx-sidecar.wasm\n`)
    log(`wrote ${relative(repoRoot, CHECKSUM_FILE)}: ${actual} (${bytes} bytes)`)
  } else {
    const expected = expectedChecksum()
    if (expected !== actual) {
      throw new Error(
        `xlsx-sidecar.wasm sha256 ${actual} does not match ${relative(repoRoot, CHECKSUM_FILE)} ` +
          `(${expected ?? 'missing'}). A different toolchain or engine source built it; after an ` +
          'intended engine change run build-wasm.mjs --update-checksum and commit the checksum.',
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
