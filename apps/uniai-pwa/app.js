/**
 * uniAI standalone PWA — ChatGPT-style shell.
 * Production host: https://uniwork.app/app
 */

const STORE_KEY = 'uniai.chats.v1'
const PREFS_KEY = 'uniai.prefs.v1'
const TASKS_KEY = 'uniai.tasks.v1'
const PROJECTS_KEY = 'uniai.projects.v1'

const ACCENTS = [
  { id: 'blue', value: '#5b8cff' },
  { id: 'teal', value: '#14b8a6' },
  { id: 'violet', value: '#8b5cf6' },
  { id: 'rose', value: '#f43f5e' },
  { id: 'amber', value: '#f59e0b' },
]

/** Selectable uniAI avatars for new-chat hero + assistant bubbles. */
const AVATARS = [
  { id: 'ai', label: 'Classic AI', glyph: 'AI', from: '#5b8cff', to: '#1d4ed8' },
  { id: 'spark', label: 'Spark', glyph: '✦', from: '#a78bfa', to: '#6d28d9' },
  { id: 'orb', label: 'Orb', glyph: '◎', from: '#22d3ee', to: '#0284c7' },
  { id: 'leaf', label: 'Leaf', glyph: '☘', from: '#34d399', to: '#047857' },
  { id: 'sun', label: 'Sun', glyph: '☀', from: '#fbbf24', to: '#d97706' },
  { id: 'flame', label: 'Flame', glyph: '✧', from: '#fb7185', to: '#e11d48' },
  { id: 'night', label: 'Night', glyph: '☾', from: '#818cf8', to: '#312e81' },
  { id: 'mono', label: 'Mono', glyph: '◆', from: '#a3a3a3', to: '#404040' },
]

const DEFAULT_PREFS = {
  lang: 'vi',
  theme: 'dark',
  accent: 'blue',
  fontSize: 'default',
  avatarId: 'ai',
  accountName: 'Người dùng uniAI',
  email: '',
  /** @type {'free'|'personal'|'pro'|'team'} */
  plan: 'free',
  usageTokens: 1240,
  usageLimit: 10000,
  enterToSend: true,
  saveHistory: true,
  analytics: false,
  /** UniWork Office Bridge API origin (https://… or http://127.0.0.1:port) */
  officeApiBase: '',
  /** User Bearer for POST /api/office/sessions — stored only on this device */
  officeAccessToken: '',
}

const Office = () => window.UniAIOffice

const SUGGESTIONS = [
  {
    title: 'Plan my week',
    subtitle: 'Summarize tasks and priorities',
  },
  {
    title: 'Draft an update',
    subtitle: 'Short project status email',
  },
  {
    title: 'Open Health',
    subtitle: 'Launch UniWork Office on this device',
  },
  {
    title: 'Explain Token Hub',
    subtitle: 'How credits work with uniAI',
  },
]

/**
 * Bộ cài đặt — Office apps in a horizontal scroll row.
 * @type {readonly { id: string, label: string, hint: string, color: string, glyph: string }[]}
 */
const OFFICE_APPS = [
  { id: 'docs', label: 'Docs', hint: 'Word / văn bản', color: '#2b579a', glyph: 'W' },
  { id: 'sheets', label: 'Sheets', hint: 'Excel / bảng tính', color: '#217346', glyph: 'X' },
  { id: 'slides', label: 'Slides', hint: 'PowerPoint', color: '#b7472a', glyph: 'P' },
  { id: 'pdf', label: 'PDF', hint: 'Xem & chú thích', color: '#c43e1c', glyph: 'PDF' },
  { id: 'markdown', label: 'Markdown', hint: 'Ghi chú .md', color: '#6b7280', glyph: 'MD' },
  { id: 'html', label: 'HTML', hint: 'Trang web tĩnh', color: '#e34f26', glyph: '</>' },
]

/**
 * Workbench — “Phổ biến” directory rows.
 * @type {readonly { id: string, label: string, hint: string, color: string, icon: string }[]}
 */
const WORKBENCH_TABS = [
  {
    id: 'desk',
    label: 'Không gian của tôi',
    hint: 'Tổng quan việc làm & đời sống',
    color: '#3b82f6',
    icon: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  },
  {
    id: 'calendar',
    label: 'Lịch',
    hint: 'Lịch & danh sách mốc hạn',
    color: '#ef4444',
    icon: '<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'tasks',
    label: 'Công việc',
    hint: 'Việc cần làm trên Workbench',
    color: '#22c55e',
    icon: '<path d="M5 7h14M5 12h10M5 17h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m15 11 2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: 'notes',
    label: 'Ghi chú',
    hint: 'Ghi chú nhanh tại máy',
    color: '#eab308',
    icon: '<path d="M7 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 4v4h4M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'assistant',
    label: 'Trợ lý AI',
    hint: 'Lối tắt vào uniAI',
    color: '#8b5cf6',
    icon: '<path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  },
  {
    id: 'forms',
    label: 'Biểu mẫu',
    hint: 'Mẫu giấy tờ hay dùng',
    color: '#06b6d4',
    icon: '<rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'personal',
    label: 'Cá nhân',
    hint: 'Hồ sơ dùng khi soạn thảo',
    color: '#f97316',
    icon: '<circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.5a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'personal-finance',
    label: 'Tài chính cá nhân',
    hint: 'Mục tiêu · chi tiêu · đầu tư',
    color: '#10b981',
    icon: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v10M9.5 9.5c0-1 1.1-1.8 2.5-1.8s2.5.8 2.5 1.8-1.1 1.7-2.5 1.7-2.5.8-2.5 1.8 1.1 1.8 2.5 1.8 2.5-.8 2.5-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    id: 'events',
    label: 'Sự kiện',
    hint: 'Họp, hội thảo sắp tới',
    color: '#ec4899',
    icon: '<path d="M5 8h14v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8Z" stroke="currentColor" stroke-width="1.6"/><path d="M5 8V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2M9 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'health',
    label: 'Sức khoẻ',
    hint: 'Chỉ số, tập luyện, dinh dưỡng',
    color: '#f43f5e',
    icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  },
  {
    id: 'self-growth',
    label: 'Phát triển bản thân',
    hint: 'Mục tiêu học tập & thói quen',
    color: '#a855f7',
    icon: '<path d="M12 3v18M7 8l5-4 5 4M7 16l5 4 5-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: 'family',
    label: 'Gia đình tôi',
    hint: 'Thành viên, thuốc, cột mốc',
    color: '#fb7185',
    icon: '<circle cx="8" cy="9" r="2.4" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="9" r="2.4" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    id: 'friends',
    label: 'Bạn bè',
    hint: 'Hồ sơ, sự kiện, kỷ niệm',
    color: '#38bdf8',
    icon: '<circle cx="9" cy="9" r="2.6" stroke="currentColor" stroke-width="1.5"/><path d="M4 19a5 5 0 0 1 10 0M16 8a2.4 2.4 0 1 1 0 4.8M14.5 19a4.2 4.2 0 0 1 5.5-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    id: 'pets',
    label: 'Thú cưng',
    hint: 'Hồ sơ & album ảnh trên máy',
    color: '#f97316',
    icon: '<ellipse cx="12" cy="14" rx="4.2" ry="3.4" stroke="currentColor" stroke-width="1.5"/><circle cx="7.2" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="10.5" cy="7" r="1.3" stroke="currentColor" stroke-width="1.4"/><circle cx="13.5" cy="7" r="1.3" stroke="currentColor" stroke-width="1.4"/><circle cx="16.8" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.4"/>',
  },
  {
    id: 'travel',
    label: 'Du lịch',
    hint: 'Chuyến đi & hành trình',
    color: '#0ea5e9',
    icon: '<path d="M3.5 12.5 20 5l-3.5 14-4.2-4.2L8 17.5l-1.2-3.3L3.5 12.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  },
  {
    id: 'clients',
    label: 'Khách hàng',
    hint: 'Danh bạ khách & đối tác',
    color: '#64748b',
    icon: '<rect x="4" y="6" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M4 11h16" stroke="currentColor" stroke-width="1.6"/>',
  },
  {
    id: 'contracts',
    label: 'Hợp đồng',
    hint: 'Theo dõi hiệu lực hợp đồng',
    color: '#78716c',
    icon: '<path d="M8 3h7l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6"/><path d="M15 3v4h4M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    id: 'matters',
    label: 'Vụ việc',
    hint: 'Hồ sơ pháp lý / luật sư',
    color: '#57534e',
    icon: '<path d="M12 3v18M7 7h5l3 3v7H7V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 20h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
]

/** @typedef {{ id: string, title: string, messages: { role: 'user'|'assistant', text: string }[] }} Chat */
/** @typedef {{ id: string, kind: 'file'|'plugin', label: string, detail?: string, pluginKind?: 'office'|'workbench', pluginId?: string, fileName?: string }} Attachment */

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** @returns {Chat[]} */
function loadChats() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** @param {Chat[]} chats */
function saveChats(chats) {
  localStorage.setItem(STORE_KEY, JSON.stringify(chats))
}

function newChat() {
  return { id: uid(), title: 'New chat', messages: [] }
}

/** @returns {typeof DEFAULT_PREFS} */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const merged = { ...DEFAULT_PREFS, ...JSON.parse(raw) }
    merged.plan = normalizePlanId(merged.plan)
    const catalog = window.UniAIPlans?.getPlan?.(merged.plan)
    if (catalog) merged.usageLimit = catalog.tokensMonth
    return merged
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** @param {typeof DEFAULT_PREFS} prefs */
function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

function loadOfficeDocs() {
  return Office()?.loadDocs?.() ?? []
}

function persistOfficeDocs(docs) {
  officeDocs = docs
  Office()?.saveDocs?.(docs)
}

let chats = loadChats()
if (chats.length === 0) {
  chats = [newChat()]
  saveChats(chats)
}
let activeId = chats[0].id
/** @type {typeof DEFAULT_PREFS} */
let prefs = loadPrefs()
let officeDocs = loadOfficeDocs()

/** @typedef {{ id: string, title: string, done: boolean, createdAt: string }} HubTask */
/** @typedef {{ id: string, name: string, status: 'active'|'paused'|'done', note?: string, createdAt: string }} HubProject */

/** @returns {HubTask[]} */
function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** @param {HubTask[]} items */
function saveTasks(items) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(items))
}

/** @returns {HubProject[]} */
function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** @param {HubProject[]} items */
function saveProjects(items) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(items))
}

