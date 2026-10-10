// Fake frame-token AI routes for the test host (CONTRACT C16, contract-first): the GO-A7 web AI
// contract (dev-uniwork docs/office/g3g4/uniwork-office-app-api-contract.md section 3) on the
// frame-token mount, in memory, no network. Not the UniWork server.
//
//   /api/v1/office-frame/documents/{documentID}/ai/
//     credentials                      GET            { items, providers }
//     credentials/{provider}           PUT / DELETE   201 create / 200 update / 204 delete, key_hint only
//     byok/{provider}/chat/completions POST           openai-compatible, SSE when stream: true
//     byok/{provider}/messages         POST           Anthropic Messages, SSE when stream: true
//     byok/{provider}/generate         POST           { model, stream, request } -> Gemini (SSE when stream)
//     byok/{provider}/models           GET            { data: [{ id }] }
//     cloud                            GET            { enabled, reason?, tools, credits }
//     cloud/search|images|media/analyze|transcribe  POST
// Every route wants `Authorization: Bearer <token>` (401 otherwise) and refuses a request that
// carries a Cookie (the frame must send credentials: 'omit'). Errors are `{ code, message }`:
// 400 provider_not_supported / base_url_refused, 402 credits_exhausted, 403 entitlement_required,
// 404 credential_missing, 424 provider_auth_failed (a stored key starting with "bad-"), 429 (+
// retry-after), 502 provider_unreachable, 503 cloud_unavailable.
//
// Test control (web/e2e, Node side): POST /__fake-ai/reset, POST /__fake-ai/control
//   { fail?: [{ status, code?, retryAfter?, path? }]   next matching AI request answers this error
//     unauthorizedOnce?: true                          next AI request answers 401 (token refresh)
//     cloud?: { enabled?, reason?, tools?, credits? }  GET cloud state
//     reply?: string                                   the model's streamed answer
//     toolCalls?: [{ name, input }]                    scripted tool calls (openai-compatible stream):
//                                                      the next streamed turns answer one each; the
//                                                      turn after them is the plain `reply`
//     credentials?: [{ provider, api_key, base_url? }] seed stored keys }
// GET /__fake-ai/log -> [{ method, path, authorization, cookie, body }] of the AI requests.

const MOUNT = /^\/api\/v1\/office-frame\/documents\/([^/]+)\/ai(\/.*)?$/

