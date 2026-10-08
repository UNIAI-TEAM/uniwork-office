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
  readCalendar,
  readEmails,
  readEvents,
  readFinance,
  readGrowth,
  readHealth,
  readStickyNotes,
  createEmailDraft,
  createStickyNote,
  readPinnedModules,
  readTasks,
  writeCalendar,
  writeEmails,
  writeEvents,
  writeFinance,
  writeGrowth,
  writeHealth,
  writeStickyNotes,
  writeTasks,
} from './workbench-pins'
import { pinSkillDomain, writeActiveSkillDomain } from './skill-domain-pins'
import { workbenchModuleLabel } from './my-ai-consent'

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

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function ensurePinned(practiceId: PracticeId, moduleId: WorkbenchModuleId): void {
  const pins = readPinnedModules(practiceId)
  if (!pins.includes(moduleId)) pinModule(practiceId, moduleId)
}

function addItem(
  practiceId: PracticeId,
  moduleId: WorkbenchModuleId,
  text: string,
): { vi: string; en: string; undo: AgentAddUndo } | null {
  const title = text.trim() || 'Untitled'
  if (!moduleSupportsAddItem(moduleId)) return null
  const place = workbenchModuleLabel(moduleId, true)
  const placeEn = workbenchModuleLabel(moduleId, false)

  if (moduleId === 'tasks') {
    const id = newId()
    const now = new Date().toISOString()
    writeTasks(practiceId, [
      {
        id,
        title,
        done: false,
        status: 'todo',
        priority: 'medium',
        createdAt: now,
        updatedAt: now,
      },
      ...readTasks(practiceId),
    ])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
  if (moduleId === 'notes') {
    const note = createStickyNote(practiceId, title)
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: note.id },
    }
  }
  if (moduleId === 'email') {
    const draft = createEmailDraft(practiceId, { subject: title, body: '' })
    return {
      vi: `Đã tạo nháp trong ${place}: ${title}`,
      en: `Created draft in ${placeEn}: ${title}`,
      undo: { moduleId, itemId: draft.id },
    }
  }
  if (moduleId === 'calendar') {
    const id = newId()
    writeCalendar(practiceId, [{ id, date: todayIso(), title }, ...readCalendar(practiceId)])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
  if (moduleId === 'events') {
    const id = newId()
    writeEvents(practiceId, [{ id, date: todayIso(), title }, ...readEvents(practiceId)])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
  if (moduleId === 'personal-finance') {
    const id = newId()
    writeFinance([
      { id, date: todayIso(), kind: 'expense', amount: 0, label: title },
      ...readFinance(),
    ])
    return {
      vi: `Đã ghi trong ${place}: ${title}`,
      en: `Logged in ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
  if (moduleId === 'health') {
    const id = newId()
    writeHealth([{ id, date: todayIso(), kind: 'other', note: title }, ...readHealth()])
    return {
      vi: `Đã ghi trong ${place}: ${title}`,
      en: `Logged in ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
  if (moduleId === 'self-growth') {
    const id = newId()
    writeGrowth([{ id, title, progress: 0, done: false }, ...readGrowth()])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
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
  if (moduleId === 'tasks') {
    writeTasks(
      practiceId,
      readTasks(practiceId).filter((t) => t.id !== itemId),
    )
  } else if (moduleId === 'notes') {
    writeStickyNotes(
      practiceId,
      readStickyNotes(practiceId).filter((n) => n.id !== itemId),
    )
  } else if (moduleId === 'email') {
    writeEmails(
      practiceId,
      readEmails(practiceId).filter((m) => m.id !== itemId),
    )
  } else if (moduleId === 'calendar') {
    writeCalendar(
      practiceId,
      readCalendar(practiceId).filter((c) => c.id !== itemId),
    )
  } else if (moduleId === 'events') {
    writeEvents(
      practiceId,
      readEvents(practiceId).filter((e) => e.id !== itemId),
    )
  } else if (moduleId === 'personal-finance') {
    writeFinance(readFinance().filter((f) => f.id !== itemId))
  } else if (moduleId === 'health') {
    writeHealth(readHealth().filter((h) => h.id !== itemId))
  } else if (moduleId === 'self-growth') {
    writeGrowth(readGrowth().filter((g) => g.id !== itemId))
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
export function applyAgentIntent(
  intent: AgentIntent,
  practiceId: PracticeId,
): AgentIntentApplyResult {
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
    const msg = addItem(practiceId, intent.target.id, intent.text ?? intent.summary)
    if (msg) {
      return {
        ok: true,
        tabId,
        messageVi: msg.vi,
        messageEn: msg.en,
        undo: msg.undo,
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
      tabId: 'assistant',
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
