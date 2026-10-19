/**
 * UniWork cloud tools (web/image search, image generation, media analysis,
 * transcription), paid with the organization's UniWork AI credits. The calls
 * go through the transport the shell main process installs in
 * `@genoffice/ai-provider` (uniwork-cloud.ts), which adds the bearer token
 * itself; this file never sees a token. Media is read here, client-side
 * (local paths under the caller's roots, data URLs, SSRF-guarded https URLs),
 * and sent as bytes, so the server never fetches a URL. Generated images land
 * in the local generated-image store and come back as file:// URLs the insert
 * pipelines accept. Slide generation is not a cloud tool and always rejects.
 * Internal names keep the historic `gsk` prefix (upstream-sync fit); nothing
 * here is shown to users.
 */

import {
<<<<<<< ours
  getUniworkCloudStatus,
  uniworkCloudEnabled,
  uniworkCloudToolAvailable,
  uniworkCloudTransport,
  UniworkCloudError,
  type MediaBlob,
  type UniworkCloudMedia,
  type UniworkCloudTool,
} from '@genoffice/ai-provider'
=======
  asRecord,
  firstItem,
  gskProxyUrl,
  isCopyrightHost,
  safeHost,
  type ImageSearchResult,
  type WebSearchResult,
} from './shared'
import {
  genofficeApiKey,
  genofficeAuthPath,
  recoverFromRejectedGskKey,
  reloadGenofficeAuth,
  type GskRecoveryOutcome,
} from './genoffice-auth'
>>>>>>> theirs
// deep import: the package root re-exports Electron-bound modules, and this file also runs in the genoffice CLI
import { storeGeneratedImage } from '@genoffice/electron-utils/generated-images'
import { loadMediaReferences, type MediaBudget } from './media-tools'
import { safeHost, type ImageSearchResult, type WebSearchResult } from './shared'

const MIB = 1024 * 1024

/** server caps (contract: UniWork cloud tools) */
export const UNIWORK_CLOUD_LIMITS = {
  maxQueryChars: 400,
  maxResults: 10,
  maxPromptChars: 4000,
  maxReferenceImages: 4,
  maxReferenceImageBytes: 8 * MIB,
  maxMediaItems: 4,
  maxMediaTotalBytes: 25 * MIB,
  maxAudioBytes: 25 * MIB,
} as const

const EXACT_SIZE = /^\d+x\d+$/

const SLIDES_UNAVAILABLE = 'UniWork cloud slide generation is not available'

function requireTool(tool: UniworkCloudTool): void {
  const status = getUniworkCloudStatus()
  if (status.state === 'signed-out') throw new UniworkCloudError('signed_out')
  if (status.state === 'not-entitled') throw new UniworkCloudError('entitlement_required')
  if (status.state === 'subscription-inactive') throw new UniworkCloudError('subscription_inactive')
  if (!uniworkCloudToolAvailable(tool)) throw new UniworkCloudError('cloud_unavailable')
}

<<<<<<< ours
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
=======
/**
 * API key for Genspark LLM proxy / tool_cli auth; '' when not logged in.
 * Priority: GSK_API_KEY env → GenOffice's own key (bills to us via its
 * key_name) → shared gsk CLI login (bills to the Claw bucket).
 */
export function gskApiKey(): string {
  const env = process.env.GSK_API_KEY
  if (env && !rejectedKeys.has(env)) return env
  const own = genofficeApiKey()
  if (own && !rejectedKeys.has(own)) return own
  try {
    const configPath = join(homedir(), '.genspark-tool-cli', 'config.json')
    if (!existsSync(configPath)) return ''
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { api_key?: string }
    const shared = config.api_key ?? ''
    return rejectedKeys.has(shared) ? '' : shared
  } catch {
    return ''
  }
}

// ── Rejected keys (401) ─────────────────────────────────────────────