// the server's BYOK table (server/internal/ai/provider/byok.go), display order
const PROVIDERS = [
  ['anthropic', 'anthropic', 'https://api.anthropic.com'],
  ['gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'],
  ['openai', 'openai-compatible', 'https://api.openai.com/v1'],
  ['deepseek', 'openai-compatible', 'https://api.deepseek.com/v1'],
  ['kimi', 'openai-compatible', 'https://api.moonshot.ai/v1'],
  ['glm', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4'],
  ['qwen', 'openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
  ['doubao', 'openai-compatible', 'https://ark.cn-beijing.volces.com/api/v3'],
  ['hunyuan', 'openai-compatible', 'https://tokenhub.tencentcloudmaas.com/v1'],
  ['minimax', 'openai-compatible', 'https://api.minimax.io/v1'],
  ['xai', 'openai-compatible', 'https://api.x.ai/v1'],
  ['mistral', 'openai-compatible', 'https://api.mistral.ai/v1'],
  ['openrouter', 'openai-compatible', 'https://openrouter.ai/api/v1'],
  ['requesty', 'openai-compatible', 'https://router.requesty.ai/v1'],
  ['custom', 'openai-compatible', ''],
].map(([id, protocol, base]) => ({
  id,
  protocol,
  requires_base_url: id === 'custom',
  default_base_url: base,
}))

// 1x1 transparent PNG
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function freshState() {
  return {
    credentials: new Map(),
    fail: [],
    unauthorizedOnce: false,
    reply: 'Hello from the UniWork AI proxy.',
    toolCalls: [],
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

const hint = (key) => `…${key.slice(-4)}`
const now = () => new Date().toISOString()

function credentialView(provider, c) {
  return {
    provider,
    label: c.label ?? '',
    base_url: c.base_url ?? '',
    key_hint: hint(c.api_key),
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

function seed(list) {
  for (const c of list ?? []) {
    const t = now()
    state.credentials.set(c.provider, { ...c, created_at: t, updated_at: t })
  }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

const fail = (res, status, code, message, headers) =>
  json(res, status, { code, message: message ?? code }, headers)

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

async function sse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  for (const e of events) {
    res.write(e)
    await sleep(60)
  }
  res.end()
}

async function byok(req, res, provider, tail, body) {
  const row = PROVIDERS.find((p) => p.id === provider)
  if (!row) return fail(res, 400, 'provider_not_supported')
  const cred = state.credentials.get(provider)
  if (!cred) return fail(res, 404, 'credential_missing', `no ${provider} key stored`)
  if (cred.api_key.startsWith('bad-')) return fail(res, 424, 'provider_auth_failed')
  const reply = state.reply
  if (tail === '/models' && req.method === 'GET') {
    return json(res, 200, { data: [{ id: 'fake-model-1' }, { id: 'fake-model-2' }] })
  }
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  if (body.__invalid) return fail(res, 400, 'invalid_json')

  if (tail === '/chat/completions' && row.protocol === 'openai-compatible') {
    if (!body.stream) {
      return json(res, 200, {
        choices: [
          { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
        ],
      })
    }
    // a scripted tool call (agent turns): one per streamed turn, then the plain reply
    const call = state.toolCalls.shift()
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
      return sse(res, [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        'data: [DONE]\n\n',
      ])
    }
    return sse(res, [
      ...parts(reply).map(
        (p) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`,
      ),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ])
  }
  if (tail === '/messages' && row.protocol === 'anthropic') {
    if (!body.stream) {
      return json(res, 200, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn',
      })
    }
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    return sse(res, [
      ev('message_start', { message: { role: 'assistant', content: [] } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ...parts(reply).map((p) =>
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: p } }),
      ),
      ev('content_block_stop', { index: 0 }),
      ev('message_delta', { delta: { stop_reason: 'end_turn' } }),
      ev('message_stop', {}),
    ])
  }
  if (tail === '/generate' && row.protocol === 'gemini') {
    if (typeof body.model !== 'string' || !body.request) return fail(res, 400, 'invalid_request')
    const chunk = (text, finish) => ({
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          ...(finish ? { finishReason: 'STOP' } : {}),
        },
      ],
    })
    if (!body.stream) return json(res, 200, chunk(reply, true))
    const ps = parts(reply)
    return sse(
      res,
      ps.map((p, i) => `data: ${JSON.stringify(chunk(p, i === ps.length - 1))}\n\n`),
    )
  }
  return fail(res, 404, 'not_found', `no ${row.protocol} route ${tail}`)
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

async function credentials(req, res, provider, body) {
  if (!provider) {
    if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed')
    return json(res, 200, {
      items: [...state.credentials].map(([p, c]) => credentialView(p, c)),
      providers: PROVIDERS,
    })
  }
  const row = PROVIDERS.find((p) => p.id === provider)
  if (!row) return fail(res, 400, 'provider_not_supported')
  const existing = state.credentials.get(provider)
  if (req.method === 'DELETE') {
    if (!existing) return fail(res, 404, 'credential_missing')
    state.credentials.delete(provider)
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    return res.end()
  }
  if (req.method !== 'PUT') return fail(res, 405, 'method_not_allowed')
  if (body.__invalid) return fail(res, 400, 'invalid_json')
  const key = typeof body.api_key === 'string' ? body.api_key : undefined
  if (!existing && !key) return fail(res, 400, 'invalid_request', 'api_key is required')
  const baseUrl = typeof body.base_url === 'string' ? body.base_url : (existing?.base_url ?? '')
  if (row.requires_base_url && !/^https:\/\/[^/]+\.[^/]+/.test(baseUrl)) {
    return fail(res, 400, 'base_url_refused')
  }
  const t = now()
  const next = {
    api_key: key ?? existing.api_key,
    base_url: baseUrl,
    label: typeof body.label === 'string' ? body.label : (existing?.label ?? ''),
    created_at: existing?.created_at ?? t,
    updated_at: t,
  }
  state.credentials.set(provider, next)
  return json(res, existing ? 200 : 201, credentialView(provider, next))
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
    state = freshState()
    json(res, 200, { ok: true })
    return true
  }
  if (pathname === '/__fake-ai/control') {
    const body = await readBody(req)
    if (Array.isArray(body.fail)) state.fail.push(...body.fail)
    if (body.unauthorizedOnce) state.unauthorizedOnce = true
    if (typeof body.reply === 'string') state.reply = body.reply
    if (Array.isArray(body.toolCalls)) state.toolCalls.push(...body.toolCalls)
    if (body.cloud)
      state.cloud = {
        ...state.cloud,
        ...body.cloud,
        tools: { ...state.cloud.tools, ...(body.cloud.tools ?? {}) },
        credits: { ...state.cloud.credits, ...(body.cloud.credits ?? {}) },
      }
    if (Array.isArray(body.credentials)) seed(body.credentials)
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
    body: tail.startsWith('/credentials')
      ? { ...body, api_key: body.api_key ? '<set>' : undefined }
      : body,
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
  if (state.unauthorizedOnce) {
    state.unauthorizedOnce = false
    fail(res, 401, 'unauthorized')
    return true
  }
  const i = state.fail.findIndex((f) => !f.path || tail.includes(f.path))
  if (i >= 0 && !tail.startsWith('/credentials')) {
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
  const cm = /^\/credentials(?:\/([^/]+))?$/.exec(tail)
  if (cm) {
    await credentials(req, res, cm[1] ? decodeURIComponent(cm[1]) : '', body)
    return true
  }
  const bm = /^\/byok\/([^/]+)(\/.*)$/.exec(tail)
  if (bm) {
    await byok(req, res, decodeURIComponent(bm[1]), bm[2], body)
    return true
  }
  if (tail === '/cloud' || tail.startsWith('/cloud/')) {
    await cloud(req, res, tail.slice('/cloud'.length), body)
    return true
  }
  fail(res, 404, 'not_found')
  return true
}
