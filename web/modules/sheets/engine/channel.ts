/**
 * How the transport (./wasm-transport.ts) reaches the engine (./host.ts): a module Worker in the
 * frame (`createWorkerChannel`), or the same EngineHost in-process (`createDirectChannel`, Node
 * tests). Paths are engine paths under /tmp; buffers move, never copied twice.
 */
import type { EngineHost } from './host'

export interface EngineChannel {
  /** one NDJSON request line -> the parsed response */
  request(line: string, requestId: string): Promise<EngineResponse>
  writeFile(path: string, data: ArrayBuffer): Promise<void>
  readFile(path: string): Promise<ArrayBuffer>
  remove(path: string): Promise<void>
  /** wasm memory and the engine's last stderr lines (diagnostics, tests) */
  stats(): Promise<{ memoryBytes: number; stderr: string[] }>
  dispose(): void
}

export interface EngineResponse {
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

/** worker <-> transport messages */
export type WorkerCall =
  | { id: number; op: 'request'; line: string; requestId: string }
  | { id: number; op: 'write'; path: string; data: ArrayBuffer }
  | { id: number; op: 'read'; path: string }
  | { id: number; op: 'remove'; path: string }
  | { id: number; op: 'stats' }

/** a call without its id (distributes over the union) */
export type WorkerCallBody = WorkerCall extends infer C
  ? C extends unknown
    ? Omit<C, 'id'>
    : never
  : never

export type WorkerReply =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: { code: string; message: string } }

function parseResponse(line: string): EngineResponse {
  return JSON.parse(line) as EngineResponse
}

export function createDirectChannel(host: EngineHost): EngineChannel {
  return {
    request: async (line, requestId) => parseResponse(host.request(line, requestId)),
    writeFile: async (path, data) => host.writeFile(path, new Uint8Array(data)),
    readFile: async (path) => {
      const bytes = host.readFile(path)
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
    },
    remove: async (path) => host.remove(path),
    stats: async () => ({ memoryBytes: host.memoryBytes, stderr: [...host.stderr] }),
    dispose: () => {},
  }
}

export function createWorkerChannel(worker: Worker): EngineChannel {
  let next = 0
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let failed: Error | null = null
  const fail = (err: Error) => {
    failed = err
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.ok) waiter.resolve(reply.value)
    else waiter.reject(Object.assign(new Error(reply.error.message), { code: reply.error.code }))
  })
  worker.addEventListener('error', (event) => {
    event.preventDefault()
    fail(
      Object.assign(new Error(`engine_crashed: ${event.message || 'worker error'}`), {
        code: 'engine_crashed',
      }),
    )
  })
  const call = <T>(message: WorkerCallBody, transfer: Transferable[] = []): Promise<T> => {
    if (failed) return Promise.reject(failed)
    const id = ++next
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ ...message, id }, transfer)
    })
  }
  return {
    request: async (line, requestId) =>
      parseResponse(await call<string>({ op: 'request', line, requestId })),
    writeFile: (path, data) => call<void>({ op: 'write', path, data }, [data]),
    readFile: (path) => call<ArrayBuffer>({ op: 'read', path }),
    remove: (path) => call<void>({ op: 'remove', path }),
    stats: () => call({ op: 'stats' }),
    dispose: () => {
      fail(new Error('engine disposed'))
      worker.terminate()
    },
  }
}
