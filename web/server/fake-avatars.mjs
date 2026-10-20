// Fake frame-token avatar route for the test host (UNI-1986, contract-first): the same-origin path the
// host puts in `avatar_url` of comments and mention candidates, answered in memory, no network. Not
// the UniWork server.
//
//   GET | HEAD /api/v1/office-frame/documents/{documentID}/avatars/{userID}   (ULIDs, upper case)
//     200 a small PNG (image/png, nosniff, private cache)
//     401 without `Authorization: Bearer <token>`; 400 cookie_refused when a Cookie came along (the
//         frame must send credentials: 'omit')
//     404 not_found for every user the test did not seed (and for a non-ULID id)
//
// Test control (web/e2e, Node side): POST /__fake-avatars/reset, POST /__fake-avatars/control
//   { users?: [userID]            these users have a picture (default: none, everyone answers 404)
//     notFound?: [userID]         404 for these even when seeded
//     wrongType?: [userID]        200 with Content-Type image/svg+xml (the loader must refuse it)
//     oversize?: [userID]         200 with a body over 2 MiB (the loader must refuse it)
//     unauthorizedOnce?: true     the next avatar request answers 401 (token refresh) }
// GET /__fake-avatars/log -> [{ method, path, authorization, cookie }] of the avatar requests.

// 1x1 transparent PNG
export const FAKE_AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const ROUTE = /^\/api\/v1\/office-frame\/documents\/([0-9A-Z]{26})\/avatars\/([0-9A-Z]{26})$/

const freshState = () => ({
  users: new Set(),
  notFound: new Set(),
  wrongType: new Set(),
  oversize: new Set(),
  unauthorizedOnce: false,
  log: [],
})
let state = freshState()

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

const fail = (res, status, code) => json(res, status, { error: { code, message: code } })

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

/** the test control endpoints; true when handled */
export async function handleFakeAvatarsControl(req, res, pathname) {
  if (!pathname.startsWith('/__fake-avatars/')) return false
  if (pathname === '/__fake-avatars/log' && req.method === 'GET') {
    json(res, 200, state.log)
    return true
  }
  if (req.method !== 'POST') {
    fail(res, 405, 'method_not_allowed')
    return true
  }
  if (pathname === '/__fake-avatars/reset') {
    state = freshState()
    json(res, 200, { ok: true })
    return true
  }
  if (pathname === '/__fake-avatars/control') {
    const body = await readBody(req)
    for (const key of ['users', 'notFound', 'wrongType', 'oversize'])
      if (Array.isArray(body[key])) for (const id of body[key]) state[key].add(String(id))
    if (body.unauthorizedOnce) state.unauthorizedOnce = true
    json(res, 200, { ok: true })
    return true
  }
  fail(res, 404, 'not_found')
  return true
}

/** the avatar route; true when the path is one */
export async function handleFakeAvatars(req, res, pathname) {
  const m = ROUTE.exec(pathname)
  if (!m) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fail(res, 405, 'method_not_allowed')
    return true
  }
  const userId = m[2]
  state.log.push({
    method: req.method,
    path: pathname,
    authorization: req.headers.authorization ?? null,
    cookie: req.headers.cookie ?? null,
  })
  if (!/^Bearer \S+$/.test(String(req.headers.authorization ?? ''))) {
    fail(res, 401, 'unauthorized')
    return true
  }
  if (req.headers.cookie) {
    fail(res, 400, 'cookie_refused')
    return true
  }
  if (state.unauthorizedOnce) {
    state.unauthorizedOnce = false
    fail(res, 401, 'unauthorized')
    return true
  }
  if (!state.users.has(userId) || state.notFound.has(userId)) {
    fail(res, 404, 'not_found')
    return true
  }
  const body = state.oversize.has(userId)
    ? Buffer.concat([FAKE_AVATAR_PNG, Buffer.alloc(2 * 1024 * 1024)])
    : FAKE_AVATAR_PNG
  res.writeHead(200, {
    'Content-Type': state.wrongType.has(userId) ? 'image/svg+xml' : 'image/png',
    'Content-Length': body.length,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}
