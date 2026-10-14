import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  type PracticePillarId,
  type SkillDomainId,
} from '@uniwork/practice-core'
import type { ProjectSummaryEntry, UniworkResult, UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkHomeSummary } from '../../shared/uniwork-work-api'
import {
  afterWorkspaceList,
  readActiveWorkspaceId,
  writeActiveWorkspaceId,
  type WorkspaceListState,
} from './active-workspace'
import { onAgentIntentNavigate } from './agent-intent-bus'
import { useI18n, type StringKey, type TFunc } from './locale'
import { SkillDomainTabs } from './SkillDomainTabs'
import { readActiveSkillDomain, readPinnedSkillDomains } from './skill-domain-pins'
import { WorkbenchModulePane } from './WorkbenchModulePanes'
import { MODULE_TONES } from './module-tones'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { WorkToolbar } from './WorkToolbar'
import { WbConfirm } from './WbConfirm'
import { WbToastHost, createWbToasts, type WbToastText } from './WbToastHost'
import { WorkbenchTabs } from './WorkbenchTabs'
import { WorkbenchTopBar, type WorkbenchNewItem } from './WorkbenchTopBar'
import { pinModule, pinPillar } from './workbench-pins'
import { WbDeleteBtn, WbOpenBtn, WbRowActions } from './WbRowActions'
import {
  WB_REFRESH_EVENT,
  cacheWork,
  cachedWork,
  cachedWorkspaceListState,
  settleWork,
  workCacheSlot,
} from './work-cache'
import { tabCounts } from './work-home'
import { WorkStatePanel, WorkspacePickerContext } from './WorkErrorState'
import { DeskView } from './DeskView'

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
  /** the signed-in person's display name ('' when unknown), for the Desk greeting */
  accountName?: string
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

type Msg = string | { key: StringKey; params?: Parameters<TFunc>[1] }

/** what a WbConfirm runs on yes; resolved at that render, so it acts on the pack shown then */
type ConfirmAction =
  | { kind: 'delete-pack' }
  | { kind: 'delete-file'; path: string }
  | { kind: 'run-skill'; skill: 'domain' | 'practice'; id: string }

/** an in-app confirmation waiting for an answer (WbConfirm); keys, translated at render */
interface ConfirmAsk {
  title: Msg
  body?: Msg
  confirm: StringKey
  tone: 'primary' | 'danger'
  action: ConfirmAction
}

/** every skill run spends AI quota: an in-app confirm first (spec 2.3) */
const skillAsk = (skill: 'domain' | 'practice', id: string): ConfirmAsk => ({
  title: { key: 'wbSkConfirmTitle' },
  body: { key: 'wbSkConfirmBody' },
  confirm: 'wbSkConfirmRun',
  tone: 'primary',
  action: { kind: 'run-skill', skill, id },
})