/**
 * Keys the server answered 401 for (expired / revoked). GenOffice's own key
 * is also deleted from disk; env and shared gsk CLI keys belong to someone
 * else, so they are only skipped for the rest of this process.
 */
const rejectedKeys = new Set<string>()

/** Thrown when a gsk-key call is refused with 401 and no fresh key could be minted. */
export class GskAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GskAuthError'
  }
}

/** Whether an error text reports an HTTP 401 (gsk CLI, tool_cli, LLM proxy shapes). */
export function isGskUnauthorizedText(text: unknown): boolean {
  return /\bHTTP 401\b|\b401 Unauthorized\b/i.test(String(text ?? ''))
}

/**
 * Records that `key` was refused with 401: it stops being offered (so
 * hasGskAuth() / ai:gsk-status report signed-out and the existing sign-in UI
 * appears) and the re-mint / re-login recovery starts. The invalidation is
 * synchronous, before the first await, so a caller can report the failure
 * right after this returns.
 */
export function noteGskKeyRejected(
  key: string,
  options: { allowLogin?: boolean } = {},
): Promise<GskRecoveryOutcome> {
  if (key) rejectedKeys.add(key)
  return recoverFromRejectedGskKey(key, options)
}

/**
 * For callers that used the gsk key outside this module (the Genspark LLM
 * proxy chat/stream): when `error` reports a 401, drop the key and start the
 * recovery in the background. Returns whether it was an auth failure.
 */
export function noteGskCallFailure(key: string, error: unknown): boolean {
  if (!key) return false
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (!isGskUnauthorizedText(text)) return false
  void noteGskKeyRejected(key).catch(() => {})
  return true
}

/**
 * Runs `call` with the current key; on a 401 drops the key and, when the
 * stored session minted a replacement, retries exactly once with it.
 */
async function withKeyRecovery<T>(
  call: (key: string) => Promise<T>,
  options: { allowLogin?: boolean } = {},
): Promise<T> {
  const key = gskApiKey()
  try {
    return await call(key)
  } catch (err) {
    if (!(err instanceof GskAuthError)) throw err
    const outcome = await noteGskKeyRejected(key, options)
    const next = gskApiKey()
    if (outcome !== 'reminted' || !next || next === key) throw err
    return call(next)
  }
}

/** Test hook: forget rejected keys. */
export function resetGskRejectedKeys(): void {
  rejectedKeys.clear()
}

/**
 * Fires when the effective gsk key changes on disk — another GenOffice-family
 * app re-logging in mints a new key and revokes the one this process holds.
 * Polls by path (watchFile): auth.json is replaced whole, and fs.watch misses
 * events for a moment after it is armed.
 */
export function watchGskApiKey(onChange: (key: string) => void, intervalMs = 2000): () => void {
  let last = gskApiKey()
  const check = (): void => {
    reloadGenofficeAuth()
    const key = gskApiKey()
    if (key === last) return
    last = key
    onChange(key)
  }
  const files = [genofficeAuthPath(), join(homedir(), '.genspark-tool-cli', 'config.json')]
  for (const f of files) watchFile(f, { persistent: false, interval: intervalMs }, check)
  return () => {
    for (const f of files) unwatchFile(f, check)
  }
>>>>>>> theirs
}

/** options every media entry point accepts: where bare local paths may be read from */
export interface GskMediaOptions {
  mediaRoots?: readonly string[]
}

/** `s` cut to `max` characters (code points, so a surrogate pair is never split) */
function clip(s: string, max: number): string {
  return s.length <= max ? s : Array.from(s).slice(0, max).join('')
}

const LOCAL_READ_REFUSED =
  'Local files can only be sent to UniWork cloud AI from the open document folder or its attachments; this document has no such folder (save it first), so use an https or data URL instead'

/**
 * Fails closed on the cloud path: a bare local path is read only under the
 * caller's media roots. With no roots the extension check would be the only
 * gate and a prompt-injected path could ship any image, audio or video on the
 * disk to the server, so only https, data: and generated-store file: URLs pass.
 */
