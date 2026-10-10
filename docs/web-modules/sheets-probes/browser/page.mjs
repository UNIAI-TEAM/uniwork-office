/* global document, Worker, window */
// Runs every fixture of /fixtures.json in its own module Worker and exposes the results.
const violations = []
document.addEventListener('securitypolicyviolation', (e) =>
  violations.push(`${e.violatedDirective} ${e.blockedURI}`),
)

function runOne(entry) {
  return new Promise((resolve) => {
    const worker = new Worker('/worker.mjs', { type: 'module' })
    const t0 = performance.now()
    worker.onmessage = (e) => {
      worker.terminate()
      resolve({ wallMs: Math.round(performance.now() - t0), ...e.data })
    }
    worker.onerror = (e) => {
      worker.terminate()
      resolve({ ok: false, fixture: entry.name, error: `worker error: ${e.message}` })
    }
    worker.postMessage(entry)
  })
}

const fixtures = await (await fetch('/fixtures.json')).json()
const results = []
for (const entry of fixtures) {
  window.__current = entry.name
  results.push(await runOne(entry))
}
window.__probe = { userAgent: navigator.userAgent, results, violations }
