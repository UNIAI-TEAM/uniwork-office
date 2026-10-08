/**
 * projectApi on the web (GO-B3): in-memory projects / chats (lost on reload).
 *
 * Only the AI panel uses projectApi, and AI is stubbed + hidden on the web
 * (lane decision, ADR GO-C2 pending), so no UniWork endpoint backs it yet.
 * When AI ships on the web these become host requests keyed by document id:
 *
 * PROJECT_ENDPOINTS (future UniWork API):
 *   resolveChat   POST   /api/chats/resolve      {filePath|fileId, tempChatId?} -> {projectId, chatId}
 *   appendChat    POST   /api/projects/:pid/chats/:cid/messages  {role, text, tools?, attachments?, scope?}
 *   loadChat      GET    /api/projects/:pid/chats/:cid/messages?limit=N -> ChatMessage[]
 *   rebindChat    POST   /api/projects/:pid/chats/:tempCid/rebind {newChatId|fileId} -> {projectId, chatId}
 *   listProjects  GET    /api/projects -> ProjectSummary[]
 *   createProject POST   /api/projects {name} -> ProjectSummary
 *   renameProject PATCH  /api/projects/:id {name}
 *   deleteProject DELETE /api/projects/:id (soft delete)
 *   moveFile      PUT    /api/files/:id/project {projectId}
 *   getTimeline   GET    /api/projects/:id/timeline?limit=N -> TimelineEntry[]
 */
import type {
  ChatMessage,
  ProjectApi,
  ProjectSummary,
  ResolveChatResult,
  TimelineEntry,
} from '@genoffice/project-store'

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const DEFAULT_PROJECT = 'default'

interface FakeProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

const projects = new Map<string, FakeProject>()
const nowIso = () => new Date().toISOString()
projects.set(DEFAULT_PROJECT, {
  id: DEFAULT_PROJECT,
  name: 'Default',
  createdAt: nowIso(),
  updatedAt: nowIso(),
})
/** `${projectId}/${chatId}` -> messages */
const chats = new Map<string, ChatMessage[]>()
/** file path -> projectId */
const fileMap = new Map<string, string>()
/** file path -> stable chatId */
const chatIdByPath = new Map<string, string>()
let chatCounter = 0

const chatKey = (projectId: string, chatId: string) => `${projectId}/${chatId}`

function chatIdFor(filePath: string): string {
  let id = chatIdByPath.get(filePath)
  if (!id) {
    id = `chat-${++chatCounter}`
    chatIdByPath.set(filePath, id)
  }
  return id
}

function filePathOfChat(chatId: string): string {
  for (const [path, id] of chatIdByPath) if (id === chatId) return path
  return ''
}

function summary(p: FakeProject): ProjectSummary {
  let lastActiveAt = p.updatedAt
  for (const [key, msgs] of chats) {
    if (!key.startsWith(`${p.id}/`)) continue
    const ts = msgs[msgs.length - 1]?.ts
    if (ts && ts > lastActiveAt) lastActiveAt = ts
  }
  const fileCount = [...fileMap.values()].filter((pid) => pid === p.id).length
  return { ...p, fileCount, lastActiveAt, isDefault: p.id === DEFAULT_PROJECT }
}

export const projectApi = {
  async resolveChat({ filePath, tempChatId }): Promise<ResolveChatResult> {
    if (!filePath) {
      return { projectId: DEFAULT_PROJECT, chatId: tempChatId ?? `unsaved-${Date.now()}` }
    }
    if (!fileMap.has(filePath)) fileMap.set(filePath, DEFAULT_PROJECT)
    return { projectId: fileMap.get(filePath)!, chatId: chatIdFor(filePath) }
  },

  async appendChat({ projectId, chatId, role, text, tools, attachments, scope }) {
    const key = chatKey(projectId, chatId)
    const list = chats.get(key) ?? []
    const fileRef = filePathOfChat(chatId) || undefined
    list.push({
      seq: (list[list.length - 1]?.seq ?? 0) + 1,
      ts: nowIso(),
      role,
      text,
      ...(fileRef ? { fileRef } : {}),
      ...(tools ? { tools } : {}),
      ...(attachments ? { attachments } : {}),
      ...(scope ? { scope } : {}),
    })
    chats.set(key, list)
  },

  async loadChat({ projectId, chatId, limit }) {
    const list = chats.get(chatKey(projectId, chatId)) ?? []
    return limit && limit > 0 ? list.slice(-limit) : list.slice()
  },

  async rebindChat({ projectId, tempChatId, newChatId, newFilePath }) {
    let chatId = newChatId
    if (!chatId && newFilePath) {
      chatId = chatIdFor(newFilePath)
      if (!fileMap.has(newFilePath)) fileMap.set(newFilePath, projectId)
    }
    // sessionId (Sheets) has nothing to look up here: keep the temp chat
    if (!chatId) return { projectId, chatId: tempChatId }
    const from = chatKey(projectId, tempChatId)
    const moved = chats.get(from)
    if (moved) {
      const to = chatKey(projectId, chatId)
      chats.set(to, [...(chats.get(to) ?? []), ...moved])
      chats.delete(from)
    }
    return { projectId, chatId }
  },

  async listProjects() {
    return [...projects.values()].map(summary)
  },

  async createProject({ name }) {
    const p: FakeProject = {
      id: `p-${Date.now().toString(36)}-${projects.size}`,
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    projects.set(p.id, p)
    return summary(p)
  },

  async renameProject({ id, name }) {
    const p = projects.get(id)
    if (!p || id === DEFAULT_PROJECT) return
    p.name = name
    p.updatedAt = nowIso()
  },

  async deleteProject({ id }) {
    if (id === DEFAULT_PROJECT) return
    projects.delete(id)
    for (const [path, pid] of fileMap) if (pid === id) fileMap.set(path, DEFAULT_PROJECT)
  },

  async moveFile({ filePath, projectId }) {
    if (projects.has(projectId)) fileMap.set(filePath, projectId)
  },

  async getTimeline({ projectId, limit }) {
    const out: TimelineEntry[] = []
    for (const [key, msgs] of chats) {
      if (!key.startsWith(`${projectId}/`)) continue
      const chatId = key.slice(projectId.length + 1)
      const filePath = filePathOfChat(chatId)
      for (const m of msgs) {
        out.push({
          filePath,
          fileName: basename(filePath),
          chatId,
          ts: m.ts,
          role: m.role,
          preview: (m.text.split('\n')[0] ?? '').slice(0, 120),
          seq: m.seq,
        })
      }
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.seq - a.seq))
    return limit && limit > 0 ? out.slice(0, limit) : out
  },
} satisfies ProjectApi
