/**
 * The xlsx engine instance (UNI-1016, CONTRACT C11): the xlsx-sidecar compiled to a
 * wasm32-wasip1 *reactor* (apps/sheets/native/xlsx-engine/wasm) running on
 * @bjorn3/browser_wasi_shim with an in-memory filesystem. Used inside the module Worker
 * (./engine.worker.ts) and, unchanged, by the Node tests.
 *
 * Protocol: the desktop sidecar's NDJSON lines. A request line is copied into wasm memory
 * (`xlsx_sidecar_alloc`) and handled synchronously (`xlsx_sidecar_handle`); the engine writes the
 * response line to fd 1 before the call returns. `xlsx_sidecar_index_step` advances worksheet
 * indexes between requests (the wasm build has no threads, see lib.rs `advance_index`).
 *
 * Filesystem: one preopened directory, /tmp (TMPDIR, where sessions keep their chunk caches).
 * Workbooks live under /tmp/w/. Two shim fixes found by the GO-D3 measurement (O8):
 *   - file writes grow the buffer geometrically (the shim reallocates to the exact size on every
 *     append, which makes writing a multi-MB xlsx quadratic),
 *   - removing a directory removes its contents (the shim's readdir indexes entries by cookie, so
 *     Rust's remove_dir_all, which deletes while it iterates, skips entries and the final rmdir
 *     failed with ENOTEMPTY: every `close` errored and leaked the session cache).
 */
import {
  ConsoleStdout,
  Directory,
  Fd,
  File,
  OpenDirectory,
  OpenFile,
  PreopenDirectory,
  WASI,
} from '@bjorn3/browser_wasi_shim'

export const WORK_DIR = '/tmp/w'

interface ReactorExports {
  memory: WebAssembly.Memory
  xlsx_sidecar_alloc(len: number): number
  xlsx_sidecar_handle(pointer: number, len: number): void
  xlsx_sidecar_index_step(): number
}

/** the engine trapped (a Rust panic aborts on wasm): every session in it is gone */
export class EngineCrashedError extends Error {
  readonly code = 'engine_crashed'
  constructor(cause: unknown, stderr: readonly string[] = []) {
    const panic = stderr
      .filter((line) => line.trim())
      .slice(-3)
      .join(' | ')
    super(
      `engine_crashed: the workbook engine stopped (${String((cause as Error)?.message ?? cause)})` +
        (panic ? `: ${panic}` : ''),
    )
    this.name = 'EngineCrashedError'
  }
}

let patched = false
function patchShim(): void {
  if (patched) return
  patched = true
  type FileFd = {
    file: File
    file_pos: bigint
    fd_write(data: Uint8Array): { ret: number; nwritten: number }
  }
  const fileProto = OpenFile.prototype as unknown as FileFd
  fileProto.fd_write = function fdWrite(this: FileFd, data: Uint8Array) {
    if (this.file.readonly) return { ret: 8 /* ERRNO_BADF */, nwritten: 0 }
    const pos = Number(this.file_pos)
    const end = pos + data.byteLength
    const current = this.file.data
    if (end > current.byteLength) {
      if (current.byteOffset === 0 && end <= current.buffer.byteLength) {
        this.file.data = new Uint8Array(current.buffer, 0, end)
      } else {
        const next = new Uint8Array(Math.max(end, current.byteLength * 2, 1 << 16))
        next.set(current)
        this.file.data = next.subarray(0, end)
      }
    }
    this.file.data.set(data, pos)
    this.file_pos += BigInt(data.byteLength)
    return { ret: 0, nwritten: data.byteLength }
  }
  const dirProto = OpenDirectory.prototype as unknown as {
    dir: Directory
    path_remove_directory(path: string): number
  }
  const removeDirectory = dirProto.path_remove_directory
  dirProto.path_remove_directory = function pathRemoveDirectory(
    this: typeof dirProto,
    path: string,
  ) {
    const target = lookup(this.dir, path)
    if (target instanceof Directory) target.contents.clear()
    return removeDirectory.call(this, path)
  }
}

