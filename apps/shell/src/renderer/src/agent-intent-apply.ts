import {
  isSkillDomainId,
  moduleSupportsAddItem,
  tabIdForTarget,
  type AgentIntent,
  type PracticeId,
  type WorkbenchModuleId,
} from '@uniwork/practice-core'
import {
  pinModule,
  pinPillar,
  readStickyNotes,
  createStickyNote,
  readPinnedModules,
  writeStickyNotes,
} from './workbench-pins'
import { pinSkillDomain, writeActiveSkillDomain } from './skill-domain-pins'
import { workbenchModuleLabel } from './my-ai-consent'
import { pickActiveWorkspace, readActiveWorkspaceId } from './active-workspace'
import { settleWork } from './work-cache'

export interface AgentAddUndo {
  moduleId: WorkbenchModuleId
  itemId: string
}

export interface AgentIntentApplyResult {
  ok: boolean
  tabId: string
  messageVi: string
  messageEn: string
  /** Present when add_item created a row — soft mutate can offer Undo. */
  undo?: AgentAddUndo
}

function ensurePinned(practiceId: PracticeId, moduleId: WorkbenchModuleId): void {
  const pins = readPinnedModules(practiceId)
  if (!pins.includes(moduleId)) pinModule(practiceId, moduleId)
}

interface AddItemOutcome {
  vi: string
  en: string
  /** on-device rows only: a UniWork task has no local Undo */
  undo?: AgentAddUndo
  failed?: boolean
}

/** The workspace a My AI task lands in: the Workbench's active one, else the first listed. */
async function agentWorkspaceId(): Promise<string | null> {
  const listed = await window.aiOffice.uniworkListWorkspaces().catch(() => null)
  return listed?.ok ? pickActiveWorkspace(listed.value, readActiveWorkspaceId()) : null
}

async function addItem(
  practiceId: PracticeId,
  moduleId: WorkbenchModuleId,
  text: string,
): Promise<AddItemOutcome | null> {
  const title = text.trim() || 'Untitled'
  if (!moduleSupportsAddItem(moduleId)) return null
  const place = workbenchModuleLabel(moduleId, true)
  const placeEn = workbenchModuleLabel(moduleId, false)

  if (moduleId === 'tasks') {
    const workspaceId = await agentWorkspaceId()
    const created = workspaceId
      ? await settleWork(
          window.uniworkWork.createTask({
            workspaceId,
            title,
            idempotencyKey: crypto.randomUUID(),
          }),
        )
      : null
    if (!created?.ok) {
      return {
        vi: `Không thêm được vào ${place} trên UniWork: ${title}`,
        en: `Could not add to ${placeEn} on UniWork: ${title}`,
        failed: true,
      }
    }
    return { vi: `Đã thêm vào ${place}: ${title}`, en: `Added to ${placeEn}: ${title}` }
  }
  if (moduleId === 'notes') {
    const note = createStickyNote(practiceId, title)
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: note.id },
    }
  }
  return null
}

/** Soft-mutate Undo — remove the row created by the last add_item. */
export function undoAgentAddItem(
  practiceId: PracticeId,
  undo: AgentAddUndo,
): { ok: boolean; messageVi: string; messageEn: string } {
  const { moduleId, itemId } = undo
  const place = workbenchModuleLabel(moduleId, true)
  const placeEn = workbenchModuleLabel(moduleId, false)
  if (moduleId === 'notes') {
    writeStickyNotes(
      practiceId,
      readStickyNotes(practiceId).filter((n) => n.id !== itemId),
    )
  } else {
    return {
      ok: false,
      messageVi: 'Không hoàn tác được mục này.',
      messageEn: 'Could not undo this item.',
    }
  }
  return {
    ok: true,
    messageVi: `Đã hoàn tác mục vừa thêm vào ${place}.`,
    messageEn: `Undid the item just added to ${placeEn}.`,
  }
}

/** Apply a consented intent on-device (pin tab + optional store write). */
export async function applyAgentIntent(
  intent: AgentIntent,
  practiceId: PracticeId,
): Promise<AgentIntentApplyResult> {
  const tabId = tabIdForTarget(intent.target)

  if (intent.target.kind === 'module') {
    ensurePinned(practiceId, intent.target.id)
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
  }
  if (intent.target.kind === 'pillar') {
    pinPillar(practiceId, intent.target.id)
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
  }
  if (intent.target.kind === 'skill-domain' && isSkillDomainId(intent.target.id)) {
    pinPillar(practiceId, 'skills')
    pinSkillDomain(intent.target.id)
    writeActiveSkillDomain(intent.target.id)
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
    window.dispatchEvent(new Event('uniwork:skill-domain-changed'))
  }

  if (intent.action === 'add_item' && intent.target.kind === 'module') {
    const msg = await addItem(practiceId, intent.target.id, intent.text ?? intent.summary)
    if (msg) {
      return {
        ok: !msg.failed,
        tabId,
        messageVi: msg.vi,
        messageEn: msg.en,
        ...(msg.undo ? { undo: msg.undo } : {}),
      }
    }
  }

  if (intent.action === 'summarize') {
    window.dispatchEvent(
      new CustomEvent('uniwork:agent-summarize', {
        detail: { practiceId, intentId: intent.intentId, text: intent.text ?? intent.summary },
      }),
    )
    return {
      ok: true,
      tabId,
      messageVi: 'Đã mở My AI để tóm tắt ngữ cảnh trên máy.',
      messageEn: 'Opened My AI to summarize on-device context.',
    }
  }

  if (intent.action === 'run_skill') {
    const skillHint = (intent.text ?? intent.summary).trim()
    window.dispatchEvent(
      new CustomEvent('uniwork:agent-run-skill', {
        detail: { practiceId, skillHint, intentId: intent.intentId },
      }),
    )
    return {
      ok: true,
      tabId: 'skills',
      messageVi: 'Đã mở Skills — chọn kỹ năng rồi chạy khi sẵn sàng.',
      messageEn: 'Opened Skills — pick a skill and run when ready.',
    }
  }

  if (intent.target.kind === 'module') {
    const nameVi = workbenchModuleLabel(intent.target.id, true)
    const nameEn = workbenchModuleLabel(intent.target.id, false)
    return {
      ok: true,
      tabId,
      messageVi: `Đã mở ${nameVi}.`,
      messageEn: `Opened ${nameEn}.`,
    }
  }
  return {
    ok: true,
    tabId,
    messageVi: 'Đã chuyển tới tab tương ứng.',
    messageEn: 'Navigated to the matching tab.',
  }
}