let hubTasks = loadTasks()
let hubProjects = loadProjects()

/** @type {'chat'|'knowledge'|'documents'|'tasks'|'projects'|'office'} */
let navView = 'chat'
let officeExpanded = true
let activeDocId = ''

/** @type {Attachment[]} */
let attachments = []

const el = {
  list: document.getElementById('chatList'),
  thread: document.getElementById('thread'),
  library: document.getElementById('libraryView'),
  composerDock: document.getElementById('composerDock'),
  title: document.getElementById('threadTitle'),
  form: document.getElementById('composer'),
  input: document.getElementById('input'),
  btnSend: document.getElementById('btnSend'),
  btnNew: document.getElementById('btnNew'),
  btnInstall: document.getElementById('btnInstall'),
  btnSettings: document.getElementById('btnSettings'),
  accountName: document.getElementById('accountName'),
  accountEmail: document.getElementById('accountEmail'),
  officeDocs: document.getElementById('officeDocs'),
  navOffice: document.getElementById('navOffice'),
  suggestions: document.getElementById('suggestions'),
  sidebar: document.getElementById('sidebar'),
  btnMenu: document.getElementById('btnMenu'),
  scrim: document.getElementById('scrim'),
  btnAttach: document.getElementById('btnAttach'),
  attachMenu: document.getElementById('attachMenu'),
  attachChips: document.getElementById('attachChips'),
  inputCamera: document.getElementById('inputCamera'),
  inputPhoto: document.getElementById('inputPhoto'),
  inputFile: document.getElementById('inputFile'),
  pluginPanel: document.getElementById('pluginPanel'),
  pluginScrim: document.getElementById('pluginScrim'),
  pluginBody: document.getElementById('pluginBody'),
  btnPluginClose: document.getElementById('btnPluginClose'),
  pluginSearch: document.getElementById('pluginSearch'),
  settingsModal: document.getElementById('settingsModal'),
  settingsScrim: document.getElementById('settingsScrim'),
  settingsBody: document.getElementById('settingsBody'),
  btnSettingsClose: document.getElementById('btnSettingsClose'),
}

let pluginQuery = ''

function getAvatar() {
  return AVATARS.find((a) => a.id === prefs.avatarId) || AVATARS[0]
}

/** @param {HTMLElement} node */
function paintAvatar(node, size = 'md') {
  const av = getAvatar()
  node.dataset.avatar = av.id
  node.style.background = `linear-gradient(145deg, ${av.from}, ${av.to})`
  node.textContent = av.glyph
  node.classList.toggle('is-emoji', av.id !== 'ai')
  if (size === 'lg') node.classList.add('empty-mark')
}

function applyPrefs() {
  const theme = prefs.theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
    : prefs.theme
  document.documentElement.dataset.theme = theme
  const lang = prefs.lang === 'en' ? 'en' : 'vi'
  document.documentElement.lang = lang
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) {
    themeColor.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000')
  }
  const accent = ACCENTS.find((a) => a.id === prefs.accent)?.value || ACCENTS[0].value
  document.documentElement.style.setProperty('--accent', accent)
  const fontMap = { small: '14px', default: '16px', large: '18px', xlarge: '20px' }
  document.documentElement.style.setProperty('--font-size', fontMap[prefs.fontSize] || '16px')
  document.body.style.fontSize = fontMap[prefs.fontSize] || '16px'
  if (el.accountName) el.accountName.textContent = prefs.accountName || 'uniAI'
  if (el.accountEmail) {
    el.accountEmail.textContent = prefs.email || 'Cá nhân hoá & tài khoản'
  }
  const sideMark = document.querySelector('.brand-mark')
  if (sideMark instanceof HTMLElement) paintAvatar(sideMark)
}

function activeChat() {
  return chats.find((c) => c.id === activeId) ?? chats[0]
}

function syncSendEnabled() {
  el.btnSend.disabled = el.input.value.trim().length === 0 && attachments.length === 0
}

function setSidebarOpen(open) {
  el.sidebar.classList.toggle('open', open)
  el.scrim.hidden = !open
}

function setAttachMenuOpen(open) {
  el.attachMenu.hidden = !open
  el.btnAttach.setAttribute('aria-expanded', open ? 'true' : 'false')
}

function setPluginOpen(open) {
  el.pluginPanel.hidden = !open
  el.pluginScrim.hidden = !open
  if (open) {
    pluginQuery = ''
    if (el.pluginSearch) el.pluginSearch.value = ''
    renderPluginPanel()
    el.pluginSearch?.focus()
  }
}

function intentUrl(tab, summary) {
  const q = new URLSearchParams({
    tab,
    action: 'open',
    source: 'pwa',
    summary: summary || `Open ${tab}`,
  })
  return `uniwork://agent/intent?${q.toString()}`
}

function openDeepLink(url) {
  if (!url) return
  if (Office()?.openDeepLink) {
    Office().openDeepLink(url)
    return
  }
  try {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    /* ignore */
  }
  try {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'display:none;width:0;height:0;border:0'
    iframe.src = url
    document.body.appendChild(iframe)
    window.setTimeout(() => iframe.remove(), 2500)
  } catch {
    /* ignore */
  }
}