export function assertCloudMediaRefs(refs: readonly string[], roots?: readonly string[]): void {
  if (roots && roots.length > 0) return
  for (const ref of refs) {
    if (!/^(https?:|data:|file:)/i.test(ref)) throw new Error(LOCAL_READ_REFUSED)
  }
}

/** loads the references of one cloud call, refusing local reads the roots do not cover */
async function loadCloudMedia(
  refs: readonly string[],
  budget: MediaBudget,
  roots?: readonly string[],
): Promise<MediaBlob[]> {
  assertCloudMediaRefs(refs, roots)
  return loadMediaReferences(refs, budget, roots)
}

/**
 * true when the UniWork cloud route is usable: signed in and the plan includes
 * it. With `tool`, that tool must also be offered by the server.
 */
export function hasGskAuth(tool?: UniworkCloudTool): boolean {
  return tool ? uniworkCloudToolAvailable(tool) : uniworkCloudEnabled()
}

export interface GskLoginInfo {
  email: string
  plan: string
  /** credits left this period; absent on an uncapped plan */
  creditBalance?: number
}

/** Current cloud account (display only); null while signed out or not entitled */
export async function gskLoginInfo(): Promise<GskLoginInfo | null> {
  const status = getUniworkCloudStatus()
  if (!status.enabled) return null
  const remaining = status.credits?.remaining
  return {
    email: status.email ?? '',
    plan: status.planName ?? '',
    ...(typeof remaining === 'number' ? { creditBalance: remaining } : {}),
  }
<<<<<<< ours
=======
  throw new Error(`No JSON found in gsk output: ${summarizeGskFailure(stdout, '')}`)
}

/** `passive`: a status/background call — a rejected key is dropped but no browser login opens */
function runGsk(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  passive = false,
): Promise<unknown> {
  const entry = resolveGskEntry()
  if (!entry) return Promise.reject(new Error('@genspark/cli is not installed'))
  return withKeyRecovery((key) => runGskOnce(entry, key, args, timeoutMs, signal), {
    allowLogin: !passive,
  })
}

function runGskOnce(
  entry: string,
  key: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  // inject the resolved key so the CLI bills the same identity as our direct HTTP calls
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...electronCompatArgs(), entry, ...args, '--output', 'json'],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        env: {
          ...gskChildEnv(),
          ...(key ? { GSK_API_KEY: key } : {}),
        },
        ...(signal ? { signal } : {}),
      },
      (err, stdout, stderr) => {
        if (err) {
          // stderr carries gsk's real reason ([ERROR] lines, or a whole HTML
          // page); err.message only repeats the command line, so use it alone
          // when stderr has nothing
          const stderrText = summarizeGskFailure(stderr, '')
          const message = stderrText
            ? `gsk failed: ${stderrText}`
            : summarizeGskFailure((err as Error).message, 'gsk failed')
          // the CLI prints a refused call's {status:'error', message:'HTTP 401…'} on stdout
          const unauthorized =
            !!key && (isGskUnauthorizedText(stdout) || isGskUnauthorizedText(stderr))
          reject(unauthorized ? new GskAuthError(message) : new Error(message))
          return
        }
        try {
          const result = parseGskOutput(String(stdout))
          const rec = asRecord(result)
          if (rec.status && rec.status !== 'ok') {
            const message = `gsk returned an error: ${summarizeGskFailure(rec.message ?? rec.status)}`
            reject(
              key && isGskUnauthorizedText(rec.message)
                ? new GskAuthError(message)
                : new Error(message),
            )
            return
          }
          resolve(result)
        } catch (parseErr) {
          reject(parseErr)
        }
      },
    )
  })
>>>>>>> theirs
}

// ── Search ──────────────────────────────────────────────────────────

function clampResults(max: number, fallback: number): number {
  const n = Number.isFinite(max) ? Math.floor(max) : fallback
  return Math.min(Math.max(1, n), UNIWORK_CLOUD_LIMITS.maxResults)
}

