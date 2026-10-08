import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ZodError } from 'zod'
import {
  officeLaunchExchangeRequestSchema,
  officeSaveCompleteRequestSchema,
  officeSavePrepareRequestSchema,
  officeSessionCreateRequestSchema,
} from '@uniwork/office-bridge-contracts'
import { AdapterError, type OfficeBridgeStore } from './store'
import { renderWorkProductPage } from './pwa'

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AdapterError) {
    if (err.code === 'VERSION_CONFLICT') {
      sendJson(res, 400, {
        ok: false,
        error: 'VERSION_CONFLICT',
        ...(err.extra ?? {}),
      })
      return
    }
    sendJson(res, err.status, { ok: false, error: err.code })
    return
  }
  sendJson(res, 500, { ok: false, error: 'INTERNAL' })
}

export function createOfficeBridgeHttpHandler(store: OfficeBridgeStore) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const auth = req.headers.authorization
      const path = url.pathname

      if (req.method === 'GET' && path.startsWith('/pwa/work-product/')) {
        const id = decodeURIComponent(path.slice('/pwa/work-product/'.length))
        const wp = store.getWorkProduct(id)
        const html = renderWorkProductPage({
          workProductId: id,
          title: wp?.title ?? 'Work Product',
          fileName: wp?.fileName ?? '',
          supported: Boolean(wp),
        })
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }

      if (req.method === 'POST' && path === '/api/office/sessions') {
        const parsed = officeSessionCreateRequestSchema.parse(
          JSON.parse((await readBody(req)).toString('utf8') || '{}'),
        )
        sendJson(res, 200, { ok: true, ...store.createSession(auth, parsed.documentId) })
        return
      }

      if (req.method === 'POST' && path === '/api/office/sessions/exchange') {
        const parsed = officeLaunchExchangeRequestSchema.parse(
          JSON.parse((await readBody(req)).toString('utf8') || '{}'),
        )
        sendJson(res, 200, { ok: true, ...store.exchange(parsed.token) })
        return
      }

      if (req.method === 'GET' && path === '/api/office/download') {
        const file = store.download(auth)
        res.writeHead(200, {
          'Content-Type': file.mimeType,
          'Cache-Control': 'no-store',
        })
        res.end(Buffer.from(file.bytes))
        return
      }

      if (req.method === 'POST' && path === '/api/office/save/prepare') {
        const parsed = officeSavePrepareRequestSchema.parse(
          JSON.parse((await readBody(req)).toString('utf8') || '{}'),
        )
        sendJson(res, 200, { ok: true, ...store.prepareSave(auth, parsed) })
        return
      }

      if (req.method === 'PUT' && path === '/api/office/upload') {
        const bytes = new Uint8Array(await readBody(req))
        store.upload(auth, bytes)
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'POST' && path === '/api/office/save/complete') {
        const parsed = officeSaveCompleteRequestSchema.parse(
          JSON.parse((await readBody(req)).toString('utf8') || '{}'),
        )
        sendJson(res, 200, { ok: true, ...store.completeSave(auth, parsed) })
        return
      }

      sendJson(res, 404, { ok: false, error: 'NOT_FOUND' })
    } catch (err) {
      if (err instanceof ZodError || err instanceof SyntaxError) {
        sendJson(res, 400, { ok: false, error: 'INVALID_REQUEST' })
        return
      }
      sendError(res, err)
    }
  }
}

export function listenOfficeBridgeAdapter(
  store: OfficeBridgeStore,
  port = 0,
): Promise<{ server: Server; origin: string }> {
  const handler = createOfficeBridgeHttpHandler(store)
  const server = createServer((req, res) => {
    void handler(req, res)
  })
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('listen failed'))
        return
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}
