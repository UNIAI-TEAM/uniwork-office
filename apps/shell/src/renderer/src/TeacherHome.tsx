import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  EDU_GRADES,
  EDU_LESSON_CHAIN_TEMPLATES,
  EDU_MATERIAL_ROLES,
  EDU_SKILLS,
  EDU_SUBJECTS,
  EDU_TEMPLATES,
  EDU_WORKFLOWS,
  eduMatchesFilter,
  eduMaterialSeedHtml,
  eduMaterialSeedTitle,
  eduSkillCategoryLabel,
  eduSkillPrompt,
  eduTemplateHtml,
  eduTemplateTitle,
  eduWorkflowPrompt,
  inferMaterialRole,
  materialRoleLabel,
  uniqueGrades,
  uniqueSubjects,
  uniqueTags,
  type EduKnowledgeItem,
  type EduMaterialRole,
  type EduMeta,
  type EduSkillId,
  type EduTemplateId,
  type EduWorkflowId,
} from '@uniwork/edu-core'
import {
  domainSkillPrompt,
  getDomainSkill,
  getPractice,
  getSkillDomain,
  isPracticePillarId,
  isWorkbenchModuleId,
  listPracticeGroups,
  listPractices,
  skillsForDomain,
  type PracticeId,
  type SkillDomainId,
} from '@uniwork/practice-core'
import type { CreateEducationProjectArgs, ProjectSummaryEntry } from '../../shared/home-api'
import { useI18n } from './locale'
import { SkillDomainTabs } from './SkillDomainTabs'
import { readActiveSkillDomain, readPinnedSkillDomains } from './skill-domain-pins'
import { onAgentIntentNavigate } from './agent-intent-bus'
import { WorkbenchModulePane } from './WorkbenchModulePanes'
import { WorkbenchTabs } from './WorkbenchTabs'
import { pinPillar } from './workbench-pins'
import { WbDeleteBtn, WbOpenBtn, WbRowActions } from './WbRowActions'