export async function gskWebSearch(
  query: string,
  maxResults = 6,
  signal?: AbortSignal,
): Promise<{ results: WebSearchResult[]; answer?: string }> {
  requireTool('web_search')
  const r = await uniworkCloudTransport().search(
    {
      query: clip(String(query ?? ''), UNIWORK_CLOUD_LIMITS.maxQueryChars),
      kind: 'web',
      maxResults: clampResults(maxResults, 6),
    },
    signal,
  )
  return {
    results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })),
    ...(r.answer ? { answer: r.answer } : {}),
  }
}

export async function gskImageSearch(
  query: string,
  maxResults = 8,
  signal?: AbortSignal,
): Promise<ImageSearchResult[]> {
  requireTool('image_search')
  const r = await uniworkCloudTransport().search(
    {
      query: clip(String(query ?? ''), UNIWORK_CLOUD_LIMITS.maxQueryChars),
      kind: 'image',
      maxResults: clampResults(maxResults, 8),
    },
    signal,
  )
  const images: ImageSearchResult[] = []
  for (const x of r.results) {
    const imageUrl = x.imageUrl || x.thumbnailUrl
    if (!imageUrl) continue
    images.push({ title: x.title, imageUrl, sourceUrl: x.url, source: safeHost(x.url) })
  }
  return images
}

// ── Image generation ────────────────────────────────────────────────

export interface GskGenerateImageOptions {
  /** Image description (English works better; text that must appear in the image stays verbatim) */
  prompt: string
  /** Generation model; ignored by the UniWork cloud (the server picks it) */
  model?: string
  /** Reference/edit-target image URLs or local paths (read here, sent as bytes) */
  referenceImageUrls?: string[] | undefined
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string | undefined
  /** auto | 0.5k | 1k | 2k | 3k | 4k */
  imageSize?: string | undefined
}

export interface GskGeneratedImage {
  /** file:// URL in the local generated-image store */
  url: string
  /** the model the server used */
  taskId: string
}

export async function gskGenerateImage(
  options: GskGenerateImageOptions,
  signal?: AbortSignal,
  media: GskMediaOptions = {},
): Promise<GskGeneratedImage> {
  requireTool('image_generate')
  const prompt = clip(String(options.prompt ?? '').trim(), UNIWORK_CLOUD_LIMITS.maxPromptChars)
  if (!prompt) throw new Error('prompt must not be empty')
  const refs = (options.referenceImageUrls ?? []).map(String).filter(Boolean)
  const blobs = await loadCloudMedia(
    refs,
    {
      maxItems: UNIWORK_CLOUD_LIMITS.maxReferenceImages,
      maxItemBytes: UNIWORK_CLOUD_LIMITS.maxReferenceImageBytes,
      maxTotalBytes:
        UNIWORK_CLOUD_LIMITS.maxReferenceImages * UNIWORK_CLOUD_LIMITS.maxReferenceImageBytes,
    },
    media.mediaRoots,
  )
  const referenceImages: UniworkCloudMedia[] = blobs.map((b) => {
    if (!b.mime.startsWith('image/')) throw new Error('reference images must be images')
    if (b.bytes.byteLength > UNIWORK_CLOUD_LIMITS.maxReferenceImageBytes) {
      throw new Error('a reference image is too large (limit 8 MB)')
    }
    return { mime: b.mime, dataBase64: toBase64(b.bytes) }
  })
  const r = await uniworkCloudTransport().generateImage(
    {
      prompt,
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
      // the server lets an exact size (and 'auto') override the aspect ratio: send WxH only
      ...(options.imageSize && EXACT_SIZE.test(options.imageSize)
        ? { imageSize: options.imageSize }
        : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
    },
    signal,
  )
  const first = r.images[0]
  if (!first) throw new UniworkCloudError('malformed_response')
  return { url: storeGeneratedImage(fromBase64(first.dataBase64), first.mime), taskId: r.model }
}

// ── Slide generation (not a UniWork cloud tool) ─────────────────────

export interface GskSlideGenerateOptions {
  /** Content and layout brief for this page */
  brief: string
  title?: string
  /** Deck-level visual system / typography / palette rules (Style Skill text) */
  styleSkill?: string
  /** Deck topic, page index, total pages, neighboring-page context */
  deckContext?: Record<string, unknown>
  /** HTTPS image candidates for this page */
  images?: { url: string; caption?: string }[]
  width?: number
  height?: number
  /** Slides model tier: ultra = opus-class model, standard (server default) = lighter model */
  tier?: 'standard' | 'ultra'
  signal?: AbortSignal
}

<<<<<<< ours
/** Cloud slide generation stays out of scope: always rejects (callers use the local pipeline) */
=======
/** Final NDJSON line = the result; heartbeat lines have no status field */
export function parseToolCliNdjson(text: string): Record<string, unknown> {
  const lines = text.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{')) continue
    try {
      const obj: unknown = JSON.parse(line)
      if (obj && typeof obj === 'object' && 'status' in obj) return obj as Record<string, unknown>
    } catch {
      continue
    }
  }
  throw new Error(`No result line in tool_cli response: ${text.slice(0, 300)}`)
}

async function toolCliPost(
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!gskApiKey()) throw new Error('Not logged in to Genspark (gsk login)')
  return withKeyRecovery((key) => toolCliPostOnce(key, path, body, timeoutMs, signal))
}

