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
  type PracticeFacetDef,
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
import { WbMenuButton } from './WbMenu'
import { WbPackChip } from './DeskDrawer'
import { FileBadge } from './FileBadge'
import { WbToastHost, createWbToasts, type WbToastText } from './WbToastHost'
import { WorkbenchTabs } from './WorkbenchTabs'
import { WorkbenchTopBar, type WorkbenchNewItem } from './WorkbenchTopBar'
import { pinModule, pinPillar } from './workbench-pins'
import { WbRowActions } from './WbRowActions'
import {
  WB_REFRESH_EVENT,
  cacheWork,
  cachedWork,
  cachedWorkspaceListState,
  settleWork,
  workCacheSlot,
} from './work-cache'
import { tabCounts } from './work-home'
import {
  WorkErrorState,
  WorkSkeleton,
  WorkStatePanel,
  WorkspacePickerContext,
} from './WorkErrorState'
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

/** what a WbConfirm runs on yes; a pack delete carries the pack it names, whatever is selected by then */
type ConfirmAction =
  | { kind: 'delete-pack'; id: string }
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

/** every skill run spends AI quota: an in-app confirm first (spec 4.9); the title names the
 *  skill and the pack at render */
const skillAsk = (skill: 'domain' | 'practice', id: string): ConfirmAsk => ({
  title: { key: 'wbSkConfirmTitle' },
  body: { key: 'wbSkConfirmBody' },
  confirm: 'wbCommonRun',
  tone: 'primary',
  action: { kind: 'run-skill', skill, id },
})

/** the skill catalogue's category keys ("ho-so", "bao-gia" …) as UI strings; an unknown key shows no pill */
const SKILL_CATEGORY: Record<string, StringKey> = {
  ai: 'wbSkCat_ai',
  'bao-cao': 'wbSkCat_bao_cao',
  'bao-gia': 'wbSkCat_bao_gia',
  brief: 'wbSkCat_brief',
  'chao-gia': 'wbSkCat_chao_gia',
  'cham-soc': 'wbSkCat_cham_soc',
  'cong-van': 'wbSkCat_cong_van',
  'danh-gia': 'wbSkCat_danh_gia',
  'de-xuat': 'wbSkCat_de_xuat',
  faq: 'wbSkCat_faq',
  'ghi-chep': 'wbSkCat_ghi_chep',
  'giam-sat': 'wbSkCat_giam_sat',
  'ho-so': 'wbSkCat_ho_so',
  hop: 'wbSkCat_hop',
  'hop-dong': 'wbSkCat_hop_dong',
  'ke-hoach': 'wbSkCat_ke_hoach',
  'khieu-nai': 'wbSkCat_khieu_nai',
  lich: 'wbSkCat_lich',
  'muc-tieu': 'wbSkCat_muc_tieu',
  'nghiem-thu': 'wbSkCat_nghiem_thu',
  'phan-hoi': 'wbSkCat_phan_hoi',
  pitch: 'wbSkCat_pitch',
  'rui-ro': 'wbSkCat_rui_ro',
  'theo-doi': 'wbSkCat_theo_doi',
  'thu-tin': 'wbSkCat_thu_tin',
  'thuyet-minh': 'wbSkCat_thuyet_minh',
  'to-trinh': 'wbSkCat_to_trinh',
  'tu-van': 'wbSkCat_tu_van',
  'tuyen-dung': 'wbSkCat_tuyen_dung',
  'vu-viec': 'wbSkCat_vu_viec',
}

/** Materials' quick-create tiles: a blank file of each kind in the pack (spec 4.8) */
const BLANKS: readonly {
  ext: string
  label: StringKey
  open: (projectId: string) => Promise<void>
}[] = [
  {
    ext: 'docx',
    label: 'wbMatBlankDoc',
    open: (projectId) => window.aiOffice.newDoc({ projectId }),
  },
  {
    ext: 'xlsx',
    label: 'wbMatBlankSheet',
    open: (projectId) => window.aiOffice.newSheet({ projectId }),
  },
  {
    ext: 'pptx',
    label: 'wbMatBlankSlides',
    open: (projectId) => window.aiOffice.newSlide({ projectId }),
  },
  {
    ext: 'pdf',
    label: 'wbMatBlankPdf',
    open: (projectId) => window.aiOffice.newPdf({ projectId }),
  },
]

