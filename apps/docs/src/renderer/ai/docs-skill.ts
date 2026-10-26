import { placeholderInstruction } from './redact'
import { redactLabelsOf } from './redact-view'
import type { Editor } from '@tiptap/core'
import type { AgentSkill, ImageUrlRegistry } from '@genoffice/agent-core'
import {
  AGENT_SYSTEM_PROMPT,
  buildDocContext,
  getSelectionScope,
  type AiTrack,
  type NumIds,
} from './protocol'
import type { AiDocWriter } from './doc-writer'
import { cap, type Capability } from '../capabilities'
import type { AiPageSetupAccess } from './page-setup'
import {
  AGENT_TOOLS,
  executeTool,
  markDocSeen,
  type AiCommentsAccess,
  type AiHeaderFooterAccess,
  type FrozenSelection,
  type AiDocExtras,
  type AskClarification,
  type ToolExecution,
} from './tools'
import type { AiNotesAccess } from './note-ops'

/** tools that only exist while their platform capability does (hidden on the web build) */
const CAPABILITY_TOOLS: ReadonlyArray<readonly [tool: string, capability: Capability]> = [
  ['web_search', 'webSearch'],
  ['image_search', 'imageSearch'],
  ['generate_image', 'imageGeneration'],
  ['create_document', 'createDocument'],
]

/**
 * The only tools a view-only UniWork document keeps: reading the document and
 * looking things up. Everything else writes into the document.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_document_context',
  'read_blocks',
  'read_revisions',
  'read_comments',
  'read_notes',
  'web_search',
  'image_search',
  'analyze_media',
  'ask_clarification',
  'generate_mindmap', // only returns a display payload for the chat card
])

/**
 * Tools that write outside the open document (a new file on disk). A
 * UniWork-bound document never offers them: its content must not leave the
 * UniWork copy through the AI (C-BOUND).
 */
export const BOUND_HIDDEN_TOOLS: ReadonlySet<string> = new Set(['create_document'])

function refuseBound(tool: string): ToolExecution {
  return {
    output: `${tool} is unavailable: this is a UniWork document, so the AI cannot write files outside it.`,
    isError: true,
    mutated: false,
    summary: tool.replace(/[_-]+/g, ' '),
  }
}

/**
 * The Word protection the AI must honour, read live from the open document
 * (document data, so BYOK and UniWork AI see the same thing):
 * - readOnly / forms: the body is locked (forms only lets people tick the form's own checkboxes)
 * - comments: the body is locked, comments may be added and replied to
 * - trackedChanges: editing stays but every change is recorded and revisions cannot be accepted or rejected
 * A password-to-modify lock that is not unlocked counts as readOnly.
 */
export type AiDocProtection = 'none' | 'readOnly' | 'comments' | 'forms' | 'trackedChanges'

/** the one AI protection kind for the document's w:documentProtection + w:writeProtection state */
export function aiProtectionOf(
  protection: { edit: string; enforced: boolean } | null,
  writeLocked: boolean,
): AiDocProtection {
  if (writeLocked) return 'readOnly'
  if (!protection?.enforced) return 'none'
  switch (protection.edit) {
    case 'none':
      // "no editing restriction": the app keeps the document editable, so the AI may edit too
      return 'none'
    case 'comments':
    case 'forms':
    case 'trackedChanges':
      return protection.edit
    default:
      // readOnly, or a kind this build does not know: the safe reading forbids every write
      return 'readOnly'
  }
}

/** a comments-only document still lets the agent leave comments */
const COMMENT_ONLY_TOOLS: ReadonlySet<string> = new Set(['add_comment', 'reply_comment'])
/**
 * Tracked-changes protection: Word locks accept/reject while it is on, and the
 * AI may only use write tools that record a tracked revision. These write tools
 * take no `track` (side state, notes, charts, pictures, floating objects), so
 * they would land untracked: hidden and refused, the same safe reading as a
 * locked body. Comment tools stay (a comment is not a revision; Word allows them).
 */
const TRACKED_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'accept_changes',
  'reject_changes',
  'set_header_footer',
  'set_page_setup',
  'insert_section_break',
  'define_style',
  'set_watermark',
  'insert_footnote',
  'insert_endnote',
  'edit_note',
  'delete_note',
  'insert_chart',
  'edit_chart',
  'insert_text_box',
  'insert_image',
  'insert_picture',
  'generate_image',
])

