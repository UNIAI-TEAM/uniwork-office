import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { getWorkbenchModule, type PracticeId, type WorkbenchModuleId } from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { NotesPane } from './NotesPane'
import { LocalTag } from './LocalTag'
import { MODULE_TONES } from './module-tones'
import { WorkbenchIcon } from './WorkbenchIcons'
import { useI18n, type StringKey } from './locale'
import { WorkProfilePane } from './WorkProfilePane'
import { escapeHtml, profileForDraft, profileMergeHtml } from './form-merge'
import { WorkCalendarPane } from './WorkCalendarPane'
import { WorkTasksPane } from './WorkTasksPane'
import { WorkPaneHeader } from './WorkPaneHeader'
import { WbDeleteBtn, WbDraftBtn, WbEditBtn, WbFileBtn, WbRowActions } from './WbRowActions'
import { readForms, writeForms, type WbFormItem } from './workbench-pins'
import { WorkStatePanel, type WorkPaneProps } from './WorkErrorState'

interface Props {
  moduleId: WorkbenchModuleId
  practiceId: PracticeId
  vi: boolean
  contextTitle?: string | null
  /** Selected Tri thức pack — Soạn from modules joins Tài liệu on first save. */
  packId?: string | null
  onPackLinked?: () => void
  /** the active UniWork workspace; null = signed out or a member of none */
  workspace: UniworkWorkspaceRef | null
  /** why the workspace list failed (the last good list stays); server tabs show it instead of "no workspace" */
  workspaceError: UniworkWorkError | null
  /** the top bar's Refresh: re-lists workspaces and reloads every server tab */
  onReload: () => void
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function WorkbenchModulePane({
  moduleId,
  practiceId,
  vi,
  contextTitle,
  packId = null,
  onPackLinked,
  workspace,
  workspaceError,
  onReload,
}: Props): ReactElement {
  const mod = getWorkbenchModule(moduleId)
  const { t } = useI18n()
  // what every server tab gets (Tasks, Calendar, Profile)
  const server: WorkPaneProps = { workspace, workspaceError, onReload }

  if (!mod) {
    return <p className="wb-empty">{t('wbModuleUnknown')}</p>
  }

  const title = vi ? mod.labelVi : mod.labelEn
  const head = {
    module: moduleId,
    title,
    meta: `${vi ? mod.hintVi : mod.hintEn}${contextTitle ? ` · ${contextTitle}` : ''}`,
  }
  const local = moduleId === 'forms' || moduleId === 'notes'

  return (
    <section className="wb-pane" aria-label={title}>
      {/* Tasks draws its own header: the aside counts the list it loads */}
      {moduleId !== 'tasks' && (
        <WorkPaneHeader {...head} aside={local ? <LocalTag /> : undefined} />
      )}
      {moduleId === 'calendar' && <WorkCalendarPane {...server} />}
      {moduleId === 'tasks' && <WorkTasksPane {...server} head={head} />}
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} />}
      {moduleId === 'forms' && (
        <FormsPane
          practiceId={practiceId}
          vi={vi}
          packId={packId}
          onPackLinked={onPackLinked}
          orgId={workspace?.orgId ?? null}
        />
      )}
      {moduleId === 'personal' && <WorkProfilePane {...server} />}
    </section>
  )
}