function officeAppDeepLink(kind) {
  const k = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'].includes(kind)
    ? kind
    : 'docs'
  // Prefer office/app; agent/intent?tab=<kind> is also accepted by updated shell.
  return Office()?.officeAppUrl?.(k) || `uniwork://office/app?kind=${k}`
}

/** Fire both protocol forms so slightly older handlers still have a chance. */
function launchOfficeApp(kind) {
  const k = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'].includes(kind)
    ? kind
    : 'docs'
  openDeepLink(`uniwork://office/app?kind=${k}`)
  window.setTimeout(() => {
    openDeepLink(
      `uniwork://agent/intent?tab=${encodeURIComponent(k)}&action=open&source=pwa&summary=${encodeURIComponent(`Open ${k}`)}`,
    )
  }, 350)
}

/**
 * Open UniOffice for a library doc — never no-op if office-hub.js failed to load.
 * @param {{ kind: string, workProductId?: string, name?: string }} doc
 * @param {{ onStatus?: (s: string) => void, onFallback?: () => void }} [hooks]
 */
async function openOfficeForDoc(doc, hooks = {}) {
  const onStatus = hooks.onStatus || (() => {})
  const hub = Office()
  if (hub?.openInUniWorkOffice) {
    return hub.openInUniWorkOffice(doc, {
      apiBase: prefs.officeApiBase,
      accessToken: prefs.officeAccessToken,
      onStatus,
      onFallback: hooks.onFallback,
    })
  }
  onStatus('app')
  launchOfficeApp(doc.kind)
  window.setTimeout(() => {
    onStatus('fallback')
    hooks.onFallback?.()
  }, 2500)
  return { mode: 'app' }
}

function renderChips() {
  el.attachChips.innerHTML = ''
  el.attachChips.hidden = attachments.length === 0
  for (const att of attachments) {
    const chip = document.createElement('span')
    chip.className = `chip${att.kind === 'plugin' ? ' is-plugin' : ''}`
    const label = document.createElement('span')
    label.className = 'chip-label'
    label.textContent = att.label
    label.title = att.detail || att.label
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'chip-x'
    x.setAttribute('aria-label', 'Remove')
    x.textContent = '×'
    x.addEventListener('click', () => {
      attachments = attachments.filter((a) => a.id !== att.id)
      renderChips()
      renderPluginPanel()
      syncSendEnabled()
    })
    chip.append(label, x)
    el.attachChips.appendChild(chip)
  }
  syncSendEnabled()
}

function isPluginOn(kind, id) {
  return attachments.some((a) => a.kind === 'plugin' && a.pluginKind === kind && a.pluginId === id)
}

function togglePlugin(kind, id, label, detail) {
  const existing = attachments.find(
    (a) => a.kind === 'plugin' && a.pluginKind === kind && a.pluginId === id,
  )
  if (existing) {
    attachments = attachments.filter((a) => a.id !== existing.id)
  } else {
    attachments.push({
      id: uid(),
      kind: 'plugin',
      pluginKind: kind,
      pluginId: id,
      label: kind === 'office' ? label : `Workbench · ${label}`,
      detail,
    })
  }
  renderChips()
  renderPluginPanel()
}

function matchesPluginQuery(label, hint) {
  const q = pluginQuery.trim().toLowerCase()
  if (!q) return true
  return `${label} ${hint}`.toLowerCase().includes(q)
}

function makeAddButton(on, onClick) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `plugin-add${on ? ' is-on' : ''}`
  btn.setAttribute('aria-label', on ? 'Đã thêm' : 'Thêm plugin')
  btn.title = on ? 'Bỏ plugin' : 'Thêm'
  btn.innerHTML = on
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return btn
}

function renderPluginPanel() {
  if (el.pluginPanel.hidden) return
  el.pluginBody.innerHTML = ''

  const officeFiltered = OFFICE_APPS.filter((a) => matchesPluginQuery(a.label, a.hint))
  if (officeFiltered.length > 0 || !pluginQuery.trim()) {
    const suiteSec = document.createElement('section')
    suiteSec.innerHTML =
      '<h3 class="plugin-section-title">Bộ cài đặt</h3><p class="plugin-section-sub">Vuốt ngang · chọn app Office gắn vào chat</p>'
    const rail = document.createElement('div')
    rail.className = 'plugin-suite-rail'
    rail.setAttribute('role', 'list')
    const apps = pluginQuery.trim() ? officeFiltered : OFFICE_APPS
    for (const app of apps) {
      const on = isPluginOn('office', app.id)
      const item = document.createElement('button')
      item.type = 'button'
      item.className = `plugin-suite-app${on ? ' is-on' : ''}`
      item.setAttribute('role', 'listitem')
      item.title = `${app.label} — ${app.hint}`
      item.setAttribute('aria-pressed', on ? 'true' : 'false')
      item.innerHTML = `
        <span class="plugin-suite-app-icon" style="background:${app.color}" aria-hidden="true">${escapeHtml(app.glyph)}</span>
        <span class="plugin-suite-app-label">${escapeHtml(app.label)}</span>
        <span class="plugin-suite-app-check" aria-hidden="true">${on ? '✓' : '+'}</span>
      `
      item.addEventListener('click', () =>
        togglePlugin('office', app.id, app.label, app.hint),
      )
      item.addEventListener('dblclick', () => {
        launchOfficeApp(app.id)
      })
      rail.appendChild(item)
    }
    suiteSec.appendChild(rail)
    el.pluginBody.appendChild(suiteSec)
  }

  const filtered = WORKBENCH_TABS.filter((t) => matchesPluginQuery(t.label, t.hint))
  const popularSec = document.createElement('section')
  popularSec.innerHTML = '<h3 class="plugin-section-title">Phổ biến</h3>'
  const list = document.createElement('div')
  list.className = 'plugin-popular'

  if (filtered.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'plugin-empty'
    empty.textContent = 'Không tìm thấy plugin phù hợp.'
    popularSec.appendChild(empty)
  } else {
    for (const t of filtered) {
      const on = isPluginOn('workbench', t.id)
      const row = document.createElement('div')
      row.className = 'plugin-item'
      row.innerHTML = `
        <div class="plugin-item-icon" style="background:${t.color}" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">${t.icon}</svg>
        </div>
        <div class="plugin-item-meta">
          <strong>${escapeHtml(t.label)}</strong>
          <span>${escapeHtml(t.hint)}</span>
        </div>
      `
      row.appendChild(
        makeAddButton(on, () => togglePlugin('workbench', t.id, t.label, t.hint)),
      )
      // Long-press style: double-click / alt-click opens deep link
      row.addEventListener('dblclick', () => {
        if (!on) togglePlugin('workbench', t.id, t.label, t.hint)
        openDeepLink(intentUrl(t.id, `Open ${t.label}`))
      })
      list.appendChild(row)
    }
    popularSec.appendChild(list)
  }

  el.pluginBody.appendChild(popularSec)
}

function addFiles(fileList) {
  const files = Array.from(fileList || [])
  for (const f of files) {
    const kindLabel = f.type.startsWith('image/') ? 'Ảnh' : 'Tệp'
    attachments.push({
      id: uid(),
      kind: 'file',
      label: `${kindLabel} · ${f.name}`,
      detail: `${Math.max(1, Math.round(f.size / 1024))} KB`,
      fileName: f.name,
    })
  }
  renderChips()
}

function setNavView(view) {
  navView = view
  document.querySelectorAll('.nav-item[data-nav]').forEach((node) => {
    node.classList.toggle('active', node.getAttribute('data-nav') === view)
  })
  const showChat = view === 'chat'
  el.thread.hidden = !showChat
  el.composerDock.hidden = !showChat
  el.library.hidden = showChat
  if (!showChat) renderLibrary()
  else {
    renderThread()
    el.input.focus()
  }
  setSidebarOpen(false)
}