async function toolCliPostOnce(
  key: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  // A listener added to an already-aborted signal never fires; the billed POST would go out.
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
  // The shared watchdog surfaces our own deadline as AiTimeoutError instead of a bare abort.
  const watchdog = createStreamWatchdog(signal, timeoutMs, timeoutMs)
  return watchdog.guard(async () => {
    const resp = await fetch(`${GSK_TOOL_CLI_BASE}${path}`, {
      method: 'POST',
      // X-Agent-Type splits GenOffice usage out of the proxy's "Claw" billing bucket
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/json',
        'X-Agent-Type': 'genoffice',
      },
      body: JSON.stringify(body),
      signal: watchdog.signal,
    })
    const text = new TextDecoder().decode(await readBodyCapped(resp, MAX_TOOL_CLI_NDJSON_BYTES))
    if (!resp.ok) {
      const message = `tool_cli ${path} HTTP ${resp.status}: ${text.slice(0, 200)}`
      throw resp.status === 401 ? new GskAuthError(message) : new Error(message)
    }
    const result = parseToolCliNdjson(text)
    if (result.status !== 'ok') {
      throw new Error(`tool_cli ${path} failed: ${result.message ?? result.status}`)
    }
    return result.data
  })
}

/**
 * Generates one editable slide in the cloud (brief → HTML → one-slide PPTX)
 * and returns the downloaded PPTX bytes plus the model that produced it.
 */
>>>>>>> theirs
export async function gskSlideGenerate(
  _options: GskSlideGenerateOptions,
): Promise<{ bytes: Uint8Array; model: string }> {
  throw new Error(SLIDES_UNAVAILABLE)
}

// ── Media analysis / transcription ──────────────────────────────────

export interface GskAnalyzeMediaOptions {
  /** Media URLs or local paths (image/audio/video), read here and sent as bytes */
  mediaUrls: string[]
  /** Analysis requirements (in English): what info to extract and what it's for */
  requirements: string
}

const CLOUD_MEDIA_BUDGET = {
  maxItems: UNIWORK_CLOUD_LIMITS.maxMediaItems,
  maxItemBytes: UNIWORK_CLOUD_LIMITS.maxMediaTotalBytes,
  maxTotalBytes: UNIWORK_CLOUD_LIMITS.maxMediaTotalBytes,
} as const