export function PracticeHome({
  practice,
  projects,
  selectedId,
  onSelectPack,
  onOpenPackFiles,
  onRefresh,
  onSwitchPractice,
  newItems,
  accountName = '',
}: PracticeHomeProps): ReactElement {
  const { lang, t } = useI18n()
  // State keeps keys (or raw server text), translated at render so a language switch applies.
  const showMsg = (m: Msg): string => (typeof m === 'string' ? m : t(m.key, m.params))
  const vi = lang === 'vi'
  // notices and errors of the whole page go to its one toast host (spec 3), not a line on top
  const [toasts] = useState(createWbToasts)
  const toastText = (m: Msg): WbToastText => (typeof m === 'string' ? { text: m } : m)
  const setNotice = (m: Msg) => toasts.show({ message: toastText(m) })
  const setError = (m: Msg) => toasts.show({ message: toastText(m), tone: 'alert' })
  const [ask, setAsk] = useState<ConfirmAsk | null>(null)
  const packListRef = useRef<HTMLUListElement>(null)

  // starts from this bucket's cached list (this pane remounts whenever the user returns
  // to the Workbench), then one load per mount plus Refresh
  const [wsState, setWsState] = useState<WorkspaceListState>(cachedWorkspaceListState)
  const { workspaces, workspaceId, workspaceError } = wsState
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const [refreshTick, setRefreshTick] = useState(0)
  // set by the Overview when its summary changes, only to redraw the tab counts (they read the cache)
  const [, setHomeSummary] = useState<WorkHomeSummary | null>(null)

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
  // a lost-access panel's "Choose another workspace": focus the chip's select and open its list
  const workspaceRef = useRef<HTMLSelectElement>(null)
  const pickWorkspace = () => {
    const select = workspaceRef.current
    if (!select) return
    select.focus()
    try {
      select.showPicker?.()
    } catch {
      // no user activation or no picker support: the focused chip is enough
    }
  }

  // a write in the Tasks tab moves the tab counts: reload the summary they read from the cache
  const homeSeq = useRef(0)
  const reloadHomeSummary = () => {
    if (!workspace) return
    const mine = ++homeSeq.current
    const slot = workCacheSlot(`home:${workspace.id}`)
    void settleWork(window.uniworkWork.homeSummary(workspace.id)).then((r) => {
      if (mine !== homeSeq.current || !r.ok) return // a newer reload is on its way
      cacheWork(slot, r.value)
      setHomeSummary(r.value)
    })
  }

  const refresh = () => {
    window.dispatchEvent(new Event(WB_REFRESH_EVENT))
    onRefresh()
    setRefreshTick((n) => n + 1)
  }

  const openDeskTab = (id: 'tasks' | 'forms') => {
    // Forms is opt-in on the tab bar; the Desk's "Manage" pins it first
    if (id === 'forms') {
      pinModule(practice.id, 'forms')
      window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
    }
    setTab(id)
  }

  const [tab, setTab] = useState<string>('desk')
  const [qQuery, setQQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
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
        toasts.show({ message: { key: 'wbSkOpenedNeedPack' } })
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
        toasts.show({ message: { key: 'wbSkOpenedPick' } })
        return
      }
      const isPractice = roleSkills.some((s) => s.id === hit.id)
      setAsk(skillAsk(isPractice ? 'practice' : 'domain', hit.id))
    }
    window.addEventListener('uniwork:wb-open-module', openMod)
    window.addEventListener('uniwork:agent-run-skill', onRunSkill)
    return () => {
      window.removeEventListener('uniwork:wb-open-module', openMod)
      window.removeEventListener('uniwork:agent-run-skill', onRunSkill)
    }
  }, [roleSkills, domainSkills, hasSelectedPack, lang, practice.id, toasts])

  useEffect(() => {
    return onAgentIntentNavigate((tabId, intent) => {
      setTab(tabId)
      if (intent.target.kind === 'skill-domain') {
        setSkillDomain(intent.target.id)
      }
      toasts.show({ message: { key: 'wbAgentApplied' } })
    })
  }, [lang, toasts])

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
  // the Desk drawer's pack chip lists every pack of this role (the Knowledge search does not apply)
  const deskPacks = useMemo(
    () =>
      projects
        .filter((p) => p.kind === practice.projectKind && !!p.practice)
        .flatMap((p) => {
          const m = toPracticeMeta(p, practice.id)
          return m ? [{ id: p.id, title: m.title }] : []
        }),
    [projects, practice.id, practice.projectKind],
  )
  // where Soạn from a form goes (Desk drawer and Forms): the selected pack, else the default one
  const draftPackId = selectedId ?? projects.find((p) => p.isDefault)?.id ?? null
  const pillar = practice.pillars.find((p) => p.id === tab)
  const pillarTitleId = useId()
  /** a pillar's empty sentence on the shared state template (spec 5): its tinted tile and one line */
  const pillarState = (id: PracticePillarId, title: StringKey) => (
    <WorkStatePanel
      tone={MODULE_TONES[id]}
      icon={<WorkbenchIcon id={id} size={20} />}
      title={t(title)}
    />
  )

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

  // the confirm string is "question\nconsequence": the title and the line of an in-app confirm
  const confirmFrom = (key: StringKey, params: Parameters<TFunc>[1]) => {
    const [title, ...rest] = t(key, params).split('\n')
    return { title: title ?? '', body: rest.join(' ') || undefined }
  }

  const deletePack = () => {
    if (!selected) return
    const text = confirmFrom('wbKnDeletePackConfirm', { title: meta?.title ?? selected.name })
    setAsk({
      title: text.title,
      body: text.body,
      confirm: 'wbKnDeletePack',
      tone: 'danger',
      action: { kind: 'delete-pack' },
    })
  }

  const removePack = async () => {
    if (!selected) return
    setBusy('delete-pack')
    try {
      await window.aiOfficeProject!.deleteProject(selected.id)
      onSelectPack(null)
      onRefresh()
      setNotice({ key: 'wbKnPackDeleted' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const deleteMaterialFile = (filePath: string) => {
    if (!selected) return
    const base = filePath.split(/[/\\]/).pop() || filePath
    setAsk({
      title: { key: 'wbMatDeleteFileConfirm', params: { name: base } },
      confirm: 'wbCommonDelete',
      tone: 'danger',
      action: { kind: 'delete-file', path: filePath },
    })
  }

  const removeMaterialFile = async (filePath: string) => {
    if (!selected) return
    setBusy(`del-file:${filePath}`)
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
    const title = titleDraft.trim()
    if (!title) {
      setError({ key: 'wbCmpTitleRequired' })
      return
    }
    for (const f of practice.facets) {
      if (f.id === practice.titleFacetId) continue
      if (f.required && !(facetDraft[f.id] ?? '').trim()) {
        setError({ key: 'wbCmpMissing', params: { field: vi ? f.labelVi : f.labelEn } })
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
      setNotice({ key: 'wbCmpCreated' })
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
      setNotice({ key: 'wbKnSaved' })
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
      setNotice({ key: 'wbMatRoleAdded', params: { role: vi ? roleDef.labelVi : roleDef.labelEn } })
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
      setNotice({ key: 'wbSkRan', params: { skill: vi ? skill.labelVi : skill.labelEn } })
    } finally {
      setBusy(null)
    }
  }

  const runPracticeSkill = async (skillId: string) => {
    if (!selected || !meta) return
    const skill = roleSkills.find((s) => s.id === skillId)
    if (!skill) return
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
      setNotice({ key: 'wbSkRanRole', params: { skill: vi ? skill.labelVi : skill.labelEn } })
    } finally {
      setBusy(null)
    }
  }

  const runAsk = (a: ConfirmAction) => {
    if (a.kind === 'delete-pack') void removePack()
    else if (a.kind === 'delete-file') void removeMaterialFile(a.path)
    else void (a.skill === 'practice' ? runPracticeSkill(a.id) : runDomainSkill(a.id))
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
      setNotice({ key: 'wbMatChainOpened' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="content wb-home">
      <WbToastHost toasts={toasts}>
        <WorkbenchTopBar
          practice={practice}
          onSwitchPractice={onSwitchPractice}
          workspaces={workspaces ?? []}
          workspaceId={workspaceId}
          onSelectWorkspace={selectWorkspace}
          workspaceRef={workspaceRef}
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
          counts={tabCounts(
            workspace ? (cachedWork<WorkHomeSummary>(`home:${workspace.id}`)?.value ?? null) : null,
          )}
          onPinsChange={(pins, pillarPins) => {
            if (isWorkbenchModuleId(tab) && !pins.includes(tab)) setTab('desk')
            if (isPracticePillarId(tab) && !pillarPins.includes(tab)) setTab('desk')
          }}
        />

        <WorkspacePickerContext.Provider value={pickWorkspace}>
          {tab === 'desk' ? (
            <DeskView
              practiceId={practice.id}
              vi={vi}
              workspaces={workspaces}
              workspaceId={workspaceId}
              workspaceError={workspaceError}
              refreshTick={refreshTick}
              packId={draftPackId}
              onReload={refresh}
              onSummary={setHomeSummary}
              onOpenTab={openDeskTab}
              onPackLinked={onRefresh}
              userName={accountName}
              packs={deskPacks}
              selectedPackId={selectedId}
              onSelectPack={onSelectPack}
            />
          ) : isWorkbenchModuleId(tab) ? (
            <WorkbenchModulePane
              moduleId={tab}
              practiceId={practice.id}
              vi={vi}
              contextTitle={meta?.title}
              packId={draftPackId}
              packs={deskPacks}
              selectedPackId={selectedId}
              onSelectPack={onSelectPack}
              onPackLinked={onRefresh}
              workspace={workspace}
              workspaceError={workspaceError}
              onReload={refresh}
              onTasksWritten={reloadHomeSummary}
              loading={workspaces === null}
            />
          ) : null}
        </WorkspacePickerContext.Provider>

        {pillar ? (
          <WorkToolbar
            title={vi ? pillar.labelVi : pillar.labelEn}
            titleId={pillarTitleId}
            summary={
              pillar.id === 'knowledge'
                ? t('wbKnCount', { count: packs.length })
                : `${vi ? pillar.hintVi : pillar.hintEn}${meta?.title ? ` · ${meta.title}` : ''}`
            }
            local
          />
        ) : null}

        {tab === 'knowledge' && (
          <section className="wb-pane" aria-labelledby={pillarTitleId} tabIndex={-1}>
            <label className="wb-kn-search">
              <WbGlyph id="search" size={14} />
              <input
                className="wb-input"
                type="search"
                value={qQuery}
                onChange={(e) => setQQuery(e.target.value)}
                aria-label={t('wbKnSearch')}
                placeholder={t('wbKnSearchPlaceholder')}
              />
            </label>
            <div className="wb-layout">
              <section className="wb-packs">
                <h3>
                  {t('wbKnLibrary')}
                  <span className="wb-count wb-num">{packs.length}</span>
                </h3>
                {packs.length === 0 ? (
                  pillarState('knowledge', 'wbKnEmpty')
                ) : (
                  <ul className="wb-pack-list" ref={packListRef} tabIndex={-1}>
                    {packs.map(({ entry, meta: m }) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className={`wb-pack-item${entry.id === selectedId ? ' active' : ''}`}
                          onClick={() => onSelectPack(entry.id === selectedId ? null : entry.id)}
                        >
                          <strong>{m.title}</strong>
                          <span>{Object.values(m.facets).filter(Boolean).join(' · ')}</span>
                          <em className="wb-num">
                            {entry.fileCount} {t('wbKnFiles')}
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
                    <h3>{meta.title}</h3>
                    <p>{Object.values(meta.facets).filter(Boolean).join(' · ')}</p>
                    <div className="wb-chip-row">
                      <button
                        type="button"
                        className="wb-btn wb-btn-secondary"
                        onClick={() => {
                          pinPillar(practice.id, 'materials')
                          window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
                          setTab('materials')
                        }}
                      >
                        {t('wbCommonMaterials')}
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-secondary"
                        onClick={() => onOpenPackFiles(selected.id)}
                      >
                        {t('wbKnViewFiles')}
                      </button>
                      <button
                        type="button"
                        className="wb-btn wb-btn-secondary"
                        disabled={busy === 'delete-pack'}
                        onClick={deletePack}
                      >
                        {t('wbKnDeletePack')}
                      </button>
                    </div>
                    <div className="wb-form wb-form-spaced">
                      <label className="wb-form-wide">
                        <span>{t('wbCommonTags')}</span>
                        <input
                          className="wb-input"
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                        />
                      </label>
                      <label className="wb-form-wide">
                        <span>{t('wbCommonNotes')}</span>
                        <textarea
                          className="wb-input"
                          rows={3}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary"
                      disabled={!!busy}
                      onClick={() => void saveMeta()}
                    >
                      {t('wbCommonSave')}
                    </button>
                  </>
                ) : (
                  pillarState('knowledge', 'wbKnSelectPack')
                )}
              </aside>
            </div>
          </section>
        )}

        {tab === 'materials' && (
          <section className="wb-pane" aria-labelledby={pillarTitleId} tabIndex={-1}>
            {!selected || !meta ? (
              pillarState('materials', 'wbMatSelectPackFirst')
            ) : (
              <>
                {packFiles.length === 0 ? (
                  pillarState('materials', 'wbMatEmpty')
                ) : (
                  <ul className="wb-material-list">
                    {packFiles.map((fp) => {
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
                              label={t('wbCommonOpen')}
                              onClick={() => void window.aiOffice.openPath(fp)}
                            />
                            <WbDeleteBtn
                              label={t('wbCommonDelete')}
                              disabled={busy === `del-file:${fp}`}
                              onClick={() => deleteMaterialFile(fp)}
                            />
                          </WbRowActions>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="wb-add-row">
                  <label>
                    <span>{t('wbMatAdd')}</span>
                    <select
                      className="wb-input"
                      value={addRole}
                      onChange={(e) => setAddRole(e.target.value)}
                    >
                      {practice.materialRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {vi ? r.labelVi : r.labelEn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="wb-btn wb-btn-primary"
                    disabled={!!busy}
                    onClick={() => void addMaterial()}
                  >
                    {t('wbMatAddOpen')}
                  </button>
                </div>
                <p className="wb-hint">{t('wbMatQuickCreateHint')}</p>
                <div className="wb-chip-row">
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary wb-btn-sm"
                    disabled={!!busy}
                    onClick={() => void window.aiOffice.newDoc({ projectId: selected.id })}
                  >
                    Docs
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary wb-btn-sm"
                    disabled={!!busy}
                    onClick={() => void window.aiOffice.newSheet({ projectId: selected.id })}
                  >
                    Sheets
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary wb-btn-sm"
                    disabled={!!busy}
                    onClick={() => void window.aiOffice.newSlide({ projectId: selected.id })}
                  >
                    Slides
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary wb-btn-sm"
                    disabled={!!busy}
                    onClick={() => void window.aiOffice.newPdf({ projectId: selected.id })}
                  >
                    PDF
                  </button>
                </div>
                <h3>{t('wbMatQuickTemplates')}</h3>
                <div className="wb-chip-row">
                  {practice.templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="wb-btn wb-btn-secondary wb-btn-sm"
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
                      className="wb-btn wb-btn-secondary"
                      disabled={!!busy}
                      onClick={() => void openFreeChain()}
                    >
                      {t('wbMatOpenChain')}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}

        {tab === 'skills' && (
          <section className="wb-pane" aria-labelledby={pillarTitleId} tabIndex={-1}>
            {!selected || !meta ? (
              pillarState('skills', 'wbSkNeedPack')
            ) : (
              <p>
                {t('wbSkContext')} <strong>{meta.title}</strong>
              </p>
            )}

            {roleSkills.length > 0 ? (
              <>
                <h3>{t('wbSkRoleSkills')}</h3>
                <p className="wb-hint">{t('wbSkRoleHint')}</p>
                <ul className="wb-skill-list">
                  {roleSkills.map((s) => (
                    <li key={s.id} className="wb-skill-row">
                      <div>
                        <strong>{vi ? s.labelVi : s.labelEn}</strong>
                        <span>{vi ? s.descVi : s.descEn}</span>
                        <em>
                          {s.category} · {t('wbCommonUsesTokens')}
                        </em>
                      </div>
                      <button
                        type="button"
                        className="wb-btn wb-btn-primary wb-btn-sm"
                        disabled={!!busy || !selected}
                        onClick={() => setAsk(skillAsk('practice', s.id))}
                      >
                        {t('wbCommonRun')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h3>{t('wbSkDomainSkills')}</h3>
            <p className="wb-hint">{t('wbSkDomainHint')}</p>
            <SkillDomainTabs vi={vi} active={skillDomain} onSelect={setSkillDomain} />
            <div className="skill-domain-panel">
              <h3>
                {skillDomainDef
                  ? vi
                    ? skillDomainDef.labelVi
                    : skillDomainDef.labelEn
                  : t('wbCommonSkills')}
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
                        {s.category} · {t('wbCommonUsesTokens')}
                      </em>
                    </div>
                    <button
                      type="button"
                      className="wb-btn wb-btn-primary wb-btn-sm"
                      disabled={!!busy || !selected}
                      onClick={() => setAsk(skillAsk('domain', s.id))}
                    >
                      {t('wbCommonRun')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'compose' && (
          <section className="wb-block wb-cmp" aria-labelledby={pillarTitleId}>
            <div className="wb-form">
              {practice.facets.map((f) => {
                if (f.id === practice.titleFacetId) {
                  return (
                    <label key={f.id} className="wb-form-wide">
                      <span>{vi ? f.labelVi : f.labelEn}</span>
                      <input
                        className="wb-input"
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
                        className="wb-input"
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
                        className="wb-input"
                        value={facetDraft[f.id] ?? ''}
                        onChange={(e) => setFacetDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                        placeholder={vi ? f.placeholderVi : f.placeholderEn}
                      />
                    )}
                  </label>
                )
              })}
              <label className="wb-form-wide">
                <span>{t('wbCommonTags')}</span>
                <input
                  className="wb-input"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="wb-btn wb-btn-primary"
              disabled={busy === 'create'}
              onClick={() => void submitCreate()}
            >
              {busy === 'create' ? t('wbCmpCreating') : t('wbCmpCreate')}
            </button>
          </section>
        )}

        {ask ? (
          <WbConfirm
            title={showMsg(ask.title)}
            body={ask.body ? showMsg(ask.body) : undefined}
            confirmLabel={t(ask.confirm)}
            cancelLabel={t('wbCommonCancel')}
            tone={ask.tone}
            onCancel={() => setAsk(null)}
            // a deleted pack takes its Delete button with it: focus lands on the pack list
            returnFocus={ask.action.kind === 'delete-pack' ? () => packListRef.current : undefined}
            onConfirm={() => {
              setAsk(null)
              runAsk(ask.action)
            }}
          />
        ) : null}
      </WbToastHost>
    </main>
  )
}