function renderOfficeDocs() {
  el.officeDocs.innerHTML = ''
  el.navOffice?.parentElement?.classList.toggle('collapsed', !officeExpanded)
  el.navOffice?.setAttribute('aria-expanded', officeExpanded ? 'true' : 'false')
  for (const doc of officeDocs) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = doc.id === activeDocId && (navView === 'office' || navView === 'documents') ? 'active' : ''
    btn.innerHTML = `<span class="office-dot" style="background:${doc.color}"></span><span>${escapeHtml(doc.name)}</span>`
    btn.addEventListener('click', () => {
      activeDocId = doc.id
      setNavView('office')
      renderOfficeDocs()
    })
    li.appendChild(btn)
    el.officeDocs.appendChild(li)
  }
}

/** @type {(() => void) | null} */
let officePreviewCleanup = null

function renderLibrary() {
  const titles = {
    knowledge: ['Tri thức', 'Kho kiến thức, skill và ghi chú dùng lại trong uniAI.'],
    documents: [
      'Tài liệu',
      'Xem trên PWA (local) hoặc mở bằng UniWork Office trên máy.',
    ],
    tasks: ['Công việc', 'Việc cần làm — lưu trên thiết bị này.'],
    projects: ['Dự án', 'Theo dõi dự án đang chạy — lưu trên thiết bị này.'],
    office: [
      'UniOffice',
      'Mở Docs / Sheets / Slides trong UniWork Office · xem trước PDF/MD trên thiết bị.',
    ],
  }
  const [title, desc] = titles[navView] || titles.documents
  if (officePreviewCleanup) {
    officePreviewCleanup()
    officePreviewCleanup = null
  }
  el.library.innerHTML = ''
  const card = document.createElement('div')
  card.className = 'library-card'
  card.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(desc)}</p>`

  if (navView === 'tasks') {
    card.appendChild(renderTasksHub())
  } else if (navView === 'projects') {
    card.appendChild(renderProjectsHub())
  } else if (navView === 'office' || navView === 'documents') {
    const selected = officeDocs.find((d) => d.id === activeDocId)
    if (selected) card.appendChild(renderOfficeDocDetail(selected))
    else card.appendChild(renderOfficeHub())
  } else if (navView === 'knowledge') {
    const grid = document.createElement('div')
    grid.className = 'library-grid'
    ;[
      ['Playbook bán hàng', 'Quy trình & checklist'],
      ['Thuật ngữ nội bộ', 'Glossary dùng chung'],
      ['Mẫu email', 'Thư chào / follow-up'],
    ].forEach(([name, hint]) => {
      const tile = document.createElement('button')
      tile.type = 'button'
      tile.className = 'library-tile'
      tile.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(hint)}</span>`
      tile.addEventListener('click', () => {
        setNavView('chat')
        send(`Dùng tri thức: ${name}`)
      })
      grid.appendChild(tile)
    })
    card.appendChild(grid)
  }

  el.library.appendChild(card)
  el.title.textContent = selectedOfficeTitle(title)
}

function selectedOfficeTitle(fallback) {
  if ((navView === 'office' || navView === 'documents') && activeDocId) {
    const doc = officeDocs.find((d) => d.id === activeDocId)
    if (doc) return doc.name
  }
  return fallback
}

function renderOfficeHub() {
  const wrap = document.createElement('div')
  wrap.className = 'office-hub'

  const apps = document.createElement('div')
  apps.className = 'office-hub-apps'
  apps.innerHTML = '<p class="office-hub-label">Mở UniWork Office</p>'
  const rail = document.createElement('div')
  rail.className = 'office-hub-rail'
  for (const app of OFFICE_APPS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'office-hub-app'
    btn.innerHTML = `
      <span class="office-hub-app-ico" style="background:${app.color}">${escapeHtml(app.glyph)}</span>
      <strong>${escapeHtml(app.label)}</strong>
      <span>${escapeHtml(app.hint)}</span>
    `
    btn.addEventListener('click', () => {
      launchOfficeApp(app.id)
    })
    rail.appendChild(btn)
  }
  apps.appendChild(rail)
  wrap.appendChild(apps)

  const toolbar = document.createElement('div')
  toolbar.className = 'office-hub-toolbar'
  toolbar.innerHTML = `<p class="teacher-hint" style="margin:0">Tài liệu · xem local hoặc mở Desktop</p>`
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'btn-primary-lite'
  addBtn.textContent = '+ Thêm tệp (local)'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept =
    '.docx,.xlsx,.pptx,.pdf,.md,.markdown,.txt,.csv,.html,.htm,image/*,application/pdf'
  fileInput.multiple = true
  fileInput.hidden = true
  addBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    void ingestOfficeFiles(fileInput.files)
    fileInput.value = ''
  })
  const cloudBtn = document.createElement('button')
  cloudBtn.type = 'button'
  cloudBtn.className = 'btn-secondary-lite'
  cloudBtn.textContent = '+ Gắn Work Product ID'
  cloudBtn.addEventListener('click', () => addCloudWorkProduct())
  toolbar.appendChild(addBtn)
  toolbar.appendChild(cloudBtn)
  toolbar.appendChild(fileInput)
  wrap.appendChild(toolbar)

  const grid = document.createElement('div')
  grid.className = 'library-grid'
  if (officeDocs.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'office-hub-empty'
    empty.textContent = 'Chưa có tài liệu. Tải tệp lên máy này hoặc gắn ID UniWork.'
    wrap.appendChild(empty)
  } else {
    for (const doc of officeDocs) {
      const tile = document.createElement('button')
      tile.type = 'button'
      tile.className = 'library-tile'
      const badge = doc.workProductId
        ? 'Cloud · Bridge'
        : doc.localBlobId
          ? 'Local preview'
          : 'Demo'
      tile.innerHTML = `<strong>${escapeHtml(doc.name)}</strong><span>${escapeHtml(doc.kind.toUpperCase())} · ${badge}</span>`
      tile.addEventListener('click', () => {
        activeDocId = doc.id
        renderLibrary()
        renderOfficeDocs()
      })
      grid.appendChild(tile)
    }
    wrap.appendChild(grid)
  }
  return wrap
}

