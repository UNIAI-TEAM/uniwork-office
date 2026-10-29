import { writerInput, type WriterCall } from '@genoffice/agent-core'
import type { AiSettings, AiStreamRequest } from '../../shared/ipc'
import { DEFAULT_DECK_STYLE, type DeckAccess } from './slides-skill'

/**
 * The request behind the panel's own generators (per-page, style skill, planning). They are not
 * conversation turns, so they carry `purpose: 'one-shot'`. UniWork AI refuses such a request
 * unless it names its `writer`: then the web frame runs it on the writer route, inside the run of
 * the chat session (`sessionId`) that called the generator; BYOK keeps reading system/user.
 */
export function oneShotStreamRequest(
  args: {
    requestId: string
    settings: AiSettings
    system: string
    user: string
    maxTokens?: number | undefined
    /** the panel chat transport's session: its open UniWork AI run is the writer's */
    sessionId?: string | undefined
  },
  writer?: WriterCall,
): AiStreamRequest {
  return {
    requestId: args.requestId,
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    settings: args.settings,
    system: args.system,
    messages: [{ role: 'user', text: args.user }],
    purpose: 'one-shot',
    ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
    ...(writer ? { writer } : {}),
  }
}

type StyleArgs = Parameters<NonNullable<DeckAccess['generateStyleSkill']>>[0]
type OutlineArgs = Parameters<NonNullable<DeckAccess['planDeckOutline']>>[0]
type PageArgs = Parameters<NonNullable<DeckAccess['generatePageLocal']>>[0]

// UniWork AI writer inputs: the server's field names, every text cut at its field cap

export function deckStyleWriter(a: StyleArgs): WriterCall {
  return {
    kind: 'slides.deck_style',
    input: writerInput({
      topic: a.topic.slice(0, 2000),
      style_hint: a.styleHint?.slice(0, 1000),
      questionnaire: a.questionnaire?.slice(0, 4000),
    }),
  }
}

export function deckOutlineWriter(a: OutlineArgs): WriterCall {
  return {
    kind: 'slides.deck_outline',
    input: writerInput({
      topic: a.topic.slice(0, 2000),
      count: a.count,
      context: a.context?.slice(0, 8000),
      style_skill: a.styleSkill?.slice(0, 8000),
      // the start page only matters to a continuation, as in the BYOK prompt
      start_page: a.continueFrom ? a.startPage : undefined,
      continue_core_hook: a.continueFrom?.coreHook.slice(0, 1000),
    }),
  }
}

/**
 * previousError: the validation error of the attempt before (the repair round). The server
 * requires a style and a title: a page redone outside generate_deck may have neither, so it gets
 * the deck's default style and "Slide N" (the BYOK prompt is built from the args unchanged).
 */
export function slidePageWriter(a: PageArgs, previousError?: string): WriterCall {
  return {
    kind: 'slides.page',
    input: writerInput({
      style: (a.style.trim() || DEFAULT_DECK_STYLE).slice(0, 8000),
      title: (a.title.trim() || `Slide ${a.pageIndex}`).slice(0, 300),
      brief: a.brief.slice(0, 4000),
      page_index: a.pageIndex,
      total_pages: a.totalPages,
      topic: a.topic?.slice(0, 2000),
      core_hook: a.coreHook.slice(0, 1000),
      layout: a.layout.slice(0, 100),
      // a URL cut short is no URL: one over the cap (a large data: URL) is left out
      image_urls: a.images.filter((u) => u.length <= 2000).slice(0, 8),
      context: a.context?.slice(0, 4000),
      skeleton: a.skeleton?.slice(0, 4000),
      previous_error: previousError?.slice(0, 1000),
    }),
  }
}

/** UniWork AI refusals the same request cannot get past: a generator does not send it again */
const FINAL_WRITER_REFUSALS: ReadonlySet<string> = new Set([
  'run_limit_reached',
  'invalid_request',
  'payload_too_large',
  'unsupported',
])

export function writerRefusalIsFinal(uniworkCode: string | undefined): boolean {
  return uniworkCode !== undefined && FINAL_WRITER_REFUSALS.has(uniworkCode)
}
