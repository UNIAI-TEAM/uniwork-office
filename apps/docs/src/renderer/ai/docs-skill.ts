import type { Editor } from '@tiptap/core'
import type { AgentSkill } from '@genoffice/agent-core'
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
])

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
  return {
    id: 'docx',
    // live: the predicate is re-read before every model request
    get systemPrompt() {
      return AGENT_SYSTEM_PROMPT + mediaOffNote() + (isReadOnly?.() ? VIEW_ONLY_NOTE : '')
    },
    get tools() {
      const hidden = mediaToolsOff()
      for (const [tool, c] of CAPABILITY_TOOLS) if (!cap(c)) hidden.add(tool)
      const readOnly = isReadOnly?.() === true
      if (!readOnly && hidden.size === 0) return AGENT_TOOLS
      return AGENT_TOOLS.filter(
        (t) => !hidden.has(t.name) && (!readOnly || READ_ONLY_TOOLS.has(t.name)),
      )
    },
    buildContext: () => {
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
    executeTool: (call, signal) =>
      isReadOnly?.() && !READ_ONLY_TOOLS.has(call.name)
        ? refuseViewOnly(call.name)
        : executeTool(
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
          ),
  }
}