/** @param {{ id: string, name: string, kind: string, color: string, workProductId?: string, localBlobId?: string, mime?: string }} doc */
function renderOfficeDocDetail(doc) {
  const wrap = document.createElement('div')
  wrap.className = 'office-doc'

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'office-doc-back'
  back.textContent = '← Danh sách'
  back.addEventListener('click', () => {
    activeDocId = ''
    renderLibrary()
    renderOfficeDocs()
  })
  wrap.appendChild(back)

  const head = document.createElement('header')
  head.className = 'office-doc-head'
  head.innerHTML = `
    <span class="office-dot" style="background:${doc.color}"></span>
    <div>
      <h3>${escapeHtml(doc.name)}</h3>
      <p>${escapeHtml(doc.kind.toUpperCase())}${
        doc.workProductId ? ` · ID ${escapeHtml(doc.workProductId)}` : ''
      }${doc.localBlobId ? ' · lưu trên máy' : ''}</p>
    </div>
  `
  wrap.appendChild(head)

  const actions = document.createElement('div')
  actions.className = 'office-doc-actions'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'btn-primary-lite'
  openBtn.textContent = 'Mở trong UniWork Office'
  const status = document.createElement('p')
  status.className = 'office-doc-status'
  status.hidden = true
  const fallback = document.createElement('div')
  fallback.className = 'office-doc-fallback'
  fallback.hidden = true
  fallback.innerHTML = `
    <p>Chưa mở được? Cần UniWork Office desktop đã đăng ký protocol <code>uniwork://</code> (bản mới có <code>office/app</code>). Rebuild/cài lại shell rồi thử.</p>
    <a href="https://github.com/truongnt7/uniwork-office/releases/latest" target="_blank" rel="noopener">Tải UniWork Office</a>
  `
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'btn-secondary-lite'
  retry.textContent = 'Thử lại'
  fallback.appendChild(retry)

  const runOpen = () => {
    status.hidden = false
    status.textContent = 'Đang mở UniWork Office…'
    fallback.hidden = true
    void openOfficeForDoc(doc, {
      onStatus: (s) => {
        if (s === 'opening') status.textContent = 'Tạo phiên Office Bridge…'
        if (s === 'app') status.textContent = 'Mở app UniOffice trên máy…'
        if (s === 'fallback') {
          status.textContent =
            'Nếu app không hiện: cài/cập nhật UniWork Office (cần bản hỗ trợ office/app) rồi thử lại.'
          fallback.hidden = false
        }
        if (s === 'failed') status.textContent = 'Không tạo được phiên (API / quyền / token).'
      },
      onFallback: () => {
        fallback.hidden = false
      },
    }).catch(() => {
      status.textContent =
        'Không mở được — kiểm tra API/token hoặc cập nhật UniWork Office desktop.'
      fallback.hidden = false
      launchOfficeApp(doc.kind)
    })
  }
  openBtn.addEventListener('click', runOpen)
  retry.addEventListener('click', runOpen)
  actions.appendChild(openBtn)

  if (doc.kind !== 'other') {
    const appOnly = document.createElement('button')
    appOnly.type = 'button'
    appOnly.className = 'btn-secondary-lite'
    appOnly.textContent = `Mở ${doc.kind} trống`
    appOnly.addEventListener('click', () => {
      launchOfficeApp(doc.kind)
    })
    actions.appendChild(appOnly)
  }

  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'btn-secondary-lite'
  del.textContent = 'Xoá khỏi máy'
  del.addEventListener('click', () => {
    if (!window.confirm(`Xoá «${doc.name}» khỏi danh sách local?`)) return
    void removeOfficeDoc(doc.id)
  })
  actions.appendChild(del)
  wrap.appendChild(actions)
  wrap.appendChild(status)
  wrap.appendChild(fallback)

  const preview = document.createElement('div')
  preview.className = 'office-doc-preview'
  preview.innerHTML = '<p class="office-hub-empty">Đang tải xem trước…</p>'
  wrap.appendChild(preview)

  void (async () => {
    const hub = Office()
    if (!hub) {
      preview.innerHTML =
        '<p class="office-hub-empty">Module Office chưa sẵn sàng. Tải lại trang.</p>'
      return
    }
    if (!doc.localBlobId) {
      preview.innerHTML = `
        <div class="office-doc-preview-card">
          <strong>Chưa có bản xem trước trên PWA</strong>
          <p>File demo / cloud: bấm <em>Mở trong UniWork Office</em> để sửa bằng bộ UniOffice.
          Hoặc tải bản local (+ Thêm tệp) để xem PDF / Markdown / ảnh ngay trên PWA.</p>
        </div>`
      return
    }
    if (!hub.canPreviewInPwa(doc)) {
      preview.innerHTML = `
        <div class="office-doc-preview-card">
          <strong>Định dạng Office (DOCX / XLSX / PPTX)</strong>
          <p>PWA lưu tệp trên máy này. Xem &amp; chỉnh sửa đầy đủ bằng UniWork Office desktop
          (nút phía trên). Preview rich trong PWA sẽ bổ sung dần.</p>
        </div>`
      return
    }
    try {
      const payload = await hub.loadPreview(doc)
      if (!payload) {
        preview.innerHTML = '<p class="office-hub-empty">Không đọc được bản local.</p>'
        return
      }
      if (payload.revoke) {
        officePreviewCleanup = () => payload.revoke?.()
      }
      preview.innerHTML = ''
      if (payload.type === 'pdf' && payload.url) {
        const iframe = document.createElement('iframe')
        iframe.className = 'office-doc-frame'
        iframe.title = doc.name
        iframe.src = payload.url
        preview.appendChild(iframe)
      } else if (payload.type === 'image' && payload.url) {
        const img = document.createElement('img')
        img.className = 'office-doc-img'
        img.src = payload.url
        img.alt = doc.name
        preview.appendChild(img)
      } else if (payload.type === 'html' && payload.text != null) {
        const iframe = document.createElement('iframe')
        iframe.className = 'office-doc-frame'
        iframe.title = doc.name
        iframe.sandbox = ''
        iframe.srcdoc = payload.text
        preview.appendChild(iframe)
      } else if (payload.text != null) {
        const pre = document.createElement('pre')
        pre.className = 'office-doc-text'
        pre.textContent = payload.text
        preview.appendChild(pre)
      } else {
        preview.innerHTML = '<p class="office-hub-empty">Không xem trước được định dạng này.</p>'
      }
    } catch {
      preview.innerHTML = '<p class="office-hub-empty">Lỗi xem trước.</p>'
    }
  })()

  return wrap
}

async function ingestOfficeFiles(fileList) {
  const hub = Office()
  if (!hub || !fileList?.length) return
  const next = [...officeDocs]
  for (const file of Array.from(fileList)) {
    try {
      const doc = await hub.ingestLocalFile(file)
      next.unshift(doc)
      activeDocId = doc.id
    } catch {
      /* skip */
    }
  }
  persistOfficeDocs(next)
  setNavView('office')
  renderOfficeDocs()
}

function addCloudWorkProduct() {
  const id = window.prompt('Work Product / documentId trên UniWork (UUID):', '')?.trim()
  if (!id) return
  const name =
    window.prompt('Tên hiển thị:', 'Tài liệu UniWork')?.trim() || 'Tài liệu UniWork'
  const kindGuess =
    Office()?.kindFromFileName?.(name) ||
    (/\.xlsx$/i.test(name) ? 'sheets' : /\.pptx$/i.test(name) ? 'slides' : 'docs')
  const doc = {
    id: Office()?.uid?.() || `c-${Date.now()}`,
    name: /\./.test(name) ? name : `${name}.docx`,
    kind: kindGuess,
    color: Office()?.KIND_COLOR?.[kindGuess] || '#2b579a',
    workProductId: id,
    source: 'cloud',
    addedAt: new Date().toISOString(),
  }
  persistOfficeDocs([doc, ...officeDocs])
  activeDocId = doc.id
  setNavView('office')
  renderOfficeDocs()
}

async function removeOfficeDoc(id) {
  const doc = officeDocs.find((d) => d.id === id)
  if (doc?.localBlobId) {
    try {
      await Office()?.deleteBlob?.(doc.localBlobId)
    } catch {
      /* ignore */
    }
  }
  persistOfficeDocs(officeDocs.filter((d) => d.id !== id))
  activeDocId = ''
  renderLibrary()
  renderOfficeDocs()
}


/** @returns {HTMLElement} */
function renderTasksHub() {
  const wrap = document.createElement('div')
  wrap.className = 'hub-panel'

  const form = document.createElement('div')
  form.className = 'hub-form'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'hub-input'
  input.placeholder = 'VD: Soạn phiếu kiểm tra'
  input.setAttribute('aria-label', 'Việc mới')
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'hub-btn primary'
  addBtn.textContent = 'Thêm'

  const add = () => {
    const t = input.value.trim()
    if (!t) return
    hubTasks = [{ id: uid(), title: t, done: false, createdAt: new Date().toISOString() }, ...hubTasks]
    saveTasks(hubTasks)
    input.value = ''
    renderLibrary()
  }
  addBtn.addEventListener('click', add)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  })
  form.append(input, addBtn)
  wrap.appendChild(form)

  const list = document.createElement('ul')
  list.className = 'hub-list'
  if (hubTasks.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'hub-empty'
    empty.textContent = 'Chưa có việc.'
    list.appendChild(empty)
  } else {
    for (const task of hubTasks) {
      const li = document.createElement('li')
      li.className = `hub-row${task.done ? ' is-done' : ''}`

      const label = document.createElement('label')
      label.className = 'hub-check'
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = task.done
      check.addEventListener('change', () => {
        hubTasks = hubTasks.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x))
        saveTasks(hubTasks)
        renderLibrary()
      })
      const span = document.createElement('span')
      span.textContent = task.title
      label.append(check, span)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'hub-btn ghost'
      del.textContent = 'Xóa'
      del.addEventListener('click', () => {
        hubTasks = hubTasks.filter((x) => x.id !== task.id)
        saveTasks(hubTasks)
        renderLibrary()
      })

      li.append(label, del)
      list.appendChild(li)
    }
  }
  wrap.appendChild(list)
  return wrap
}

