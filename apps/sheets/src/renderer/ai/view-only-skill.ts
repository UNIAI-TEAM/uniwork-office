import type { AgentSkill } from '@genoffice/agent-core'
import type { WorkbookFile } from '../../shared/desktop-api'

/**
 * Tools that only read the workbook (or the web / attachments); everything else
 * (propose_operations, create_document, merge_attached_workbooks, generate_image,
 * and any tool added later) is edit-capable and withheld from a view-only workbook.
 */
export const VIEW_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_workbook_context',
  'read_range',
  'aggregate_range',
  'load_guide',
  'read_formats',
  'read_sheet_features',
  'read_cells',
  'find_cells',
  'select_range',
  'trace_precedents',
  'trace_dependents',
  'read_attachment',
  'web_search',
  'image_search',
])

const VIEW_ONLY_NOTE =
  'The open workbook is view-only. You can read it, analyze it and answer questions, but you cannot change it: no edit tools are available. If asked to change the workbook, say it is view-only and describe the change instead.'

/** the same product rule everywhere: a UniWork workbook the user may only view */
export function isUniworkViewOnly(
  file: Pick<WorkbookFile, 'uniworkBound' | 'readOnly'> | null | undefined,
): boolean {
  return file?.uniworkBound === true && file.readOnly === true
}

/**
 * Restrict a skill to its reading tools while `isViewOnly()` is true. Live like the other
 * getters: the loop re-reads tools and prompt before every request, so a workbook that turns
 * view-only (or editable) mid-session takes effect on the next turn. The executor refuses an
 * edit tool even if the model calls one it was never offered.
 */
export function restrictToReading(skill: AgentSkill, isViewOnly: () => boolean): AgentSkill {
  return {
    ...skill,
    get systemPrompt() {
      // the note rides on the workbook skill's prompt only (once per request)
      return isViewOnly() && skill.id === 'sheets'
        ? `${skill.systemPrompt}\n\n${VIEW_ONLY_NOTE}`
        : skill.systemPrompt
    },
    get tools() {
      return isViewOnly()
        ? skill.tools.filter((tool) => VIEW_ONLY_TOOLS.has(tool.name))
        : skill.tools
    },
    executeTool: (call, signal) =>
      isViewOnly() && !VIEW_ONLY_TOOLS.has(call.name)
        ? {
            output: `${call.name} is not available: the workbook is view-only.`,
            isError: true,
            summary: call.name,
          }
        : skill.executeTool(call, signal),
  }
}
