/**
 * UniWork cloud tools (web/image search, image generation, media analysis,
 * transcription, slide generation). The cloud route is wired to the UniWork
 * server in a later lane; until then every entry point here reports "not
 * available" and callers use their BYOK or free fallbacks. Nothing in this
 * file spawns a process, reads a file or opens a connection.
 */

import { uniworkCloudEnabled } from '@genoffice/ai-provider'
import type { ImageSearchResult, WebSearchResult } from './shared'

const CLOUD_UNAVAILABLE = 'UniWork cloud is not available'

function cloudUnavailable(): Promise<never> {
  return Promise.reject(new Error(CLOUD_UNAVAILABLE))
}

/** true when the UniWork cloud route is signed in; always false while the seam is off */
export function hasGskAuth(): boolean {
  return uniworkCloudEnabled() && false
}

export interface GskLoginInfo {
  email: string
  plan: string
  creditBalance?: number
}

/** Current cloud sign-in; null when signed out (always, while the seam is off) */
export async function gskLoginInfo(): Promise<GskLoginInfo | null> {
  return null
}

// ── Search ──────────────────────────────────────────────────────────

export async function gskWebSearch(
  _query: string,
  _maxResults = 6,
): Promise<{ results: WebSearchResult[]; answer?: string }> {
  return cloudUnavailable()
}

export async function gskImageSearch(
  _query: string,
  _maxResults = 8,
): Promise<ImageSearchResult[]> {
  return cloudUnavailable()
}

// ── Image generation ────────────────────────────────────────────────

export interface GskGenerateImageOptions {
  /** Image description (English works better; text that must appear in the image stays verbatim) */
  prompt: string
  /** Generation model; empty = the cloud default. Special-purpose models (e.g. background removal) are named here too */
  model?: string
  /** Reference/edit-target image URLs or local paths */
  referenceImageUrls?: string[]
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string
  /** auto | 0.5k | 1k | 2k | 3k | 4k */
  imageSize?: string
}

export interface GskGeneratedImage {
  /** Watermark-free image URL; can be downloaded and inserted directly */
  url: string
  taskId: string
}

export async function gskGenerateImage(
  _options: GskGenerateImageOptions,
  _signal?: AbortSignal,
): Promise<GskGeneratedImage> {
  return cloudUnavailable()
}

// ── Slide generation ────────────────────────────────────────────────

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

/** One editable slide generated in the cloud (brief to one-slide PPTX bytes) */
export async function gskSlideGenerate(
  _options: GskSlideGenerateOptions,
): Promise<{ bytes: Uint8Array; model: string }> {
  return cloudUnavailable()
}

// ── Media analysis / transcription ──────────────────────────────────

export interface GskAnalyzeMediaOptions {
  /** Media URLs or local paths (image/audio/video) */
  mediaUrls: string[]
  /** Analysis requirements (in English): what info to extract and what it's for */
  requirements: string
}

export async function gskAnalyzeMedia(
  _options: GskAnalyzeMediaOptions,
  _signal?: AbortSignal,
): Promise<string> {
  return cloudUnavailable()
}

export interface GskTranscribeOptions {
  /** Audio URLs or local paths */
  audioUrls: string[]
  /** Prompt (context / proper nouns; can improve recognition quality) */
  prompt?: string
  /** transcription model; empty = the cloud default */
  model?: string
}

export async function gskTranscribe(
  _options: GskTranscribeOptions,
  _signal?: AbortSignal,
): Promise<string> {
  return cloudUnavailable()
}
