import type { AgentSkill } from '@genoffice/agent-core'
import { cap } from '../capabilities'
import basePrompt from './prompts/base.md?raw'
import { verifySheetsResponse } from './response-verify'
import { placeholderInstruction } from './redact'
import {
  WORKBOOK_TOOLS,
  buildWorkbookContext,
  executeWorkbookTool,
  type SheetsSkillDeps,
} from './tools'

/** the base prompt's bullet about the create_document tool (hidden with the tool) */
const CREATE_DOCUMENT_LINE = /^- \*\*New standalone files\*\*.*\n?/m

/** create_document writes files to a desktop folder: not offered without the `createDocument` capability */
export const basePromptFor = (createDocument: boolean): string =>
  createDocument ? basePrompt : basePrompt.replace(CREATE_DOCUMENT_LINE, '')

export const workbookToolsFor = (createDocument: boolean): typeof WORKBOOK_TOOLS =>
  createDocument ? WORKBOOK_TOOLS : WORKBOOK_TOOLS.filter((tool) => tool.name !== 'create_document')

/**
 * The workbook DSL as an AgentSkill: mirrors createDocsSkill's shape
 * (systemPrompt + tools + buildContext + executeTool) so it plugs into the
 * same packages/agent-core AgentLoop docx uses.
 *
 * Prompt layout: the always-loaded base prompt (prompts/base.md) stays small
 * — workflow, op catalog, cross-cutting discipline — while per-domain field
 * definitions and conventions live in prompts/guides/*.md, loaded on demand
 * via load_guide.
 */
export function createWorkbookSkill(deps: SheetsSkillDeps): AgentSkill {
  // C-BOUND: a UniWork working copy never writes new files beside itself
  const createDocument = (): boolean => cap('createDocument') && deps.isUniworkBound?.() !== true
  return {
    id: 'sheets',
    // live: the loop re-reads both before every request
    get systemPrompt() {
      // The base prompt is imported raw and therefore fixed at build time, so
      // the placeholder section is appended here: which labels exist is a
      // property of the open workbook, and a model told about a placeholder
      // that is not there — or not told about one that is — misreads the sheet.
      const index = deps.redactions?.()
      const labels = index?.isEmpty
        ? []
        : (deps.getActiveSheetInfo().sheets.flatMap((sheet) => index?.labelsFor(sheet.id) ?? []) ??
          [])
      const base = basePromptFor(createDocument())
      return labels.length > 0 ? `${base}\n\n${placeholderInstruction(labels)}` : base
    },
    get tools() {
      return workbookToolsFor(createDocument())
    },
    buildContext: () => buildWorkbookContext(deps),
    executeTool: (call) => executeWorkbookTool(call, deps),
    verifyResponse: verifySheetsResponse,
  }
}
