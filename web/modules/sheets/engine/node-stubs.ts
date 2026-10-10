/**
 * Browser stand-ins for the `node:*` imports of @genoffice/xlsx-gateway (UNI-1016). The Sheets
 * frame uses the gateway's planner (pure string/XML work); the file helpers that need Node
 * (atomic writes, temp dirs, fsync, hashing to disk) are desktop-only and never run in the frame.
 * The web build aliases node:crypto / node:fs / node:fs/promises / node:os / node:path here
 * (web/docs/build/modules.ts, sheets `aliases`); calling any of them is a bug and throws.
 */
function unavailable(name: string): never {
  throw new Error(`${name} is not available in the Sheets web frame`)
}

export const createHash = (): never => unavailable('crypto.createHash')
export const randomUUID = (): string => crypto.randomUUID()
export const closeSync = (): never => unavailable('fs.closeSync')
export const fsyncSync = (): never => unavailable('fs.fsyncSync')
export const openSync = (): never => unavailable('fs.openSync')
export const readFileSync = (): never => unavailable('fs.readFileSync')
export const writeFileSync = (): never => unavailable('fs.writeFileSync')
export const writeSync = (): never => unavailable('fs.writeSync')
export const copyFile = (): never => unavailable('fs.copyFile')
export const mkdir = (): never => unavailable('fs.mkdir')
export const mkdtemp = (): never => unavailable('fs.mkdtemp')
export const rename = (): never => unavailable('fs.rename')
export const rm = (): never => unavailable('fs.rm')
export const stat = (): never => unavailable('fs.stat')
export const unlink = (): never => unavailable('fs.unlink')
export const tmpdir = (): never => unavailable('os.tmpdir')
export const basename = (path: string): string => path.split('/').pop() ?? path
export const dirname = (path: string): string => path.split('/').slice(0, -1).join('/') || '/'
export const extname = (path: string): string => /\.[^./]*$/.exec(path)?.[0] ?? ''
export const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')
export default {}