const baseName = (path: string) => path.split(/[/\\]/).pop() || path
const extOf = (path: string) => /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
const splitTags = (text: string) =>
  text
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)

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
  /** a create or run that failed: what failed, the reason, and Retry where one is safe */
  const failed = (
    key: StringKey,
    params: Record<string, string>,
    err: unknown,
    retry?: () => void,
  ) =>
    toasts.show({
      message: {
        key,
        params: { ...params, error: err instanceof Error ? err.message : String(err) },
      },
      tone: 'alert',
      ...(retry ? { actions: [{ label: 'acctRetry' as const, onClick: retry }] } : {}),
    })
  // the selection now, for a delete that finishes after the user picked another pack
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [ask, setAsk] = useState<ConfirmAsk | null>(null)
  const packListRef = useRef<HTMLUListElement>(null)
  const paneRef = useRef<HTMLElement>(null)

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
  const [cmpNotes, setCmpNotes] = useState('')
  // Compose fields left empty on submit: a line under each, the first one focused (spec 4.10)
  const [cmpErrors, setCmpErrors] = useState<ReadonlySet<string>>(() => new Set())
  const [noteDraft, setNoteDraft] = useState('')
  const [tagList, setTagList] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  // null while the pack's file list loads, 'error' when it could not be read (never shown as empty)
  const [packFiles, setPackFiles] = useState<string[] | 'error' | null>(null)
  const [filesTick, setFilesTick] = useState(0)
  const ids = useId()

  // Declared before effects that depend on it (avoids TDZ crash when opening Workbench).
  const selected = projects.find((p) => p.id === selectedId) ?? null
  const meta = selected ? toPracticeMeta(selected, practice.id) : null
  const hasSelectedPack = !!selected

  const resetCompose = () => {
    const init: Record<string, string> = {}
    for (const f of practice.facets) {
      if (f.id === practice.titleFacetId) continue
      init[f.id] = f.options?.[0] ?? ''
    }
    setFacetDraft(init)
    setTitleDraft('')
    setTagsText('')
    setCmpNotes('')
    setCmpErrors(new Set())
  }

  useEffect(() => {
    resetCompose()
    setTab('desk')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new role starts a blank form
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
  // the Desk drawer's pack chip lists every pack of this role (the Knowledge search does not apply),
  // most recently active first, as Knowledge lists them
  const deskPacks = useMemo(
    () =>
      projects
        .filter((p) => p.kind === practice.projectKind && !!p.practice)
        .sort((a, b) => (b.lastActiveAt > a.lastActiveAt ? 1 : -1))
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
  const pillarLabel = pillar ? (vi ? pillar.labelVi : pillar.labelEn) : ''
  /** a pillar's state on the shared template (spec 4.11): its tinted tile, one line, an action */
  const pillarState = (
    id: PracticePillarId,
    title: string,
    opts: { action?: { label: string; onClick: () => void }; compact?: boolean } = {},
  ) => (
    <WorkStatePanel
      tone={MODULE_TONES[id]}
      icon={<WorkbenchIcon id={id} size={20} />}
      title={title}
      action={opts.action ? { ...opts.action, variant: 'secondary' } : undefined}
      compact={opts.compact}
    />
  )
  /** pin a pillar tab (it may be unpinned) and show it */
  const openPillar = (id: PracticePillarId) => {
    pinPillar(practice.id, id)
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
    setTab(id)
  }

  // keyed on the stored values, not the array: a refresh hands over a new array with the same
  // tags, and that must not throw away unsaved edits
  const storedTags = (meta?.tags ?? []).join('\n')
  useEffect(() => {
    setNoteDraft(meta?.notes ?? '')
    setTagList(storedTags ? storedTags.split('\n') : [])
    setTagInput('')
  }, [selected?.id, meta?.notes, storedTags])

  // a new pack shows its skeleton; a reload of the same pack keeps the list until it answers
  useEffect(() => setPackFiles(null), [selectedId])
  useEffect(() => {
    if (!selectedId || !window.aiOfficeProject) {
      setPackFiles([])
      return
    }
    let live = true
    window.aiOfficeProject.listFiles(selectedId).then(
      (files) => live && setPackFiles(files),
      () => live && setPackFiles('error'),
    )
    return () => {
      live = false
    }
  }, [selectedId, selected?.fileCount, filesTick])
  const retryFiles = () => {
    setPackFiles(null)
    setFilesTick((n) => n + 1)
  }
  const files = Array.isArray(packFiles) ? packFiles : []

  // the pack's tags as chips plus whatever is typed and not yet entered (Save keeps that too)
  const tagsNow = [...tagList, ...splitTags(tagInput).filter((x) => !tagList.includes(x))]
  const metaDirty =
    !!meta &&
    (noteDraft !== (meta.notes ?? '') || tagsNow.join('\n') !== (meta.tags ?? []).join('\n'))
  const addTags = () => {
    setTagList(tagsNow)
    setTagInput('')
  }
  const discardMeta = () => {
    setNoteDraft(meta?.notes ?? '')
    setTagList(meta?.tags ?? [])
    setTagInput('')
  }

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
      action: { kind: 'delete-pack', id: selected.id },
    })
  }

  // deleting the last pack unmounts the list the confirm handed focus to: the pane takes it
  const hadPacks = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    if (hadPacks.current && deskPacks.length === 0 && (!active || active === document.body)) {
      paneRef.current?.focus()
    }
    hadPacks.current = deskPacks.length > 0
  }, [deskPacks.length])

  const removePack = async (id: string) => {
    setBusy('delete-pack')
    try {
      await window.aiOfficeProject!.deleteProject(id)
      if (selectedIdRef.current === id) onSelectPack(null)
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
    setAsk({
      title: { key: 'wbMatDeleteFileConfirm', params: { name: baseName(filePath) } },
      body: { key: 'wbMatDeleteFileBody' },
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

  // Compose, in the order the form shows it: the title, the free-text facets, then the choices
  const titleFacet = practice.facets.find((f) => f.id === practice.titleFacetId)
  const textFacets = practice.facets.filter((f) => f.id !== practice.titleFacetId && !f.options)
  const choiceFacets = practice.facets.filter((f) => f.id !== practice.titleFacetId && f.options)
  const cmpOrder = [...(titleFacet ? [titleFacet] : []), ...textFacets, ...choiceFacets]
  const cmpFieldId = (facetId: string) => `${ids}-cmp-${facetId}`

  /** the new pack's first document, from the role's first template (the toast's action) */
  const draftFirstDoc = async (created: ProjectSummaryEntry) => {
    const createdMeta = toPracticeMeta(created, practice.id)
    const seedRole = practice.templates[0]?.materialRole ?? practice.materialRoles[0]?.id
    if (!createdMeta || !seedRole) return
    try {
      const roleDef = practice.materialRoles.find((r) => r.id === seedRole)
      if (roleDef?.app === 'slides') {
        await window.aiOffice.newSlide({ projectId: created.id })
      } else if (roleDef?.app === 'sheets') {
        await window.aiOffice.newSheet({ projectId: created.id })
      } else {
        const html = practiceMaterialSeedHtml(
          seedRole,
          vi ? (roleDef?.labelVi ?? seedRole) : (roleDef?.labelEn ?? seedRole),
          createdMeta,
        )
        await openDocs(created.id, `${roleDef?.labelVi ?? seedRole} — ${createdMeta.title}`, html)
      }
      await rememberRole(created.id, seedRole)
    } catch (err) {
      failed('wbMatCreateFailed', {}, err, () => void draftFirstDoc(created))
    }
  }

  const submitCreate = async () => {
    const title = titleDraft.trim()
    const missing = cmpOrder
      .filter((f) =>
        f.id === practice.titleFacetId ? !title : f.required && !(facetDraft[f.id] ?? '').trim(),
      )
      .map((f) => f.id)
    setCmpErrors(new Set(missing))
    if (missing[0]) {
      document.getElementById(cmpFieldId(missing[0]))?.focus()
      return
    }
    setBusy('create')
    try {
      const notes = cmpNotes.trim()
      const created = await window.aiOfficeProject!.createPracticeProject({
        practiceId: practice.id,
        title,
        facets: facetDraft,
        tags: splitTags(tagsText),
        ...(notes ? { notes } : {}),
      })
      onRefresh()
      // no blank document opens by itself (spec 5.2): the new pack is selected in Knowledge
      onSelectPack(created.id)
      setQQuery('')
      resetCompose()
      openPillar('knowledge')
      toasts.show({
        id: `cmp-created:${created.id}`,
        message: { key: 'wbCmpCreated', params: { title } },
        actions: [{ label: 'wbCmpFirstDoc', onClick: () => void draftFirstDoc(created) }],
      })
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
      const tags = tagsNow
      await window.aiOfficeProject!.patchPracticeMeta({
        projectId: selected.id,
        patch: { notes: noteDraft, tags },
      })
      setTagList(tags)
      setTagInput('')
      onRefresh()
      setNotice({ key: 'wbKnSaved' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const addMaterial = async (addRole: string) => {
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
    } catch (err) {
      failed('wbMatCreateFailed', {}, err, () => void addMaterial(addRole))
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
    } catch (err) {
      failed('wbMatCreateFailed', {}, err, () => void openTemplate(templateId))
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
    } catch (err) {
      // Retry asks again: a run spends AI credit
      failed('wbSkRunFailed', { skill: vi ? skill.labelVi : skill.labelEn }, err, () =>
        setAsk(skillAsk('domain', skillId)),
      )
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
    } catch (err) {
      failed('wbSkRunFailed', { skill: vi ? skill.labelVi : skill.labelEn }, err, () =>
        setAsk(skillAsk('practice', skillId)),
      )
    } finally {
      setBusy(null)
    }
  }

  const openBlank = (b: (typeof BLANKS)[number], projectId: string): Promise<void> =>
    b
      .open(projectId)
      .catch((err: unknown) =>
        failed('wbMatCreateFailed', {}, err, () => void openBlank(b, projectId)),
      )

  const runAsk = (a: ConfirmAction) => {
    if (a.kind === 'delete-pack') void removePack(a.id)
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
    } catch (err) {
      // no Retry: the documents before the failure exist, a rerun would open them twice
      failed('wbMatCreateFailed', {}, err)
    } finally {
      setBusy(null)
    }
  }

  const skillName = (a: { skill: 'domain' | 'practice'; id: string }) => {
    const s = a.skill === 'practice' ? roleSkills.find((x) => x.id === a.id) : getDomainSkill(a.id)
    return s ? (vi ? s.labelVi : s.labelEn) : a.id
  }

  /** a skill row (spec 4.9): spark tile, name, description, translated category, secondary Run */
  const skillRow = (
    kind: 'domain' | 'practice',
    s: {
      id: string
      category: string
      labelVi: string
      labelEn: string
      descVi: string
      descEn: string
    },
  ) => {
    const category = SKILL_CATEGORY[s.category]
    const nameId = `${ids}-sk-${s.id}`
    return (
      <li key={s.id} className="wb-row wb-sk-row">
        <WorkbenchIcon id="skills" size={28} />
        <div className="wb-sk-text">
          <span className="wb-sk-name" id={nameId}>
            {vi ? s.labelVi : s.labelEn}
          </span>
          <span className="wb-sk-desc">{vi ? s.descVi : s.descEn}</span>
        </div>
        {category ? <span className="wb-pill">{t(category)}</span> : null}
        <button
          type="button"
          className="wb-btn wb-btn-secondary wb-btn-sm"
          aria-describedby={nameId}
          disabled={!!busy || !selected}
          onClick={() => setAsk(skillAsk(kind, s.id))}
        >
          <WbGlyph id="spark" />
          {t('wbCommonRun')}
        </button>
      </li>
    )
  }

  /** one Compose field: label (* when required), input or select, and its error line */
  const cmpField = (f: PracticeFacetDef) => {
    const isTitle = f.id === practice.titleFacetId
    const id = cmpFieldId(f.id)
    const bad = cmpErrors.has(f.id)
    const set = (v: string) => {
      if (isTitle) setTitleDraft(v)
      else setFacetDraft((d) => ({ ...d, [f.id]: v }))
      if (bad) setCmpErrors((e) => new Set([...e].filter((x) => x !== f.id)))
    }
    const common = {
      id,
      className: 'wb-input',
      value: isTitle ? titleDraft : (facetDraft[f.id] ?? ''),
      'aria-invalid': bad || undefined,
      'aria-describedby': bad ? `${id}-err` : undefined,
      'aria-required': isTitle || f.required || undefined,
    }
    return (
      <div key={f.id} className="wb-field">
        <label className="wb-field-label" htmlFor={id}>
          {vi ? f.labelVi : f.labelEn}
          {isTitle || f.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {f.options ? (
          <select {...common} onChange={(e) => set(e.target.value)}>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            onChange={(e) => set(e.target.value)}
            placeholder={vi ? f.placeholderVi : f.placeholderEn}
          />
        )}
        {bad ? (
          <span className="wb-field-error" id={`${id}-err`}>
            {t('wbCmpRequired')}
          </span>
        ) : null}
      </div>
    )
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

        {/* "Choose another workspace" only when the chip is there and offers another one */}
        <WorkspacePickerContext.Provider
          value={workspace && workspaces?.some((w) => w.id !== workspace.id) ? pickWorkspace : null}
        >
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

        {tab === 'knowledge' && (
          <>
            <WorkToolbar
              title={pillarLabel}
              titleId={pillarTitleId}
              lead={
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
              }
              summary={t('wbKnCount', { count: packs.length })}
              local
              actions={
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary"
                  onClick={() => openPillar('compose')}
                >
                  <WbGlyph id="plus" />
                  {t('wbKnNewPack')}
                </button>
              }
            />
            <section
              ref={paneRef}
              className="wb-pane"
              aria-labelledby={pillarTitleId}
              tabIndex={-1}
            >
              {deskPacks.length === 0 ? (
                pillarState('knowledge', t('wbKnEmpty'), {
                  action: { label: t('wbKnCreateFirst'), onClick: () => openPillar('compose') },
                })
              ) : (
                <div className="wb-kn">
                  <section className="wb-block wb-kn-list" aria-label={t('wbKnLibrary')}>
                    {packs.length === 0 ? (
                      <WorkStatePanel
                        compact
                        tone={MODULE_TONES.knowledge}
                        icon={<WbGlyph id="search" />}
                        title={t('wbKnNoMatch', { q: qQuery.trim() })}
                        action={{
                          label: t('wbKnClearSearch'),
                          onClick: () => setQQuery(''),
                          variant: 'secondary',
                        }}
                      />
                    ) : (
                      <ul className="wb-pack-list" ref={packListRef} tabIndex={-1}>
                        {packs.map(({ entry, meta: m }) => (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className={`wb-pack-item${entry.id === selectedId ? ' active' : ''}`}
                              aria-current={entry.id === selectedId ? 'true' : undefined}
                              // a second click keeps the pack: no hidden "click again to clear" (spec 5.4)
                              onClick={() => onSelectPack(entry.id)}
                            >
                              <span className="wb-pack-text">
                                <span className="wb-pack-title">{m.title}</span>
                                <span className="wb-row-sub">
                                  {Object.values(m.facets).filter(Boolean).join(' · ')}
                                </span>
                              </span>
                              <span className="wb-pill">
                                {entry.fileCount
                                  ? t('wbKnFileCount', { count: entry.fileCount })
                                  : t('wbKnNoFiles')}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section
                    className="wb-block wb-kn-detail"
                    aria-labelledby={selected && meta ? `${ids}-kn-title` : undefined}
                  >
                    {selected && meta ? (
                      <>
                        <div className="wb-kn-head">
                          <div className="wb-kn-head-text">
                            <h3 className="wb-kn-title" id={`${ids}-kn-title`}>
                              {meta.title}
                            </h3>
                            <div className="wb-kn-facets">
                              {Object.entries(meta.facets)
                                .filter(([, v]) => !!v)
                                .map(([id, v]) => (
                                  <span key={id} className="wb-pill">
                                    {v}
                                  </span>
                                ))}
                            </div>
                          </div>
                          <div className="wb-kn-head-actions">
                            <button
                              type="button"
                              className="wb-btn wb-btn-secondary wb-btn-sm"
                              onClick={() => openPillar('materials')}
                            >
                              {t('wbKnMaterials')}
                            </button>
                            <button
                              type="button"
                              className="wb-btn wb-btn-secondary wb-btn-sm"
                              onClick={() => onOpenPackFiles(selected.id)}
                            >
                              {t('wbKnViewFiles')}
                            </button>
                            <WbMenuButton
                              label={t('wbKnMore')}
                              menuLabel={meta.title}
                              // busy while deleting: a confirm then hands focus to the pack list
                              disabled={busy === 'delete-pack'}
                              items={[
                                {
                                  label: t('wbKnDeletePackMenu'),
                                  icon: <WbGlyph id="trash" />,
                                  danger: true,
                                  onSelect: deletePack,
                                },
                              ]}
                            />
                          </div>
                        </div>
                        <div className="wb-kn-section">
                          <h4 className="wb-kn-label">{t('wbKnFilesInPack')}</h4>
                          {packFiles === null ? (
                            <WorkSkeleton rows={2} />
                          ) : packFiles === 'error' ? (
                            <WorkErrorState state="server" compact onRetry={retryFiles} />
                          ) : files.length === 0 ? (
                            <p className="wb-row-sub">{t('wbKnNoFiles')}</p>
                          ) : (
                            <>
                              <ul className="wb-kn-files">
                                {files.slice(0, 3).map((fp) => (
                                  <li key={fp} className="wb-kn-file">
                                    <FileBadge ext={extOf(fp)} size={20} />
                                    <button
                                      type="button"
                                      className="wb-row-title"
                                      onClick={() => void window.aiOffice.openPath(fp)}
                                    >
                                      {baseName(fp)}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                              {files.length > 3 ? (
                                <button
                                  type="button"
                                  className="wb-link"
                                  onClick={() => openPillar('materials')}
                                >
                                  {t('wbKnSeeAllFiles', { count: files.length })}
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                        <div className="wb-kn-section">
                          <span className="wb-kn-label" id={`${ids}-kn-tags`}>
                            {t('wbCommonTags')}
                          </span>
                          <div
                            className="wb-kn-tags"
                            role="group"
                            aria-labelledby={`${ids}-kn-tags`}
                          >
                            {tagList.map((tag) => (
                              <span key={tag} className="wb-kn-tag">
                                {tag}
                                <button
                                  type="button"
                                  className="wb-kn-tag-x"
                                  aria-label={t('wbKnRemoveTag', { tag })}
                                  title={t('wbKnRemoveTag', { tag })}
                                  onClick={() => setTagList((l) => l.filter((x) => x !== tag))}
                                >
                                  <WbGlyph id="close" size={12} />
                                </button>
                              </span>
                            ))}
                            <input
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault()
                                  addTags()
                                }
                              }}
                              aria-label={t('wbKnAddTagLabel')}
                              placeholder={t('wbKnAddTag')}
                            />
                          </div>
                        </div>
                        <label className="wb-kn-section wb-field">
                          <span className="wb-kn-label">{t('wbCommonNotes')}</span>
                          <textarea
                            className="wb-input"
                            rows={4}
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                          />
                        </label>
                        <div className="wb-kn-foot">
                          {metaDirty ? (
                            <span className="wb-row-sub">{t('wbKnUnsaved')}</span>
                          ) : null}
                          <span className="wb-kn-foot-actions">
                            <button
                              type="button"
                              className="wb-btn wb-btn-ghost wb-btn-sm"
                              disabled={!metaDirty}
                              onClick={discardMeta}
                            >
                              {t('wbKnDiscard')}
                            </button>
                            <button
                              type="button"
                              className="wb-btn wb-btn-primary wb-btn-sm"
                              disabled={!metaDirty || !!busy}
                              onClick={() => void saveMeta()}
                            >
                              {t('wbCommonSave')}
                            </button>
                          </span>
                        </div>
                      </>
                    ) : (
                      pillarState('knowledge', t('wbKnSelectPack'))
                    )}
                  </section>
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'materials' && (
          <>
            <WorkToolbar
              title={pillarLabel}
              titleId={pillarTitleId}
              lead={
                <WbPackChip
                  packs={deskPacks}
                  selectedPackId={selectedId}
                  onSelectPack={onSelectPack}
                  noneLabel={t('wbMatPackNone')}
                  format={(name) => t('wbMatPackChip', { title: name })}
                  ariaLabel={t('wbMatPackPick')}
                  className=""
                />
              }
              summary={
                selected && meta && Array.isArray(packFiles)
                  ? t('wbKnFileCount', { count: files.length })
                  : undefined
              }
              local
              actions={
                <WbMenuButton
                  label={t('wbMatAdd')}
                  className="wb-btn wb-btn-secondary"
                  disabled={!selected || !meta || !!busy}
                  items={practice.materialRoles.map((r) => ({
                    label: vi ? r.labelVi : r.labelEn,
                    onSelect: () => void addMaterial(r.id),
                  }))}
                >
                  <WbGlyph id="plus" />
                  {t('wbMatAdd')}
                </WbMenuButton>
              }
            />
            <section
              ref={paneRef}
              className="wb-pane"
              aria-labelledby={pillarTitleId}
              tabIndex={-1}
            >
              {!selected || !meta ? (
                pillarState('materials', t('wbMatPackNone'), {
                  action: {
                    label: t('wbMatPickInKnowledge'),
                    onClick: () => openPillar('knowledge'),
                  },
                })
              ) : (
                <>
                  <section className="wb-block wb-mat-files" aria-labelledby={`${ids}-mat-files`}>
                    <div className="wb-desk-head">
                      <h3 id={`${ids}-mat-files`}>{t('wbKnFilesInPack')}</h3>
                    </div>
                    {packFiles === null ? (
                      <WorkSkeleton rows={2} />
                    ) : packFiles === 'error' ? (
                      <WorkErrorState state="server" compact onRetry={retryFiles} />
                    ) : files.length === 0 ? (
                      pillarState('materials', t('wbMatEmpty'), { compact: true })
                    ) : (
                      <ul className="wb-mat-list">
                        {files.map((fp, i) => {
                          const base = baseName(fp)
                          const roleId = meta.materials?.[fp]
                          const role = practice.materialRoles.find((r) => r.id === roleId)
                          return (
                            <li key={fp} className="wb-row wb-mat-row">
                              <FileBadge ext={extOf(fp)} size={24} />
                              <span className="wb-mat-name" id={`${ids}-mat-${i}`}>
                                {base}
                              </span>
                              {role ? (
                                <span className="wb-pill">{vi ? role.labelVi : role.labelEn}</span>
                              ) : null}
                              <button
                                type="button"
                                className="wb-btn wb-btn-secondary wb-btn-sm"
                                aria-describedby={`${ids}-mat-${i}`}
                                onClick={() => void window.aiOffice.openPath(fp)}
                              >
                                {t('wbCommonOpen')}
                              </button>
                              <WbRowActions>
                                <WbMenuButton
                                  label={t('wbFormsMore', { title: base })}
                                  menuLabel={base}
                                  disabled={busy === `del-file:${fp}`}
                                  items={[
                                    {
                                      label: t('wbDeskShowInFolder'),
                                      icon: <WbGlyph id="folder" />,
                                      onSelect: () => void window.aiOffice.revealPath(fp),
                                    },
                                    {
                                      label: t('wbMatDeleteFileMenu'),
                                      icon: <WbGlyph id="trash" />,
                                      danger: true,
                                      onSelect: () => deleteMaterialFile(fp),
                                    },
                                  ]}
                                />
                              </WbRowActions>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                  <section className="wb-pillar-section" aria-labelledby={`${ids}-mat-quick`}>
                    <h3 className="wb-sec-title" id={`${ids}-mat-quick`}>
                      {t('wbMatQuickCreate')}
                    </h3>
                    <div className="wb-mat-tiles">
                      {BLANKS.map((b) => (
                        <button
                          key={b.ext}
                          type="button"
                          className="wb-mat-tile"
                          disabled={!!busy}
                          onClick={() => void openBlank(b, selected.id)}
                        >
                          <FileBadge ext={b.ext} size={28} />
                          <span>{t(b.label)}</span>
                        </button>
                      ))}
                    </div>
                    {practice.templates.length > 0 ? (
                      <div className="wb-chip-row">
                        {practice.templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            className="wb-btn wb-btn-secondary wb-btn-sm"
                            disabled={!!busy}
                            onClick={() => void openTemplate(tpl.id)}
                          >
                            {vi ? tpl.labelVi : tpl.labelEn}
                          </button>
                        ))}
                        {practice.freeChainTemplateIds?.length ? (
                          <button
                            type="button"
                            className="wb-link"
                            disabled={!!busy}
                            onClick={() => void openFreeChain()}
                          >
                            {t('wbMatOpenChain')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                </>
              )}
            </section>
          </>
        )}

        {tab === 'skills' && (
          <>
            <WorkToolbar
              title={pillarLabel}
              titleId={pillarTitleId}
              lead={
                <WbPackChip
                  packs={deskPacks}
                  selectedPackId={selectedId}
                  onSelectPack={onSelectPack}
                  noneLabel={t('wbMatPackNone')}
                  format={(name) => t('wbSkContextChip', { title: name })}
                  ariaLabel={t('wbMatPackPick')}
                  className=""
                />
              }
              summary={t('wbSkPerRun')}
              local
            />
            <section
              ref={paneRef}
              className="wb-pane"
              aria-labelledby={pillarTitleId}
              tabIndex={-1}
            >
              {!selected || !meta
                ? pillarState('skills', t('wbSkNeedPack'), { compact: true })
                : null}
              {roleSkills.length > 0 ? (
                <section className="wb-pillar-section" aria-labelledby={`${ids}-sk-role`}>
                  <h3 className="wb-sec-title" id={`${ids}-sk-role`}>
                    {t('wbSkRoleSkills', { role: vi ? practice.labelVi : practice.labelEn })}
                  </h3>
                  <ul className="wb-block wb-sk-list">
                    {roleSkills.map((s) => skillRow('practice', s))}
                  </ul>
                </section>
              ) : null}
              <section className="wb-pillar-section" aria-labelledby={`${ids}-sk-domain`}>
                <h3 className="wb-sec-title" id={`${ids}-sk-domain`}>
                  {t('wbSkDomainSkills')}
                </h3>
                <SkillDomainTabs vi={vi} active={skillDomain} onSelect={setSkillDomain} />
                {skillDomainDef ? (
                  <p className="wb-sk-hint">{vi ? skillDomainDef.hintVi : skillDomainDef.hintEn}</p>
                ) : null}
                <ul className="wb-block wb-sk-list">
                  {domainSkills.map((s) => skillRow('domain', s))}
                </ul>
              </section>
            </section>
          </>
        )}

        {tab === 'compose' && (
          <>
            <WorkToolbar
              title={pillarLabel}
              titleId={pillarTitleId}
              summary={<strong>{t('wbCmpSummary')}</strong>}
              local
            />
            <section
              ref={paneRef}
              className="wb-pane"
              aria-labelledby={pillarTitleId}
              tabIndex={-1}
            >
              <div className="wb-cmp">
                <form
                  className="wb-block wb-cmp-form"
                  noValidate
                  aria-labelledby={pillarTitleId}
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submitCreate()
                  }}
                >
                  <div className="wb-cmp-section">
                    <h3 className="wb-sec-title">{t('wbCmpMain')}</h3>
                    <div className="wb-cmp-fields">
                      {[...(titleFacet ? [titleFacet] : []), ...textFacets].map(cmpField)}
                    </div>
                  </div>
                  {choiceFacets.length > 0 ? (
                    <div className="wb-cmp-section">
                      <h3 className="wb-sec-title">{t('wbCmpClassify')}</h3>
                      <div className="wb-cmp-fields is-two">{choiceFacets.map(cmpField)}</div>
                    </div>
                  ) : null}
                  <label className="wb-cmp-section wb-field">
                    <span className="wb-sec-title">{t('wbCommonTags')}</span>
                    <input
                      className="wb-input"
                      value={tagsText}
                      placeholder={t('wbCmpTagsHint')}
                      onChange={(e) => setTagsText(e.target.value)}
                    />
                  </label>
                  <label className="wb-cmp-section wb-field">
                    <span className="wb-sec-title">{t('wbCommonNotes')}</span>
                    <textarea
                      className="wb-input"
                      rows={3}
                      value={cmpNotes}
                      onChange={(e) => setCmpNotes(e.target.value)}
                    />
                  </label>
                  <div className="wb-cmp-foot">
                    <span className="wb-row-sub">{t('wbCmpFoot')}</span>
                    <span className="wb-cmp-foot-actions">
                      <button
                        type="button"
                        className="wb-btn wb-btn-ghost"
                        onClick={() => {
                          resetCompose()
                          openPillar('knowledge')
                        }}
                      >
                        {t('wbCommonCancel')}
                      </button>
                      <button
                        type="submit"
                        className="wb-btn wb-btn-primary"
                        disabled={busy === 'create'}
                      >
                        {busy === 'create' ? t('wbCmpCreating') : t('wbCmpCreate')}
                      </button>
                    </span>
                  </div>
                </form>
                <aside className="wb-cmp-aside" aria-labelledby={`${ids}-cmp-what`}>
                  <h3 className="wb-sec-title" id={`${ids}-cmp-what`}>
                    {t('wbCmpWhatTitle')}
                  </h3>
                  <ul>
                    <li>
                      <WorkbenchIcon id="materials" size={24} />
                      {t('wbCmpWhatDocs')}
                    </li>
                    <li>
                      <WorkbenchIcon id="forms" size={24} />
                      {t('wbCmpWhatForms')}
                    </li>
                    <li>
                      <WorkbenchIcon id="skills" size={24} />
                      {t('wbCmpWhatSkills')}
                    </li>
                  </ul>
                </aside>
              </div>
            </section>
          </>
        )}

        {ask ? (
          <WbConfirm
            title={
              ask.action.kind === 'run-skill'
                ? t('wbSkConfirmTitle', {
                    skill: skillName(ask.action),
                    pack: meta?.title ?? '',
                  })
                : showMsg(ask.title)
            }
            body={ask.body ? showMsg(ask.body) : undefined}
            confirmLabel={t(ask.confirm)}
            cancelLabel={t('wbCommonCancel')}
            tone={ask.tone}
            onCancel={() => setAsk(null)}
            // a delete takes its row or pack with it: focus lands on the pack list, else the pane
            returnFocus={
              ask.action.kind === 'run-skill'
                ? undefined
                : () => packListRef.current ?? paneRef.current
            }
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