/** the protection in plain words, for the text the model reads */
const PROTECTION_WORDS: Record<Exclude<AiDocProtection, 'none'>, string> = {
  readOnly: 'read only',
  forms: 'forms only',
  comments: 'comments only',
  trackedChanges: 'tracked changes',
}

/** whether the protection forbids this tool */
function protectionBlocks(kind: AiDocProtection, tool: string): boolean {
  if (kind === 'none') return false
  if (kind === 'trackedChanges') return TRACKED_HIDDEN_TOOLS.has(tool)
  if (READ_ONLY_TOOLS.has(tool)) return false
  return !(kind === 'comments' && COMMENT_ONLY_TOOLS.has(tool))
}

const PROTECTION_NOTES: Record<Exclude<AiDocProtection, 'none'>, string> = {
  readOnly:
    '\n\nNote: this document is protected against editing. You can read it and answer questions about it, but you must not change it or add comments: no editing tool is available, so tell the user it is protected instead of attempting it.',
  forms:
    '\n\nNote: this document is protected for filling in forms only. You can read it, but you must not change its text or add comments: no editing tool is available, so tell the user it is protected instead of attempting it.',
  comments:
    '\n\nNote: this document is protected so that only comments are allowed. You can read it and add or reply to comments, but you must not change its text: no editing tool is available, so tell the user it is protected instead of attempting it.',
  trackedChanges:
    '\n\nNote: this document is protected so that every change must be tracked. Your edits are recorded as tracked changes; you cannot accept or reject changes, and the tools that cannot record a tracked change (headers and footers, page setup, section breaks, styles, watermarks, notes, charts, pictures, text boxes) are not available, so tell the user instead of attempting them.',
}

function refuseProtected(tool: string, kind: Exclude<AiDocProtection, 'none'>): ToolExecution {
  return {
    output: `${tool} is unavailable: this document is protected (${PROTECTION_WORDS[kind]}) and the protection does not allow it.`,
    isError: true,
    mutated: false,
    summary: tool.replace(/[_-]+/g, ' '),
  }
}

const VIEW_ONLY_NOTE =
  '\n\nNote: this document is view-only. You can read it and answer questions about it, but you must not change it: no editing tool is available, so tell the user it cannot be edited instead of attempting it.'

/** what a refused edit call returns: an error the model reads, nothing touches the document */
function refuseViewOnly(tool: string): ToolExecution {
  return {
    output: `${tool} is unavailable: this document is view-only and cannot be edited.`,
    isError: true,
    mutated: false,
    summary: tool.replace(/[_-]+/g, ' '),
  }
}

const IMAGE_GEN_OFF_NOTE =
  '\n\nNote: generate_image is currently unavailable (no image model is configured under Settings → AI media). Do not call or promise it; use image_search for imagery.'

const MEDIA_ANALYSIS_OFF_NOTE =
  '\n\nNote: analyze_media is currently unavailable (no media analysis model is configured under Settings → AI media). You cannot see what a picture inside the document shows — tell the user that instead of guessing at its content.'

/**
 * The docx capability as an AgentSkill: document skeleton context, the five
 * document tools, and the local executor. Future apps register their own
 * skills (Excel / PPT) against the same agent loop.
 */
