import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  domainSkillPrompt,
  getDomainSkill,
  getSkillDomain,
  isPracticePillarId,
  isWorkbenchModuleId,
  practiceMaterialSeedHtml,
  practiceMatchesFilter,
  practiceSkillPrompt,
  skillsForDomain,
  type PracticeDefinition,
  type PracticeId,
  type PracticeMeta,
  type SkillDomainId,
} from '@uniwork/practice-core'
import type { ProjectSummaryEntry, UniworkResult, UniworkWorkspaceRef } from '../../shared/home-api'
import {
  afterWorkspaceList,
  readActiveWorkspaceId,
  writeActiveWorkspaceId,
  type WorkspaceListState,
} from './active-workspace'
import { onAgentIntentNavigate } from './agent-intent-bus'
import { useI18n } from './locale'
import { SkillDomainTabs } from './SkillDomainTabs'
import { readActiveSkillDomain, readPinnedSkillDomains } from './skill-domain-pins'
import { WorkbenchModulePane } from './WorkbenchModulePanes'
import { WorkbenchTabs } from './WorkbenchTabs'
import { WorkbenchTopBar, type WorkbenchNewItem } from './WorkbenchTopBar'
import { pinPillar } from './workbench-pins'
import { WbDeleteBtn, WbOpenBtn, WbRowActions } from './WbRowActions'
import { WB_REFRESH_EVENT, cacheWork, workCacheSlot } from './work-cache'
import { WorkOverview } from './WorkOverview'

interface PracticeHomeProps {
  practice: PracticeDefinition
  projects: ProjectSummaryEntry[]
  selectedId: string | null
  onSelectPack: (id: string | null) => void
  onOpenPackFiles: (id: string) => void
  onRefresh: () => void
  onSwitchPractice: (id: PracticeId) => void
  /** Home's NEW_ITEMS, for the top bar's + New menu */
  newItems: readonly WorkbenchNewItem[]
}

