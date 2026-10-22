import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { getWorkbenchModule, type PracticeId, type WorkbenchModuleId } from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { InboxPane } from './InboxPane'
import { NotesPane } from './NotesPane'
import { MODULE_TONES } from './module-tones'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { useI18n } from './locale'
import { WorkProfilePane } from './WorkProfilePane'
import { draftFromForm } from './form-draft'
import { WorkCalendarPane } from './WorkCalendarPane'
import { WorkTasksPane } from './WorkTasksPane'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'
import { toastError, useWbToast, useWbUndoKey } from './WbToastHost'
import { WbIconBtn, WbRowActions } from './WbRowActions'
import { WbMenuButton } from './WbMenu'
import { WbPackChip } from './DeskDrawer'
import { FileBadge } from './FileBadge'
import { readForms, WB_FORMS_CHANGED, writeForms, type WbFormItem } from './workbench-pins'
import {
  WorkSkeleton,
  WorkStatePanel,
  type WorkPaneProps,
  type WorkSkeletonShape,
} from './WorkErrorState'

interface Props {
  moduleId: WorkbenchModuleId
  practiceId: PracticeId
  vi: boolean
  contextTitle?: string | null
  /** where Soạn from Forms goes: the selected Tri thức pack, else the default project */
  packId?: string | null
  /** the Forms banner's pack chip: the role's packs and the Knowledge selection */
  packs?: readonly { id: string; title: string }[]
  selectedPackId?: string | null
  onSelectPack?: (id: string | null) => void
  onPackLinked?: () => void
  /** the active UniWork workspace; null = signed out or a member of none */
  workspace: UniworkWorkspaceRef | null
  /** why the workspace list failed (the last good list stays); server tabs show it instead of "no workspace" */
  workspaceError: UniworkWorkError | null
  /** the top bar's Refresh: re-lists workspaces and reloads every server tab */
  onReload: () => void
  /** a task write landed in the Tasks tab (the tab counts reload) */
  onTasksWritten?: () => void
  /** the workspace list is still loading: a server tab shows its header over the skeleton */
  loading?: boolean
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
  packs = [],
  selectedPackId = null,
  onSelectPack,
  onPackLinked,
  workspace,
  workspaceError,
  onReload,
  onTasksWritten,
  loading = false,
}: Props): ReactElement {
  const mod = getWorkbenchModule(moduleId)
  const { t } = useI18n()
  // what every server tab gets (Inbox, Tasks, Calendar, Profile)
  const server: WorkPaneProps = { workspace, workspaceError, onReload }

  if (!mod) {
    return <p className="wb-empty">{t('wbModuleUnknown')}</p>
  }

  const title = vi ? mod.labelVi : mod.labelEn
  // the tab hint (and the open pack) until the tab's data can say more
  const head: WorkToolbarProps = {
    title,
    summary:
      moduleId === 'personal' ? (
        <>
          <strong>{t('wbProfileSummary')}</strong> · {t('wbProfileReadOnly')}
        </>
      ) : (
        `${vi ? mod.hintVi : mod.hintEn}${contextTitle ? ` · ${contextTitle}` : ''}`
      ),
  }
  const local = moduleId === 'forms' || moduleId === 'notes'

  // server tabs wait for the workspace list: null would read as "no workspace"
  if (loading && !local) {
    return (
      <section className="wb-pane" aria-label={title}>
        <WorkToolbar {...head} />
        <WorkSkeleton shape={SKELETON[moduleId]} />
      </section>
    )
  }

  return (
    <section className="wb-pane" aria-label={title}>
      {/* each tab draws its own toolbar: its summary counts what it loads, Profile adds Edit on the web */}
      {moduleId === 'inbox' && <InboxPane {...server} head={head} />}
      {moduleId === 'calendar' && <WorkCalendarPane {...server} head={head} />}
      {moduleId === 'tasks' && <WorkTasksPane {...server} head={head} onWritten={onTasksWritten} />}
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} head={head} />}
      {moduleId === 'forms' && (
        <FormsPane
          practiceId={practiceId}
          vi={vi}
          packId={packId}
          packs={packs}
          selectedPackId={selectedPackId}
          onSelectPack={onSelectPack}
          onPackLinked={onPackLinked}
          orgId={workspace?.orgId ?? null}
          head={head}
        />
      )}
      {moduleId === 'personal' && <WorkProfilePane {...server} head={head} />}
    </section>
  )
}

