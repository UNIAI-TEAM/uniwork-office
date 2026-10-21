import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFolderUploadTransport } from '../src/main/uniwork-docs/folder-upload-client'
import { openFileBlob } from '../src/main/uniwork-docs/folder-upload/file-source'
import type { FileTarget } from '../src/main/uniwork-docs/folder-upload/transport'

/**
 * UNI-2052 FU-FIX1 M3: the storage PUT goes out through Node's global fetch
 * (what index.ts hands the wiring), not Electron's net.fetch. A real local HTTP
 * server sees what a presigned storage endpoint (S3 / MinIO) would: a plain
 * PUT with a Content-Length, no chunked encoding, no credentials, exact bytes.
 */

interface Seen {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: Buffer
}

let dir: string
let server: Server
let origin: string
let seen: Seen[]

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fu-storage-http-'))
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      })
      res.setHeader('ETag', `"etag-${seen.length}"`)
      res.statusCode = 200
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

// the same callback index.ts passes as `storageFetch`
const storageFetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init)

const transport = () =>
  createFolderUploadTransport(
    {
      apiOrigin: 'https://uniwork.example',
      authorized: <T>(call: (token: string) => Promise<T>) => call('session-token'),
      isSignedIn: () => true,
    },
    'ws_1',
    { storageFetch },
  )

function fileOf(bytes: Buffer): string {
  const path = join(dir, `f-${Math.random().toString(36).slice(2)}.bin`)
  writeFileSync(path, bytes)
  return path
}

function expectPlainPut(request: Seen, bytes: Buffer): void {
  expect(request.method).toBe('PUT')
  expect(request.headers['content-length']).toBe(String(bytes.length))
  expect(request.headers['transfer-encoding']).toBeUndefined()
  expect(request.headers.authorization).toBeUndefined()
  expect(request.headers.cookie).toBeUndefined()
  expect(request.body.equals(bytes)).toBe(true)
}

describe('storage PUT over the global fetch', () => {
  it('a single PUT of a file-backed Blob arrives plain, whole and without credentials', async () => {
    seen = []
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))
    const blob = await openFileBlob(fileOf(bytes))
    const target: FileTarget = {
      kind: 'put',
      method: 'PUT',
      url: `${origin}/bucket/f-0001?sig=abc`,
      headers: { 'Content-Type': 'application/octet-stream', Authorization: 'must-not-pass' },
      expires_at: '2099-01-01T00:00:00Z',
    }

    const stored = await transport().put(target, blob)

    expect(stored).toEqual({ etag: '"etag-1"' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('/bucket/f-0001?sig=abc')
    expectPlainPut(seen[0] as Seen, bytes)
  })

  it('each part of a multipart target is a plain PUT of exactly its slice', async () => {
    seen = []
    const bytes = Buffer.from(Array.from({ length: 2500 }, (_, i) => (i * 7) % 253))
    const blob = await openFileBlob(fileOf(bytes))
    const part = (n: number) => ({
      part_number: n,
      method: 'PUT',
      url: `${origin}/bucket/f-0002?partNumber=${n}`,
      headers: {},
      expires_at: '2099-01-01T00:00:00Z',
    })
    const target: FileTarget = {
      kind: 'multipart',
      session_id: 's-f-0002',
      part_size: 1000,
      parts: [part(1), part(2), part(3)],
      expires_at: '2099-01-01T00:00:00Z',
    }

    const stored = await transport().put(target, blob)

    expect(seen).toHaveLength(3)
    expect(stored).toMatchObject({
      parts: [{ part_number: 1 }, { part_number: 2 }, { part_number: 3 }],
    })
    expectPlainPut(seen[0] as Seen, bytes.subarray(0, 1000))
    expectPlainPut(seen[1] as Seen, bytes.subarray(1000, 2000))
    expectPlainPut(seen[2] as Seen, bytes.subarray(2000))
  })
})

describe('the wiring', () => {
  it('index.ts hands the storage PUT to the global fetch, not Electron net.fetch', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const line = source.split('\n').find((l) => l.trimStart().startsWith('storageFetch:'))
    expect(line).toBeDefined()
    expect(line).not.toContain('net.fetch')
    expect(line).toContain('fetch(input, init)')
  })
})
