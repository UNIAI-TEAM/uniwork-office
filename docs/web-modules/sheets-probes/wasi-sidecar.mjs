// Runs the wasm32-wasip1 xlsx-sidecar build as a drop-in sidecar process
// (NDJSON over stdin/stdout) so the same probe can drive it.
import { WASI } from 'node:wasi'
import { readFileSync } from 'node:fs'
const wasmPath = process.env.SIDECAR_WASM
const root = process.env.SIDECAR_ROOT ?? '/tmp'
const wasi = new WASI({
  version: 'preview1',
  args: ['xlsx-sidecar'],
  env: { TMPDIR: root },
  preopens: { [root]: root },
  returnOnExit: true,
})
const module = await WebAssembly.compile(readFileSync(wasmPath))
const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
process.exitCode = wasi.start(instance)