function toPracticeMeta(entry: ProjectSummaryEntry, practiceId: PracticeId): PracticeMeta | null {
  const p = entry.practice
  if (!p || p.practiceId !== practiceId) return null
  return {
    version: 1,
    kind: 'practice',
    practiceId: p.practiceId,
    title: p.title,
    facets: p.facets ?? {},
    ...(p.tags?.length ? { tags: p.tags } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.materials ? { materials: p.materials } : {}),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

export function PracticeHome({
  practice,
  projects,
  selectedId,
  onSelectPack,
  onOpenPackFiles,
  onRefresh,
  onSwitchPractice,
  newItems,
}: PracticeHomeProps): ReactElement {
  const { lang } = useI18n()
  const vi = lang === 'vi'
  const label = (a: string, b: string) => (vi ? a : b)

  // null while the list loads; Home remounts on an account or org change
  // (WorkbenchAccountGate keys it by bucket), so one load per mount plus Refresh is enough
  const [wsState, setWsState] = useState<WorkspaceListState>({
    workspaces: null,
    workspaceId: null,
    workspaceError: null,
  })
  const { workspaces, workspaceId, workspaceError } = wsState
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let live = true
    const listSlot = workCacheSlot('workspaces') // taken before the call, like every cached answer
    void window.aiOffice
      .uniworkListWorkspaces()
      // a rejected bridge call reads as offline, like every other work call
      .catch((): UniworkResult<UniworkWorkspaceRef[]> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (!live) return
        // My AI reads the first listed workspace when none is stored (cachedOpenTasks)
        if (result.ok) cacheWork(listSlot, result.value)
        setWsState((prev) => afterWorkspaceList(prev, result, readActiveWorkspaceId()))
      })
    return () => {
      live = false
    }
  }, [refreshTick])

  // the workspace on screen is the stored one: My AI and Open from UniWork read the same id
  useEffect(() => {
    if (workspaceId && workspaceId !== readActiveWorkspaceId()) writeActiveWorkspaceId(workspaceId)
  }, [workspaceId])

  const selectWorkspace = (id: string) => setWsState((s) => ({ ...s, workspaceId: id }))

  const refresh = () => {
    window.dispatchEvent(new Event(WB_REFRESH_EVENT))
    onRefresh()
    setRefreshTick((n) => n + 1)
  }

  const openCompose = () => {
    pinPillar(practice.id, 'compose')
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
    setTab('compose')
  }

  const [tab, setTab] = useState<string>('desk')
  const [qQuery, setQQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmSkill, setConfirmSkill] = useState<{
    kind: 'domain' | 'practice'
    id: string
  } | null>(null)
  const [skillDomain, setSkillDomain] = useState<SkillDomainId>(() =>
    readActiveSkillDomain(readPinnedSkillDomains()),
  )
  const domainSkills = useMemo(() => skillsForDomain(skillDomain), [skillDomain])
  const skillDomainDef = getSkillDomain(skillDomain)
  const roleSkills = practice.skills
  const [facetDraft, setFacetDraft] = useState<Record<string, string>>({})
  const [titleDraft, setTitleDraft] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [addRole, setAddRole] = useState(practice.materialRoles[0]?.id ?? 'khac')
  const [packFiles, setPackFiles] = useState<string[]>([])

  // Declared before effects that depend on it (avoids TDZ crash when opening Workbench).
  const selected = projects.find((p) => p.id === selectedId) ?? null
  const meta = selected ? toPracticeMeta(selected, practice.id) : null
  const hasSelectedPack = !!selected

  useEffect(() => {
    const init: Record<string, string> = {}
    for (const f of practice.facets) {
      if (f.id === practice.titleFacetId) continue
      init[f.id] = f.options?.[0] ?? ''
    }
    setFacetDraft(init)
    setTitleDraft('')
    setAddRole(practice.materialRoles[0]?.id ?? 'khac')
    setTab('desk')
  }, [practice.id])

  useEffect(() => {
    const openMod = (ev: Event) => {
      const moduleId = (ev as CustomEvent<{ moduleId?: string }>).detail?.moduleId
      if (moduleId && isWorkbenchModuleId(moduleId)) setTab(moduleId)
    }
    const onRunSkill = (ev: Event) => {
      pinPillar(practice.id, 'skills')
      window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
      setTab('skills')
      const hint = ((ev as CustomEvent<{ skillHint?: string }>).detail?.skillHint ?? '')
        .toLowerCase()
        .trim()
      if (!hint || !hasSelectedPack) {
        setNotice(
          label(
            hasSelectedPack
              ? 'Mở Skills — chọn kỹ năng và xác nhận Token.'
              : 'Mở Skills — chọn gói Tri thức rồi chạy kỹ năng.',
            hasSelectedPack
              ? 'Opened Skills — pick a skill and confirm Tokens.'
              : 'Opened Skills — select a Knowledge pack, then run a skill.',
          ),
        )
        return
      }
      const hit =
        roleSkills.find(
          (s) =>
            hint.includes(s.id.toLowerCase()) ||
            hint.includes(s.labelVi.toLowerCase()) ||
            hint.includes(s.labelEn.toLowerCase()),
        ) ??
        domainSkills.find(
          (s) =>
            hint.includes(s.id.toLowerCase()) ||
            hint.includes(s.labelVi.toLowerCase()) ||
            hint.includes(s.labelEn.toLowerCase()),
        )
      if (!hit) {
        setNotice(
          label(
            'Mở Skills — chọn kỹ năng và xác nhận Token.',
            'Opened Skills — pick a skill and confirm Tokens.',
          ),
        )
        return
      }
      const isPractice = roleSkills.some((s) => s.id === hit.id)
      setConfirmSkill({ kind: isPractice ? 'practice' : 'domain', id: hit.id })
    }
    window.addEventListener('uniwork:wb-open-module', openMod)
    window.addEventListener('uniwork:agent-run-skill', onRunSkill)
    return () => {
      window.removeEventListener('uniwork:wb-open-module', openMod)
      window.removeEventListener('uniwork:agent-run-skill', onRunSkill)
    }
  }, [roleSkills, domainSkills, hasSelectedPack, vi, practice.id])

  useEffect(() => {
    return onAgentIntentNavigate((tabId, intent) => {
      setTab(tabId)
      if (intent.target.kind === 'skill-domain') {
        setSkillDomain(intent.target.id)
      }
      setNotice(label('Đã áp dụng lệnh AI trên máy.', 'Applied AI intent on device.'))
    })
  }, [vi])

  const packs = useMemo(() => {
    return projects
      .filter((p) => p.kind === practice.projectKind && !!p.practice)
      .map((p) => ({ entry: p, meta: toPracticeMeta(p, practice.id) }))
      .filter((x): x is { entry: ProjectSummaryEntry; meta: PracticeMeta } => !!x.meta)
      .filter(({ entry, meta }) =>
        practiceMatchesFilter(
          {
            id: entry.id,
            name: entry.name,
            fileCount: entry.fileCount,
            lastActiveAt: entry.lastActiveAt,
            meta,
          },
          { query: qQuery || undefined },
        ),
      )
      .sort((a, b) => (b.entry.lastActiveAt > a.entry.lastActiveAt ? 1 : -1))
  }, [projects, practice.id, practice.projectKind, qQuery])

  useEffect(() => {
    if (!meta) {
      setNoteDraft('')
      setTagDraft('')
      return
    }
    setNoteDraft(meta.notes ?? '')
    setTagDraft((meta.tags ?? []).join(', '))
  }, [selected?.id, meta?.notes, meta?.tags])

  useEffect(() => {
    if (!selectedId || !window.aiOfficeProject) {
      setPackFiles([])
      return
    }
    void window.aiOfficeProject
      .listFiles(selectedId)
      .then(setPackFiles)
      .catch(() => setPackFiles([]))
  }, [selectedId, selected?.fileCount])

  const rememberRole = async (projectId: string, role: string) => {
    const current = await window.aiOfficeProject!.getPracticeMeta(projectId)
    const materials = { ...(current?.materials ?? {}), [`role:${role}`]: role }
    await window.aiOfficeProject!.patchPracticeMeta({ projectId, patch: { materials } })
    onRefresh()
  }

  const deletePack = async () => {
    if (!selected) return
    const ok = window.confirm(
      label(
        `Xóa gói “${meta?.title ?? selected.name}”?\nFile trong gói sẽ về dự án mặc định, không mất nội dung.`,
        `Delete pack “${meta?.title ?? selected.name}”?\nFiles move to the default project; content is not lost.`,
      ),
    )
    if (!ok) return
    setBusy('delete-pack')
    setError(null)
    try {
      await window.aiOfficeProject!.deleteProject(selected.id)
      onSelectPack(null)
      onRefresh()
      setNotice(label('Đã xóa gói khỏi Tri thức.', 'Pack removed from Knowledge.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const deleteMaterialFile = async (filePath: string) => {
    if (!selected) return
    const base = filePath.split(/[/\\]/).pop() || filePath
    const ok = window.confirm(label(`Xóa tệp “${base}”?`, `Delete file “${base}”?`))
    if (!ok) return
    setBusy(`del-file:${filePath}`)
    setError(null)
    try {
      await window.aiOffice.deleteFiles([filePath])
      const current = await window.aiOfficeProject!.getPracticeMeta(selected.id)
      if (current?.materials) {
        const materials = { ...current.materials }
        delete materials[filePath]
        await window.aiOfficeProject!.patchPracticeMeta({
          projectId: selected.id,
          patch: { materials },
        })
      }
      const next = await window.aiOfficeProject!.listFiles(selected.id)
      setPackFiles(next)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const openDocs = async (
    projectId: string,
    title: string,
    html: string,
    aiPreset?: { text: string; autoRun?: boolean; displayText?: string },
  ) => {
    await window.aiOffice.newDoc({
      projectId,
      aiContent: { title, html },
      ...(aiPreset ? { aiPreset } : {}),
    })
  }

  const submitCreate = async () => {
    setError(null)
    const title = titleDraft.trim()
    if (!title) {
      setError(label('Cần nhập tiêu đề gói.', 'Pack title is required.'))
      return
    }
    for (const f of practice.facets) {
      if (f.id === practice.titleFacetId) continue
      if (f.required && !(facetDraft[f.id] ?? '').trim()) {
        setError(label(`Thiếu: ${f.labelVi}`, `Missing: ${f.labelEn}`))
        return
      }
    }
    setBusy('create')
    try {
      const tags = tagsText
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
      const created = await window.aiOfficeProject!.createPracticeProject({
        practiceId: practice.id,
        title,
        facets: facetDraft,
        tags,
      })
      onRefresh()
      onSelectPack(created.id)
      const createdMeta = toPracticeMeta(created, practice.id)
      const seedRole = practice.templates[0]?.materialRole ?? practice.materialRoles[0]?.id
      if (createdMeta && seedRole) {
        const roleDef = practice.materialRoles.find((r) => r.id === seedRole)
        const html = practiceMaterialSeedHtml(
          seedRole,
          vi ? (roleDef?.labelVi ?? seedRole) : (roleDef?.labelEn ?? seedRole),
          createdMeta,
        )
        if (roleDef?.app === 'slides') {
          await window.aiOffice.newSlide({ projectId: created.id })
        } else if (roleDef?.app === 'sheets') {
          await window.aiOffice.newSheet({ projectId: created.id })
        } else {
          await openDocs(created.id, `${roleDef?.labelVi ?? seedRole} — ${title}`, html)
        }
        await rememberRole(created.id, seedRole)
      }
      setTitleDraft('')
      setTagsText('')
      pinPillar(practice.id, 'materials')
      window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
      setTab('materials')
      setNotice(label('Đã tạo gói trong Tri thức.', 'Pack added to Knowledge.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const saveMeta = async () => {
    if (!selected || !meta) return
    setBusy('meta')
    try {
      const tags = tagDraft
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
      await window.aiOfficeProject!.patchPracticeMeta({
        projectId: selected.id,
        patch: { notes: noteDraft, tags },
      })
      onRefresh()
      setNotice(label('Đã lưu.', 'Saved.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const addMaterial = async () => {
    if (!selected || !meta) return
    const roleDef = practice.materialRoles.find((r) => r.id === addRole)
    if (!roleDef) return
    setBusy(`mat:${addRole}`)
    try {
      if (roleDef.app === 'slides') await window.aiOffice.newSlide({ projectId: selected.id })
      else if (roleDef.app === 'sheets') await window.aiOffice.newSheet({ projectId: selected.id })
      else {
        const html = practiceMaterialSeedHtml(addRole, vi ? roleDef.labelVi : roleDef.labelEn, meta)
        await openDocs(selected.id, `${roleDef.labelVi} — ${meta.title}`, html)
      }
      await rememberRole(selected.id, addRole)
      setNotice(label(`Đã thêm: ${roleDef.labelVi}`, `Added: ${roleDef.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const openTemplate = async (templateId: string) => {
    if (!selected || !meta) return
    const tpl = practice.templates.find((t) => t.id === templateId)
    if (!tpl) return
    setBusy(`tpl:${templateId}`)
    try {
      if (tpl.app === 'slides') await window.aiOffice.newSlide({ projectId: selected.id })
      else if (tpl.app === 'sheets') await window.aiOffice.newSheet({ projectId: selected.id })
      else {
        const roleDef = practice.materialRoles.find((r) => r.id === tpl.materialRole)
        const html = practiceMaterialSeedHtml(
          tpl.materialRole,
          vi ? (roleDef?.labelVi ?? tpl.labelVi) : (roleDef?.labelEn ?? tpl.labelEn),
          meta,
        )
        await openDocs(selected.id, `${tpl.labelVi} — ${meta.title}`, html)
      }
      await rememberRole(selected.id, tpl.materialRole)
    } finally {
      setBusy(null)
    }
  }

  const runDomainSkill = async (skillId: string) => {
    if (!selected || !meta) return
    const skill = getDomainSkill(skillId)
    if (!skill) return
    const domain = getSkillDomain(skill.domainId)
    setConfirmSkill(null)
    setBusy(`skill:${skillId}`)
    try {
      const ctx = [
        `Tiêu đề: ${meta.title}`,
        ...Object.entries(meta.facets).map(([k, v]) => `${k}: ${v}`),
        meta.tags?.length ? `Thẻ: ${meta.tags.join(', ')}` : '',
      ]
      const prompt = domainSkillPrompt(
        vi ? skill.labelVi : skill.labelEn,
        vi ? skill.descVi : skill.descEn,
        vi ? (domain?.labelVi ?? skill.domainId) : (domain?.labelEn ?? skill.domainId),
        ctx,
      )
      const preset = {
        text: prompt,
        autoRun: true,
        displayText: vi ? skill.labelVi : skill.labelEn,
      }
      if (skill.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id, aiPreset: preset })
      } else {
        const role = practice.materialRoles[0]?.id ?? 'khac'
        const roleDef = practice.materialRoles.find((r) => r.id === role)
        const html = practiceMaterialSeedHtml(
          role,
          vi ? (roleDef?.labelVi ?? role) : (roleDef?.labelEn ?? role),
          meta,
        )
        await openDocs(selected.id, `${skill.labelVi} — ${meta.title}`, html, preset)
        await rememberRole(selected.id, role)
      }
      setNotice(label(`Đã chạy kỹ năng: ${skill.labelVi}`, `Ran skill: ${skill.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const runPracticeSkill = async (skillId: string) => {
    if (!selected || !meta) return
    const skill = roleSkills.find((s) => s.id === skillId)
    if (!skill) return
    setConfirmSkill(null)
    setBusy(`pskill:${skillId}`)
    try {
      const prompt = practiceSkillPrompt(
        vi ? skill.labelVi : skill.labelEn,
        vi ? skill.descVi : skill.descEn,
        meta,
      )
      const preset = {
        text: prompt,
        autoRun: true,
        displayText: vi ? skill.labelVi : skill.labelEn,
      }
      if (skill.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id, aiPreset: preset })
      } else {
        const role = skill.seedRole ?? practice.materialRoles[0]?.id ?? 'khac'
        const roleDef = practice.materialRoles.find((r) => r.id === role)
        const html = practiceMaterialSeedHtml(
          role,
          vi ? (roleDef?.labelVi ?? role) : (roleDef?.labelEn ?? role),
          meta,
        )
        await openDocs(selected.id, `${skill.labelVi} — ${meta.title}`, html, preset)
        await rememberRole(selected.id, role)
      }
      setNotice(label(`Đã chạy kỹ năng vai: ${skill.labelVi}`, `Ran role skill: ${skill.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const openFreeChain = async () => {
    if (!selected || !meta) return
    const ids = practice.freeChainTemplateIds
    if (!ids?.length) return
    setBusy('chain')
    try {
      for (const templateId of ids) {
        const tpl = practice.templates.find((t) => t.id === templateId)
        if (!tpl) continue
        if (tpl.app === 'slides') await window.aiOffice.newSlide({ projectId: selected.id })
        else if (tpl.app === 'sheets') await window.aiOffice.newSheet({ projectId: selected.id })
        else {
          const roleDef = practice.materialRoles.find((r) => r.id === tpl.materialRole)
          const html = practiceMaterialSeedHtml(
            tpl.materialRole,
            vi ? (roleDef?.labelVi ?? tpl.labelVi) : (roleDef?.labelEn ?? tpl.labelEn),
            meta,
          )
          await openDocs(selected.id, `${tpl.labelVi} — ${meta.title}`, html)
        }
        await rememberRole(selected.id, tpl.materialRole)
      }
      setNotice(
        label('Đã mở chuỗi mẫu miễn phí theo thứ tự.', 'Opened the free template chain in order.'),
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="content wb-home">
      <WorkbenchTopBar
        practice={practice}
        onSwitchPractice={onSwitchPractice}
        workspaces={workspaces ?? []}
        workspaceId={workspaceId}
        onSelectWorkspace={selectWorkspace}
        newItems={newItems}
        onNewTask={() => setTab('tasks')}
        onRefresh={refresh}
      />

      <WorkbenchTabs
        practiceId={practice.id}
        pillars={practice.pillars}
        active={tab}
        onSelect={setTab}
        vi={vi}
        onPinsChange={(pins, pillarPins) => {
          if (isWorkbenchModuleId(tab) && !pins.includes(tab)) setTab('desk')
          if (isPracticePillarId(tab) && !pillarPins.includes(tab)) setTab('desk')
        }}
      />

      {error && <p className="wb-error">{error}</p>}
      {notice && <p className="wb-hint">{notice}</p>}

      {tab === 'desk' ? (
        <WorkOverview
          workspaces={workspaces}
          workspaceId={workspaceId}
          workspaceError={workspaceError}
          refreshTick={refreshTick}
          onReload={refresh}
          onCompose={openCompose}
        />
      ) : isWorkbenchModuleId(tab) && workspaces === null && tab !== 'forms' && tab !== 'notes' ? (
        // server tabs wait for the workspace list: null would read as "no workspace"
        <div className="wb-work-skeleton" aria-busy="true" />
      ) : isWorkbenchModuleId(tab) ? (
        <WorkbenchModulePane
          moduleId={tab}
          practiceId={practice.id}
          vi={vi}
          contextTitle={meta?.title}
          packId={selectedId}
          onPackLinked={onRefresh}
          workspace={workspace}
          workspaceError={workspaceError}
          onReload={refresh}
        />
      ) : null}

      {tab === 'knowledge' && (
        <section className="wb-panel">
          <label className="wb-form-wide">
            <span>{label('Tìm', 'Search')}</span>
            <input
              value={qQuery}
              onChange={(e) => setQQuery(e.target.value)}
              placeholder={label('Tên gói, thẻ, ghi chú…', 'Title, tags, notes…')}
            />
          </label>
          <div className="wb-layout">
            <section className="wb-packs">
              <h2>
                {label('Thư viện', 'Library')}
                <span className="wb-count">{packs.length}</span>
              </h2>
              {packs.length === 0 ? (
                <p className="wb-empty">
                  {label('Chưa có gói. Tạo ở tab Soạn mới.', 'No packs yet. Create in Compose.')}
                </p>
              ) : (
                <ul className="wb-pack-list">
                  {packs.map(({ entry, meta: m }) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`wb-pack-item${entry.id === selectedId ? ' active' : ''}`}
                        onClick={() => onSelectPack(entry.id === selectedId ? null : entry.id)}
                      >
                        <strong>{m.title}</strong>
                        <span>{Object.values(m.facets).filter(Boolean).join(' · ')}</span>
                        <em>
                          {entry.fileCount} {label('tệp', 'files')}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <aside className="wb-detail">
              {selected && meta ? (
                <>
                  <h2>{meta.title}</h2>
                  <p>{Object.values(meta.facets).filter(Boolean).join(' · ')}</p>
                  <div className="wb-chip-row">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        pinPillar(practice.id, 'materials')
                        window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
                        setTab('materials')
                      }}
                    >
                      {label('Tài liệu', 'Materials')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onOpenPackFiles(selected.id)}
                    >
                      {label('Xem file', 'View files')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy === 'delete-pack'}
                      onClick={() => void deletePack()}
                    >
                      {label('Xóa gói', 'Delete pack')}
                    </button>
                  </div>
                  <div className="wb-form wb-form-spaced">
                    <label className="wb-form-wide">
                      <span>{label('Thẻ', 'Tags')}</span>
                      <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
                    </label>
                    <label className="wb-form-wide">
                      <span>{label('Ghi chú', 'Notes')}</span>
                      <textarea
                        rows={3}
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy}
                    onClick={() => void saveMeta()}
                  >
                    {label('Lưu', 'Save')}
                  </button>
                </>
              ) : (
                <p className="wb-empty">{label('Chọn một gói.', 'Select a pack.')}</p>
              )}
            </aside>
          </div>
        </section>
      )}

      {tab === 'materials' && (
        <section className="wb-panel wb-detail">
          {!selected || !meta ? (
            <p className="wb-empty">
              {label('Chọn gói ở Tri thức trước.', 'Select a Knowledge pack first.')}
            </p>
          ) : (
            <>
              <h2>
                {label('Tài liệu', 'Materials')} · {meta.title}
              </h2>
              <ul className="wb-material-list">
                {packFiles.length === 0 ? (
                  <li className="wb-empty">
                    {label('Chưa có file — thêm bên dưới.', 'No files yet — add below.')}
                  </li>
                ) : (
                  packFiles.map((fp) => {
                    const base = fp.split(/[/\\]/).pop() || fp
                    return (
                      <li key={fp} className="wb-material-row">
                        <div>
                          <strong>{base}</strong>
                          <span>
                            {meta.materials?.[fp] ?? meta.materials?.[`role:${base}`] ?? '—'}
                          </span>
                        </div>
                        <WbRowActions>
                          <WbOpenBtn
                            label={label('Mở', 'Open')}
                            onClick={() => void window.aiOffice.openPath(fp)}
                          />
                          <WbDeleteBtn
                            label={label('Xóa', 'Delete')}
                            disabled={busy === `del-file:${fp}`}
                            onClick={() => void deleteMaterialFile(fp)}
                          />
                        </WbRowActions>
                      </li>
                    )
                  })
                )}
              </ul>
              <div className="wb-add-row">
                <label>
                  <span>{label('Thêm tài liệu', 'Add material')}</span>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                    {practice.materialRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {vi ? r.labelVi : r.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={() => void addMaterial()}
                >
                  {label('Thêm & mở', 'Add & open')}
                </button>
              </div>
              <p className="wb-hint">
                {label(
                  'Tạo nhanh Office vào gói này (lưu lần đầu = hiện trong danh sách). File đã có: chuyển gói từ Home → danh sách file.',
                  'Quick-create Office into this pack (first save lists it here). Existing files: move pack from Home → file list.',
                )}
              </p>
              <div className="wb-chip-row">
                <button
                  type="button"
                  className="wb-chip"
                  disabled={!!busy}
                  onClick={() => void window.aiOffice.newDoc({ projectId: selected.id })}
                >
                  Docs
                </button>
                <button
                  type="button"
                  className="wb-chip"
                  disabled={!!busy}
                  onClick={() => void window.aiOffice.newSheet({ projectId: selected.id })}
                >
                  Sheets
                </button>
                <button
                  type="button"
                  className="wb-chip"
                  disabled={!!busy}
                  onClick={() => void window.aiOffice.newSlide({ projectId: selected.id })}
                >
                  Slides
                </button>
                <button
                  type="button"
                  className="wb-chip"
                  disabled={!!busy}
                  onClick={() => void window.aiOffice.newPdf({ projectId: selected.id })}
                >
                  PDF
                </button>
              </div>
              <h3>{label('Mẫu nhanh (miễn phí)', 'Quick templates (free)')}</h3>
              <div className="wb-chip-row">
                {practice.templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="wb-chip"
                    disabled={!!busy}
                    onClick={() => void openTemplate(t.id)}
                  >
                    {vi ? t.labelVi : t.labelEn}
                  </button>
                ))}
              </div>
              {practice.freeChainTemplateIds && practice.freeChainTemplateIds.length > 0 ? (
                <div className="wb-chip-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!!busy}
                    onClick={() => void openFreeChain()}
                  >
                    {label('Mở chuỗi mẫu miễn phí', 'Open free template chain')}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {tab === 'skills' && (
        <section className="wb-panel wb-detail">
          <h2>{label('Kỹ năng', 'Skills')}</h2>
          {!selected || !meta ? (
            <p className="wb-empty">
              {label(
                'Chọn gói ở Tri thức để gắn ngữ cảnh trước khi chạy.',
                'Select a Knowledge pack for context before running.',
              )}
            </p>
          ) : (
            <p>
              {label('Ngữ cảnh:', 'Context:')} <strong>{meta.title}</strong>
            </p>
          )}

          {roleSkills.length > 0 ? (
            <>
              <h3>{label('Kỹ năng theo vai', 'Role skills')}</h3>
              <p className="wb-hint">
                {label(
                  'Kỹ năng gắn với vai trò hiện tại. Mỗi lần chạy hỏi xác nhận Token.',
                  'Skills for this practice role. Each run asks to confirm Tokens.',
                )}
              </p>
              <ul className="wb-skill-list">
                {roleSkills.map((s) => (
                  <li key={s.id} className="wb-skill-row">
                    <div>
                      <strong>{vi ? s.labelVi : s.labelEn}</strong>
                      <span>{vi ? s.descVi : s.descEn}</span>
                      <em>
                        {s.category} · {label('Tốn Token', 'Uses Tokens')}
                      </em>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!!busy || !selected}
                      onClick={() => setConfirmSkill({ kind: 'practice', id: s.id })}
                    >
                      {label('Chạy', 'Run')}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>{label('Kỹ năng lĩnh vực', 'Domain skills')}</h3>
          <p className="wb-hint">
            {label(
              'Thêm tab lĩnh vực bằng +. Mỗi lần chạy hỏi xác nhận Token.',
              'Add domain tabs with +. Each run asks to confirm Tokens.',
            )}
          </p>
          <SkillDomainTabs vi={vi} active={skillDomain} onSelect={setSkillDomain} />
          <div className="skill-domain-panel">
            <h3>
              {skillDomainDef
                ? vi
                  ? skillDomainDef.labelVi
                  : skillDomainDef.labelEn
                : label('Kỹ năng', 'Skills')}
            </h3>
            <p className="wb-hint">
              {skillDomainDef ? (vi ? skillDomainDef.hintVi : skillDomainDef.hintEn) : ''}
            </p>
            <ul className="wb-skill-list">
              {domainSkills.map((s) => (
                <li key={s.id} className="wb-skill-row">
                  <div>
                    <strong>{vi ? s.labelVi : s.labelEn}</strong>
                    <span>{vi ? s.descVi : s.descEn}</span>
                    <em>
                      {s.category} · {label('Tốn Token', 'Uses Tokens')}
                    </em>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy || !selected}
                    onClick={() => setConfirmSkill({ kind: 'domain', id: s.id })}
                  >
                    {label('Chạy', 'Run')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === 'compose' && (
        <section className="wb-panel wb-create">
          <h2>{label('Soạn gói mới', 'New pack')}</h2>
          <div className="wb-form">
            {practice.facets.map((f) => {
              if (f.id === practice.titleFacetId) {
                return (
                  <label key={f.id} className="wb-form-wide">
                    <span>{vi ? f.labelVi : f.labelEn}</span>
                    <input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      placeholder={vi ? f.placeholderVi : f.placeholderEn}
                    />
                  </label>
                )
              }
              return (
                <label key={f.id}>
                  <span>{vi ? f.labelVi : f.labelEn}</span>
                  {f.options ? (
                    <select
                      value={facetDraft[f.id] ?? ''}
                      onChange={(e) => setFacetDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={facetDraft[f.id] ?? ''}
                      onChange={(e) => setFacetDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                      placeholder={vi ? f.placeholderVi : f.placeholderEn}
                    />
                  )}
                </label>
              )
            })}
            <label className="wb-form-wide">
              <span>{label('Thẻ', 'Tags')}</span>
              <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === 'create'}
            onClick={() => void submitCreate()}
          >
            {busy === 'create'
              ? label('Đang tạo…', 'Creating…')
              : label('Tạo gói vào Tri thức', 'Create pack in Knowledge')}
          </button>
        </section>
      )}

      {confirmSkill && (
        <div className="modal-overlay" onClick={() => setConfirmSkill(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{label('Dùng Token AI?', 'Use AI Tokens?')}</h3>
            <p>
              {label(
                'Thao tác này gọi Hub AI và có thể trừ token.',
                'This calls your AI Hub and may spend tokens.',
              )}
            </p>
            <div className="modal-buttons">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setConfirmSkill(null)}
              >
                {label('Huỷ', 'Cancel')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (confirmSkill.kind === 'practice') void runPracticeSkill(confirmSkill.id)
                  else void runDomainSkill(confirmSkill.id)
                }}
              >
                {label('Chạy AI', 'Run AI')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