export async function gskAnalyzeMedia(
  options: GskAnalyzeMediaOptions,
  signal?: AbortSignal,
  media: GskMediaOptions = {},
): Promise<string> {
  requireTool('media_analyze')
  const requirements = clip(
    String(options.requirements ?? '').trim(),
    UNIWORK_CLOUD_LIMITS.maxPromptChars,
  )
  if (!requirements) throw new Error('requirements must not be empty')
  const refs = (options.mediaUrls ?? []).map(String).filter(Boolean)
  if (!refs.length) throw new Error('mediaUrls must not be empty')
  const blobs = await loadCloudMedia(refs, CLOUD_MEDIA_BUDGET, media.mediaRoots)
  return analyzeLoadedMedia(requirements, blobs, signal)
}

/**
 * Analysis of references the caller already loaded (the mixed BYOK / cloud
 * batch, which loads once): applies the cloud caps, then sends the bytes. The
 * caller has already checked local reads with assertCloudMediaRefs.
 */
export async function gskAnalyzeLoadedMedia(
  options: { requirements: string; media: readonly MediaBlob[] },
  signal?: AbortSignal,
): Promise<string> {
  requireTool('media_analyze')
  const requirements = clip(
    String(options.requirements ?? '').trim(),
    UNIWORK_CLOUD_LIMITS.maxPromptChars,
  )
  if (!requirements) throw new Error('requirements must not be empty')
  return analyzeLoadedMedia(requirements, options.media, signal)
}

async function analyzeLoadedMedia(
  requirements: string,
  blobs: readonly MediaBlob[],
  signal?: AbortSignal,
): Promise<string> {
  if (blobs.length > CLOUD_MEDIA_BUDGET.maxItems) {
    throw new Error(
      `Too many media items for UniWork cloud AI (${blobs.length}, limit ${CLOUD_MEDIA_BUDGET.maxItems}); analyze them in smaller batches`,
    )
  }
  const total = blobs.reduce((n, b) => n + b.bytes.byteLength, 0)
  if (total > CLOUD_MEDIA_BUDGET.maxTotalBytes) {
    throw new Error(
      `Media is too large for UniWork cloud AI (limit ${CLOUD_MEDIA_BUDGET.maxTotalBytes / MIB} MB in total); analyze it in smaller batches`,
    )
  }
  const r = await uniworkCloudTransport().analyzeMedia(
    {
      requirements,
      media: blobs.map((b) => ({ mime: b.mime, dataBase64: toBase64(b.bytes) })),
    },
    signal,
  )
  return r.text
}

export interface GskTranscribeOptions {
  /** Audio URLs or local paths, read here and sent as bytes (one request each) */
  audioUrls: string[]
  /** Prompt (context / proper nouns; can improve recognition quality) */
  prompt?: string
  /** transcription model; ignored by the UniWork cloud (the server picks it) */
  model?: string
}