export function createDocsSkill(
  getEditor: () => Editor,
  getNumIds: () => NumIds,
  getTrack?: () => AiTrack | undefined,
  getComments?: () => AiCommentsAccess | undefined,
  getHf?: () => AiHeaderFooterAccess | undefined,
  /** live predicate (a BYOK media model is configured; the UniWork cloud route while its seam is on); false hides generate_image */
  imageGenAvailable?: () => boolean,
  /** streaming long-form writer behind write_document (panel-owned: progress chip, partial keep/discard) */
  getWriter?: () => AiDocWriter | undefined,
  getPageSetup?: () => AiPageSetupAccess | undefined,
  /** styles.xml catalog + page watermark stores (define_style / applyStyle / set_watermark) */
  getExtras?: () => AiDocExtras | undefined,
  getNotes?: () => AiNotesAccess | undefined,
  /** same as imageGenAvailable, for analyze_media (seeing pictures that are in the document) */
  mediaAnalysisAvailable?: () => boolean,
  /** live predicate: a view-only UniWork document, where the agent may only read */
  isReadOnly?: () => boolean,
  /** live predicate: the document is a UniWork working copy (hides BOUND_HIDDEN_TOOLS) */
  isBound?: () => boolean,
  /** the panel's questionnaire card behind ask_clarification; none hides the tool */
  getAsk?: () => AskClarification | undefined,
  /** live predicate: the Word protection of the open document (re-read every request, so unprotecting restores the tools) */
  getProtection?: () => AiDocProtection,
  /** image URLs this run may insert (reset at every run); refuses unregistered ones while its enforce predicate holds */
  imageUrls?: ImageUrlRegistry,
): AgentSkill {
  // Selection frozen per run: tools act on the range the prompt described,
  // not on wherever the user's live selection has wandered mid-run. The doc
  // snapshot bounds the freeze's validity (see FrozenSelection).
  let frozen: FrozenSelection | null = null
  /** tools that need a media provider: a BYOK media model in Settings (or the UniWork cloud route while its seam is on) */
  const mediaToolsOff = (): Set<string> => {
    const hidden = new Set<string>()
    if (imageGenAvailable?.() === false) hidden.add('generate_image')
    if (mediaAnalysisAvailable?.() === false) hidden.add('analyze_media')
    return hidden
  }
  const mediaOffNote = (): string =>
    [...mediaToolsOff()]
      .map((name) => (name === 'generate_image' ? IMAGE_GEN_OFF_NOTE : MEDIA_ANALYSIS_OFF_NOTE))
      .join('')
  const protectionKind = (): AiDocProtection => getProtection?.() ?? 'none'
  const protectionNote = (): string => {
    const kind = protectionKind()
    return kind === 'none' ? '' : PROTECTION_NOTES[kind]
  }
  return {
    id: 'docx',
    // live: the predicate is re-read before every model request
    get systemPrompt() {
<<<<<<< ours
      return (
        AGENT_SYSTEM_PROMPT +
        mediaOffNote() +
        (isReadOnly?.() ? VIEW_ONLY_NOTE : '') +
        protectionNote()
      )
=======
      // only when the open document actually withholds something, so a
      // document without spans pays nothing and the model is not told to
      // look for markers that are not there
      const editor = getEditor()
      const labels = editor
        ? redactLabelsOf(editor.getJSON() as unknown as Parameters<typeof redactLabelsOf>[0])
        : []
      const redact = labels.length > 0 ? `\n\n${placeholderInstruction(labels)}` : ''
      return AGENT_SYSTEM_PROMPT + mediaOffNote() + redact
>>>>>>> theirs
    },
    get tools() {
      const hidden = mediaToolsOff()
      for (const [tool, c] of CAPABILITY_TOOLS) if (!cap(c)) hidden.add(tool)
      if (isBound?.() === true) for (const tool of BOUND_HIDDEN_TOOLS) hidden.add(tool)
      if (!getAsk?.()) hidden.add('ask_clarification')
      const readOnly = isReadOnly?.() === true
      const protection = protectionKind()
      if (!readOnly && protection === 'none' && hidden.size === 0) return AGENT_TOOLS
      return AGENT_TOOLS.filter(
        (t) =>
          !hidden.has(t.name) &&
          (!readOnly || READ_ONLY_TOOLS.has(t.name)) &&
          !protectionBlocks(protection, t.name),
      )
    },
    buildContext: () => {
      // one buildContext per loop.run: the image URLs of the previous request stop being insertable
      imageUrls?.beginRun()
      const editor = getEditor()
      markDocSeen(editor) // the context the model receives is the freshness baseline for index-addressed writes
      frozen = { scope: getSelectionScope(editor), doc: editor.state.doc }
      return buildDocContext(
        editor,
        frozen.scope,
        getComments?.()?.list(),
        getHf?.()?.read(),
        getPageSetup?.()?.list(),
      )
    },
    executeTool: (call, signal) => {
      const protection = protectionKind()
      if (isReadOnly?.() && !READ_ONLY_TOOLS.has(call.name)) return refuseViewOnly(call.name)
      if (protection !== 'none' && protectionBlocks(protection, call.name))
        return refuseProtected(call.name, protection)
      if (isBound?.() && BOUND_HIDDEN_TOOLS.has(call.name)) return refuseBound(call.name)
      return executeTool(
        getEditor(),
        call,
        getNumIds(),
        getTrack?.(),
        signal,
        frozen,
        getComments?.(),
        getHf?.(),
        getWriter?.(),
        getPageSetup?.(),
        getExtras?.(),
        getNotes?.(),
        getAsk?.(),
        imageUrls,
      )
    },
  }
}
