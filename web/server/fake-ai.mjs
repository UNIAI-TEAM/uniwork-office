// Fake frame-token AI routes for the test host (CONTRACT C16, contract-first): the GO-A7 web AI
// contract (dev-uniwork docs/office/g3g4/uniwork-office-app-api-contract.md section 3) on the
// frame-token mount, in memory, no network. Not the UniWork server.
//
//   /api/v1/office-frame/documents/{documentID}/ai/   (UniWork AI only, UNI-2289: no key routes)
//     uniwork/chat/completions         POST           UniWork AI: openai-compatible SSE, with the
//                                                     conversation and run headers; a request that carries
//                                                     X-UniWork-AI-Handoff answers the next `handoffRemaining`
//                                                     value as X-UniWork-AI-Handoff-Remaining (UNI-2264);
//                                                     scripted `toolCalls` are answered here too
//     uniwork/write                    POST           UniWork AI writer (UNI-2276): { kind, lang, input } with the
//                                                     run header (400 without it); `writerReply` in three SSE
//                                                     chunks, then [DONE]
//     cloud                            GET            { enabled, reason?, tools, credits }
//     cloud/search|images|media/analyze|transcribe  POST
// Every route wants `Authorization: Bearer <token>` (401 otherwise) and refuses a request that
// carries a Cookie (the frame must send credentials: 'omit'). Errors use the UniWork envelope
// `{ error: { code, message } }`:
// 402 credits_exhausted, 403 entitlement_required, 429 (+ retry-after), 502 provider_unreachable,
// 503 cloud_unavailable.
//
// Test control (web/e2e, Node side): POST /__fake-ai/reset, POST /__fake-ai/control
//   { fail?: [{ status, code?, retryAfter?, path? }]   next matching AI request answers this error
//     unauthorizedOnce?: true | { path: string }       next AI request answers 401 (token refresh); with a
//                                                      path, the next request whose route tail includes it
//                                                      (aim it at '/chat/completions': a background
//                                                      cloud read would eat it)
//     cloud?: { enabled?, reason?, tools?, credits? }  GET cloud state
//     reply?: string                                   the model's streamed answer
//     writerReply?: string                             the writer route's streamed text
//     toolCalls?: [{ name, input }]                    scripted tool calls (openai-compatible stream):
//                                                      the next streamed turns answer one each; the
//                                                      turn after them is the plain `reply`
//     hold?: boolean                                   stream a chunk, then pause between chunks until
//                                                      { hold: false } (or reset): for mid-stream abort
//                                                      and frame/port-loss cases (UNI-1923)
//     handoffRemaining?: number[]                      the Remaining header of the next handed-over
//                                                      questions, in order (none left: no header) }
// GET /__fake-ai/log -> [{ method, path, authorization, cookie, handoff, run, conversation, body }] of
// the AI requests (handoff / run / conversation = the request's X-UniWork-AI-Handoff / -Run /
// -Conversation header, or null).

const MOUNT = /^\/api\/v1\/office-frame\/documents\/([^/]+)\/ai(\/.*)?$/

// 1x1 transparent PNG
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function freshState() {
  return {
    fail: [],
    unauthorizedOnce: null,
    reply: 'Hello from the UniWork AI proxy.',
    // the UniWork AI writer route's streamed text
    writerReply: '<h2>Fake writer section</h2><p>Written by the fake writer route.</p>',
    toolCalls: [],
    handoffRemaining: [],
    // UniWork AI run ids handed out so far
    runs: 0,
    hold: false,
    // res.resolve of streams paused between chunks on `hold`
    held: [],
    cloud: {
      enabled: true,
      tools: {
        web_search: true,
        image_search: true,
        image_generate: true,
        media_analyze: true,
        transcribe: true,
      },
      credits: {
        unit: 'ai.tokens',
        used: 1500,
        limit: 100000,
        remaining: 98500,
        period_end: '2026-11-01T00:00:00Z',
      },
    },
    log: [],
  }
}

let state = freshState()

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

const fail = (res, status, code, message, headers) =>
  json(res, status, { error: { code, message: message ?? code } }, headers)

