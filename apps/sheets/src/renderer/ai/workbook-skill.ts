import type { AgentSkill } from '@genoffice/agent-core'
import { cap } from '../capabilities'
import basePrompt from './prompts/base.md?raw'
import { verifySheetsResponse } from './response-verify'
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
  return {
    id: 'sheets',
    // live: the loop re-reads both before every request
    get systemPrompt() {
      return basePromptFor(cap('createDocument'))
    },
    get tools() {
      return workbookToolsFor(cap('createDocument'))
    },
    buildContext: () => buildWorkbookContext(deps),
    executeTool: (call) => executeWorkbookTool(call, deps),
    verifyResponse: verifySheetsResponse,
  }
}