/** @returns {HTMLElement} */
function renderProjectsHub() {
  const wrap = document.createElement('div')
  wrap.className = 'hub-panel'

  const form = document.createElement('div')
  form.className = 'hub-form'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'hub-input'
  input.placeholder = 'VD: Ra mắt sản phẩm Q2'
  input.setAttribute('aria-label', 'Dự án mới')
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'hub-btn primary'
  addBtn.textContent = 'Thêm'

  const add = () => {
    const name = input.value.trim()
    if (!name) return
    hubProjects = [
      { id: uid(), name, status: 'active', createdAt: new Date().toISOString() },
      ...hubProjects,
    ]
    saveProjects(hubProjects)
    input.value = ''
    renderLibrary()
  }
  addBtn.addEventListener('click', add)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  })
  form.append(input, addBtn)
  wrap.appendChild(form)

  /** @type {Record<HubProject['status'], string>} */
  const statusLabel = { active: 'Đang chạy', paused: 'Tạm dừng', done: 'Hoàn thành' }
  /** @type {HubProject['status'][]} */
  const statusCycle = ['active', 'paused', 'done']

  const list = document.createElement('ul')
  list.className = 'hub-list'
  if (hubProjects.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'hub-empty'
    empty.textContent = 'Chưa có dự án.'
    list.appendChild(empty)
  } else {
    for (const project of hubProjects) {
      const li = document.createElement('li')
      li.className = `hub-row hub-project status-${project.status}`

      const main = document.createElement('div')
      main.className = 'hub-project-main'
      const nameEl = document.createElement('strong')
      nameEl.textContent = project.name
      const meta = document.createElement('span')
      meta.className = 'hub-meta'
      meta.textContent = statusLabel[project.status]
      main.append(nameEl, meta)

      const actions = document.createElement('div')
      actions.className = 'hub-actions'

      const statusBtn = document.createElement('button')
      statusBtn.type = 'button'
      statusBtn.className = 'hub-btn ghost'
      statusBtn.textContent = 'Trạng thái'
      statusBtn.addEventListener('click', () => {
        const idx = statusCycle.indexOf(project.status)
        const next = statusCycle[(idx + 1) % statusCycle.length]
        hubProjects = hubProjects.map((x) => (x.id === project.id ? { ...x, status: next } : x))
        saveProjects(hubProjects)
        renderLibrary()
      })

      const chatBtn = document.createElement('button')
      chatBtn.type = 'button'
      chatBtn.className = 'hub-btn ghost'
      chatBtn.textContent = 'Chat'
      chatBtn.addEventListener('click', () => {
        setNavView('chat')
        send(`Giúp tôi với dự án: ${project.name}`)
      })

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'hub-btn ghost'
      del.textContent = 'Xóa'
      del.addEventListener('click', () => {
        hubProjects = hubProjects.filter((x) => x.id !== project.id)
        saveProjects(hubProjects)
        renderLibrary()
      })

      actions.append(statusBtn, chatBtn, del)
      li.append(main, actions)
      list.appendChild(li)
    }
  }
  wrap.appendChild(list)
  return wrap
}

function renderList() {
  el.list.innerHTML = ''
  const visible = prefs.saveHistory ? chats : chats.slice(0, 1)
  for (const c of visible) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = c.title
    btn.className = c.id === activeId && navView === 'chat' ? 'active' : ''
    btn.addEventListener('click', () => {
      activeId = c.id
      setNavView('chat')
      render()
    })
    li.appendChild(btn)
    el.list.appendChild(li)
  }
}

function setSettingsOpen(open) {
  el.settingsModal.hidden = !open
  el.settingsScrim.hidden = !open
  if (open) renderSettings()
}

