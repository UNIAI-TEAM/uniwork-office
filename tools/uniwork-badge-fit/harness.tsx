// Renderer page for tools/uniwork-badge-fit/run.mjs: the real TabBar (real
// tabbar.css + tokens.css + the real chip / notice components) with the
// window.aiOffice / window.aiOfficeTabs bridges stubbed, so a state can be
// chosen from the page URL: ?lang=vi&theme=dark&state=signed-out
import { createRoot } from 'react-dom/client'
import '@genoffice/ui/tokens.css'
import '../../apps/shell/src/renderer/src/tabbar.css'
import { LocaleProvider } from '../../apps/shell/src/renderer/src/locale'
import { TabBar } from '../../apps/shell/src/renderer/src/TabBar'
import type {
  AccountState,
  UniworkDocStatus,
  UniworkLaunchEvent,
} from '../../apps/shell/src/shared/home-api'
import type { TabSummary } from '../../apps/shell/src/shared/tabs-api'

const params = new URLSearchParams(location.search)
const lang = (params.get('lang') ?? 'en') as 'en' | 'vi'
const theme = params.get('theme') ?? 'light'
const stateName = params.get('state') ?? 'saved'

const PATH = 'C:\\ud\\uniwork-documents\\d1\\Báo cáo quý.docx'
const base: UniworkDocStatus = {
  path: PATH,
  documentId: 'd1',
  workspaceId: 'w1',
  title: 'Báo cáo quý',
  format: 'docx',
  access: 'edit',
  state: 'saved',
  lastSavedAt: '2026-10-10T08:15:00',
}

interface Scenario {
  doc?: Partial<UniworkDocStatus>
  account?: AccountState
  notice?: UniworkLaunchEvent
}

/** every chip state, plus the launch notices (alone and next to a chip) */
const SCENARIOS: Record<string, Scenario> = {
  saved: { doc: { state: 'saved' } },
  saving: { doc: { state: 'saving' } },
  unsaved: { doc: { state: 'dirty' } },
  'sign-in-again': { doc: { state: 'signed-out' }, account: 'session-expired' },
  'sign-in-retry': { doc: { state: 'signed-out' } },
  offline: { doc: { state: 'offline', error: 'network' } },
  unreachable: { doc: { state: 'offline', error: 'server_error' } },
  conflict: { doc: { state: 'conflict' } },
  'view-only': { doc: { access: 'view' } },
  blocked: { doc: { state: 'blocked', error: 'quota_exceeded' } },
  error: { doc: { state: 'error', error: 'server_error' } },
  'notice-opening': {
    notice: {
      phase: 'opening',
      title: 'Báo cáo tài chính quý ba năm hai nghìn không trăm hai mươi sáu.docx',
    },
  },
  'notice-sign-in': { notice: { phase: 'needs-sign-in' }, account: 'session-expired' },
  'notice-failed': { notice: { phase: 'failed', error: 'ticket_expired' } },
  'notice-and-chip': {
    doc: { state: 'signed-out' },
    account: 'session-expired',
    notice: { phase: 'needs-sign-in' },
  },
}

const scenario = SCENARIOS[stateName] ?? {}
const account: AccountState = scenario.account ?? 'signed-in'
const status: UniworkDocStatus | null = scenario.doc ? { ...base, ...scenario.doc } : null

const tabs: TabSummary[] = [
  { id: 'home', kind: 'home', title: 'UniWork Office', closable: false, active: false },
  {
    id: 't1',
    kind: 'docs',
    title: 'Báo cáo quý.docx',
    closable: true,
    active: true,
    filePath: PATH,
  },
  { id: 't2', kind: 'sheets', title: 'Bảng lương tháng mười.xlsx', closable: true, active: false },
  { id: 't3', kind: 'slides', title: 'Trình bày kế hoạch.pptx', closable: true, active: false },
  { id: 't4', kind: 'markdown', title: 'Ghi chú họp.md', closable: true, active: false },
  { id: 't5', kind: 'pdf', title: 'Hợp đồng.pdf', closable: true, active: false },
]

const noop = (): Promise<undefined> => Promise.resolve(undefined)
// any bridge call not listed resolves to undefined; `on…` subscriptions return an unsubscribe
const stub = (own: Record<string, unknown>) =>
  new Proxy(own, {
    get: (target, key: string) =>
      key in target ? target[key] : key.startsWith('on') ? () => () => undefined : noop,
  })

const win = window as unknown as Record<string, unknown>
win.aiOfficeTabs = stub({ list: () => Promise.resolve(tabs) })
win.aiOffice = stub({
  accountStatus: () => Promise.resolve({ loggedIn: account === 'signed-in', state: account }),
  uniworkDocStatus: () => Promise.resolve(status),
  uniworkActiveDocStatus: () => Promise.resolve(status),
  onUniworkLaunch: (cb: (event: UniworkLaunchEvent) => void) => {
    if (scenario.notice) setTimeout(() => cb(scenario.notice!), 0)
    return () => undefined
  },
  setLanguage: noop,
})

win.__scenarios = Object.keys(SCENARIOS)
document.documentElement.lang = lang
if (theme !== 'system') document.documentElement.setAttribute('data-theme', theme)
createRoot(document.getElementById('root')!).render(
  <LocaleProvider initial={lang}>
    <TabBar />
  </LocaleProvider>,
)