function toEduMeta(entry: ProjectSummaryEntry): EduMeta | null {
  const e = entry.edu
  if (!e) return null
  return {
    version: e.version === 2 ? 2 : 1,
    kind: 'education',
    subject: e.subject,
    grade: e.grade,
    ...(e.week ? { week: e.week } : {}),
    lessonTitle: e.lessonTitle,
    ...(typeof e.durationMinutes === 'number' ? { durationMinutes: e.durationMinutes } : {}),
    objectives: e.objectives ?? [],
    ...(e.tags?.length ? { tags: e.tags } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    ...(e.materials ? { materials: e.materials } : {}),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

function toKnowledgeItem(entry: ProjectSummaryEntry): EduKnowledgeItem | null {
  const edu = toEduMeta(entry)
  if (!edu) return null
  return {
    id: entry.id,
    name: entry.name,
    fileCount: entry.fileCount,
    lastActiveAt: entry.lastActiveAt,
    edu,
  }
}

async function openDocsSeed(
  projectId: string,
  title: string,
  html: string | null,
  aiPreset?: { text: string; autoRun?: boolean; displayText?: string },
): Promise<void> {
  await window.aiOffice.newDoc({
    projectId,
    ...(html ? { aiContent: { title, html } } : {}),
    ...(aiPreset ? { aiPreset } : {}),
  })
}

const AI_WORKFLOWS = EDU_WORKFLOWS.filter((w) => w.id !== 'lesson-chain-templates')

interface TeacherHomeProps {
  projects: ProjectSummaryEntry[]
  selectedId: string | null
  onSelectPack: (id: string | null) => void
  onOpenPackFiles: (id: string) => void
  onRefresh: () => void
  onSwitchPractice?: (id: PracticeId) => void
}

const TEACHER_UI_LANG_KEY = 'uniwork.teacherUiLang'

type TeacherUiLang = 'vi' | 'en'

function persistTeacherUiLang(next: TeacherUiLang): void {
  try {
    localStorage.setItem(TEACHER_UI_LANG_KEY, next)
  } catch {
    /* ignore */
  }
}

export function TeacherHome({
  projects,
  selectedId,
  onSelectPack,
  onOpenPackFiles,
  onRefresh,
  onSwitchPractice,
}: TeacherHomeProps): ReactElement {
  const { lang, setLang } = useI18n()
  const vi = lang === 'vi'
  const uiLang: TeacherUiLang = vi ? 'vi' : 'en'
  const label = (viText: string, enText: string) => (vi ? viText : enText)

  const changeUiLang = (next: TeacherUiLang) => {
    persistTeacherUiLang(next)
    setLang(next)
  }

  const [tab, setTab] = useState<string>('desk')
  const teacherPractice = getPractice('teacher')!
  const [qSubject, setQSubject] = useState('')
  const [qGrade, setQGrade] = useState('')
  const [qQuery, setQQuery] = useState('')
  const [qTag, setQTag] = useState('')

  const [form, setForm] = useState<CreateEducationProjectArgs>({
    subject: EDU_SUBJECTS[0],
    grade: EDU_GRADES[0],
    week: '',
    lessonTitle: '',
    durationMinutes: 45,
    objectives: [],
    tags: [],
  })
  const [objectiveText, setObjectiveText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAi, setConfirmAi] = useState<
    | { kind: 'workflow'; id: EduWorkflowId }
    | { kind: 'skill'; id: EduSkillId }
    | { kind: 'domain-skill'; id: string }
    | null
  >(null)
  const [skillDomain, setSkillDomain] = useState<SkillDomainId>(() =>
    readActiveSkillDomain(readPinnedSkillDomains()),
  )
  const domainSkills = useMemo(() => skillsForDomain(skillDomain), [skillDomain])
  const skillDomainDef = getSkillDomain(skillDomain)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [packFiles, setPackFiles] = useState<string[]>([])
  const [addRole, setAddRole] = useState<EduMaterialRole>('phieu-hoc-tap')
  const [showHub, setShowHub] = useState(false)

  const [hubBaseUrl, setHubBaseUrl] = useState('')
  const [hubToken, setHubToken] = useState('')
  const [hubModel, setHubModel] = useState('')
  const [hubStatus, setHubStatus] = useState<string | null>(null)
  const [hubOk, setHubOk] = useState<boolean | null>(null)
  const [hubSaving, setHubSaving] = useState(false)

  useEffect(() => {
    return onAgentIntentNavigate((tabId, intent) => {
      setTab(tabId)
      if (intent.target.kind === 'skill-domain') {
        setSkillDomain(intent.target.id)
      }
      setNotice(label('Đã áp dụng lệnh AI trên máy.', 'Applied AI intent on device.'))
    })
  }, [vi])

  const knowledge = useMemo(
    () =>
      projects
        .filter((p) => p.kind === 'education' || !!p.edu)
        .map(toKnowledgeItem)
        .filter((x): x is EduKnowledgeItem => !!x)
        .sort((a, b) => (b.lastActiveAt > a.lastActiveAt ? 1 : -1)),
    [projects],
  )

  const filtered = useMemo(
    () =>
      knowledge.filter((item) =>
        eduMatchesFilter(item, {
          subject: qSubject || undefined,
          grade: qGrade || undefined,
          query: qQuery || undefined,
          tag: qTag || undefined,
        }),
      ),
    [knowledge, qSubject, qGrade, qQuery, qTag],
  )

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const meta = selected ? toEduMeta(selected) : null
  const filterSubjects = useMemo(() => uniqueSubjects(knowledge), [knowledge])
  const filterGrades = useMemo(() => uniqueGrades(knowledge), [knowledge])
  const filterTags = useMemo(() => uniqueTags(knowledge), [knowledge])

  useEffect(() => {
    if (!selected?.edu) {
      setNoteDraft('')
      setTagDraft('')
      return
    }
    setNoteDraft(selected.edu.notes ?? '')
    setTagDraft((selected.edu.tags ?? []).join(', '))
  }, [selected?.id, selected?.edu?.notes, selected?.edu?.tags])

  useEffect(() => {
    if (!selectedId || !window.aiOfficeProject) {
      setPackFiles([])
      return
    }
    void window.aiOfficeProject.listFiles(selectedId).then(setPackFiles).catch(() => setPackFiles([]))
  }, [selectedId, selected?.fileCount, selected?.updatedAt])

  useEffect(() => {
    void window.aiOffice.getAiSettings?.().then((s) => {
      const custom = s.providers.custom
      setHubBaseUrl(custom?.baseUrl ?? '')
      setHubToken(custom?.apiKey ?? '')
      setHubModel(custom?.model ?? '')
      if (s.provider === 'custom' && custom?.baseUrl) {
        setHubStatus(label('Đang dùng Hub (Custom).', 'Using Hub (Custom).'))
        setHubOk(true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const materialRows = useMemo(() => {
    const roleMap = meta?.materials ?? selected?.edu?.materials ?? {}
    const fromFiles = packFiles.map((filePath) => {
      const base = filePath.split(/[/\\]/).pop() || filePath
      const stored = roleMap[filePath] as EduMaterialRole | undefined
      const role = stored ?? inferMaterialRole(base)
      return { key: filePath, title: base, role, kind: 'file' as const }
    })
    const coveredRoles = new Set(fromFiles.map((r) => r.role))
    const pending = Object.entries(roleMap)
      .filter(([key, role]) => key.startsWith('role:') && !coveredRoles.has(role as EduMaterialRole))
      .map(([key, role]) => ({
        key,
        title: materialRoleLabel(role as EduMaterialRole, vi),
        role: role as EduMaterialRole,
        kind: 'pending' as const,
      }))
    return [...fromFiles, ...pending]
  }, [packFiles, meta?.materials, selected?.edu?.materials, vi])

  const saveHub = async () => {
    setHubSaving(true)
    setHubStatus(null)
    try {
      const current = await window.aiOffice.getAiSettings()
      const baseUrl = hubBaseUrl.trim().replace(/\/+$/, '')
      const apiKey = hubToken.trim()
      const model = hubModel.trim()
      if (!baseUrl || !apiKey) {
        setHubOk(false)
        setHubStatus(label('Cần Base URL và Token.', 'Base URL and token are required.'))
        return
      }
      await window.aiOffice.setAiSettings({
        ...current,
        provider: 'custom',
        providers: {
          ...current.providers,
          custom: {
            ...current.providers.custom,
            apiKey,
            baseUrl,
            model: model || current.providers.custom.model || 'gpt-4o',
          },
        },
      })
      const probe = await window.aiOffice.probeAiHub({ baseUrl, apiKey })
      setHubOk(probe.ok)
      setHubStatus(
        probe.ok
          ? label(`Đã lưu. ${probe.message}`, `Saved. ${probe.message}`)
          : label(
              `Đã lưu token, nhưng kiểm tra Hub: ${probe.message}`,
              `Token saved, but Hub check failed: ${probe.message}`,
            ),
      )
    } catch (err) {
      setHubOk(false)
      setHubStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setHubSaving(false)
    }
  }

  const probeHub = async () => {
    setHubStatus(null)
    const probe = await window.aiOffice.probeAiHub({
      baseUrl: hubBaseUrl.trim(),
      apiKey: hubToken.trim(),
    })
    setHubOk(probe.ok)
    setHubStatus(probe.message)
  }

  const submitCreate = async () => {
    setError(null)
    const subject = form.subject.trim()
    const grade = form.grade.trim()
    const lessonTitle = form.lessonTitle.trim()
    if (!subject || !grade || !lessonTitle) {
      setError(label('Cần nhập Môn, Lớp và Tên bài.', 'Subject, grade, and lesson title are required.'))
      return
    }
    setCreating(true)
    try {
      const objectives = objectiveText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const tags = tagsText
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
      const created = await window.aiOfficeProject!.createEducationProject({
        subject,
        grade,
        week: form.week?.trim() || undefined,
        lessonTitle,
        durationMinutes: form.durationMinutes,
        objectives,
        tags,
      })
      onRefresh()
      onSelectPack(created.id)
      const createdMeta = toEduMeta(created)
      if (createdMeta) {
        await openDocsSeed(
          created.id,
          eduTemplateTitle('giao-an', createdMeta),
          eduTemplateHtml('giao-an', createdMeta),
        )
        await window.aiOfficeProject!.patchEduMeta({
          projectId: created.id,
          patch: { materials: { ...(created.edu?.materials ?? {}), 'role:giao-an': 'giao-an' } },
        })
        onRefresh()
      }
      setForm({
        subject: EDU_SUBJECTS[0],
        grade: EDU_GRADES[0],
        week: '',
        lessonTitle: '',
        durationMinutes: 45,
        objectives: [],
        tags: [],
      })
      setObjectiveText('')
      setTagsText('')
      pinPillar('teacher', 'materials')
      window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
      setTab('materials')
      setNotice(label('Đã tạo bài trong Tri thức.', 'Lesson pack added to Knowledge.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const saveKnowledgeMeta = async () => {
    if (!selected) return
    setBusy('meta')
    setError(null)
    try {
      const tags = tagDraft
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
      await window.aiOfficeProject!.patchEduMeta({
        projectId: selected.id,
        patch: { notes: noteDraft, tags },
      })
      onRefresh()
      setNotice(label('Đã lưu ghi chú / thẻ.', 'Notes / tags saved.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const rememberRole = async (projectId: string, role: EduMaterialRole) => {
    const current = await window.aiOfficeProject!.getEduMeta(projectId)
    const materials = { ...(current?.materials ?? {}), [`role:${role}`]: role }
    await window.aiOfficeProject!.patchEduMeta({ projectId, patch: { materials } })
    onRefresh()
  }

  const deletePack = async () => {
    if (!selected) return
    const ok = window.confirm(
      label(
        `Xóa gói “${meta?.lessonTitle ?? selected.name}”?\nFile trong gói sẽ về dự án mặc định, không mất nội dung.`,
        `Delete pack “${meta?.lessonTitle ?? selected.name}”?\nFiles move to the default project; content is not lost.`,
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
      const current = await window.aiOfficeProject!.getEduMeta(selected.id)
      if (current?.materials) {
        const materials = { ...current.materials }
        delete materials[filePath]
        await window.aiOfficeProject!.patchEduMeta({ projectId: selected.id, patch: { materials } })
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

  const openTemplate = async (templateId: EduTemplateId) => {
    if (!selected || !meta) return
    const def = EDU_TEMPLATES.find((t) => t.id === templateId)
    if (!def) return
    setBusy(`tpl:${templateId}`)
    try {
      if (def.app === 'docs') {
        await openDocsSeed(
          selected.id,
          eduTemplateTitle(templateId, meta),
          eduTemplateHtml(templateId, meta),
        )
      } else if (def.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id })
      } else {
        await window.aiOffice.newSheet({ projectId: selected.id })
      }
      await rememberRole(selected.id, templateId)
    } finally {
      setBusy(null)
    }
  }

  const addMaterial = async () => {
    if (!selected || !meta) return
    const roleDef = EDU_MATERIAL_ROLES.find((r) => r.id === addRole)
    if (!roleDef) return
    setBusy(`mat:${addRole}`)
    try {
      if (roleDef.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id })
      } else if (roleDef.app === 'sheets') {
        await window.aiOffice.newSheet({ projectId: selected.id })
      } else {
        const html = eduMaterialSeedHtml(addRole, meta)
        await openDocsSeed(selected.id, eduMaterialSeedTitle(addRole, meta), html)
      }
      await rememberRole(selected.id, addRole)
      setNotice(label(`Đã thêm: ${roleDef.labelVi}`, `Added: ${roleDef.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const openLessonChainFree = async () => {
    if (!selected || !meta) return
    setBusy('chain')
    try {
      for (const id of EDU_LESSON_CHAIN_TEMPLATES) {
        const def = EDU_TEMPLATES.find((t) => t.id === id)
        if (!def) continue
        if (def.app === 'docs') {
          await openDocsSeed(selected.id, eduTemplateTitle(id, meta), eduTemplateHtml(id, meta))
        } else if (def.app === 'slides') {
          await window.aiOffice.newSlide({ projectId: selected.id })
        } else {
          await window.aiOffice.newSheet({ projectId: selected.id })
        }
        await rememberRole(selected.id, id)
      }
      setNotice(label('Đã mở chuỗi giáo án → slide → phiếu.', 'Opened plan → slides → worksheet.'))
    } finally {
      setBusy(null)
    }
  }

  const runAiWorkflow = async (workflowId: EduWorkflowId) => {
    if (!selected || !meta || workflowId === 'lesson-chain-templates') return
    const wf = AI_WORKFLOWS.find((w) => w.id === workflowId)
    if (!wf) return
    const prompt = eduWorkflowPrompt(workflowId, meta)
    const displayText = vi ? wf.labelVi : wf.labelEn
    setBusy(`ai:${workflowId}`)
    setConfirmAi(null)
    try {
      const preset = { text: prompt, autoRun: true, displayText }
      if (wf.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id, aiPreset: preset })
      } else {
        await openDocsSeed(
          selected.id,
          eduTemplateTitle(wf.seedTemplate, meta),
          eduTemplateHtml(wf.seedTemplate, meta),
          preset,
        )
      }
      await rememberRole(selected.id, wf.seedTemplate)
    } finally {
      setBusy(null)
    }
  }

  const runSkill = async (skillId: EduSkillId) => {
    if (!selected || !meta) return
    const skill = EDU_SKILLS.find((s) => s.id === skillId)
    if (!skill) return
    const prompt = eduSkillPrompt(skillId, meta)
    const displayText = vi ? skill.labelVi : skill.labelEn
    setBusy(`skill:${skillId}`)
    setConfirmAi(null)
    try {
      const preset = { text: prompt, autoRun: true, displayText }
      if (skill.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: selected.id, aiPreset: preset })
      } else {
        const role = skill.seedRole ?? 'giao-an'
        const html = eduMaterialSeedHtml(role, meta)
        await openDocsSeed(selected.id, eduMaterialSeedTitle(role, meta), html, preset)
        await rememberRole(selected.id, role)
      }
      setNotice(label(`Đã chạy kỹ năng: ${skill.labelVi}`, `Ran skill: ${skill.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const runDomainSkill = async (skillId: string) => {
    if (!selected || !meta) return
    const skill = getDomainSkill(skillId)
    if (!skill) return
    const domain = getSkillDomain(skill.domainId)
    setBusy(`skill:${skillId}`)
    setConfirmAi(null)
    try {
      const ctx = [
        `Bài: ${meta.lessonTitle}`,
        `Môn: ${meta.subject}`,
        `Lớp: ${meta.grade}`,
        meta.week ? `Tuần: ${meta.week}` : '',
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
        const role: EduMaterialRole = 'phieu-hoc-tap'
        const html = eduMaterialSeedHtml(role, meta)
        await openDocsSeed(
          selected.id,
          `${skill.labelVi} — ${meta.lessonTitle}`,
          html,
          preset,
        )
        await rememberRole(selected.id, role)
      }
      setNotice(label(`Đã chạy kỹ năng: ${skill.labelVi}`, `Ran skill: ${skill.labelEn}`))
    } finally {
      setBusy(null)
    }
  }

  const exportPack = async () => {
    if (!selected) return
    setExportMsg(null)
    setBusy('export')
    try {
      const r = await window.aiOffice.exportLessonPack(selected.id)
      if (r.canceled) return
      if (!r.ok) {
        setExportMsg(r.error || label('Xuất thất bại.', 'Export failed.'))
        return
      }
      setExportMsg(label(`Đã xuất: ${r.path}`, `Exported: ${r.path}`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="content teacher-home">
      <section className="teacher-hero" aria-label={label('Giáo viên', 'Teacher')}>
        <div className="teacher-hero-top">
          <div>
            <h1 className="teacher-title">{label('Bàn làm việc giáo viên', 'Teacher workbench')}</h1>
            <p className="teacher-subtitle">
              {label(
                'Tri thức · Học liệu · Kỹ năng · Soạn mẫu. Desktop miễn phí; Token AI chỉ khi bạn chạy kỹ năng/workflow.',
                'Knowledge · Materials · Skills · Compose. Desktop is free; AI Tokens only when you run Skills/workflows.',
              )}
            </p>
            <p className="teacher-hint">
              {label(`${knowledge.length} bài trong thư viện`, `${knowledge.length} packs in library`)}
            </p>
          </div>
          <div className="teacher-hero-controls">
            {onSwitchPractice ? (
              <label className="teacher-lang">
                <span>{label('Vai trò', 'Role')}</span>
                <select
                  value="teacher"
                  onChange={(e) => onSwitchPractice(e.target.value as PracticeId)}
                  aria-label={label('Vai trò làm việc', 'Practice role')}
                >
                  {listPracticeGroups(vi).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.practices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {vi ? p.labelVi : p.labelEn}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="teacher-lang">
              <span>{label('Ngôn ngữ', 'Language')}</span>
              <select
                value={uiLang}
                onChange={(e) => changeUiLang(e.target.value as TeacherUiLang)}
                aria-label={label('Ngôn ngữ bàn làm việc', 'Workbench language')}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <WorkbenchTabs
        practiceId="teacher"
        pillars={teacherPractice.pillars}
        active={tab}
        onSelect={setTab}
        vi={vi}
        onPinsChange={(pins, pillarPins) => {
          if (isWorkbenchModuleId(tab) && !pins.includes(tab)) setTab('desk')
          if (isPracticePillarId(tab) && !pillarPins.includes(tab)) setTab('desk')
        }}
      />

      {error && <p className="teacher-error">{error}</p>}
      {notice && <p className="teacher-hint">{notice}</p>}

      {isWorkbenchModuleId(tab) ? (
        <WorkbenchModulePane
          moduleId={tab}
          practiceId="teacher"
          vi={vi}
          contextTitle={selected?.edu?.lessonTitle}
          packId={selectedId}
          onPackLinked={onRefresh}
        />
      ) : null}

      {tab === 'knowledge' && (
        <section className="teacher-panel" aria-label={label('Tri thức', 'Knowledge')}>
          <div className="teacher-filters">
            <label>
              <span>{label('Môn', 'Subject')}</span>
              <select value={qSubject} onChange={(e) => setQSubject(e.target.value)}>
                <option value="">{label('Tất cả', 'All')}</option>
                {(filterSubjects.length ? filterSubjects : [...EDU_SUBJECTS]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{label('Lớp', 'Grade')}</span>
              <select value={qGrade} onChange={(e) => setQGrade(e.target.value)}>
                <option value="">{label('Tất cả', 'All')}</option>
                {(filterGrades.length ? filterGrades : [...EDU_GRADES]).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="teacher-form-wide">
              <span>{label('Tìm', 'Search')}</span>
              <input
                value={qQuery}
                onChange={(e) => setQQuery(e.target.value)}
                placeholder={label('Tên bài, tuần, ghi chú…', 'Title, week, notes…')}
              />
            </label>
            <label>
              <span>{label('Thẻ', 'Tag')}</span>
              <select value={qTag} onChange={(e) => setQTag(e.target.value)}>
                <option value="">{label('Tất cả', 'All')}</option>
                {filterTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="teacher-layout">
            <section className="teacher-packs">
              <h2>
                {label('Thư viện bài', 'Lesson library')}
                <span className="teacher-count">{filtered.length}</span>
              </h2>
              {filtered.length === 0 ? (
                <p className="teacher-empty">
                  {label(
                    'Chưa có bài khớp. Tạo mới ở tab Soạn mới.',
                    'No matching packs. Create one in Compose.',
                  )}
                </p>
              ) : (
                <ul className="teacher-pack-list">
                  {filtered.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`teacher-pack-item${item.id === selectedId ? ' active' : ''}`}
                        onClick={() => onSelectPack(item.id === selectedId ? null : item.id)}
                        onDoubleClick={() => onOpenPackFiles(item.id)}
                      >
                        <strong>{item.edu.lessonTitle}</strong>
                        <span>
                          {[item.edu.subject, item.edu.grade, item.edu.week].filter(Boolean).join(' · ')}
                        </span>
                        <em>
                          {item.fileCount} {label('tệp', 'files')}
                          {(item.edu.tags ?? []).length > 0
                            ? ` · ${(item.edu.tags ?? []).slice(0, 3).join(', ')}`
                            : ''}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <aside className="teacher-detail">
              {selected && meta ? (
                <>
                  <header className="teacher-detail-header">
                    <div>
                      <h2>{meta.lessonTitle}</h2>
                      <p>
                        {[meta.subject, meta.grade, meta.week, meta.durationMinutes ? `${meta.durationMinutes}'` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </header>
                  <div className="teacher-chip-row">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        pinPillar('teacher', 'materials')
                        window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
                        setTab('materials')
                      }}
                    >
                      {label('Học liệu', 'Materials')}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => onOpenPackFiles(selected.id)}>
                      {label('Xem file', 'View files')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy === 'export'}
                      onClick={() => void exportPack()}
                    >
                      {busy === 'export' ? label('Đang xuất…', 'Exporting…') : label('Xuất ZIP', 'Export ZIP')}
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
                  {exportMsg && <p className="teacher-hint">{exportMsg}</p>}
                  <div className="teacher-form teacher-form-spaced">
                    <label className="teacher-form-wide">
                      <span>{label('Thẻ (phẩy tách)', 'Tags (comma-separated)')}</span>
                      <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
                    </label>
                    <label className="teacher-form-wide">
                      <span>{label('Ghi chú tri thức', 'Knowledge notes')}</span>
                      <textarea rows={4} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy === 'meta'}
                    onClick={() => void saveKnowledgeMeta()}
                  >
                    {label('Lưu ghi chú / thẻ', 'Save notes / tags')}
                  </button>
                </>
              ) : (
                <p className="teacher-empty">
                  {label('Chọn một bài để xem chi tiết.', 'Select a pack to see details.')}
                </p>
              )}
            </aside>
          </div>
        </section>
      )}

      {tab === 'materials' && (
        <section className="teacher-panel teacher-detail" aria-label={label('Học liệu', 'Materials')}>
          {!selected || !meta ? (
            <p className="teacher-empty">
              {label('Chọn bài ở tab Tri thức trước.', 'Select a pack in Knowledge first.')}
            </p>
          ) : (
            <>
              <h2>
                {label('Học liệu', 'Materials')} · {meta.lessonTitle}
              </h2>
              <p className="teacher-hint">
                {label(
                  'Mỗi file có vai trò: giáo án, KHDH, slide, phiếu, đề KT, tham khảo…',
                  'Each file has a role: lesson plan, slides, worksheet, quiz, reference…',
                )}
              </p>
              <ul className="teacher-material-list">
                {materialRows.length === 0 ? (
                  <li className="teacher-empty">{label('Chưa có học liệu — thêm bên dưới.', 'No materials yet — add below.')}</li>
                ) : (
                  materialRows.map((row) => (
                    <li key={row.key} className="teacher-material-row">
                      <div>
                        <strong>{row.title}</strong>
                        <span>{materialRoleLabel(row.role, vi)}</span>
                      </div>
                      {row.kind === 'file' ? (
                        <WbRowActions>
                          <WbOpenBtn
                            label={label('Mở', 'Open')}
                            onClick={() => void window.aiOffice.openPath(row.key)}
                          />
                          <WbDeleteBtn
                            label={label('Xóa', 'Delete')}
                            disabled={busy === `del-file:${row.key}`}
                            onClick={() => void deleteMaterialFile(row.key)}
                          />
                        </WbRowActions>
                      ) : (
                        <em className="teacher-hint">{label('Đã seed', 'Seeded')}</em>
                      )}
                    </li>
                  ))
                )}
              </ul>
              <div className="teacher-add-row">
                <label>
                  <span>{label('Thêm học liệu', 'Add material')}</span>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value as EduMaterialRole)}>
                    {EDU_MATERIAL_ROLES.map((r) => (
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
              <h3>{label('Mẫu nhanh (miễn phí)', 'Quick templates (free)')}</h3>
              <div className="teacher-chip-row">
                {EDU_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="teacher-chip"
                    disabled={busy === `tpl:${t.id}`}
                    onClick={() => void openTemplate(t.id)}
                  >
                    {vi ? t.labelVi : t.labelEn}
                  </button>
                ))}
                <button
                  type="button"
                  className="teacher-chip"
                  disabled={busy === 'chain'}
                  onClick={() => void openLessonChainFree()}
                >
                  {label('Chuỗi GA → Slide → Phiếu', 'Chain plan → slides → worksheet')}
                </button>
              </div>
              <div className="teacher-chip-row teacher-chip-row-spaced">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy === 'export'}
                  onClick={() => void exportPack()}
                >
                  {label('Xuất gói ZIP', 'Export ZIP')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => onOpenPackFiles(selected.id)}>
                  {label('Xem tất cả file', 'View all files')}
                </button>
              </div>
              {exportMsg && <p className="teacher-hint">{exportMsg}</p>}
            </>
          )}
        </section>
      )}

      {tab === 'skills' && (
        <section className="teacher-panel teacher-detail" aria-label={label('Kỹ năng', 'Skills')}>
          <h2>{label('Kỹ năng chuyên môn', 'Specialized Skills')}</h2>
          <p className="teacher-hint">
            {label(
              'Thêm tab lĩnh vực bằng +. Giáo dục giữ bộ kỹ năng giáo viên đầy đủ; lĩnh vực khác dùng kỹ năng chuyên biệt.',
              'Add domain tabs with +. Education keeps the full teacher set; other domains use specialized skills.',
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
            <p className="teacher-hint">
              {skillDomainDef ? (vi ? skillDomainDef.hintVi : skillDomainDef.hintEn) : ''}
            </p>
            {!selected || !meta ? (
              <p className="teacher-empty">
                {label(
                  'Chọn bài ở Tri thức để gắn ngữ cảnh môn/lớp/bài.',
                  'Select a Knowledge pack for subject/grade context.',
                )}
              </p>
            ) : (
              <p>
                {label('Ngữ cảnh:', 'Context:')}{' '}
                <strong>
                  {meta.lessonTitle} ({meta.subject} · {meta.grade})
                </strong>
              </p>
            )}
            {skillDomain === 'education' ? (
              <>
                <ul className="teacher-skill-list">
                  {EDU_SKILLS.map((s) => (
                    <li key={s.id} className="teacher-skill-row">
                      <div>
                        <strong>{vi ? s.labelVi : s.labelEn}</strong>
                        <span>{vi ? s.descVi : s.descEn}</span>
                        <em>
                          {eduSkillCategoryLabel(s.category, vi)} · {label('Tốn Token', 'Uses Tokens')}
                        </em>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!!busy || !selected}
                        onClick={() => setConfirmAi({ kind: 'skill', id: s.id })}
                      >
                        {label('Chạy', 'Run')}
                      </button>
                    </li>
                  ))}
                </ul>
                <h3>{label('Workflow nhanh', 'Quick workflows')}</h3>
                <div className="teacher-chip-row">
                  {AI_WORKFLOWS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className="teacher-chip teacher-chip-ai"
                      disabled={!!busy || !selected}
                      onClick={() => setConfirmAi({ kind: 'workflow', id: w.id })}
                    >
                      {vi ? w.labelVi : w.labelEn}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <ul className="teacher-skill-list">
                {domainSkills.map((s) => (
                  <li key={s.id} className="teacher-skill-row">
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
                      onClick={() => setConfirmAi({ kind: 'domain-skill', id: s.id })}
                    >
                      {label('Chạy', 'Run')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary teacher-hub-toggle"
            onClick={() => setShowHub((v) => !v)}
          >
            {showHub
              ? label('Ẩn cấu hình Hub', 'Hide Hub settings')
              : label('Hub Token (tuỳ chọn)', 'Hub Token (optional)')}
          </button>
          {showHub && (
            <div className="teacher-hub teacher-hub-nested">
              <p className="teacher-hint">
                {label(
                  'Gateway OpenAI-compatible. Mở mẫu / xuất zip không trừ Token. OpenRouter cấu hình ở Settings → AI.',
                  'OpenAI-compatible gateway. Templates / zip export do not charge Tokens. Configure OpenRouter in Settings → AI.',
                )}
              </p>
              <div className="teacher-form">
                <label className="teacher-form-wide">
                  <span>Base URL</span>
                  <input
                    value={hubBaseUrl}
                    onChange={(e) => setHubBaseUrl(e.target.value)}
                    placeholder="https://your-hub.example/v1"
                  />
                </label>
                <label className="teacher-form-wide">
                  <span>API Token</span>
                  <input
                    type="password"
                    value={hubToken}
                    onChange={(e) => setHubToken(e.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>{label('Model (tuỳ chọn)', 'Model (optional)')}</span>
                  <input value={hubModel} onChange={(e) => setHubModel(e.target.value)} placeholder="gpt-4o" />
                </label>
              </div>
              {hubStatus && (
                <p className={`teacher-hint${hubOk === false ? ' teacher-error-inline' : ''}`}>{hubStatus}</p>
              )}
              <div className="teacher-chip-row">
                <button className="btn btn-secondary" disabled={hubSaving} onClick={() => void saveHub()}>
                  {hubSaving ? label('Đang lưu…', 'Saving…') : label('Lưu & kiểm tra', 'Save & check')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void probeHub()}>
                  {label('Kiểm tra lại', 'Re-check')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'compose' && (
        <section className="teacher-panel teacher-create" aria-label={label('Soạn mới', 'Compose')}>
          <h2>{label('Soạn bài mới', 'New lesson pack')}</h2>
          <div className="teacher-form">
            <label>
              <span>{label('Môn', 'Subject')}</span>
              <select
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              >
                {EDU_SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{label('Lớp', 'Grade')}</span>
              <select value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}>
                {EDU_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{label('Tuần (tuỳ chọn)', 'Week (optional)')}</span>
              <input
                value={form.week ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, week: e.target.value }))}
                placeholder={label('VD: Tuần 12', 'e.g. Week 12')}
              />
            </label>
            <label>
              <span>{label('Tên bài', 'Lesson title')}</span>
              <input
                value={form.lessonTitle}
                onChange={(e) => setForm((f) => ({ ...f, lessonTitle: e.target.value }))}
                placeholder={label('VD: Phân số', 'e.g. Fractions')}
              />
            </label>
            <label>
              <span>{label('Thời lượng (phút)', 'Duration (min)')}</span>
              <input
                type="number"
                min={15}
                max={120}
                value={form.durationMinutes ?? 45}
                onChange={(e) =>
                  setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) || 45 }))
                }
              />
            </label>
            <label className="teacher-form-wide">
              <span>{label('Thẻ', 'Tags')}</span>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder={label('đại số, ôn tập,…', 'algebra, review,…')}
              />
            </label>
            <label className="teacher-form-wide">
              <span>{label('Mục tiêu / CĐR (mỗi dòng một ý)', 'Objectives (one per line)')}</span>
              <textarea
                rows={3}
                value={objectiveText}
                onChange={(e) => setObjectiveText(e.target.value)}
                placeholder={label('Nhận biết phân số\nSo sánh phân số', 'Identify fractions\nCompare fractions')}
              />
            </label>
          </div>
          {error && tab === 'compose' && <p className="teacher-error">{error}</p>}
          <button className="btn btn-primary" disabled={creating} onClick={() => void submitCreate()}>
            {creating
              ? label('Đang tạo…', 'Creating…')
              : label('Tạo bài vào Tri thức + mở giáo án', 'Create pack + open lesson plan')}
          </button>
        </section>
      )}

      {confirmAi && (
        <div className="modal-overlay" onClick={() => setConfirmAi(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={label('Xác nhận dùng Token AI', 'Confirm AI Token use')}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{label('Dùng Token AI?', 'Use AI Tokens?')}</h3>
            <p>
              {label(
                'Thao tác này sẽ gọi Hub AI và có thể trừ credit/token. Soạn mẫu thủ công thì không bị trừ.',
                'This will call your AI Hub and may spend credits/tokens. Manual templates are free.',
              )}
            </p>
            <div className="modal-buttons">
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmAi(null)}>
                {label('Huỷ', 'Cancel')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (confirmAi.kind === 'skill') void runSkill(confirmAi.id)
                  else if (confirmAi.kind === 'domain-skill') void runDomainSkill(confirmAi.id)
                  else void runAiWorkflow(confirmAi.id)
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