function renderSettings() {
  const pct = Math.min(100, Math.round((prefs.usageTokens / prefs.usageLimit) * 100))
  el.settingsBody.innerHTML = `
    <section class="settings-group">
      <h3>Tùy chỉnh</h3>
      <div class="settings-row">
        <div><label for="setLang">Ngôn ngữ</label><small>Ngôn ngữ giao diện uniAI</small></div>
        <select id="setLang">
          <option value="vi">Tiếng Việt</option>
          <option value="en">English</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </div>
      <div class="settings-row">
        <div><label for="setTheme">Giao diện</label><small>Sáng / tối / theo hệ thống</small></div>
        <select id="setTheme">
          <option value="dark">Tối</option>
          <option value="light">Sáng</option>
          <option value="system">Hệ thống</option>
        </select>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Màu nhấn</span><small>Màu nhấn cho nút và điểm nhấn UI</small></div>
        <div class="accent-swatches" id="accentSwatches"></div>
      </div>
      <div class="settings-row">
        <div><label for="setFont">Cỡ chữ</label><small>Kích thước chữ trong chat</small></div>
        <select id="setFont">
          <option value="small">Nhỏ</option>
          <option value="default">Mặc định</option>
          <option value="large">Lớn</option>
          <option value="xlarge">Rất lớn</option>
        </select>
      </div>
      <div class="settings-row settings-row-stack">
        <div><span class="settings-label">Avatar uniAI</span><small>Hiện trên trang New chat và tin nhắn trợ lý</small></div>
        <div class="avatar-picker" id="settingsAvatarPicker"></div>
      </div>
    </section>

    <section class="settings-group">
      <h3>Tài khoản</h3>
      <div class="settings-row">
        <div><label for="setName">Tài khoản</label><small>Tên hiển thị</small></div>
        <input id="setName" type="text" value="${escapeHtml(prefs.accountName)}" />
      </div>
      <div class="settings-row">
        <div><label for="setEmail">Email</label><small>Đăng nhập UniWork / Token Hub</small></div>
        <input id="setEmail" type="email" placeholder="you@uniwork.app" value="${escapeHtml(prefs.email)}" />
      </div>
      <div class="settings-row">
        <div>
          <span class="settings-label">Gói đăng ký</span>
          <small>${escapeHtml(window.UniAIPlans?.getPlan?.(normalizePlanId(prefs.plan))?.nameVi || prefs.plan)} · chọn gói bên dưới (xem thử local)</small>
        </div>
        <a class="settings-link" href="https://uniwork.app" target="_blank" rel="noopener" id="btnUpgrade">Thanh toán</a>
      </div>
      <div class="settings-row">
        <div>
          <span class="settings-label">Mức sử dụng &amp; giới hạn</span>
          <small>${prefs.usageTokens.toLocaleString('vi-VN')} / ${prefs.usageLimit.toLocaleString('vi-VN')} token tháng này</small>
        </div>
        <div class="usage-bar" title="${pct}%"><i style="width:${pct}%"></i></div>
      </div>
      <div class="settings-row settings-row-stack">
        <div>
          <span class="settings-label">Bảng giá UniWork Office</span>
          <small>Desktop trên máy · Bridge cloud từ Personal · Team theo ghế</small>
        </div>
        <div class="plan-grid" id="planGrid"></div>
      </div>
    </section>

    <section class="settings-group">
      <h3>UniWork Office Bridge</h3>
      <div class="settings-row settings-row-stack">
        <div>
          <label for="setOfficeApi">API origin</label>
          <small>HTTPS UniWork hoặc http://127.0.0.1 — dùng để Mở trong Office (session token)</small>
        </div>
        <input id="setOfficeApi" type="url" placeholder="https://uniwork.app" value="${escapeHtml(prefs.officeApiBase || '')}" />
      </div>
      <div class="settings-row settings-row-stack">
        <div>
          <label for="setOfficeToken">Access token</label>
          <small>Bearer user — chỉ lưu trên thiết bị này, không đưa vào deep link</small>
        </div>
        <input id="setOfficeToken" type="password" autocomplete="off" placeholder="eyJ…" value="${escapeHtml(prefs.officeAccessToken || '')}" />
      </div>
    </section>

    <section class="settings-group">
      <h3>Cài đặt chung</h3>
      <div class="settings-row">
        <div><span class="settings-label">Enter để gửi</span><small>Shift+Enter xuống dòng</small></div>
        <button type="button" class="settings-toggle${prefs.enterToSend ? ' is-on' : ''}" data-pref="enterToSend" aria-pressed="${prefs.enterToSend}"></button>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Lưu lịch sử chat</span><small>Hiện danh sách Gần đây trên sidebar</small></div>
        <button type="button" class="settings-toggle${prefs.saveHistory ? ' is-on' : ''}" data-pref="saveHistory" aria-pressed="${prefs.saveHistory}"></button>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Chia sẻ dữ liệu cải thiện</span><small>Tuỳ chọn, có thể tắt bất cứ lúc nào</small></div>
        <button type="button" class="settings-toggle${prefs.analytics ? ' is-on' : ''}" data-pref="analytics" aria-pressed="${prefs.analytics}"></button>
      </div>
    </section>

    <section class="settings-group">
      <h3>Trợ giúp</h3>
      <div class="settings-row">
        <div><span class="settings-label">Trung tâm trợ giúp</span><small>Hướng dẫn uniAI &amp; Token Hub</small></div>
        <a class="settings-link" href="https://uniwork.app" target="_blank" rel="noopener">Mở</a>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Cài UniWork Office</span><small>Desktop để mở Workbench &amp; file Office</small></div>
        <a class="settings-link" href="https://github.com/truongnt7/uniwork-office/releases/latest" target="_blank" rel="noopener">Tải</a>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Phản hồi</span><small>Góp ý sản phẩm</small></div>
        <a class="settings-link" href="mailto:hello@uniwork.app">Email</a>
      </div>
    </section>
  `

  /** @type {HTMLSelectElement|null} */
  const lang = el.settingsBody.querySelector('#setLang')
  /** @type {HTMLSelectElement|null} */
  const theme = el.settingsBody.querySelector('#setTheme')
  /** @type {HTMLSelectElement|null} */
  const font = el.settingsBody.querySelector('#setFont')
  if (lang) lang.value = prefs.lang
  if (theme) theme.value = prefs.theme
  if (font) font.value = prefs.fontSize

  const swatches = el.settingsBody.querySelector('#accentSwatches')
  if (swatches) {
    for (const a of ACCENTS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `accent-swatch${prefs.accent === a.id ? ' is-on' : ''}`
      b.style.background = a.value
      b.title = a.id
      b.addEventListener('click', () => {
        prefs.accent = a.id
        persistPrefs()
        renderSettings()
      })
      swatches.appendChild(b)
    }
  }

  const settingsAvatars = el.settingsBody.querySelector('#settingsAvatarPicker')
  if (settingsAvatars) {
    fillAvatarPicker(settingsAvatars, () => {
      persistPrefs()
      renderSettings()
      if (navView === 'chat') renderThread()
    })
  }

  lang?.addEventListener('change', () => {
    prefs.lang = lang.value
    persistPrefs()
  })
  theme?.addEventListener('change', () => {
    prefs.theme = theme.value
    persistPrefs()
  })
  font?.addEventListener('change', () => {
    prefs.fontSize = font.value
    persistPrefs()
  })
  el.settingsBody.querySelector('#setName')?.addEventListener('change', (e) => {
    prefs.accountName = /** @type {HTMLInputElement} */ (e.target).value.trim() || DEFAULT_PREFS.accountName
    persistPrefs()
  })
  el.settingsBody.querySelector('#setEmail')?.addEventListener('change', (e) => {
    prefs.email = /** @type {HTMLInputElement} */ (e.target).value.trim()
    persistPrefs()
  })
  el.settingsBody.querySelector('#setOfficeApi')?.addEventListener('change', (e) => {
    prefs.officeApiBase = /** @type {HTMLInputElement} */ (e.target).value.trim()
    persistPrefs()
  })
  el.settingsBody.querySelector('#setOfficeToken')?.addEventListener('change', (e) => {
    prefs.officeAccessToken = /** @type {HTMLInputElement} */ (e.target).value.trim()
    persistPrefs()
  })
  const planGrid = el.settingsBody.querySelector('#planGrid')
  if (planGrid && window.UniAIPlans?.PLANS) {
    const current = normalizePlanId(prefs.plan)
    for (const plan of window.UniAIPlans.PLANS) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = `plan-card${plan.id === current ? ' is-on' : ''}`
      card.innerHTML = `
        <header>
          <strong>${escapeHtml(plan.nameVi)}</strong>
          ${plan.id === current ? '<span class="plan-badge">Đang dùng</span>' : ''}
        </header>
        <p class="plan-price">${escapeHtml(window.UniAIPlans.priceLabel(plan, 'vi'))}</p>
        <p class="plan-blurb">${escapeHtml(plan.blurbVi)}</p>
        <ul>${plan.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      `
      card.addEventListener('click', () => {
        applyPlanQuota(plan.id)
        persistPrefs()
        renderSettings()
      })
      planGrid.appendChild(card)
    }
  }

  el.settingsBody.querySelectorAll('.settings-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-pref')
      if (!key) return
      prefs[key] = !prefs[key]
      persistPrefs()
      renderSettings()
      if (key === 'saveHistory') renderList()
    })
  })
}

function persistPrefs() {
  savePrefs(prefs)
  applyPrefs()
}

function normalizePlanId(raw) {
  const id = String(raw || 'free').toLowerCase()
  if (id === 'free' || id === 'personal' || id === 'pro' || id === 'team') return id
  return 'free'
}

function applyPlanQuota(planId) {
  const plan = window.UniAIPlans?.getPlan?.(normalizePlanId(planId))
  if (!plan) return
  prefs.plan = plan.id
  prefs.usageLimit = plan.tokensMonth
}