/** wake every paused stream (release or reset) */
function releaseHeld() {
  for (const r of state.held.splice(0)) r()
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { __invalid: true }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** the reply in three parts, so the frame renders a real stream */
function parts(text) {
  const a = Math.ceil(text.length / 3)
  return [text.slice(0, a), text.slice(a, 2 * a), text.slice(2 * a)].filter(Boolean)
}

async function sse(res, events, headers = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    ...headers,
  })
  for (const e of events) {
    res.write(e)
    // `hold` parks the stream after each chunk so a test can stop the turn or
    // drop the frame mid-stream; the client going away just releases it
    if (state.hold) {
      await new Promise((r) => {
        state.held.push(r)
        res.once('close', r)
      })
    }
    await sleep(60)
  }
  res.end()
}

/** one UniWork AI turn (the frame route): the plain reply, streamed */
async function uniwork(req, res, body) {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  if (body.__invalid) return fail(res, 400, 'invalid_json')
  const headers = {
    'X-UniWork-AI-Conversation': req.headers['x-uniwork-ai-conversation'] || 'conv-1',
    'X-UniWork-AI-Run': `run-${++state.runs}`,
  }
  if (req.headers['x-uniwork-ai-handoff'] && state.handoffRemaining.length > 0) {
    headers['X-UniWork-AI-Handoff-Remaining'] = String(state.handoffRemaining.shift())
  }
  // a scripted tool call: one per streamed turn, then the plain reply
  const call = body.stream ? state.toolCalls.shift() : undefined
  if (call) {
    const delta = {
      tool_calls: [
        {
          index: 0,
          id: `call_${Date.now()}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        },
      ],
    }
    return sse(
      res,
      [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        'data: [DONE]\n\n',
      ],
      headers,
    )
  }
  return sse(
    res,
    [
      ...parts(state.reply).map(
        (p) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`,
      ),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ],
    headers,
  )
}

/** one UniWork AI writer call (UNI-2276): the `writerReply` in three SSE chunks, then [DONE] */
async function uniworkWrite(req, res, body) {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  if (body.__invalid || typeof body.kind !== 'string' || !body.input) {
    return fail(res, 400, 'invalid_request')
  }
  // a writer runs inside the turn's run; it never opens one
  if (!req.headers['x-uniwork-ai-run']) return fail(res, 400, 'invalid_request')
  return sse(res, [
    ...parts(state.writerReply).map(
      (p) =>
        `data: ${JSON.stringify({ model: '', choices: [{ index: 0, delta: { content: p } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`,
    'data: [DONE]\n\n',
  ])
}

async function cloud(req, res, tail, body) {
  const c = state.cloud
  if (tail === '' && req.method === 'GET') {
    return json(res, 200, {
      enabled: c.enabled,
      ...(c.reason ? { reason: c.reason } : {}),
      tools: c.tools,
      credits: c.credits,
    })
  }
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  if (!c.enabled) return fail(res, 403, 'entitlement_required')
  const tool = {
    '/search': 'web_search',
    '/images': 'image_generate',
    '/media/analyze': 'media_analyze',
    '/transcribe': 'transcribe',
  }[tail]
  if (!tool) return fail(res, 404, 'not_found')
  if (tail === '/search' && body.kind === 'image' ? !c.tools.image_search : !c.tools[tool]) {
    return fail(res, 503, 'cloud_unavailable')
  }
  if (tail === '/search') {
    const q = String(body.query ?? '')
    if (body.kind === 'image') {
      return json(res, 200, {
        results: [
          {
            title: `Picture of ${q}`,
            url: 'https://example.com/a',
            snippet: '',
            image_url: `data:image/png;base64,${PNG_1PX}`,
          },
        ],
      })
    }
    return json(res, 200, {
      results: [
        { title: `About ${q}`, url: 'https://example.com/a', snippet: `Fake result for ${q}.` },
      ],
      answer: `Fake answer for ${q}.`,
    })
  }
  if (tail === '/images')
    return json(res, 200, {
      images: [{ mime: 'image/png', data_base64: PNG_1PX }],
      model: 'fake-image',
    })
  if (tail === '/media/analyze')
    return json(res, 200, { text: `Analyzed ${body.media?.length ?? 0} item(s).` })
  return json(res, 200, { text: 'Fake transcript.' })
}

/** the test control endpoints; true when handled */
export async function handleFakeAiControl(req, res, pathname) {
  if (!pathname.startsWith('/__fake-ai/')) return false
  if (pathname === '/__fake-ai/log' && req.method === 'GET') {
    json(res, 200, state.log)
    return true
  }
  if (req.method !== 'POST') {
    fail(res, 405, 'method_not_allowed')
    return true
  }
  if (pathname === '/__fake-ai/reset') {
    releaseHeld()
    state = freshState()
    json(res, 200, { ok: true })
    return true
  }
  if (pathname === '/__fake-ai/control') {
    const body = await readBody(req)
    if (Array.isArray(body.fail)) state.fail.push(...body.fail)
    if (body.unauthorizedOnce) {
      const path =
        typeof body.unauthorizedOnce === 'object' ? body.unauthorizedOnce.path : undefined
      state.unauthorizedOnce = { path: typeof path === 'string' ? path : '' }
    }
    if (typeof body.reply === 'string') state.reply = body.reply
    if (typeof body.writerReply === 'string') state.writerReply = body.writerReply
    if (body.hold === true) state.hold = true
    if (body.hold === false) {
      state.hold = false
      releaseHeld()
    }
    if (Array.isArray(body.toolCalls)) state.toolCalls.push(...body.toolCalls)
    if (Array.isArray(body.handoffRemaining)) state.handoffRemaining.push(...body.handoffRemaining)
    if (body.cloud)
      state.cloud = {
        ...state.cloud,
        ...body.cloud,
        tools: { ...state.cloud.tools, ...(body.cloud.tools ?? {}) },
        credits: { ...state.cloud.credits, ...(body.cloud.credits ?? {}) },
      }
    json(res, 200, { ok: true })
    return true
  }
  fail(res, 404, 'not_found')
  return true
}

/** the AI routes; true when the path is under the mount */
export async function handleFakeAi(req, res, pathname) {
  const m = MOUNT.exec(pathname)
  if (!m) return false
  const tail = m[2] ?? ''
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {}
  state.log.push({
    method: req.method,
    path: pathname,
    authorization: req.headers.authorization ?? null,
    cookie: req.headers.cookie ?? null,
    handoff: req.headers['x-uniwork-ai-handoff'] ?? null,
    run: req.headers['x-uniwork-ai-run'] ?? null,
    conversation: req.headers['x-uniwork-ai-conversation'] ?? null,
    body,
  })
  const auth = String(req.headers.authorization ?? '')
  if (!/^Bearer \S+$/.test(auth)) {
    fail(res, 401, 'unauthorized')
    return true
  }
  if (req.headers.cookie) {
    fail(res, 400, 'cookie_refused', 'frame requests must not carry cookies')
    return true
  }
  if (state.unauthorizedOnce && tail.includes(state.unauthorizedOnce.path)) {
    state.unauthorizedOnce = null
    fail(res, 401, 'unauthorized')
    return true
  }
  const i = state.fail.findIndex((f) => !f.path || tail.includes(f.path))
  if (i >= 0) {
    const [f] = state.fail.splice(i, 1)
    const code = f.code ?? (f.status === 429 ? undefined : 'error')
    json(
      res,
      f.status,
      code ? { code, message: code } : { message: 'rate limited' },
      f.retryAfter ? { 'Retry-After': String(f.retryAfter) } : {},
    )
    return true
  }
  if (tail === '/uniwork/chat/completions') {
    await uniwork(req, res, body)
    return true
  }
  if (tail === '/uniwork/write') {
    await uniworkWrite(req, res, body)
    return true
  }
  if (tail === '/cloud' || tail.startsWith('/cloud/')) {
    await cloud(req, res, tail.slice('/cloud'.length), body)
    return true
  }
  fail(res, 404, 'not_found')
  return true
}
