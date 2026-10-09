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
 */
import type { ChatMessage, ProjectApi, ResolveChatResult } from '@genoffice/project-store'

const DEFAULT_PROJECT = 'default'

const nowIso = () => new Date().toISOString()
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
} satisfies ProjectApi
