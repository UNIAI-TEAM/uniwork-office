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
  getUniworkCloudStatus,
  uniworkCloudEnabled,
  uniworkCloudToolAvailable,
  uniworkCloudTransport,
  UniworkCloudError,
  type MediaBlob,
  type UniworkCloudMedia,
  type UniworkCloudTool,
} from '@genoffice/ai-provider'
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

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
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

/** Cloud slide generation stays out of scope: always rejects (callers use the local pipeline) */
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
  }
  return parts.join('\n\n')
}
