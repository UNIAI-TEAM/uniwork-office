/**
 * The Sheets engine Worker (UNI-1016, CONTRACT C11): a module Worker emitted by the build as its
 * own same-origin file (worker-src 'self', no blob: worker). It instantiates the xlsx-sidecar
 * wasm reactor (./host.ts) once and answers ./channel.ts calls one at a time. Between calls it
 * continues worksheet indexes with background passes (each pass yields back to the message queue,
 * so a viewport read never waits behind more than one pass).
 */
import wasmUrl from '../../../../apps/sheets/native/xlsx-engine/wasm/dist/xlsx-sidecar.wasm?url'
import type { WorkerCall, WorkerReply } from './channel'
import { EngineHost } from './host'

/** the slice of DedicatedWorkerGlobalScope used here (the DOM lib types the frame) */
const scope = self as unknown as {
  postMessage(message: WorkerReply, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerCall>) => void): void
}

let hostPromise: Promise<EngineHost> | null = null
const host = () =>
  (hostPromise ??= WebAssembly.compileStreaming(fetch(wasmUrl)).then((m) => EngineHost.create(m)))

let indexing = false
function scheduleIndexing(engine: EngineHost): void {
  if (indexing) return
  indexing = true
  const step = () => {
    if (engine.indexStep()) setTimeout(step, 0)
    else indexing = false
  }
  setTimeout(step, 0)
}

function reply(message: WorkerReply, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

// calls run strictly in order (the engine is single-threaded and stateful)
let queue: Promise<void> = Promise.resolve()

scope.addEventListener('message', (event) => {
  const call = event.data
  queue = queue.then(async () => {
    try {
      const engine = await host()
      switch (call.op) {
        case 'request': {
          const line = engine.request(call.line, call.requestId)
          reply({ id: call.id, ok: true, value: line })
          scheduleIndexing(engine)
          return
        }
        case 'write':
          engine.writeFile(call.path, new Uint8Array(call.data))
          return reply({ id: call.id, ok: true })
        case 'read': {
          const bytes = engine.readFile(call.path)
          const buffer = bytes.buffer as ArrayBuffer
          return reply({ id: call.id, ok: true, value: buffer }, [buffer])
        }
        case 'remove':
          engine.remove(call.path)
          return reply({ id: call.id, ok: true })
        case 'stats':
          return reply({
            id: call.id,
            ok: true,
            value: { memoryBytes: engine.memoryBytes, stderr: [...engine.stderr] },
          })
      }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      reply({
        id: call.id,
        ok: false,
        error: { code: e.code ?? 'internal', message: e.message ?? String(err) },
      })
    }
  })
})