function lookup(root: Directory, path: string): unknown {
  let node: unknown = root
  for (const part of path.split('/').filter(Boolean)) {
    if (!(node instanceof Directory)) return null
    node = node.contents.get(part) ?? null
  }
  return node
}

const encoder = new TextEncoder()

export class EngineHost {
  private dead: Error | null = null
  private stdoutLines: string[] = []

  private constructor(
    private readonly exports: ReactorExports,
    private readonly tmp: Directory,
    readonly stderr: string[],
  ) {}

  static async create(module: WebAssembly.Module): Promise<EngineHost> {
    patchShim()
    const stderr: string[] = []
    const tmp = new Directory(new Map([['w', new Directory(new Map())]]))
    let host: EngineHost | null = null
    const fds: Fd[] = [
      new OpenFile(new File(new Uint8Array(0), { readonly: true })),
      ConsoleStdout.lineBuffered((line) => host?.stdoutLines.push(line)),
      ConsoleStdout.lineBuffered((line) => {
        stderr.push(line)
        if (stderr.length > 50) stderr.shift()
      }),
      new PreopenDirectory('/tmp', tmp.contents),
    ]
    const wasi = new WASI(['xlsx-sidecar'], ['TMPDIR=/tmp'], fds, { debug: false })
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })
    // a reactor: _initialize runs the constructors once, the exports keep their state
    wasi.initialize(
      instance as unknown as {
        exports: { memory: WebAssembly.Memory; _initialize?: () => unknown }
      },
    )
    host = new EngineHost(instance.exports as unknown as ReactorExports, tmp, stderr)
    return host
  }

  get crashed(): boolean {
    return this.dead !== null
  }

  /** wasm linear memory in bytes (grows, never shrinks) */
  get memoryBytes(): number {
    return this.exports.memory.buffer.byteLength
  }

  /** one NDJSON request line -> its response line */
  request(line: string, requestId: string): string {
    if (this.dead) throw new EngineCrashedError(this.dead, this.stderr)
    const bytes = encoder.encode(line)
    this.stdoutLines = []
    try {
      const pointer = this.exports.xlsx_sidecar_alloc(bytes.byteLength)
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.byteLength).set(bytes)
      this.exports.xlsx_sidecar_handle(pointer, bytes.byteLength)
    } catch (err) {
      this.dead = err as Error
      throw new EngineCrashedError(err, this.stderr)
    }
    const prefix = `{"version":1,"requestId":${JSON.stringify(requestId)},`
    const response = this.stdoutLines.find((l) => l.startsWith(prefix))
    this.stdoutLines = []
    if (response === undefined) throw new Error(`engine returned no response for ${requestId}`)
    return response
  }

  /** one background index pass; true while more indexing remains */
  indexStep(): boolean {
    if (this.dead) return false
    try {
      return this.exports.xlsx_sidecar_index_step() === 1
    } catch (err) {
      this.dead = err as Error
      return false
    }
  }

  writeFile(path: string, data: Uint8Array): void {
    const { dir, name } = this.parent(path, true)
    dir.contents.set(name, new File(data))
  }

  readFile(path: string): Uint8Array {
    const node = lookup(this.tmp, this.relative(path))
    if (!(node instanceof File)) throw new Error(`no such file: ${path}`)
    return node.data.slice()
  }

  remove(path: string): void {
    const { dir, name } = this.parent(path, false)
    dir.contents.delete(name)
  }

  private relative(path: string): string {
    if (!path.startsWith('/tmp/')) throw new Error(`engine paths live under /tmp: ${path}`)
    return path.slice('/tmp/'.length)
  }

  private parent(path: string, create: boolean): { dir: Directory; name: string } {
    const parts = this.relative(path).split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) throw new Error(`not a file path: ${path}`)
    let dir = this.tmp
    for (const part of parts) {
      let next = dir.contents.get(part)
      if (!next && create) {
        const created = new Directory(new Map())
        ;(created as unknown as { parent: Directory }).parent = dir
        dir.contents.set(part, created)
        next = created
      }
      if (!(next instanceof Directory)) throw new Error(`no such directory: ${path}`)
      dir = next
    }
    return { dir, name }
  }
}
