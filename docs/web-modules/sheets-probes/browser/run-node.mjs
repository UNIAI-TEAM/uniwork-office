// GO-D3 probe: the same conversation (driver.mjs) in Node, either through the browser WASI shim
// (same code path as the Chromium worker, minus the browser) or against the native binary.
// Usage:
//   node run-node.mjs shim   <shim-dir> <xlsx-sidecar.wasm> <out.json> <fixture>... [--recalc-max-bytes N]
//   node run-node.mjs native <xlsx-sidecar>            <out.json> <fixture>... [--recalc-max-bytes N]
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { conversation, createDriver, runWithShim } from './driver.mjs'

const args = process.argv.slice(2)
const mode = args.shift()
let recalcMaxBytes = 3_000_000
const rest = []
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--recalc-max-bytes') recalcMaxBytes = Number(args[++i])
  else rest.push(args[i])
}

async function peakRssKb(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    return Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? 0) || null
  } catch {
    return null
  }
}

async function runNative(binary, fixture, opts) {
  const root = await mkdtemp(join(tmpdir(), 'go-d3-native-'))
  try {
    const name = basename(fixture)
    await copyFile(fixture, join(root, name))
    await mkdir(join(root, 'extract'))
    const driver = createDriver(conversation(join(root, name), root, opts))
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let peak = null
    const lines = createInterface({ input: child.stdout })
    const done = new Promise((resolve) => child.once('exit', resolve))
    const next = () => {
      const line = driver.pull()
      if (line === null) child.stdin.end()
      else child.stdin.write(`${line}\n`)
    }
    lines.on('line', async (line) => {
      driver.push(line)
      peak = (await peakRssKb(child.pid)) ?? peak
      next()
    })
    next()
    await done
    return { fixture: name, results: driver.results, peakRssKb: peak }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (mode === 'shim') {
  const [shimDir, wasmPath, out, ...fixtures] = rest
  const shim = await import(pathToFileURL(join(shimDir, 'index.js')).href)
  const t0 = performance.now()
  const module = await WebAssembly.compile(await readFile(wasmPath))
  const compileMs = Math.round((performance.now() - t0) * 10) / 10
  const results = []
  for (const fixture of fixtures) {
    const bytes = await readFile(fixture)
    try {
      results.push(
        await runWithShim(shim, module, basename(fixture), bytes, {
          recalc: bytes.byteLength <= recalcMaxBytes,
        }),
      )
    } catch (err) {
      results.push({ fixture: basename(fixture), error: String(err) })
    }
    process.stderr.write(`shim ${basename(fixture)}\n`)
  }
  await writeFile(
    out,
    `${JSON.stringify({ runtime: `node ${process.version} + browser_wasi_shim`, compileMs, results }, null, 2)}\n`,
  )
} else if (mode === 'native') {
  const [binary, out, ...fixtures] = rest
  const results = []
  for (const fixture of fixtures) {
    const size = (await readFile(fixture)).byteLength
    results.push(await runNative(binary, fixture, { recalc: size <= recalcMaxBytes }))
    process.stderr.write(`native ${basename(fixture)}\n`)
  }
  await writeFile(out, `${JSON.stringify({ runtime: 'native', results }, null, 2)}\n`)
} else {
  throw new Error('usage: run-node.mjs shim|native ...')
}