export async function gskTranscribe(
  options: GskTranscribeOptions,
  signal?: AbortSignal,
  media: GskMediaOptions = {},
): Promise<string> {
<<<<<<< ours
  requireTool('transcribe')
  const refs = (options.audioUrls ?? []).map(String).filter(Boolean)
  if (!refs.length) throw new Error('audioUrls must not be empty')
  const blobs = await loadCloudMedia(
    refs,
    { ...CLOUD_MEDIA_BUDGET, maxItemBytes: UNIWORK_CLOUD_LIMITS.maxAudioBytes },
    media.mediaRoots,
  )
  const prompt = options.prompt
    ? clip(options.prompt.trim(), UNIWORK_CLOUD_LIMITS.maxPromptChars)
    : undefined
  const parts: string[] = []
  for (const b of blobs) {
    const r = await uniworkCloudTransport().transcribe(
      {
        ...(prompt ? { prompt } : {}),
        audio: { mime: b.mime, dataBase64: toBase64(b.bytes) },
      },
      signal,
    )
    parts.push(r.text)
=======
  const args = ['transcribe', '--audio_urls', ...options.audioUrls]
  if (options.prompt) args.push('--prompt', options.prompt)
  if (options.model) args.push('-m', options.model)
  const raw = await runGsk(args, GENERATE_TIMEOUT_MS, signal)
  return extractGskText(raw)
}

// ── Past projects (Genspark web) ────────────────────────────────────

export interface GskPastProject {
  projectId: string
  /** raw project type, e.g. 'slides_agent_git' */
  type: string
  title: string
  /** creation time, ISO-like string from the API */
  ctime: string
  /** relative web URL, e.g. '/agents?id=...' — join with https://www.genspark.ai */
  projectUrl: string
}

export interface GskPastProjectsPage {
  projects: GskPastProject[]
  total: number
  hasMore: boolean
}

/**
 * Parses `gsk projects`. data.projects lacks project_url — it only appears in
 * session_state.past_projects — so take it from there, falling back to
 * deriving it from the project id. (exported for tests)
 */
export function parseGskPastProjects(raw: unknown): GskPastProjectsPage {
  const rec = asRecord(raw)
  const data = asRecord(rec.data ?? raw)
  const urlById = new Map<string, string>()
  const sessionProjects = asRecord(asRecord(rec.session_state).past_projects).projects
  if (Array.isArray(sessionProjects)) {
    for (const item of sessionProjects) {
      const p = asRecord(item)
      if (p.project_id && typeof p.project_url === 'string' && p.project_url) {
        urlById.set(String(p.project_id), p.project_url)
      }
    }
  }
  const listRaw: unknown[] = Array.isArray(data.projects) ? data.projects : []
  const projects: GskPastProject[] = []
  for (const item of listRaw) {
    const p = asRecord(item)
    const projectId = String(p.project_id ?? '')
    if (!projectId) continue
    projects.push({
      projectId,
      type: String(p.type ?? ''),
      title: String(p.title ?? ''),
      ctime: String(p.ctime ?? ''),
      projectUrl: urlById.get(projectId) ?? `/agents?id=${projectId}`,
    })
  }
  const total = Number(data.total)
  return {
    projects,
    total: Number.isFinite(total) ? total : projects.length,
    hasMore: data.has_more === true,
  }
}

export interface GskListPastProjectsOptions {
  /** 'slides' | 'docs' | 'sheets' | ...; omit for all kinds */
  artifactTypes?: string[]
  /** page size, CLI default 20, max 100 */
  limit?: number
  offset?: number
  signal?: AbortSignal
}

/** Lists the user's own past Genspark web projects, newest first (`gsk projects`). */
export async function gskListPastProjects(
  options: GskListPastProjectsOptions = {},
): Promise<GskPastProjectsPage> {
  const args = ['projects']
  if (options.artifactTypes?.length) args.push('--artifact_types', ...options.artifactTypes)
  if (options.limit !== undefined) args.push('--limit', String(options.limit))
  if (options.offset) args.push('--offset', String(options.offset))
  // background sync: never the reason a browser window opens
  const raw = await runGsk(args, SEARCH_TIMEOUT_MS, options.signal, true)
  return parseGskPastProjects(raw)
}

export interface GskLoginInfo {
  email: string
  plan: string
  creditBalance?: number
}

/** Current login info; null when not logged in */
export async function gskLoginInfo(): Promise<GskLoginInfo | null> {
  try {
    const raw = await runGsk(['login-info'], SEARCH_TIMEOUT_MS, undefined, true)
    const d = asRecord(asRecord(raw).data ?? raw)
    if (!d.email) return null
    const info: GskLoginInfo = {
      email: String(d.email),
      plan: String(d.plan ?? d.personal_plan ?? ''),
    }
    const balance = Number(d.credit_balance)
    if (Number.isFinite(balance)) info.creditBalance = balance
    return info
  } catch {
    return null
>>>>>>> theirs
  }
  return parts.join('\n\n')
}