const SKELETON: Partial<Record<WorkbenchModuleId, WorkSkeletonShape>> = {
  inbox: 'rows',
  calendar: 'agenda',
  personal: 'card',
}

function FormsPane({
  practiceId,
  vi,
  packId,
  packs,
  selectedPackId,
  onSelectPack,
  onPackLinked,
  orgId,
  head,
}: {
  practiceId: PracticeId
  vi: boolean
  /** where a draft goes: the selected pack, else the default one; null = no pack at all */
  packId: string | null
  packs: readonly { id: string; title: string }[]
  selectedPackId: string | null
  onSelectPack?: (id: string | null) => void
  onPackLinked?: () => void
  /** the active org, for the cached UniWork profile the compose merge reads; null when signed out */
  orgId: string | null
  head: WorkToolbarProps
}): ReactElement {
  const { t } = useI18n()
  const toasts = useWbToast()
  // ⌘/Ctrl+Z off the text fields brings back the last deleted form (the toast may be out of reach)
  useWbUndoKey('forms-delete:')
  const baseId = useId()
  const [items, setItems] = useState<WbFormItem[]>(() => readForms(practiceId))
  // the "New form" card: closed, adding (null id) or editing a form
  const [card, setCard] = useState<{ editingId: string | null } | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [draftFile, setDraftFile] = useState<{
    filePath: string
    fileName: string
    fileExt: string
  } | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // a removed row took the focus with it: land on the list (or Add when it is gone) after the render
  const refocus = useRef(false)

  useEffect(() => {
    setItems(readForms(practiceId))
    setCard(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
  }, [practiceId])

  // follow storage: an Undo from an earlier mount, the Desk drawer's pack link
  useEffect(() => {
    const sync = () => setItems(readForms(practiceId))
    window.addEventListener(WB_FORMS_CHANGED, sync)
    return () => window.removeEventListener(WB_FORMS_CHANGED, sync)
  }, [practiceId])

  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    ;(listRef.current ?? addRef.current)?.focus()
  }, [items])

  const persist = (next: WbFormItem[]) => {
    setItems(next)
    writeForms(practiceId, next)
  }

  const closeCard = () => {
    setCard(null)
    setTitle('')
    setNote('')
    setDraftFile(null)
    addRef.current?.focus()
  }

  const openCard = (it?: WbFormItem) => {
    setCard({ editingId: it?.id ?? null })
    setTitle(it?.title ?? '')
    setNote(it?.note ?? '')
    setDraftFile(
      it?.filePath
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
      // a key is translated by the host at render, so a language switch applies
      toasts.show({
        id: 'forms-upload',
        message: result.rejected[0]
          ? { text: result.rejected[0] }
          : { key: 'wbFormsNoSupportedFile' },
      })
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
    toasts.dismiss('forms-upload')
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = title.trim()
    if (!name || !card) return
    const editingId = card.editingId
    // the stored list, not this render's, so a stale pane cannot drop forms
    const stored = readForms(practiceId)
    const existing = editingId ? stored.find((x) => x.id === editingId) : undefined
    const row: WbFormItem = {
      id: editingId ?? newId(),
      title: name,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(existing?.linkedProjectId
        ? { linkedProjectId: existing.linkedProjectId }
        : selectedPackId
          ? { linkedProjectId: selectedPackId }
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
    persist(editingId ? stored.map((x) => (x.id === editingId ? row : x)) : [row, ...stored])
    closeCard()
  }

  // never locked (spec 5.1): the selected pack, else the default one, as the Desk drawer does
  const draft = async (item: WbFormItem) => {
    try {
      await draftFromForm(item, packId, orgId, vi)
    } catch (err) {
      toasts.show({
        id: `draft-failed:${item.id}`,
        tone: 'alert',
        message: {
          key: 'wbFormsDraftFailed',
          params: { name: item.title, error: toastError(err) },
        },
        actions: [{ label: 'acctRetry', onClick: () => void draft(item) }],
      })
      return
    }
    if (packId && item.linkedProjectId !== packId) {
      persist(
        readForms(practiceId).map((x) =>
          x.id === item.id ? { ...x, linkedProjectId: packId } : x,
        ),
      )
    }
    onPackLinked?.()
  }

  // removed at once, with Undo in the toast (spec 5.3); Undo puts it back where it was
  const remove = (item: WbFormItem) => {
    const stored = readForms(practiceId)
    const at = stored.findIndex((x) => x.id === item.id)
    if (card?.editingId === item.id) closeCard()
    refocus.current = true
    persist(stored.filter((x) => x.id !== item.id))
    toasts.show({
      id: `forms-delete:${item.id}`,
      message: { key: 'wbFormsDeleted', params: { title: item.title } },
      actions: [
        {
          label: 'wbCommonUndo',
          onClick: () => {
            // the stored list, not this render's: other edits may have landed since
            const now = readForms(practiceId).filter((x) => x.id !== item.id)
            now.splice(Math.min(at, now.length), 0, item)
            persist(now)
          },
        },
      ],
    })
  }

  const ext = (it: WbFormItem) => it.fileExt?.replace(/^\./, '') ?? ''

  return (
    <>
      <WorkToolbar
        {...head}
        summary={<strong>{t('wbFormsCount', { count: items.length })}</strong>}
        local
        actions={
          <button
            ref={addRef}
            type="button"
            className="wb-btn wb-btn-secondary"
            aria-expanded={card !== null}
            onClick={() => (card ? closeCard() : openCard())}
          >
            <WbGlyph id="plus" />
            {t('wbDeskDrawerAdd')}
          </button>
        }
      />
      {items.length > 0 ? (
        <div className="wb-banner wb-forms-banner">
          <span>{t('wbFormsBannerInto')}</span>
          <WbPackChip
            packs={packs}
            selectedPackId={selectedPackId}
            onSelectPack={onSelectPack}
            // no default project either: a draft is a plain document, so the chip says no pack
            noneLabel={packId ? undefined : t('wbMatPackNone')}
          />
          {selectedPackId ? null : (
            <span className="wb-row-sub">
              {t(packId ? 'wbFormsBannerDefault' : 'wbFormsBannerNoPack')}
            </span>
          )}
        </div>
      ) : null}
      {card ? (
        <form
          key={card.editingId ?? 'new'}
          className="wb-block wb-forms-new"
          aria-labelledby={`${baseId}-new`}
          onSubmit={save}
        >
          <div className="wb-desk-head">
            <h3 id={`${baseId}-new`}>
              {t(card.editingId ? 'wbFormsEditTitle' : 'wbFormsNewTitle')}
            </h3>
            <span className="wb-desk-head-end">
              <WbIconBtn label={t('wbOvDismiss')} onClick={closeCard}>
                <WbGlyph id="close" />
              </WbIconBtn>
            </span>
          </div>
          <div className="wb-forms-fields">
            <label className="wb-field">
              <span className="wb-field-label">
                {t('wbFormsTitle')} <span aria-hidden="true">*</span>
              </span>
              <input
                className="wb-input"
                value={title}
                required
                autoFocus
                placeholder={t('wbFormsTitlePlaceholder')}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="wb-field">
              <span className="wb-field-label">{t('wbFormsNote')}</span>
              <input className="wb-input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="wb-field" role="group" aria-labelledby={`${baseId}-file`}>
              <span className="wb-field-label" id={`${baseId}-file`}>
                {t('wbFormsTemplateLabel')}
              </span>
              {draftFile ? (
                <div className="wb-forms-file">
                  <FileBadge ext={draftFile.fileExt.replace(/^\./, '')} size={16} />
                  <span className="wb-forms-file-name">{draftFile.fileName}</span>
                  <button type="button" className="wb-link" onClick={() => void pickTemplateFile()}>
                    {t('wbFormsReplaceFile')}
                  </button>
                  <WbIconBtn label={t('wbFormsClearFile')} onClick={() => setDraftFile(null)}>
                    <WbGlyph id="close" size={14} />
                  </WbIconBtn>
                </div>
              ) : (
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary"
                  onClick={() => void pickTemplateFile()}
                >
                  <WbGlyph id="upload" />
                  {t('wbFormsUploadFile')}
                </button>
              )}
            </div>
          </div>
          <div className="wb-forms-new-actions">
            <button type="button" className="wb-btn wb-btn-ghost" onClick={closeCard}>
              {t('wbCommonCancel')}
            </button>
            <button type="submit" className="wb-btn wb-btn-primary" disabled={!title.trim()}>
              {t(card.editingId ? 'wbFormsSave' : 'wbFormsAdd')}
            </button>
          </div>
        </form>
      ) : null}
      {items.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.forms}
          icon={<WorkbenchIcon id="forms" size={20} />}
          title={t('wbFormsEmpty')}
        />
      ) : (
        <>
          <ul
            ref={listRef}
            className="wb-block wb-forms-list"
            tabIndex={-1}
            aria-label={t('wbFormsCount', { count: items.length })}
          >
            {items.map((it) => (
              <li key={it.id} className="wb-row wb-forms-row">
                {ext(it) ? (
                  <FileBadge ext={ext(it)} size={28} />
                ) : (
                  <WorkbenchIcon id="forms" size={28} />
                )}
                <div className="wb-forms-text">
                  <span className="wb-forms-name" id={`${baseId}-${it.id}`}>
                    {it.title}
                  </span>
                  {it.note ? <span className="wb-row-sub">{it.note}</span> : null}
                </div>
                <span className="wb-forms-file-cell">
                  {it.fileName ? (
                    <>
                      <FileBadge ext={ext(it)} size={16} />
                      <span>{it.fileName}</span>
                    </>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-btn-sm"
                  aria-describedby={`${baseId}-${it.id}`}
                  onClick={() => void draft(it)}
                >
                  {t('wbFormsDraft')}
                </button>
                <WbRowActions>
                  <FormMenu
                    item={it}
                    onOpenFile={() => void window.aiOffice.openPath?.(it.filePath!)}
                    onEdit={() => openCard(it)}
                    onRemove={() => remove(it)}
                  />
                </WbRowActions>
              </li>
            ))}
          </ul>
          <p className="wb-forms-foot">{t('wbFormsHint')}</p>
        </>
      )}
    </>
  )
}

/** a form row's ⋯ menu: open the source template, edit, remove */
function FormMenu({
  item,
  onOpenFile,
  onEdit,
  onRemove,
}: {
  item: WbFormItem
  onOpenFile: () => void
  onEdit: () => void
  onRemove: () => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <WbMenuButton
      label={t('wbFormsMore', { title: item.title })}
      menuLabel={item.title}
      items={[
        ...(item.filePath
          ? [
              {
                label: t('wbFormsOpenTemplate'),
                icon: <WbGlyph id="external" />,
                onSelect: onOpenFile,
              },
            ]
          : []),
        { label: t('wbFormsEditMenu'), icon: <WbGlyph id="pencil" />, onSelect: onEdit },
        {
          label: t('wbFormsRemove'),
          icon: <WbGlyph id="trash" />,
          danger: true,
          onSelect: onRemove,
        },
      ]}
    />
  )
}
