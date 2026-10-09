/* global self */
// GO-D3 probe: one workbook per Worker (fresh wasm memory, like one sidecar process per run).
import * as shim from '/shim/index.js'
import { runWithShim } from '/driver.mjs'

let modulePromise = null

self.onmessage = async (event) => {
  const { wasmUrl, fixtureUrl, name, recalc } = event.data
  try {
    const t0 = performance.now()
    modulePromise ??= WebAssembly.compileStreaming(fetch(wasmUrl))
    const module = await modulePromise
    const compileMs = Math.round((performance.now() - t0) * 10) / 10
    const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer())
    const result = await runWithShim(shim, module, name, bytes, { recalc })
    self.postMessage({ ok: true, compileMs, ...result })
  } catch (err) {
    self.postMessage({ ok: false, fixture: name, error: `${err?.name}: ${err?.message ?? err}` })
  }
}