function FormsPane({
  practiceId,
  vi,
  packId,
  onPackLinked,
  orgId,
}: {
  practiceId: PracticeId
  vi: boolean
  packId?: string | null
  onPackLinked?: () => void
  /** the active org, for the cached UniWork profile the compose merge reads; null when signed out */
  orgId: string | null
}): ReactElement {
  const { t } = useI18n()
  const [items, setItems] = useState<WbFormItem[]>(() => readForms(practiceId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [draftFile, setDraftFile] = useState<{
    filePath: string
    fileName: string
    fileExt: string
  } | null>(null)
  // a key (translated at render, so a language switch applies) or the main process's own text
  const [uploadNotice, setUploadNotice] = useState<{ key: StringKey } | { text: string } | null>(
    null,
  )

  useEffect(() => {
    setItems(readForms(practiceId))
    setEditingId(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
  }, [practiceId])

  const persist = (next: WbFormItem[]) => {
    setItems(next)
    writeForms(practiceId, next)
  }

  const clearForm = () => {
    setEditingId(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
  }

  const startEdit = (it: WbFormItem) => {
    setEditingId(it.id)
    setTitle(it.title)
    setNote(it.note ?? '')
    setDraftFile(
      it.filePath
        ? {
            filePath: it.filePath,
            fileName: it.fileName || it.filePath.split(/[\\/]/).pop() || it.title,
            fileExt: it.fileExt || '',
          }
        : null,
    )
  }

  const pickTemplateFile = async () => {
    const result = (await window.aiOffice.pickAttachments?.()) ?? null
    if (!result) return
    const accepted = result.accepted[0]
    if (!accepted) {
      setUploadNotice(
        result.rejected[0] ? { text: result.rejected[0] } : { key: 'wbFormsNoSupportedFile' },
      )
      window.setTimeout(() => setUploadNotice(null), 4000)
      return
    }
    setDraftFile({
      filePath: accepted.path,
      fileName: accepted.name,
      fileExt: accepted.ext,
    })
    if (!title.trim()) {
      setTitle(accepted.name.replace(/\.[^.]+$/, ''))
    }
    setUploadNotice(null)
  }

  const save = () => {
    const t = title.trim() || draftFile?.fileName.replace(/\.[^.]+$/, '') || ''
    if (!t) return
    const existing = editingId ? items.find((x) => x.id === editingId) : undefined
    const row: WbFormItem = {
      id: editingId ?? newId(),
      title: t,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(existing?.linkedProjectId
        ? { linkedProjectId: existing.linkedProjectId }
        : packId
          ? { linkedProjectId: packId }
          : {}),
      ...(draftFile
        ? {
            filePath: draftFile.filePath,
            fileName: draftFile.fileName,
            ...(draftFile.fileExt ? { fileExt: draftFile.fileExt } : {}),
          }
        : {}),
      ...(existing?.templateId ? { templateId: existing.templateId } : {}),
    }
    if (editingId) {
      persist(items.map((x) => (x.id === editingId ? row : x)))
    } else {
      persist([row, ...items])
    }
    clearForm()
  }

  const openForm = async (item: WbFormItem) => {
    const targetPack = packId ?? item.linkedProjectId
    if (!targetPack) return
    // merge fields from the UniWork profile: cached first, never blocking compose (form-merge.ts)
    const metaLines = profileMergeHtml(await profileForDraft(orgId))
    const fileHint = item.fileName
      ? `<p><em>${vi ? 'Mẫu gốc' : 'Source template'}: ${escapeHtml(item.fileName)}</em></p>`
      : ''
    const html = `
      <h1>${escapeHtml(item.title)}</h1>
      ${item.note ? `<p><em>${escapeHtml(item.note)}</em></p>` : ''}
      ${fileHint}
      ${metaLines}
      <h2>${vi ? 'Nội dung' : 'Content'}</h2>
      <p></p>
    `.trim()
    await window.aiOffice.newDoc({
      projectId: targetPack,
      aiContent: { title: item.title, html },
    })
    if (!item.linkedProjectId || item.linkedProjectId !== targetPack) {
      persist(items.map((x) => (x.id === item.id ? { ...x, linkedProjectId: targetPack } : x)))
    }
    onPackLinked?.()
  }

  const openTemplateFile = async (item: WbFormItem) => {
    if (!item.filePath) return
    await window.aiOffice.openPath?.(item.filePath)
  }

  return (
    <>
      <p className="wb-forms-hint" title={t('wbFormsHint')}>
        {t('wbFormsHint')}
      </p>
      <div className="wb-forms-add">
        <input
          className="wb-forms-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={t('wbFormsTitle')}
          placeholder={t('wbFormsTitle')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
        <input
          className="wb-forms-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t('wbFormsNote')}
          placeholder={t('wbFormsNote')}
        />
        <button
          type="button"
          className="wb-btn wb-btn-secondary"
          onClick={() => void pickTemplateFile()}
        >
          {draftFile ? t('wbFormsReplaceFile') : t('wbFormsUploadFile')}
        </button>
        {draftFile ? (
          <button type="button" className="wb-btn wb-btn-ghost" onClick={() => setDraftFile(null)}>
            {t('wbFormsClearFile')}
          </button>
        ) : null}
        <button type="button" className="wb-btn wb-btn-primary" onClick={save}>
          {editingId ? t('wbFormsSave') : t('wbFormsAdd')}
        </button>
        {editingId ? (
          <button type="button" className="wb-btn wb-btn-ghost" onClick={clearForm}>
            {t('wbFormsCancelEdit')}
          </button>
        ) : null}
      </div>
      {draftFile ? (
        <p className="wb-hint">
          {t('wbFormsTemplateFile')} {draftFile.fileName}
        </p>
      ) : null}
      {uploadNotice ? (
        <p className="wb-hint">{'key' in uploadNotice ? t(uploadNotice.key) : uploadNotice.text}</p>
      ) : null}
      {items.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.forms}
          icon={<WorkbenchIcon id="forms" size={20} />}
          title={t('wbFormsEmpty')}
        />
      ) : (
        <ul className="wb-block wb-forms-list">
          {items.map((it) => {
            const canOpen = Boolean(packId ?? it.linkedProjectId)
            const caption = [
              it.note ?? '',
              it.fileName ? `${t('wbFormsFile')} ${it.fileName}` : '',
              it.linkedProjectId ? t('wbFormsLinked') : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={it.id} className="wb-row">
                <div className="wb-forms-text">
                  <strong>{it.title}</strong>
                  {caption ? <span>{caption}</span> : null}
                </div>
                {/* outside the hover-only actions: it explains why Draft is locked */}
                {canOpen ? null : (
                  <span className="wb-forms-locked">{t('wbFormsDraftNeedsPackHint')}</span>
                )}
                <WbRowActions>
                  <WbEditBtn label={t('wbFormsEdit')} onClick={() => startEdit(it)} />
                  {it.filePath ? (
                    <WbFileBtn
                      label={t('wbFormsOpenFile')}
                      onClick={() => void openTemplateFile(it)}
                    />
                  ) : null}
                  <WbDraftBtn
                    label={t('wbFormsDraft')}
                    disabled={!canOpen}
                    title={canOpen ? t('wbFormsDraft') : t('wbFormsDraftNeedsPack')}
                    onClick={() => void openForm(it)}
                  />
                  <WbDeleteBtn
                    label={t('wbCommonDelete')}
                    onClick={() => {
                      if (editingId === it.id) clearForm()
                      persist(items.filter((x) => x.id !== it.id))
                    }}
                  />
                </WbRowActions>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
