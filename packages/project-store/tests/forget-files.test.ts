import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../src/store.js'

describe('forgetFiles deletes the AI history of the given files', () => {
  let tmpDir: string
  let store: ProjectStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'project-store-forget-'))
    store = new ProjectStore(tmpDir)
    store.ensureDefaultProject()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const chatsDir = (projectId: string) => join(tmpDir, 'projects', projectId, 'chats')

  function chatWith(filePath: string, text: string): { projectId: string; chatId: string } {
    writeFileSync(filePath, 'doc', 'utf8')
    const ids = store.resolveChatForFile(filePath)
    store.appendChatMessage(ids.projectId, ids.chatId, { role: 'user', text })
    store.appendChatMessage(ids.projectId, ids.chatId, { role: 'assistant', text: 'answer' })
    return ids
  }

  it('removes the transcript, the chat mapping and the project entry, and keeps other files', () => {
    const accountCopy = join(tmpDir, 'account.xlsx')
    const localFile = join(tmpDir, 'local.docx')
    const forgotten = chatWith(accountCopy, 'What data does this workbook contain?')
    const kept = chatWith(localFile, 'local question')

    store.forgetFiles([accountCopy])

    expect(existsSync(join(chatsDir(forgotten.projectId), `${forgotten.chatId}.jsonl`))).toBe(false)
    expect(store.loadChat(forgotten.projectId, forgotten.chatId)).toEqual([])
    expect(store.knownFilePaths().some((p) => p.endsWith('account.xlsx'))).toBe(false)
    expect(store.listProjectFiles('default').some((p) => p.endsWith('account.xlsx'))).toBe(false)
    // nothing readable is left behind in the trash either
    expect(existsSync(join(tmpDir, 'projects', '.trash'))).toBe(false)
    expect(store.loadChat(kept.projectId, kept.chatId).map((m) => m.text)).toEqual([
      'local question',
      'answer',
    ])
  })

  it('a reopened file starts with an empty history', () => {
    const accountCopy = join(tmpDir, 'account.docx')
    chatWith(accountCopy, 'secret')
    store.forgetFiles([accountCopy])
    const again = store.resolveChatForFile(accountCopy)
    expect(store.loadChat(again.projectId, again.chatId)).toEqual([])
  })

  it('removes the transcript from a named project too', () => {
    const accountCopy = join(tmpDir, 'plan.pptx')
    writeFileSync(accountCopy, 'doc', 'utf8')
    const project = store.createProject('Research')
    store.moveFileToProject(accountCopy, project.id)
    const ids = chatWith(accountCopy, 'q')
    expect(ids.projectId).toBe(project.id)

    store.forgetFiles([accountCopy])

    expect(readdirSync(chatsDir(project.id))).toEqual([])
    expect(store.listProjectFiles(project.id)).toEqual([])
  })

  it('ignores unknown paths and an empty list', () => {
    expect(() => store.forgetFiles([])).not.toThrow()
    expect(() => store.forgetFiles([join(tmpDir, 'never-seen.docx')])).not.toThrow()
  })
})