function renderSuggestions(show) {
  el.suggestions.hidden = !show
  el.suggestions.innerHTML = ''
  if (!show) return
  for (const s of SUGGESTIONS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.innerHTML = `${escapeHtml(s.title)}<span>${escapeHtml(s.subtitle)}</span>`
    b.addEventListener('click', () => send(`${s.title}: ${s.subtitle}`))
    el.suggestions.appendChild(b)
  }
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * @param {HTMLElement} host
 * @param {() => void} [onPicked]
 */
function fillAvatarPicker(host, onPicked) {
  host.innerHTML = ''
  for (const a of AVATARS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `avatar-opt${prefs.avatarId === a.id ? ' is-on' : ''}`
    b.title = a.label
    b.setAttribute('aria-label', a.label)
    b.setAttribute('aria-pressed', prefs.avatarId === a.id ? 'true' : 'false')
    b.innerHTML = `<span style="background:linear-gradient(145deg,${a.from},${a.to})">${escapeHtml(a.glyph)}</span>`
    b.addEventListener('click', () => {
      prefs.avatarId = a.id
      savePrefs(prefs)
      applyPrefs()
      onPicked?.()
    })
    host.appendChild(b)
  }
}

function renderThread() {
  const chat = activeChat()
  el.title.textContent = chat.messages.length === 0 ? 'uniAI' : chat.title
  el.thread.innerHTML = ''
  el.thread.classList.toggle('is-empty', chat.messages.length === 0)

  if (chat.messages.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    const mark = document.createElement('div')
    mark.className = 'empty-mark'
    mark.setAttribute('aria-hidden', 'true')
    paintAvatar(mark, 'lg')
    const h2 = document.createElement('h2')
    h2.textContent = 'Where should we begin?'
    const p = document.createElement('p')
    p.textContent =
      'uniAI is your independent UniWork assistant — Token Hub on the web, optional Office deep links on this device.'
    const pickerLabel = document.createElement('p')
    pickerLabel.className = 'avatar-picker-label'
    pickerLabel.textContent = 'Chọn avatar'
    const picker = document.createElement('div')
    picker.className = 'avatar-picker'
    picker.setAttribute('role', 'listbox')
    picker.setAttribute('aria-label', 'Chọn avatar uniAI')
    fillAvatarPicker(picker, () => renderThread())
    empty.append(mark, h2, p, pickerLabel, picker)
    el.thread.appendChild(empty)
    renderSuggestions(true)
    return
  }

  renderSuggestions(false)
  for (const m of chat.messages) {
    const row = document.createElement('div')
    row.className = `msg ${m.role}`
    if (m.role === 'assistant') {
      const av = document.createElement('div')
      av.className = 'msg-avatar'
      av.setAttribute('aria-hidden', 'true')
      paintAvatar(av)
      row.appendChild(av)
    }
    const body = document.createElement('div')
    body.className = 'msg-body'
    body.textContent = m.text
    row.appendChild(body)
    el.thread.appendChild(row)
  }
  el.thread.scrollTop = el.thread.scrollHeight
}

function render() {
  applyPrefs()
  renderList()
  renderOfficeDocs()
  if (navView === 'chat') renderThread()
  else renderLibrary()
  renderChips()
  syncSendEnabled()
}

/**
 * @param {string} text
 * @param {Attachment[]} atts
 */
function demoReply(text, atts) {
  const lower = text.toLowerCase()
  const plugins = atts.filter((a) => a.kind === 'plugin')
  const files = atts.filter((a) => a.kind === 'file')

  if (plugins.length || files.length) {
    const lines = ['Đã nhận ngữ cảnh đính kèm:']
    for (const p of plugins) lines.push(`• ${p.label}`)
    for (const f of files) lines.push(`• ${f.label}`)
    const wb = plugins.find((p) => p.pluginKind === 'workbench')
    if (wb?.pluginId) {
      lines.push('')
      lines.push(`Deep link Workbench (nếu Office đã cài):`)
      lines.push(intentUrl(wb.pluginId, `Open ${wb.label}`))
    }
    if (plugins.some((p) => p.pluginKind === 'office')) {
      lines.push('')
      lines.push(
        'Plugin Office đã kết nối vào cuộc trò chuyện. Token Hub sẽ dùng ngữ cảnh này khi soạn / chuyển file trong production.',
      )
    }
    return lines.join('\n')
  }

  if (lower.includes('health') || lower.includes('sức')) {
    return (
      'I can open Health in UniWork Office on this device.\n\n' +
      `Deep link:\n${intentUrl('health', 'Open Health')}\n\n` +
      'Hoặc dùng + → Plugin → Workbench → Sức khoẻ.'
    )
  }
  if (lower.includes('token')) {
    return (
      'Token Hub meters uniAI usage on your UniWork account.\n\n' +
      'Sign in on the web PWA to use your balance. Desktop Office is optional for chat.'
    )
  }
  return (
    'uniAI received your message.\n\n' +
    'Dùng nút + để mở Camera, Ảnh, Tệp, hoặc Plugin (Office + Workbench).'
  )
}

/** @param {string} text */
function send(text) {
  const trimmed = text.trim()
  const atts = [...attachments]
  if (!trimmed && atts.length === 0) return
  const chat = activeChat()
  const composed =
    trimmed ||
    atts.map((a) => a.label).join(', ')
  if (chat.messages.length === 0) {
    chat.title = composed.slice(0, 48)
  }
  const userLines = []
  if (trimmed) userLines.push(trimmed)
  if (atts.length) {
    userLines.push('')
    userLines.push(atts.map((a) => `[${a.label}]`).join(' '))
  }
  chat.messages.push({ role: 'user', text: userLines.join('\n').trim() })
  chat.messages.push({ role: 'assistant', text: demoReply(trimmed, atts) })
  // Keep plugin connections across turns; clear one-shot files.
  attachments = atts.filter((a) => a.kind === 'plugin')
  saveChats(chats)
  el.input.value = ''
  autosize()
  render()
}

function autosize() {
  el.input.style.height = 'auto'
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault()
  send(el.input.value)
})

el.input.addEventListener('input', () => {
  autosize()
  syncSendEnabled()
})

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && prefs.enterToSend) {
    e.preventDefault()
    send(el.input.value)
  }
})

el.btnNew.addEventListener('click', () => {
  const c = newChat()
  chats = [c, ...chats]
  activeId = c.id
  attachments = []
  saveChats(chats)
  setAttachMenuOpen(false)
  setPluginOpen(false)
  setSettingsOpen(false)
  setNavView('chat')
  render()
  el.input.focus()
})

document.querySelectorAll('.nav-item[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-nav')
    if (view === 'office') {
      // First click expands; if already on office, toggle collapse.
      if (navView === 'office') {
        officeExpanded = !officeExpanded
        renderOfficeDocs()
        return
      }
      officeExpanded = true
      setNavView('office')
      renderOfficeDocs()
      return
    }
    if (view === 'knowledge' || view === 'documents' || view === 'tasks' || view === 'projects') {
      setNavView(view)
    }
  })
})

el.btnSettings?.addEventListener('click', () => setSettingsOpen(true))
el.btnSettingsClose?.addEventListener('click', () => setSettingsOpen(false))
el.settingsScrim?.addEventListener('click', () => setSettingsOpen(false))

el.btnMenu.addEventListener('click', () => setSidebarOpen(true))
el.scrim.addEventListener('click', () => setSidebarOpen(false))

el.btnAttach.addEventListener('click', (e) => {
  e.preventDefault()
  e.stopPropagation()
  const willOpen = el.attachMenu.hidden
  setAttachMenuOpen(willOpen)
})

el.attachMenu.addEventListener('click', (e) => {
  e.stopPropagation()
  const btn = e.target.closest('[data-attach]')
  if (!btn) return
  const action = btn.getAttribute('data-attach')
  setAttachMenuOpen(false)
  if (action === 'camera') el.inputCamera.click()
  else if (action === 'photo') el.inputPhoto.click()
  else if (action === 'file') el.inputFile.click()
  else if (action === 'plugin') setPluginOpen(true)
})

el.inputCamera.addEventListener('change', () => {
  addFiles(el.inputCamera.files)
  el.inputCamera.value = ''
})
el.inputPhoto.addEventListener('change', () => {
  addFiles(el.inputPhoto.files)
  el.inputPhoto.value = ''
})
el.inputFile.addEventListener('change', () => {
  addFiles(el.inputFile.files)
  el.inputFile.value = ''
})

el.btnPluginClose.addEventListener('click', () => setPluginOpen(false))
el.pluginScrim.addEventListener('click', () => setPluginOpen(false))

el.pluginSearch?.addEventListener('input', () => {
  pluginQuery = el.pluginSearch.value
  renderPluginPanel()
})

document.addEventListener(
  'pointerdown',
  (e) => {
    if (el.attachMenu.hidden) return
    const t = e.target
    if (
      t instanceof Node &&
      !el.attachMenu.contains(t) &&
      t !== el.btnAttach &&
      !el.btnAttach.contains(t)
    ) {
      setAttachMenuOpen(false)
    }
  },
  true,
)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setAttachMenuOpen(false)
    setPluginOpen(false)
    setSettingsOpen(false)
  }
})

/** @type {BeforeInstallPromptEvent | null} */
let deferredInstall = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = /** @type {BeforeInstallPromptEvent} */ (e)
  el.btnInstall.hidden = false
})

el.btnInstall.addEventListener('click', async () => {
  if (!deferredInstall) return
  await deferredInstall.prompt()
  deferredInstall = null
  el.btnInstall.hidden = true
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js')
  })
}

render()
el.input.focus()
