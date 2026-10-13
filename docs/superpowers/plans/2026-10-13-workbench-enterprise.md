# Bàn làm việc doanh nghiệp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến Bàn làm việc thành cửa sổ desktop của UniWork Home cho nhân viên doanh nghiệp: gỡ toàn bộ code giáo dục và đời sống, lấy Tổng quan, Việc, Lịch và Hồ sơ từ server UniWork, và làm lại giao diện theo token UniWork.
**Architecture:** Main process có client `uniwork-work` dùng chung đường gửi đã gia cố của `uniwork-docs` (token chỉ nằm trong main) và expose qua IPC `uniwork-work:*` thành `window.uniworkWork`, mọi lời gọi trả `UniworkWorkResult<T>`. Renderer giữ workspace đang chọn trong `wb_kv` (bucket theo deployment + account + org), cache câu trả lời gần nhất theo bucket + workspace, và vẽ các tab server (Tổng quan, Việc, Lịch, Hồ sơ) bằng token tint/signal mới. Biểu mẫu, Ghi chú và 4 trụ cột vẫn lưu cục bộ.
**Tech Stack:** Electron (electron-vite), React 18 + TypeScript, vitest (node và jsdom), Playwright, CSS custom properties trong `packages/ui/src/tokens.css`, npm workspaces; server UniWork (Go) và `uniwork:packages/core` chỉ dùng để tham chiếu.
**Spec:** docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md

## Global Constraints

- Accent của shell (`apps/shell/src/renderer/src/home.css`, đủ 3 khối): `--accent` light `#0a52e6` + `--on-accent` `#ffffff`; dark và system-dark `--accent` `#5a96ff` + `--on-accent` `#0d1220`; `--accent-hover` light `#0843bd`, dark `#7aabff`; `--shadow-btn-primary` dùng rgb của accent mới; `--accent-soft` (`#eaf0fd` / `#24354d`) giữ nguyên; mark UniAI giữ gradient riêng.
- Token mới trong `packages/ui/src/tokens.css`: `--tint-{gray,green,yellow,orange,violet,blue,teal,pink}`, `--tint-<hue>-fg`, `--info`, `--info-bg`; giá trị chép từ `uniwork:packages/ui/styles/tokens.css` (đổi `-foreground`→`-fg`, `info-soft`→`info-bg`), không chép selector.
- Mỗi token mới có giá trị trong cả 3 khối: `:root` (light), `[data-theme='dark']`, và `@media (prefers-color-scheme: dark) :root:not([data-theme='light']):not([data-theme='dark'])`.
- Bảng tint module (`module-tones.ts`): Tổng quan `gray`, Việc `green`, Lịch `yellow`, Hồ sơ `pink`, Biểu mẫu `teal`, Ghi chú `gray`, Tri thức (`knowledge`/`materials`/`skills`/`compose`) `blue`; cuộc họp trong Lịch dùng `violet` (`MEETING_TINT`).
- Thang chữ: 11 (overline), 12 (caption), 13/14 (body), 18–20 (title).
- Radius: 6, 8, 10, 12.
- Chuyển động 150–250 ms, chỉ để diễn tả thay đổi, tôn trọng `prefers-reduced-motion`; bỏ `wb-ms-breathe`, gradient hero và fade-up.
- Không hex / `rgb()` / `hsl()` thô trong CSS renderer và inline style của chrome; chỉ được viết giá trị thô trên dòng định nghĩa `--x: …;`. `npm run check:theme-colors -- --base origin/main` phải pass sau mỗi task đụng CSS.
- i18n: chuỗi Bàn làm việc nằm ở `apps/shell/src/renderer/src/i18n/workbench/<lang>.ts` + aggregator `i18n/strings-workbench.ts`; `zh.ts` định nghĩa bộ key; vi và en viết tay; 18 locale còn lại là `{ ...en }`; mỗi shard `satisfies Record<keyof typeof zh, string>`; key có tiền tố `wb`; không bao giờ định nghĩa lại `wbLoadFailedTitle` / `wbLoadFailedBody`; không đưa `t` của `useI18n()` vào mảng phụ thuộc của hook.
- Tiếng Việt trang trọng, không trộn từ UI tiếng Anh (workspace, task, meeting, tab, inbox, online, offline, profile).
- Làm mới dữ liệu: khi mở tab, khi cửa sổ được focus lại, khi bấm "Làm mới" (`WB_REFRESH_EVENT` + `refreshTick`), và mỗi 60 giây khi Tổng quan đang hiện (`HOME_REFRESH_MS = 60_000`).
- Khóa bucket `wb_kv`: `local` khi chưa đăng nhập; còn lại `a-` + `sha256(`${deploymentId}\n${accountId}\n${orgId}`).hex.slice(0, 32)`; `orgId` là `''` khi đã đăng nhập nhưng chưa chọn org.
- Giữ đúng 13 vai trò: `legal`, `construction`, `procurement`, `sales`, `customer-care`, `entrepreneur`, `freelancer`, `content-creator`, `marketing`, `hr`, `accounting`, `it`, `real-estate`; mặc định `entrepreneur`.
- Module giữ lại: `desk`, `tasks`, `calendar`, `forms`, `notes`, `personal`; tab lõi luôn ghim: `desk`, `tasks`, `calendar` (`forms` thành tùy chọn).
- Lỗi có kiểu: renderer chỉ thấy `UniworkWorkResult<T> = { ok: true; value: T } | { ok: false; error: 'signed-out' | 'forbidden' | 'offline' | 'server' }`; handler không bao giờ throw sang renderer; token không bao giờ rời main.
- Sau mọi thay đổi ở `apps/*/src/main` hoặc preload: `npm run build -w @genoffice/shell`, nếu không thay đổi sẽ không chạy.
- Package workspace nằm trong `dependencies` của một app phải có trong danh sách `exclude` của `externalizeDepsPlugin` (shell hiện không dùng plugin này, C7; plan này không thêm dependency workspace mới).
- Không dữ liệu giả, trạng thái rỗng phải trung thực: nguồn lỗi hiện "—" kèm Thử lại, không hiện 0; offline hiện cache kèm "Cập nhật lúc HH:mm".
- Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Đổi workspace (hoặc org) khi tab đang tải: câu trả lời muộn của workspace cũ không được ghi đè workspace mới. Test ghim: Task 14 Step 12, `a late answer for the previous workspace never replaces the new one`.
2. Múi giờ quanh nửa đêm: "hôm nay" theo `timezone` của summary chứ không theo đồng hồ máy, nên cuộc họp lúc 00:30 giờ người dùng là ngày mai. Test ghim: Task 13 Step 4, `the summary zone decides today near midnight`.
3. Offline ngay lần mở đầu tiên, chưa có cache: tab Việc phải hiện lỗi kèm Thử lại rồi hồi phục, không kẹt ở skeleton. Test ghim: Task 14 Step 12, `offline on first load with nothing cached`.
4. Server trả status key không có trong catalogue: dòng hiện nguyên key, việc vẫn mở, tick gửi `'done'`. Test ghim: Task 14 Step 12, `a status key missing from the catalogue shows as-is and stays open`.
5. Server trả kind lịch mà desktop không biết: dòng hiện như lịch ngoài và mở trang Lịch trên web, không vỡ. Test ghim: Task 15 Step 9, `an event kind the desktop does not know shows as external`.

## Interface Contract

### Hợp đồng kiểu (contract.ts)

```ts
// ════════════════════════════════════════════════════════════════════════════
// FILE: apps/shell/src/shared/uniwork-work-api.ts   (new; see Correction C13)
// ════════════════════════════════════════════════════════════════════════════
import type {
  RecentEntry,
  UniworkDocErrorCode,
  UniworkDocSummary,
  UniworkWorkspaceRef,
} from './home-api'

/** The only failures the renderer ever sees from a work call. */
export type UniworkWorkError = 'signed-out' | 'forbidden' | 'offline' | 'server'

/** Same shape as the existing UniworkResult (`value`, not `data`; Correction C1). */
export type UniworkWorkResult<T> = { ok: true; value: T } | { ok: false; error: UniworkWorkError }

/** UniworkDocError codes → work errors. Main uses it, and the renderer uses it for uniworkListWorkspaces/ListDocuments results. */
export function workErrorOfDocCode(code: UniworkDocErrorCode): UniworkWorkError {
  switch (code) {
    case 'not_signed_in':
    case 'session_expired':
    case 'wrong_deployment':
      return 'signed-out'
    case 'forbidden':
    case 'not_found':
    case 'deleted':
      return 'forbidden'
    case 'network':
    case 'timeout':
      return 'offline'
    default:
      return 'server'
  }
}

// ── DTOs: server snake_case field names, only the fields the UI reads ─────

/** Server catalogue key. The built-in keys are listed. The server may send others. */
export type WorkTaskStatusKey =
  | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled'
  | (string & {})

export interface WorkTask {
  id: string
  workspace_id: string
  /** "PREFIX-N"; '' when absent. Shown where the spec says "dự án" (C9) */
  identifier: string
  title: string
  status: WorkTaskStatusKey
  priority: string // none|low|medium|high|urgent (wider at runtime)
  due_date?: string // YYYY-MM-DD
  due_at?: string // RFC3339
  project_id?: string | null
  updated_at: string
}

/** GET /workspaces/{ws}/task-statuses → `statuses[]` (main drops rows with archived_at). */
export interface WorkTaskStatus {
  id: string
  key: string // what PATCH /tasks/{id} takes in `status`
  name: string
  category: string // one of the 7 built-in categories
  color: string
  position: number
}

export interface WorkMeeting {
  id: string
  workspace_id: string
  title: string
  starts_at: string
  ends_at: string
  status?: string // 'IN_PROGRESS' = live (buildHomeHeadline)
}

export interface WorkNotification {
  id: string
  kind: string // NOTIFICATION_KINDS, wider at runtime
  workspace_id: string
  resource_type: string
  resource_id: string
  actor_kind: string
  title_key: string // e.g. "notifications.kind.task_assigned"
  params: Record<string, string>
  read_at?: string
  created_at: string
}

export type WorkHomeSource = 'tasks' | 'meetings' | 'notifications'

export interface WorkHomeCounts {
  open: number
  overdue: number
  due_today: number
  meetings_today: number
  unread: number
}

/** GET /workspaces/{ws}/home. Each section degrades on its own: a section that fails its schema becomes [] and its source is added to `partial`. */
export interface WorkHomeSummary {
  today: string // YYYY-MM-DD in `timezone`; a response without it is 'server'
  timezone: string // '' when absent
  counts: WorkHomeCounts
  my_work: WorkTask[]
  upcoming_meetings: WorkMeeting[]
  inbox: WorkNotification[]
  partial: WorkHomeSource[]
  generated_at: string
}

/** GET /workspaces/{ws}/calendar/events?from&to&mine=true → `events[]` */
export interface WorkCalendarEvent {
  id: string
  kind: 'task' | 'meeting' | 'external' | (string & {})
  entity_id: string
  title: string
  start: string
  end?: string | null
  all_day: boolean
  status?: string | null
  project_id?: string | null
}

/** GET /orgs/{orgSlug}/people/{userId} → `person` (`reports` ignored) */
export interface WorkPerson {
  user_id: string
  display_name: string
  email: string
  avatar_url?: string
  title: string
  department: { id: string; name: string } | null
  manager: { id: string; kind: string; display_name: string } | null
  timezone: string
}

/** Overview "Tài liệu gần đây": cloud rows from aiOffice.uniworkListDocuments, plus local recents labelled "trên máy". */
export type WorkRecentDocument =
  | { source: 'uniwork'; doc: UniworkDocSummary }
  | { source: 'local'; entry: RecentEntry }

export interface WorkCreateTaskInput {
  workspaceId: string
  title: string
  dueDate?: string // YYYY-MM-DD
  /** renderer mints one (crypto.randomUUID()) per intent and reuses it on Thử lại */
  idempotencyKey: string
}

/** Main builds the URL. The renderer never passes a URL (path shapes follow uniwork:packages/core/paths/paths.ts:64-84). */
export type WorkWebTarget =
  | { kind: 'task' | 'meeting' | 'room' | 'person'; orgSlug: string; wsSlug: string; id: string }
  | { kind: 'my-tasks' | 'calendar' | 'inbox' | 'tasks'; orgSlug: string; wsSlug: string }
  | { kind: 'onboarding' }

export const UNIWORK_WORK_CHANNELS = {
  homeSummary: 'uniwork-work:home-summary',
  myTasks: 'uniwork-work:my-tasks',
  taskStatuses: 'uniwork-work:task-statuses',
  setTaskStatus: 'uniwork-work:set-task-status',
  createTask: 'uniwork-work:create-task',
  calendarEvents: 'uniwork-work:calendar-events',
  myProfile: 'uniwork-work:my-profile',
  openWeb: 'uniwork-work:open-web',
} as const

/** window.uniworkWork (preload: contextBridge.exposeInMainWorld('uniworkWork', api)) */
export interface UniworkWorkApi {
  homeSummary(workspaceId: string): Promise<UniworkWorkResult<WorkHomeSummary>>
  myTasks(workspaceId: string): Promise<UniworkWorkResult<WorkTask[]>>
  taskStatuses(workspaceId: string): Promise<UniworkWorkResult<WorkTaskStatus[]>>
  /** status = catalogue KEY (e.g. 'done' / 'todo'), not a status id */
  setTaskStatus(taskId: string, status: string): Promise<UniworkWorkResult<WorkTask>>
  createTask(input: WorkCreateTaskInput): Promise<UniworkWorkResult<WorkTask>>
  calendarEvents(input: { workspaceId: string; from: string; to: string }): Promise<UniworkWorkResult<WorkCalendarEvent[]>>
  /** the signed-in user in the selected org (main resolves org slug + account id) */
  myProfile(): Promise<UniworkWorkResult<WorkPerson>>
  /** false when the target fails validation or no profile is set */
  openWeb(target: WorkWebTarget): Promise<boolean>
}
// Workspaces and recent cloud docs are NOT on this API: reuse
// window.aiOffice.uniworkListWorkspaces() and
// window.aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }), then slice to 6 (C4).

// ════════════════════════════════════════════════════════════════════════════
// CHANGE: apps/shell/src/shared/home-api.ts:146
// ════════════════════════════════════════════════════════════════════════════
export interface UniworkWorkspaceRef {
  id: string
  name: string
  orgId: string
  slug: string     // NEW: server `slug` ('' when absent)
  orgSlug: string  // NEW: server `organization_slug` ('' when absent)
}
// Parse change in uniwork-docs/client.ts:212-220. Also update
// e2e/fixtures/uniwork-documents-stub.ts:268-272 and tests/uniwork-docs-client.test.ts.

// ════════════════════════════════════════════════════════════════════════════
// CHANGE: apps/shell/src/main/uniwork-docs/client.ts — extract the hardened send
// ════════════════════════════════════════════════════════════════════════════
export interface UniworkCall<T> {
  method: 'GET' | 'POST' | 'PATCH' // PATCH is new
  route: string
  query?: URLSearchParams
  json?: unknown
  form?: FormData
  idempotencyKey?: string
  timeoutMs: number
  read(response: Response): Promise<T>
}
/** Body of today's `send` (client.ts:125-193), unchanged; the docs client calls it. */
export declare function createUniworkSend(
  options: UniworkDocsClientOptions,
): <T>(call: UniworkCall<T>) => Promise<T>
/** today's private `id()` (client.ts:78-81), exported */
export declare function uniworkId(value: string): string

// ════════════════════════════════════════════════════════════════════════════
// NEW: apps/shell/src/main/uniwork-work/client.ts  (+ parse.ts hand-written guards like uniwork-docs/parse.ts; no zod)
// ════════════════════════════════════════════════════════════════════════════
export interface UniworkWorkClient {
  homeSummary(workspaceId: string): Promise<WorkHomeSummary>                      // GET  /workspaces/{ws}/home
  myTasks(workspaceId: string): Promise<WorkTask[]>                               // GET  /workspaces/{ws}/my-tasks?limit=200 → .tasks
  taskStatuses(workspaceId: string): Promise<WorkTaskStatus[]>                    // GET  /workspaces/{ws}/task-statuses → .statuses
  setTaskStatus(taskId: string, status: string): Promise<WorkTask>                // PATCH /tasks/{taskID} body {status} → .task
  createTask(input: WorkCreateTaskInput): Promise<WorkTask>                       // POST /workspaces/{ws}/tasks body {title, due_date?} + Idempotency-Key → .task
  calendarEvents(i: { workspaceId: string; from: string; to: string }): Promise<WorkCalendarEvent[]> // GET /workspaces/{ws}/calendar/events?from&to&mine=true → .events
  person(orgSlug: string, userId: string): Promise<WorkPerson>                    // GET  /orgs/{orgSlug}/people/{userId} → .person
}
/** Throws UniworkDocError, like the docs client. Every call uses METADATA_TIMEOUT_MS. */
export declare function createUniworkWorkClient(options: UniworkDocsClientOptions): UniworkWorkClient

// NEW: apps/shell/src/main/uniwork-work/wiring.ts
export interface UniworkWorkDeps {
  profile(): DeploymentProfile | null                         // uniworkDeploymentProfile
  identity(): { accountId: string } | null                    // uniworkSessionIdentity
  org(): { id: string; slug: string } | null                  // () => uniworkAccount().status().org ?? null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T> // authorizedRequest
  openExternal(url: string): Promise<void>                    // shell.openExternal
  fetch?: FetchLike
}
/** Handlers wrap every call: `try { ok, value } catch (e) { ok:false, error: workErrorOfDocCode(e instanceof UniworkDocError ? e.code : 'server_error') }`.
 *  Called in main/index.ts beside createUniworkDocs (index.ts:4184). Rebuild the shell after any change. */
export declare function registerUniworkWork(ipcMain: IpcMain, deps: UniworkWorkDeps): void
// openWeb: `${new URL(profile.apiOrigin).origin}${path}`; each slug and id must match /^[A-Za-z0-9_-]{1,128}$/.
// shortcut: web origin = API origin (true on the prod edge); dev web runs elsewhere. Upgrade when the server exposes a web origin (C6).

// ════════════════════════════════════════════════════════════════════════════
// NEW: apps/shell/src/renderer/src/active-workspace.ts
// Stored in wb_kv through wbStoreGetRaw/wbStoreSetRaw. The bucket is already per
// (deployment, account, org), so the key carries no ids.
// ════════════════════════════════════════════════════════════════════════════
export const ACTIVE_WORKSPACE_KEY = 'uniwork.wb.activeWorkspace'
export declare function readActiveWorkspaceId(): string | null
export declare function writeActiveWorkspaceId(id: string): void
/** stored id when still listed, else the first workspace, else null (empty state + openWeb({kind:'onboarding'})) */
export declare function pickActiveWorkspace(
  items: readonly UniworkWorkspaceRef[],
  stored: string | null,
): string | null
// Workbench and UniworkOpenDialog (pickerReducer 'workspaces-loaded', uniwork-docs-model.ts:455-471) both call pickActiveWorkspace.
// Each writes the id back on 'select-workspace'.

// ════════════════════════════════════════════════════════════════════════════
// CHANGE: apps/shell/src/main/workbench-accounts.ts:30-44
// ════════════════════════════════════════════════════════════════════════════
export interface WorkbenchOwner {
  deploymentId: string
  accountId: string
  orgId: string // NEW: '' while signed in before an org is selected
}
/** `local` when null; else `a-` + sha256(`${deploymentId}\n${accountId}\n${orgId}`).hex.slice(0, 32) */
export declare function workbenchBucketOf(owner: WorkbenchOwner | null): string
// syncWorkbenchOwner (index.ts:2927-2936) adds orgId: uniworkAccount().status().org?.id ?? ''.
// selectOrg already emits a status push, so an org switch re-buckets (manager.ts:351-372).

// ════════════════════════════════════════════════════════════════════════════
// CHANGE: packages/practice-core/src/modules.ts:9-28, 199-204
// ════════════════════════════════════════════════════════════════════════════
export type WorkbenchModuleId = 'desk' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = ['desk', 'tasks', 'calendar'] // 'forms' leaves core (C8)
// PRACTICE_IDS after the cut (types.ts:2-18 minus teacher, principal):
// 'legal','construction','procurement','sales','customer-care','entrepreneur','freelancer',
// 'content-creator','marketing','hr','accounting','it','real-estate'; default 'entrepreneur'

// ════════════════════════════════════════════════════════════════════════════
// NEW TOKENS: packages/ui/src/tokens.css. Add to all 3 blocks: :root (l.8),
// [data-theme='dark'] (l.96), @media (prefers-color-scheme: dark)
// :root:not([data-theme='light']):not([data-theme='dark']) (l.163-164).
// Values come from uniwork:packages/ui/styles/tokens.css, renamed -foreground→-fg and info-soft→info-bg.
// ════════════════════════════════════════════════════════════════════════════
//                 light bg / light fg        dark bg / dark fg
// --tint-gray     #eeeeef / #5c5c5c          #262626 / #a1a1aa
// --tint-green    #e6f7ee / #137046          #16301f / #4ade80
// --tint-yellow   #fff6d6 / #8f5300          #3a2f10 / #fbbf24
// --tint-orange   #ffece5 / #a84300          #3d2416 / #ffa06b
// --tint-violet   #efedfd / #7612fa          #2a1f4a / #b38cff
// --tint-blue     #e6f0ff / #0a66bc          #182640 / #5db4ff
// --tint-teal     #e0f5f2 / #0d6e66          #123430 / #3fd6c5
// --tint-pink     #fff1fe / #b8107f          #3d1a35 / #ff7ad9
// (fg token name: --tint-<hue>-fg)
// --info          #0a66bc                    #5db4ff
// --info-bg       #e6f0ff                    #182640
//
// Shell accent: apps/shell/src/renderer/src/home.css, all 3 blocks (l.3-23, 61-76, 79-96)
// --accent    light #0a52e6, dark #5a96ff
// --on-accent light #ffffff, dark #0d1220   (on-accent is the existing text-on-accent token)
// --shadow-btn-primary embeds the old accent rgb (l.22, 74, 93) and must be updated too.

// ════════════════════════════════════════════════════════════════════════════
// NEW: apps/shell/src/renderer/src/module-tones.ts
// ════════════════════════════════════════════════════════════════════════════
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
export type Tint = 'gray' | 'green' | 'yellow' | 'orange' | 'violet' | 'blue' | 'teal' | 'pink'
export const MODULE_TONES: Record<WorkbenchModuleId | PracticePillarId, Tint> = {
  desk: 'gray', tasks: 'green', calendar: 'yellow', personal: 'pink', forms: 'teal', notes: 'gray',
  knowledge: 'blue', materials: 'blue', skills: 'blue', compose: 'blue', // "Tri thức" = the 4 pillars
}
/** calendar agenda: task rows use MODULE_TONES.tasks; meeting rows use this (UniWork: "meetings keep violet") */
export const MEETING_TINT: Tint = 'violet'
export const tintStyle = (t: Tint) => ({ background: `var(--tint-${t})`, color: `var(--tint-${t}-fg)` })

// ════════════════════════════════════════════════════════════════════════════
// i18n: workbench shard
// ════════════════════════════════════════════════════════════════════════════
// Aggregator: apps/shell/src/renderer/src/i18n/strings-workbench.ts
//   export const workbenchStrings = defineStrings({ zh, en, ja, ko, fr, de, es, th, id, ru, ar, pt, it, pl, cs, nl, ms, he, hi, 'zh-TW': zhTW, vi })
// Shards: apps/shell/src/renderer/src/i18n/workbench/{zh,en,ja,ko,fr,de,es,th,id,ru,ar,pt,it,pl,cs,nl,ms,he,hi,zh-TW,vi}.ts
//   zh.ts: `export const zh = { ... }` (defines the key set)
//   others: `import type { zh } from './zh'; export const vi = { ... } satisfies Record<keyof typeof zh, string>` (zh-TW exports `zhTW`)
// Register in renderer/src/locale.tsx: add `| keyof typeof workbenchStrings.zh` to StringKey (l.18-23) and `...workbenchStrings[l]` to dicts (l.26-36).
// Key prefix: `wb`. NEVER reuse wbLoadFailedTitle / wbLoadFailedBody (already in the account shard); a duplicate key is overwritten silently by the spread.
// The navTeacher→navWorkbench rename stays in renderer/src/strings.ts (21 locales; l.10, 379, …).
```

### Quyết định hòa giải giữa các task (áp dụng cho toàn plan)

- **`window.uniworkWork` khai báo đúng một lần**, ở `declare global` của `apps/shell/src/renderer/src/Home.tsx` (Task 8), dạng **không optional** `uniworkWork: UniworkWorkApi` giống `aiOffice`. Không file nào khác được khai báo lại (hai khai báo khác modifier là lỗi tsc). `work-home.ts` (Task 13) không có `declare global`.
- **Shard i18n:** Task 11 tạo hạ tầng và chỉ seed các key dùng chung nhiều tab: `wbOnThisDevice` và câu thông báo `wbNotif_<server kind>` (18 kind) + `wbNotifFallback` (C10). Mỗi task giao diện sau đó tự thêm key của mình vào **chỉ ba file** `zh.ts`, `vi.ts`, `en.ts`: Task 12 `wbTop*`, Task 13 `wbOv*`, Task 14 `wbWork*` / `wbTasks*`, Task 15 `wbCal*`, Task 16 `wbProfile*`, Task 17 `wbNotes*`, Task 18 85 key của chuỗi `label(vi, en)` cũ (`wbCommon*`, `wbKn*`, `wbMat*`, `wbSk*`, `wbCmp*`, `wbTabs*`, `wbSkTabs*`, `wbForms*`, `wbAgentApplied`, `wbModuleUnknown`). 18 locale còn lại là `{ ...en }` nên tự nhận key mới. Task 12–17 thêm key bằng script `insert.cjs` (tạo ở Task 12 Step 10); Task 18 dùng `relabel.cjs`, vừa thay lời gọi vừa thêm key.
- **Tham số câu thông báo** lấy nguyên từ `params` của server; tên tham số khớp `uniwork:packages/core/i18n/locales/en.json` (`{{actor}}`, `{{task}}`, …).
- **Workspace trong `PracticeHome`** (Task 12, 13, 14): state `workspaces: UniworkWorkspaceRef[] | null` (null = đang tải), `workspaceId`, `workspaceError: UniworkWorkError | null`, `refreshTick`, và `refresh()`. Task 14 suy ra `workspace = workspaces?.find((w) => w.id === workspaceId) ?? null` và truyền vào `WorkbenchModulePane` qua prop `workspace`; khi `workspaces === null` các tab server hiện skeleton, nên `null` ở pane chỉ có nghĩa "chưa đăng nhập hoặc không thuộc workspace nào".
- **Vai trò không phải namespace dữ liệu (spec §5.6):** ghi chú và biểu mẫu lưu dưới khóa cố định `uniwork.wb.stickies` / `uniwork.wb.forms` trong bucket (Task 17 Step 9); ghim tab vẫn theo vai trò vì vai trò quyết định tab ghim mặc định.
- **Làm mới:** `refresh()` của `PracticeHome` vừa tăng `refreshTick` (Tổng quan) vừa phát `WB_REFRESH_EVENT = 'uniwork:wb-refresh'` (các tab server, Task 14 Step 18).
- **Selector E2E:** 5 ô số là `.wb-ov-stat` theo thứ tự Đang mở, Quá hạn, Đến hạn hôm nay, Họp hôm nay, Chưa đọc; thẻ tài liệu gần đây là `.wb-ov-recent`; mục nav tiếng Anh là `.nav-item` có chữ "Workbench".
- **Cột "dự án" (C9)** hiện `identifier`, nhãn "Mã việc" / "Key". **Quick add (C15)** không gửi `allow_duplicate`; 409 `active_duplicate_task` tới renderer là `'server'`.
- **`myProfile()`** khi đã đăng nhập nhưng chưa chọn org trả `{ ok: false, error: 'server' }`.
- **`uniworkId`** từ chối cả giá trị không phải chuỗi (`typeof value !== 'string'`) thành `not_found` (renderer thấy `'forbidden'`); caller của docs không bị ảnh hưởng.
- **`initialPickerState(workspaceId: string | null = null)`** nhận workspace đã lưu.
- **`defaultPinnedSkillDomains(practiceId: PracticeId)`** thay cho phiên bản không tham số; shell đọc vai trò từ wb_kv `uniwork.activePracticeId`.
- **My AI `add_item` → Việc** tạo việc trên UniWork nên `applyAgentIntent` thành async; `add_item` cho Lịch đổi thành `open` (không có route tạo họp). Vòng nhắc việc desktop (`workbench-reminders.ts`) bị xóa ở Task 13 cùng `DeskPane`.
- **File bị xóa sớm:** `DeskPane.tsx`, `workbench-desk.ts`, `workbench-reminders.ts` xóa ở Task 13; Task 14 và Task 17 chỉ kiểm tra chúng không còn.

### Sự thật đã xác minh

**Xác thực, client và lỗi**
- Base URL lấy từ `DeploymentProfile.apiOrigin` (`main/uniwork-auth/deployment.ts:11-17`). Client tài liệu được dựng trong `uniwork-docs/service.ts:249-262` với `profile.apiOrigin`, `deps.authorized` và `isSignedIn = identity() !== null`. `wiring.ts:222,227-228` cung cấp `uniworkDeploymentProfile`, `uniworkAccount().status().org?.id` và `authorizedRequest`.
- Token chỉ được dùng bên trong `authorizedRequest(call)` (`uniwork-auth/index.ts:276-279`), hàm này refresh một lần và thử lại một lần khi gặp 401. `uniworkSessionIdentity()` trả `{accountId, deviceSessionId, deploymentId}` và không bao giờ trả token (`index.ts:282-289`).
- `client.ts:24` định nghĩa `FetchLike`; `:26` đặt `METADATA_TIMEOUT_MS = 30_000`. `send` (`:125-193`):
  - throw `not_signed_in` khi chưa đăng nhập (`:126`);
  - chỉ nhận URL dưới `${origin}/api/v1/` (`:129`);
  - gửi `cache:'no-store'`, `redirect:'error'` (`:150-151`) và `Idempotency-Key` (`:137`);
  - đổi 401 thành `TransportError('unauthorized')` để `authorized()` thử lại (`:168-171`);
  - sau lần thử lại, `fromAuthFailure` map unauthorized, device_revoked và refresh_reused sang `session_expired` (`:90-105`).
- `errorFromResponse` (`errors.ts:60-88`) chỉ coi 403/404 là `forbidden` / `not_found` khi body có envelope `{error:{code}}`. 403/404 trần thành `server_error`.
- Helper kết quả hiện có trả `{ok:true,value}|{ok:false,error}` (`service.ts:168-174`, `home-api.ts:168`).

**Kiểu dùng chung, preload và window API**
- `UniworkWorkspaceRef = {id, name, orgId}` (`home-api.ts:146-150`), parse từ `id`, `name`, `organization_id` của server (`client.ts:212-220`). Server còn gửi `slug`, `organization_slug`, `organization_name` (`uniwork:server/internal/handler/organization.go:54-58`, `dto/sdo/workspace.go:13-20`).
- `AccountOrg = {id, name, slug, role}` (`home-api.ts:715-720`). `AccountStatus.org` ở `:750`.
- `accountId` của desktop là user id phía server (`manager.ts:427` so `me.id` với `credential.accountId`; `mapping.ts:71`).
- Pattern preload: `asUniworkResult` đổi reply sai dạng thành lỗi (`preload/index.ts:153-163`); lời gọi dùng `ipcRenderer.invoke(CHANNEL, …)` (`:822-836`); API expose bằng `contextBridge.exposeInMainWorld('aiOffice'|'aiOfficeProject'|'aiOfficeIntegrations'|'aiOfficeTabs', …)` (`:883, 946, 976, 1044`). Kiểu window khai báo trong file renderer dùng nó bằng `declare global { interface Window {…} }` (`Home.tsx:46-52`, `TabBar.tsx:13-17`). Pattern hằng kênh: `UNIWORK_DOC_CHANNELS` (`home-api.ts:1164-1180`).

**Bucket và workspace đang chọn**
- Bucket: `sha256(\`${deploymentId}\n${accountId}\`)` → `a-<32 hex>` (`workbench-accounts.ts:37-44`). Owner được đặt trong `syncWorkbenchOwner` (`main/index.ts:2927-2936`), do `onUniworkAccountStatus` kích hoạt (`index.ts:6451`). `selectOrg` kết thúc bằng `setState` nên phát một status push (`manager.ts:351-372`). Test: `apps/shell/tests/workbench-accounts.test.ts:27-71`.
- wb_kv đọc/ghi qua `wbStoreGetRaw/wbStoreSetRaw` (`renderer/src/workbench-store-client.ts:201,239`; mẫu dùng `skill-domain-pins.ts:6-26`). Không gian khóa `uniwork.*` là quy ước sẵn có.
- `workbench-bucket.ts` export `currentWorkbenchBucket`, `setCurrentWorkbenchBucket`, `clearCurrentWorkbenchBucket`, `isWorkbenchBucketCleared`, `wbMediaDbName`.

**Route và payload phía server**
- Mọi route trong hợp đồng (`registerTasks`, `registerTasksSuite`, `registerHome`, `registerCalendar`, `registerPeople`) nằm cùng nhóm `authed` (`RequireAuthWithDevice`) với `registerDocuments`, route desktop đã gọi thành công (`uniwork:server/internal/handler/router/router.go:133-179`). Không route nào sau feature flag.
- `PATCH /tasks/{taskID}`: `PatchTaskSDI.status` là key catalogue (`dto/sdi/task.go:32-45`); response `{task}` (`sdo/task.go:4-6`).
- `POST /workspaces/{ws}/tasks`: nhận `title`, `due_date` và header `Idempotency-Key` (`router/tasks.go:25-32`, `sdi/task.go:9-27`). Tiêu đề trùng một việc đang mở cho `active_duplicate_task`.
- `my-tasks` trả `{tasks,total,limit,offset}`, `relation` mặc định `all`, `limit` 50 (tối đa 200) (`sdi/task.go:89-94`, `core/api/endpoints/tasks-suite.ts:155-173`).
- `task-statuses` trả `{statuses,categories,total}`; mỗi status có `key/name/category/color/position/archived_at` (`core/types/task-catalog.ts:3-17`, `endpoints/task-catalog.ts:14-18`).
- Home: `{today,timezone,counts{open,overdue,due_today,meetings_today,unread},my_work,upcoming_meetings,inbox,partial,generated_at}` (`sdo/home.go:15-24`, `core/types/home.ts:8-27`). Drift được ghi vào `partial` theo tên nguồn (`core/api/endpoints/home.ts:17-34`). Logic câu đầu trang: `core/home/brief.ts:57-75`.
- Sự kiện lịch: `{events:[{id,kind,entity_id,title,start,end,all_day,status,priority,project_id,provider,external_url}]}` (`core/api/endpoints/calendar.ts:8-22,104-114`).
- `GET /orgs/{org}/people/{userID}` hiểu `{org}` là slug (`server/internal/handler/people.go:56-67` → `orgIDFromSlug`, `organization_members.go:31-38`, `service/organization.go:141-142`). Response `{person, reports}` (`core/api/endpoints/people.ts:22`); trường của person: `core/types/people.ts:28-47`.
- Đường dẫn web: `/${orgSlug}/${wsSlug}/tasks/{id}`, `/meetings/{id}`, `/meetings/{id}/room`, `/my-tasks`, `/calendar`, `/inbox`, `/people/{id}`, và `/onboarding` (`core/paths/paths.ts:21,64-84`). Trên prod, web và `/api` chung một host (`uniwork:deploy/edge/route.yaml:18-32`).
- Câu thông báo web dùng tham số `{{actor}}`, `{{task}}`, … (`uniwork:packages/core/i18n/locales/en.json`, ví dụ `"task_assigned": "{{actor}} assigned you “{{task}}”"`).

**Token và i18n**
- Các khối của `tokens.css`: `:root` l.8, `[data-theme='dark']` l.96, system dark l.163-164. Quy tắc accent theo app ở l.4. Accent và on-accent của shell: `home.css:3-23, 61-76, 79-96`.
- Tint nguồn: `uniwork:packages/ui/styles/tokens.css` l.266-283 (light) và l.474-491 (dark). `--info` l.173/420, `--info-soft` l.189/433.
- i18n: mẫu aggregator `i18n/strings-account.ts:1-47`, mẫu shard `i18n/account/{zh,vi}.ts`, gộp trong `locale.tsx:13-36`. Có 21 `LANGS` (`packages/i18n/src/index.ts:24-46`).
- Khóa lưu trữ `uniwork.teacher*` / `uniwork.teacherUiLang` chỉ còn trong ba allowlist (`backup-addons.ts:196,200`, `workbench-store-client.ts:29,31`, `main/workbench-db.ts:255,257`) và hai nơi ghi (`TeacherHome.tsx:109`, `PracticeHome.tsx:29`).

**Lệnh test (đã chạy thử)**
- Unit test shell: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/<file>.test.ts` (ví dụ `workbench-accounts.test.ts`, 14 pass). Config `apps/shell/vitest.config.ts`: `include tests/**/*.test.ts`, `environment node`.
  - Test component là file `.ts` có `/** @vitest-environment jsdom */`, dùng `createElement` + `react-dom/client`. Mẫu: `tests/uniwork-docs-ui-components.test.ts:1-8`.
- practice-core: `cd packages/practice-core && npx vitest run` (2 file, 9 pass trước plan).
- ui: `cd packages/ui && npx vitest run`.
- project-store: `cd packages/project-store && npx vitest run`.
- Typecheck từ gốc repo: `npm run typecheck -w @genoffice/shell` (tương tự `@uniwork/practice-core`, `@genoffice/ui`, `@genoffice/project-store`).
- Theme check: `npm run check:theme-colors -- --base origin/main` (dựa trên diff; base cũng lấy được từ env `FORMAT_BASE_REF`; `tools/check-theme-colors.mjs:10-16`).
- E2E từ gốc repo: `npm run build:all && npx playwright test --config e2e/playwright.config.ts e2e/<name>.spec.ts`, chạy tuần tự 1 worker.
  - Spec UniWork chạy với stub cục bộ (`e2e/fixtures/uniwork-auth-stub.ts`, `uniwork-documents-stub.ts`) và helper đăng nhập `fixtures/uniwork-signin-steps.ts`.
  - Bị skip với `NO_KEYRING_SKIP` khi máy không có OS keyring.

### Điều chỉnh so với spec

- **C1. Dạng kết quả.** Spec viết `{ok:true, data}`. Code hiện có dùng `value` (`home-api.ts:168`, `service.ts:170` và mọi reducer renderer, ví dụ `uniwork-docs-model.ts:463`). Hợp đồng dùng `value`.
- **C2. `setTaskStatus(taskId, statusId)` sai.** Body PATCH là `{status: <key catalogue>}` (`sdi/task.go:35`, `core/api/endpoints/tasks.ts:18-21`). Checkbox gửi `'done'` và `'todo'`.
- **C3. `person(org, userId)`: `{org}` là slug của org, không phải id.** Ngược lại `/orgs/{org}/workspaces` nhận id. Main tự giải cả hai giá trị, nên lời gọi phía renderer là `myProfile()` (slug từ `status.org.slug`, user id từ `identity.accountId`).
- **C4. `recentDocuments(ws)` không cần hàm client mới.** `listDocuments` không có query đã gọi `/documents/recent` (`client.ts:223-240`) và đã expose thành `aiOffice.uniworkListDocuments`. `parse.ts:127` bỏ các dòng không phải file, nên xin `limit: 20` rồi cắt còn 6.
- **C5. Thiếu slug workspace.** Liên kết web cần slug của org và workspace, nhưng `UniworkWorkspaceRef` chưa có. Hợp đồng mở rộng kiểu, phần parse, stub e2e (`uniwork-documents-stub.ts:268-272`) và `tests/uniwork-docs-client.test.ts`.
- **C6. Desktop không biết origin của web.** Prod phục vụ web và API cùng host. Ở dev, web chạy cổng khác (`apps/web/platform/runtime-config.ts:15`), nên `openWeb` dùng `apiOrigin` như một shortcut có đánh dấu.
- **C7. Dọn edu-core nhỏ hơn spec nói.**
  - `hub.ts` không còn ai dùng sau khi xóa: chỉ `main/edu-commercial.ts` (`probeAiHub`) và `TeacherHome.tsx` dùng nó, và cả hai đều bị xóa. Không cần chuyển gì.
  - Không danh sách `externalizeDepsPlugin` nào chứa edu-core; shell không có plugin này (`apps/shell/electron.vite.config.ts:6-12`).
  - Script `test` và `typecheck` ở `package.json:36-37` gốc chạy `-w @uniwork/edu-core`; phải gỡ, spec không nhắc.
- **C8. Biểu mẫu rời tab lõi.** `CORE_PINNED_MODULES` hiện có `'forms'` (`modules.ts:199-204`). Tab lõi của spec là Tổng quan, Việc và Lịch, nên Biểu mẫu thành tùy chọn.
- **C9. Không có tên dự án cho cột "dự án".** `Task` chỉ có `project_id` (`core/types/task.ts:61`) và dòng My work trên web cũng không hiện dự án. Hiện `identifier` thay thế (một route projects nữa nằm ngoài spec).
- **C10. Thông báo cần câu chữ phía desktop.** Server gửi `title_key` + `params` (`core/types/notification.ts:39-40`) cho 18 kind (`:4-23`), web dịch bằng file locale riêng. Shard Bàn làm việc cần một câu cho mỗi kind và một câu dự phòng cho kind lạ.
- **C11. E2E dùng stub, không dùng server dev.** Spec viết "đăng nhập server dev", nhưng repo dùng stub cục bộ. Mở rộng stub (Task 19 thêm `uniwork-work-stub.ts` với `/home`).
- **C12. Rủi ro §9.1 thấp hơn spec nói.** `/home` và `/my-tasks` cùng nhóm middleware với route tài liệu mà token desktop đã gọi được (`router.go:133-179`). Spike vẫn nên chạy nhưng khó là điểm chặn.
- **C13. Vị trí file kiểu.** Spec đặt kiểu `window.uniworkWork` trong `home-api.ts` (1196 dòng). Pattern của repo cho một window object riêng là file shared riêng (`shared/integrations-api.ts`, `shared/tabs-api.ts`), nên hợp đồng dùng `shared/uniwork-work-api.ts`.
- **C14. Va chạm bucket và key.**
  - Phiên đã đăng nhập nhưng chưa có org nhận `orgId ''`, bucket đổi khi org tải xong, gây một lần reload ngắn.
  - Ghi chú và biểu mẫu giờ sống theo org.
  - Key `wbLoadFailed*` đã có trong shard account; key trùng bị ghi đè mà không báo lỗi.
- **C15. Quick add với tiêu đề trùng thất bại.** Tiêu đề trùng một việc đang mở trả 409 `active_duplicate_task`, map thành `'server'`. Quyết định: không gửi `allow_duplicate`, giống mặc định server và web.

---

### Task 1: Spike: kiểm tra token desktop dùng được ở `/home` và `/my-tasks` (spec §9.1)

Task này không có code sản phẩm. Token chỉ nằm trong `authorizedRequest` ở main process, và test Node/vitest không chạm được OS keyring. Vì vậy spike là một bản vá dùng một lần vào `apps/shell/src/main/index.ts`, chạy một lần ở dev rồi hoàn tác bằng `git checkout`. Commit duy nhất là kết quả ghi vào spec.

Thứ tự: Task 2–6 (cắt gọn) không cần server, chạy được kể cả khi spike chưa xong. Task 7 trở đi phụ thuộc kết quả spike.

**Files:**
- Sửa tạm, hoàn tác ở Step 4: `apps/shell/src/main/index.ts` (khối import l.92-103; sau l.6451 `onUniworkAccountStatus(() => syncWorkbenchOwner())`)
- Modify: `docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md` (§9, sau mục 1)

**Interfaces:**
- Consumes: `authorizedRequest<T>(call: (token: string) => Promise<T>): Promise<T>`, `uniworkDeploymentProfile(): DeploymentProfile | null`, `uniworkSessionIdentity(): { accountId; deviceSessionId; deploymentId } | null`, `onUniworkAccountStatus(cb: (s: AccountStatus) => void)` (đều từ `./uniwork-auth`), và `TransportError` từ `./uniwork-auth/transport`.
- Produces: không có code sản phẩm, chỉ một kết luận được ghi lại.

- [ ] **Step 1: Bật server UniWork dev và chuẩn bị tài khoản có ít nhất một workspace**

Dùng deployment dev chung mà nhóm đang đăng nhập, hoặc chạy cục bộ:
```bash
cd /Users/ducquang/UNICOM/uniwork && make start   # API on http://localhost:8080 (.env PORT=8080)
```
Trên web app, đăng nhập và bảo đảm tài khoản có một org với ít nhất một workspace. Tạo một việc giao cho chính mình, hạn hôm nay.

- [ ] **Step 2: Áp bản probe dùng một lần (KHÔNG stage)**

Trong `apps/shell/src/main/index.ts`, mở rộng import `./uniwork-auth` (l.92-103):
```ts
import {
  bindAuthCallbackEvents,
  configureUniworkAccount,
  createAuthCallbackRouter,
  registerAccountIpc,
  routeAuthCallbackUrl,
  startUniworkAccount,
  startUniworkCloud,
  stopUniworkAccount,
  onUniworkAccountStatus,
  uniworkSessionIdentity,
  authorizedRequest,
  uniworkDeploymentProfile,
} from './uniwork-auth'
import { TransportError } from './uniwork-auth/transport'
```
Ngay sau `  onUniworkAccountStatus(() => syncWorkbenchOwner())` (l.6451), chèn:
```ts
  // SPIKE (Task 1): probe the work routes with the desktop token. Never commit.
  let spikeRan = false
  onUniworkAccountStatus((s) => {
    const profile = uniworkDeploymentProfile()
    const me = uniworkSessionIdentity()
    if (spikeRan || !s.loggedIn || !s.org || !profile || !me) return
    spikeRan = true
    const org = s.org
    const base = `${new URL(profile.apiOrigin).origin}/api/v1`
    const probe = async (route: string): Promise<{ status: number; body: unknown } | null> => {
      try {
        const r = await authorizedRequest(async (token) => {
          const res = await fetch(`${base}${route}`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
            cache: 'no-store',
            redirect: 'error',
          })
          if (res.status === 401) throw new TransportError('unauthorized', 401)
          return { status: res.status, body: (await res.json().catch(() => null)) as unknown }
        })
        const keys = r.body && typeof r.body === 'object' ? Object.keys(r.body).join(',') : ''
        console.log('[spike]', route, r.status, `keys=${keys}`, r.status >= 400 ? JSON.stringify(r.body) : '')
        return r
      } catch (e) {
        console.log('[spike]', route, 'REJECTED', e instanceof Error ? e.message : String(e))
        return null
      }
    }
    void (async () => {
      const ws = await probe(`/orgs/${org.id}/workspaces`)
      const first = (ws?.body as { workspaces?: { id: string }[] } | null)?.workspaces?.[0]?.id
      if (!first) return console.log('[spike] no workspace in this org: create one on the web, restart')
      const home = await probe(`/workspaces/${first}/home`)
      console.log('[spike] home.partial', JSON.stringify((home?.body as { partial?: unknown } | null)?.partial))
      await probe(`/workspaces/${first}/my-tasks?limit=5`)
      await probe(`/workspaces/${first}/task-statuses`)
      const from = new Date().toISOString().slice(0, 10)
      const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
      await probe(`/workspaces/${first}/calendar/events?from=${from}&to=${to}&mine=true`)
      await probe(`/orgs/${org.slug}/people/${me.accountId}`)
      await probe(`/workspaces/${first}/documents/recent?limit=1&kind=file`)
    })()
  })
```
Probe chỉ log mã trạng thái, các key cấp cao nhất và body lỗi, không bao giờ log token. Probe chỉ đọc: không PATCH, không POST, nên không đổi dữ liệu server.

Typecheck bản vá:
```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell
```
Kết quả mong đợi: exit 0.

- [ ] **Step 3: Chạy và ghi kết quả**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && UNIWORK_API_ORIGIN=http://localhost:8080 npm run dev
```
`UNIWORK_API_ORIGIN` chỉ có tác dụng khi chưa chọn server trong app (`deployment.ts:150-170`). Nếu đã lưu server khác, chọn server dev ở màn kết nối. Đăng nhập bằng tài khoản ở Step 1 và chọn org. Terminal của main process in các dòng `[spike]`.

Ghi lại:

| Route | Status | Keys / error code |
|---|---|---|
| `GET /orgs/{orgId}/workspaces` (đối chứng: client tài liệu đã dùng) | | |
| `GET /workspaces/{ws}/home` (+ `home.partial`) | | |
| `GET /workspaces/{ws}/my-tasks?limit=5` | | |
| `GET /workspaces/{ws}/task-statuses` | | |
| `GET /workspaces/{ws}/calendar/events?from&to&mine=true` | | |
| `GET /orgs/{orgSlug}/people/{accountId}` | | |
| `GET /workspaces/{ws}/documents/recent` (đối chứng) | | |

Ghi thêm phiên bản server: `git -C /Users/ducquang/UNICOM/uniwork rev-parse --short HEAD`, hoặc build của deployment dev nếu ở xa.

Kết quả mong đợi (C12): mọi dòng là 200. Key mong đợi: `today,timezone,counts,my_work,upcoming_meetings,inbox,partial,generated_at` cho home, `tasks,total,limit,offset` cho my-tasks, `statuses,categories,total` cho task-statuses, `events` cho calendar, `person,reports` cho people.

**Điều kiện DỪNG.** Không bắt đầu Task 7 hay bất kỳ task nào dùng server nếu một trong hai điều sau đúng:
- `/home` hoặc `/my-tasks` cho `REJECTED unauthorized`, 403 hoặc 404 trong khi hai dòng đối chứng trả 200;
- route people trả 403/404 cho chính account id của bạn.

Khi đó báo bảng kết quả cho người dùng. Theo §9.1, phải sửa server trước. 400 ở calendar là lỗi tham số của probe, không phải điểm dừng: sửa ngày rồi chạy lại.

- [ ] **Step 4: Hoàn tác probe và ghi kết quả**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && git checkout -- apps/shell/src/main/index.ts && git status --short apps/shell/src/main/index.ts
```
Kết quả mong đợi: không có output (file sạch).

Trong `docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md`, thêm một ghi chú thụt lề dưới §9 mục 1 (sau dòng kết thúc bằng `…xử lý phía server trước.`), điền giá trị đo được:
```markdown
   - Kết quả spike (YYYY-MM-DD, server `<sha hoặc build>`): `/home` <status>, `/my-tasks` <status>, `/task-statuses` <status>, `/calendar/events` <status>, `/people/{id}` <status>; đối chứng `/workspaces` và `/documents/recent` <status>. `home.partial` = <giá trị>. Kết luận: <tiếp tục | dừng, cần sửa server>.
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md
git commit -m "docs(spec): record the work-routes token spike result

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Gỡ module tiêu dùng và module không có server khỏi practice-core và mọi consumer trong shell

Ghi chú thứ tự: `@uniwork/practice-core` resolve về source (`node_modules/@uniwork/practice-core -> packages/practice-core`, `exports: ./src/index.ts`). Nếu chỉ thu hẹp union `WorkbenchModuleId` thì `npm run typecheck -w @genoffice/shell` báo 31 lỗi ở `WorkbenchModulePanes.tsx`, `WorkbenchIcons.tsx`, `agent-intent-apply.ts`, `context-manager.ts` và `my-ai-playbooks.ts` (đã thử trên bản sao). Để mọi task đều xanh, Task 2 sửa luôn năm file đó, chuỗi gợi ý trong `my-ai-router.ts` và hai test shell. Task 3 xóa file, store, widget, CSS và test không còn ai dùng.

**Files:**
- Modify: `packages/practice-core/src/modules.ts` (l.3-28 union + doc, l.41-47 gợi ý desk, l.73-88 và l.105-192 định nghĩa module, l.195-204 tab lõi)
- Modify: `packages/practice-core/src/agent-intent.ts` (l.99-100, l.103-119 `MODULE_KEYWORDS`; l.270-281 `moduleSupportsAddItem`)
- Test: `packages/practice-core/tests/practice-core.test.ts` (l.81-120), `packages/practice-core/tests/agent-intent.test.ts` (l.18-43)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (import l.4-51, l.82, dispatcher l.101-127; xóa l.132-182 và l.501-1683)
- Modify: `apps/shell/src/renderer/src/WorkbenchIcons.tsx` (xóa l.90-112 và l.131-267)
- Modify: `apps/shell/src/renderer/src/agent-intent-apply.ts` (l.9-31, l.101-108, l.118-157, l.178-198, l.257)
- Modify: `apps/shell/src/renderer/src/context-manager.ts` (l.13-21, l.90-137, l.203-218)
- Modify: `apps/shell/src/renderer/src/my-ai-playbooks.ts` (l.37, chip l.87-90, 150-151, 309-312, 368-371, 395-398, 423-424, 448-451; step l.106, 169-174, 325, 384, 410, 437, 463)
- Modify: `apps/shell/src/renderer/src/my-ai-router.ts` (l.792, l.794)
- Test: `apps/shell/tests/my-ai-playbooks-consent.test.ts` (l.11-21, l.56-62), `apps/shell/tests/my-ai-router-plan.test.ts` (l.23-41)

**Interfaces:**
- Produces (hợp đồng): `export type WorkbenchModuleId = 'desk' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'` và `export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = ['desk', 'tasks', 'calendar']`.
- Produces: `moduleSupportsAddItem(id)` chỉ đúng với `tasks | notes | calendar` (Task 15 thu tiếp về `tasks | notes`). `listAgentRoutableTabs()` liệt kê 6 module và 4 trụ cột.
- Consumes: không có gì mới. Pin đã lưu chứa id bị xóa được `ensureCorePinnedModules` sẵn có bỏ qua im lặng (lọc qua `isWorkbenchModuleId`).

- [ ] **Step 1: Viết test practice-core sẽ fail**

Trong `packages/practice-core/tests/practice-core.test.ts`, thay toàn bộ khối `it('exposes workbench modules and role defaults', …)` (l.81-120) bằng:
```ts
  it('exposes workbench modules and role defaults', () => {
    expect(WORKBENCH_MODULES.map((m) => m.id)).toEqual([
      'desk',
      'calendar',
      'tasks',
      'notes',
      'forms',
      'personal',
    ])
    const core = ['desk', 'tasks', 'calendar']
    expect(defaultPinnedModules('legal')).toEqual(core)
    expect(defaultPinnedModules('construction')).toEqual(core)
    expect(isCorePinnedModule('desk')).toBe(true)
    expect(isCorePinnedModule('forms')).toBe(false)
    expect(ensureCorePinnedModules(['desk', 'forms'])).toEqual([
      'desk',
      'tasks',
      'calendar',
      'forms',
    ])
    expect(ensureCorePinnedModules(['desk', 'health' as never, 'notes'])).toEqual([
      'desk',
      'tasks',
      'calendar',
      'notes',
    ])
  })
```
Trong `packages/practice-core/tests/agent-intent.test.ts`, thay l.18-21:
```ts
  it('resolves Vietnamese NL to health / tasks', () => {
    const health = resolveAgentIntentFromText('Mở tab sức khoẻ giúp tôi')
    expect(health?.target).toEqual({ kind: 'module', id: 'health' })
    expect(health?.action).toBe('open')
```
bằng:
```ts
  it('resolves Vietnamese NL to calendar / tasks', () => {
    const cal = resolveAgentIntentFromText('Mở tab lịch giúp tôi')
    expect(cal?.target).toEqual({ kind: 'module', id: 'calendar' })
    expect(cal?.action).toBe('open')
```
Rồi thay l.42-43:
```ts
    expect(moduleSupportsAddItem('assistant')).toBe(false)
  })
```
bằng:
```ts
    expect(moduleSupportsAddItem('forms')).toBe(false)
  })

  it('no longer routes removed consumer modules', () => {
    const ids = listAgentRoutableTabs().map((t) => t.id)
    for (const gone of ['health', 'personal-finance', 'family', 'email', 'assistant', 'clients']) {
      expect(ids).not.toContain(gone)
    }
    expect(parseAgentIntentTarget('pets')).toBeNull()
    expect(resolveAgentIntentFromText('Mở tab sức khoẻ giúp tôi')).toBeNull()
  })
```

- [ ] **Step 2: Chạy và thấy test fail**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run
```
Kết quả mong đợi: FAIL ở `exposes workbench modules and role defaults` (danh sách nhận được có 19 id) và ở `no longer routes removed consumer modules` (`expected [...] to not include 'health'`).

- [ ] **Step 3: Sửa practice-core**

`packages/practice-core/src/modules.ts`:
1. Xóa object module `email` và `assistant` (l.73-88) và từ `personal-finance` tới `matters` (l.105-192, dừng ngay trước `] as const`).
2. Thay l.3-28:
```ts
/**
 * Optional Workbench modules (pinned via Tab +).
 * Pillars (knowledge / materials / skills / compose) are also opt-in via Tab +.
 * Core always-on modules: My Space / Tasks / Calendar / Forms.
 * "Projects" is intentionally omitted — it maps to the Knowledge pillar.
 */
export type WorkbenchModuleId =
  | 'desk'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'email'
  | 'assistant'
  | 'forms'
  | 'personal'
  | 'personal-finance'
  | 'events'
  | 'health'
  | 'self-growth'
  | 'family'
  | 'friends'
  | 'pets'
  | 'travel'
  | 'clients'
  | 'contracts'
  | 'matters'
```
bằng:
```ts
/**
 * Optional Workbench modules (pinned via Tab +).
 * Pillars (knowledge / materials / skills / compose) are also opt-in via Tab +.
 * Core always-on modules: My Space / Tasks / Calendar.
 * "Projects" is intentionally omitted — it maps to the Knowledge pillar.
 */
export type WorkbenchModuleId = 'desk' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'
```
3. Trong định nghĩa `desk`, thay:
```ts
    hintVi: 'Tổng hợp việc làm & đời sống — chỉ số, nhắc, biểu đồ',
    hintEn: 'Work and life at a glance — KPIs, reminders, charts',
```
bằng:
```ts
    hintVi: 'Tổng hợp việc và lịch — chỉ số, nhắc, biểu đồ',
    hintEn: 'Tasks and calendar at a glance — KPIs, reminders, charts',
```
4. Thay:
```ts
/**
 * Always-on Workbench tabs (cannot be removed via Tab ×).
 * Order: My Space → Tasks → Calendar → Forms. Everything else is opt-in via +.
 */
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = [
  'desk',
  'tasks',
  'calendar',
  'forms',
]
```
bằng:
```ts
/**
 * Always-on Workbench tabs (cannot be removed via Tab ×).
 * Order: My Space → Tasks → Calendar. Everything else is opt-in via +.
 */
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = ['desk', 'tasks', 'calendar']
```

`packages/practice-core/src/agent-intent.ts`:
1. Xóa các dòng `MODULE_KEYWORDS` của `email` và `assistant` (l.99-100), rồi các dòng từ `personal-finance` tới `matters` (l.103-119). Phần còn lại:
```ts
const MODULE_KEYWORDS: readonly { id: WorkbenchModuleId; keys: readonly string[] }[] = [
  { id: 'desk', keys: ['my space', 'không gian', 'myspace', 'desk', 'bàn cá nhân'] },
  { id: 'calendar', keys: ['lịch', 'calendar', 'hẹn', 'deadline', 'cuộc họp'] },
  { id: 'tasks', keys: ['công việc', 'tasks', 'todo', 'việc cần', 'to-do', 'task'] },
  { id: 'notes', keys: ['ghi chú', 'notes', 'note', 'nháp'] },
  { id: 'forms', keys: ['biểu mẫu', 'forms', 'form', 'mẫu giấy'] },
  { id: 'personal', keys: ['hồ sơ', 'personal', 'cá nhân profile'] },
]
```
2. Thay thân `moduleSupportsAddItem` (l.271-280):
```ts
  return (
    id === 'tasks' ||
    id === 'notes' ||
    id === 'email' ||
    id === 'calendar' ||
    id === 'events' ||
    id === 'personal-finance' ||
    id === 'health' ||
    id === 'self-growth'
  )
```
bằng:
```ts
  return id === 'tasks' || id === 'notes' || id === 'calendar'
```

- [ ] **Step 4: Chạy test practice-core và typecheck**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @uniwork/practice-core
```
Kết quả mong đợi: `Tests 10 passed (10)`; typecheck exit 0.

- [ ] **Step 5: Viết test playbook shell sẽ fail**

Trong `apps/shell/tests/my-ai-playbooks-consent.test.ts`, thay l.11-21 (`it('matches sales quote → Word + task + Clients', …)`) bằng:
```ts
  it('matches sales quote → Word + task', () => {
    const hit = matchPracticePlaybook('sales', 'Soạn báo giá Word và thêm việc follow-up')
    expect(hit?.playbook.id).toBe('sales-quote')
    expect(hit?.steps).toHaveLength(2)
    expect(hit?.steps[0]).toMatchObject({ kind: 'fill_template', templateId: 'sales-quote' })
    expect(hit?.steps[1]?.kind).toBe('workbench')
  })

  it('only targets Workbench modules that still exist', () => {
    const practices = ['sales', 'accounting', 'procurement', 'real-estate', 'customer-care', 'legal'] as const
    for (const p of practices) {
      for (const chip of practiceMyAiChips(p)) {
        for (const s of matchPracticePlaybook(p, chip.promptVi)?.steps ?? []) {
          if (s.kind === 'workbench' && s.intent.target.kind === 'module') {
            expect(['tasks', 'calendar', 'notes']).toContain(s.intent.target.id)
          }
        }
      }
    }
  })
```
Thay l.56-62 (`it('accounting invoice → sheets + email draft + task', …)`) bằng:
```ts
  it('accounting invoice → sheets + task', () => {
    const hit = matchPracticePlaybook('accounting', 'Tạo hóa đơn Excel cho khách ABC')
    expect(hit?.playbook.id).toBe('accounting-invoice')
    expect(hit?.steps).toHaveLength(2)
    expect(hit?.steps[0]).toMatchObject({ kind: 'create_file', app: 'sheets' })
    expect(hit?.steps[1]?.kind).toBe('workbench')
  })
```
Trong `apps/shell/tests/my-ai-router-plan.test.ts`, thay l.23-41 (từ `it('builds create + task + open Clients plan with one goal (P3)'` tới dấu `}` đóng khối `r.steps[2]`) bằng đoạn sau. Ba dòng `goalVi` / `summaryVi` phía sau giữ nguyên.
```ts
  it('builds create + task plan with one goal (P3)', () => {
    const r = routeMyAiText('Soạn báo giá Word và thêm công việc follow-up khách', {
      practiceId: 'sales',
    })
    expect(r.kind).toBe('plan')
    if (r.kind !== 'plan') return
    expect(r.steps).toHaveLength(2)
    expect(r.steps[0]).toMatchObject({ kind: 'fill_template', templateId: 'sales-quote' })
    expect(r.steps[1]).toMatchObject({ kind: 'workbench' })
    if (r.steps[1]!.kind === 'workbench') {
      expect(r.steps[1].intent.action).toBe('add_item')
      expect(r.steps[1].intent.target).toEqual({ kind: 'module', id: 'tasks' })
    }
```

- [ ] **Step 6: Chạy và thấy test fail**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/my-ai-playbooks-consent.test.ts tests/my-ai-router-plan.test.ts
```
Kết quả mong đợi: FAIL, có `expected [ 'tasks', 'calendar', 'notes' ] to include 'clients'` và `expected [ …(3) ] to have a length of 2 but got 3`.

- [ ] **Step 7: Sửa shell (mọi lỗi biên dịch do đổi union)**

Lúc này `npm run typecheck -w @genoffice/shell` liệt kê 31 lỗi đã biết (TS2367, TS2353, TS2322, TS2345) trong năm file dưới. Các sửa sau xử lý hết.

**`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`.** Xóa từ dưới lên: trước tiên l.501-1683 (`function EventsPane` tới dấu `}` đóng `MattersPane` và dòng trống sau đó; `function escapeHtml` giữ lại), rồi l.132-182 (`function AssistantPane` và dòng trống sau). Sau đó thay import ở l.4-51:
```ts
import { CalendarPane } from './CalendarPane'
import { DeskPane } from './DeskPane'
import { FamilyPane } from './FamilyPane'
import { FinancePane } from './FinancePane'
import { FriendsPane } from './FriendsPane'
import { HealthPane } from './HealthPane'
import { EmailPane } from './EmailPane'
import { NotesPane } from './NotesPane'
import { PetsPane } from './PetsPane'
import { TasksPane } from './TasksPane'
import {
  WbDeleteBtn,
  WbDraftBtn,
  WbEditBtn,
  WbExpandBtn,
  WbFileBtn,
  WbMailBtn,
  WbRowActions,
} from './WbRowActions'
import {
  createEmailDraft,
  pinModule,
  readClients,
  readContracts,
  readEvents,
  defaultTravelChecklist,
  readForms,
  readGrowth,
  readMatters,
  readPersonal,
  readTravel,
  writeClients,
  writeContracts,
  writeEvents,
  writeForms,
  writeGrowth,
  writeMatters,
  writePersonal,
  writeTravel,
  type WbClientItem,
  type WbContractItem,
  type WbEventItem,
  type WbFormItem,
  type WbGrowthItem,
  type WbMatterItem,
  type WbPersonalProfile,
  type WbTravelTrip,
} from './workbench-pins'
```
bằng:
```ts
import { CalendarPane } from './CalendarPane'
import { DeskPane } from './DeskPane'
import { NotesPane } from './NotesPane'
import { TasksPane } from './TasksPane'
import { WbDeleteBtn, WbDraftBtn, WbEditBtn, WbFileBtn, WbRowActions } from './WbRowActions'
import {
  readForms,
  readPersonal,
  writeForms,
  writePersonal,
  type WbFormItem,
  type WbPersonalProfile,
} from './workbench-pins'
```
Thay `  const hideChrome = moduleId === 'desk' || moduleId === 'notes' || moduleId === 'email'` bằng `  const hideChrome = moduleId === 'desk' || moduleId === 'notes'`. Rồi thay đuôi dispatcher:
```tsx
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'email' && <EmailPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'assistant' && <AssistantPane vi={vi} packId={packId} />}
      {moduleId === 'forms' && (
        <FormsPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'personal' && <PersonalPane vi={vi} />}
      {moduleId === 'personal-finance' && <FinancePane vi={vi} />}
      {moduleId === 'events' && <EventsPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'health' && <HealthPane vi={vi} />}
      {moduleId === 'self-growth' && <GrowthPane vi={vi} />}
      {moduleId === 'family' && <FamilyPane vi={vi} />}
      {moduleId === 'friends' && <FriendsPane vi={vi} />}
      {moduleId === 'pets' && <PetsPane vi={vi} />}
      {moduleId === 'travel' && <TravelPane vi={vi} packId={packId} onPackLinked={onPackLinked} />}
      {moduleId === 'clients' && <ClientsPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'contracts' && (
        <ContractsPane
          practiceId={practiceId}
          vi={vi}
          packId={packId}
          onPackLinked={onPackLinked}
        />
      )}
      {moduleId === 'matters' && (
        <MattersPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
    </section>
```
bằng:
```tsx
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} vi={vi} />}
      {moduleId === 'forms' && (
        <FormsPane practiceId={practiceId} vi={vi} packId={packId} onPackLinked={onPackLinked} />
      )}
      {moduleId === 'personal' && <PersonalPane vi={vi} />}
    </section>
```

**`apps/shell/src/renderer/src/WorkbenchIcons.tsx`.** Xóa l.131-267 (các mục `'personal-finance'` tới `matters` của `BADGE`), rồi l.90-112 (mục `email` và `assistant`). `add` giữ lại.

**`apps/shell/src/renderer/src/agent-intent-apply.ts`.** Thay import `./workbench-pins` (l.9-31) bằng:
```ts
import {
  pinModule,
  pinPillar,
  readCalendar,
  readStickyNotes,
  createStickyNote,
  readPinnedModules,
  readTasks,
  writeCalendar,
  writeStickyNotes,
  writeTasks,
} from './workbench-pins'
```
Xóa khối `if (moduleId === 'email') { … }` trong `addItem` (l.101-108). Rồi thay toàn bộ từ `  if (moduleId === 'events') {` (l.118) tới `  return null` (l.157) bằng đúng một dòng `  return null`. Trong `undoAgentAddItem`, thay:
```ts
  } else if (moduleId === 'email') {
    writeEmails(
      practiceId,
      readEmails(practiceId).filter((m) => m.id !== itemId),
    )
  } else if (moduleId === 'calendar') {
    writeCalendar(
      practiceId,
      readCalendar(practiceId).filter((c) => c.id !== itemId),
    )
  } else if (moduleId === 'events') {
    writeEvents(
      practiceId,
      readEvents(practiceId).filter((e) => e.id !== itemId),
    )
  } else if (moduleId === 'personal-finance') {
    writeFinance(readFinance().filter((f) => f.id !== itemId))
  } else if (moduleId === 'health') {
    writeHealth(readHealth().filter((h) => h.id !== itemId))
  } else if (moduleId === 'self-growth') {
    writeGrowth(readGrowth().filter((g) => g.id !== itemId))
  } else {
```
bằng:
```ts
  } else if (moduleId === 'calendar') {
    writeCalendar(
      practiceId,
      readCalendar(practiceId).filter((c) => c.id !== itemId),
    )
  } else {
```
Trong nhánh `summarize`, đổi `      tabId: 'assistant',` thành `      tabId,`. Nếu không, `PracticeHome` sẽ `setTab('assistant')` và không còn gì để vẽ.

**`apps/shell/src/renderer/src/context-manager.ts`.** Thay import ở l.13-21 bằng `import { readCalendar, readNotes, readTasks } from './workbench-pins'`. Trong `moduleContext`, thay toàn bộ từ `  } else if (moduleId === 'email') {` tới hết nhánh `desk`:
```ts
  } else if (moduleId === 'desk') {
    const tasks = readTasks(practiceId).filter((t) => !t.done).length
    const events = readEvents(practiceId).length
    chunks.push({
      id: 'desk',
      source: 'local:desk',
      text: `My Space pulse: openTasks=${tasks}, events=${events}`,
    })
```
bằng:
```ts
  } else if (moduleId === 'desk') {
    const tasks = readTasks(practiceId).filter((t) => !t.done).length
    chunks.push({
      id: 'desk',
      source: 'local:desk',
      text: `My Space pulse: openTasks=${tasks}`,
    })
```
Trong `buildMyAiContextPack`, xóa câu lệnh `const mails = readEmails(practiceId).slice(0, MAX_LIST)` và lời gọi `chunks.push({ id: 'email', … })` theo sau cùng dòng trống sau nó (l.203-219).

**`apps/shell/src/renderer/src/my-ai-playbooks.ts`.**
- l.37: `  moduleId: 'tasks' | 'clients' | 'contracts' | 'calendar' | 'email' | 'notes',` thành `  moduleId: 'tasks' | 'calendar' | 'notes',`.
- Xóa các dòng step: l.106 `        wb('open', 'clients', 'Mở tab Clients', 'Mở Clients'),`; l.169-174 (lời gọi 6 dòng `wb('add_item', 'email', …)`); l.325 `        wb('open', 'contracts', 'Mở Contracts', 'Open Contracts'),`; l.384 `        wb('open', 'clients', 'Mở Clients', 'Open Clients'),`; l.410 `        wb('open', 'clients', 'Mở tab Clients', 'Mở Clients'),`; l.437 `        wb('open', 'clients', 'Mở Clients', 'Open Clients'),`; l.463 `        wb('open', 'contracts', 'Mở Contracts', 'Open Contracts'),`.
- Thay chữ trên chip (chính xác `trước` → `sau`):
  - `'Báo giá + việc + Clients'` → `'Báo giá + việc'`; `'Quote + task + Clients'` → `'Quote + task'`; `'Soạn báo giá Word và thêm việc follow-up, mở tab Clients'` → `'Soạn báo giá Word và thêm việc follow-up'`; `'Draft a Word quote and add a follow-up task, open Clients'` → `'Draft a Word quote and add a follow-up task'`
  - `'Tạo bảng hóa đơn Excel, nháp email yêu cầu chứng từ (tab Email), thêm việc đối soát'` → `'Tạo bảng hóa đơn Excel và thêm việc đối soát'`; `'Create an invoice sheet, draft a voucher-request in Email tab, add a reconcile task'` → `'Create an invoice sheet and add a reconcile task'`
  - `labelVi: 'RFP + Contracts'` → `labelVi: 'RFP + việc'`; `labelEn: 'RFP + Contracts'` → `labelEn: 'RFP + task'`; `'Soạn RFP / yêu cầu báo giá NCC Word, thêm việc chấm thầu, mở Contracts'` → `'Soạn RFP / yêu cầu báo giá NCC Word và thêm việc chấm thầu'`; `'Draft an RFP / vendor RFQ in Word, add an evaluation task, open Contracts'` → `'Draft an RFP / vendor RFQ in Word and add an evaluation task'`
  - `labelVi: 'Listing + Clients'` → `labelVi: 'Listing + việc'`; `labelEn: 'Listing + Clients'` → `labelEn: 'Listing + task'`; `'Soạn mô tả listing BĐS Word, thêm việc hẹn xem nhà, mở Clients'` → `'Soạn mô tả listing BĐS Word và thêm việc hẹn xem nhà'`; `'Draft a property listing in Word, add a viewing task, open Clients'` → `'Draft a property listing in Word and add a viewing task'`
  - `labelVi: 'Follow-up + Clients'` → `labelVi: 'Follow-up + việc'`; `labelEn: 'Follow-up + Clients'` → `labelEn: 'Follow-up + task'`; `'Soạn thư follow-up sau demo và thêm việc gọi lại, mở Clients'` → `'Soạn thư follow-up sau demo và thêm việc gọi lại'`; `'Draft a post-demo follow-up and add a callback task, open Clients'` → `'Draft a post-demo follow-up and add a callback task'`
  - `'Soạn thư trả lời khách khiếu nại và thêm việc theo dõi, mở Clients'` → `'Soạn thư trả lời khách khiếu nại và thêm việc theo dõi'`; `'Draft a complaint reply and add a follow-up task, open Clients'` → `'Draft a complaint reply and add a follow-up task'`
  - `labelVi: 'Hợp đồng + Contracts'` → `labelVi: 'Hợp đồng + việc'`; `labelEn: 'Contract + Contracts'` → `labelEn: 'Contract + task'`; `'Soạn hợp đồng thuê nhà Word và thêm việc rà soát, mở tab Contracts'` → `'Soạn hợp đồng thuê nhà Word và thêm việc rà soát'`; `'Draft a lease contract in Word and add a review task, open Contracts'` → `'Draft a lease contract in Word and add a review task'`

**`apps/shell/src/renderer/src/my-ai-router.ts`** (chuỗi gợi ý nhắc tới tab không còn):
- l.792 `'Thử: “Soạn báo giá Word và thêm việc follow-up, mở tab Clients”, “Mở file báo cáo”, “Tóm tắt file gần đây”.',` thành `'Thử: “Soạn báo giá Word và thêm việc follow-up”, “Mở file báo cáo”, “Tóm tắt file gần đây”.',`
- l.794 `'Try: “Draft a Word quote and add a follow-up task, open Clients”, “Open report file”, “Summarize recent files”.',` thành `'Try: “Draft a Word quote and add a follow-up task”, “Open report file”, “Summarize recent files”.',`

Sau bước này `FinancePane`, `HealthPane`, `FamilyPane`, `FriendsPane`, `PetsPane` và `EmailPane` không còn ai import nhưng vẫn biên dịch được. Task 3 xóa chúng.

- [ ] **Step 8: Chạy test shell và typecheck**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run
```
Kết quả mong đợi: typecheck exit 0, mọi file test shell pass (`Tests 2108 passed` trên bản chạy thử). Không file main nào đổi nên không cần rebuild shell.

- [ ] **Step 9: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add packages/practice-core/src/modules.ts packages/practice-core/src/agent-intent.ts packages/practice-core/tests/practice-core.test.ts packages/practice-core/tests/agent-intent.test.ts apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/WorkbenchIcons.tsx apps/shell/src/renderer/src/agent-intent-apply.ts apps/shell/src/renderer/src/context-manager.ts apps/shell/src/renderer/src/my-ai-playbooks.ts apps/shell/src/renderer/src/my-ai-router.ts apps/shell/tests/my-ai-playbooks-consent.test.ts apps/shell/tests/my-ai-router-plan.test.ts
git commit -m "refactor(practice-core,shell): cut the Workbench to desk, tasks, calendar, forms, notes, personal

Removes the life, client/contract/matter, events, assistant and email
modules from the module registry, agent intents and every shell consumer.
Forms leaves the core tabs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Xóa pane, store, widget desk, slot media và CSS mồ côi trong shell

**Files:**
- Delete: `apps/shell/src/renderer/src/{FinancePane.tsx,HealthPane.tsx,HealthMetricsViz.tsx,FamilyPane.tsx,FamilyTreeCanvas.tsx,family-tree-layout.ts,FriendsPane.tsx,PetsPane.tsx,EmailPane.tsx}`, `apps/shell/tests/family-tree-layout.test.ts`
- Modify: `apps/shell/src/renderer/src/workbench-pins.ts` (xóa l.518-644, l.669-735, l.760-1623; thay l.236-264)
- Modify: `apps/shell/src/renderer/src/WbRowActions.tsx` (xóa l.186-234)
- Replace: `apps/shell/src/renderer/src/workbench-desk.ts`, `apps/shell/src/renderer/src/DeskPane.tsx` (bản tạm giữ build xanh; Task 13 xóa cả hai)
- Modify: `apps/shell/src/renderer/src/workbench-media-backup.ts` (l.3, l.8-24, l.127, l.211-219)
- Modify: `apps/shell/src/shared/home-api.ts` (l.620-625), `apps/shell/src/main/workbench-backup.ts` (l.28-36). Đây là code main process nên phải rebuild shell.
- Modify: `apps/shell/src/renderer/src/my-ai-templates.ts` (l.7, l.216-219, l.284-300, l.311-343, l.362, l.369, l.385-390)
- Modify: `apps/shell/src/renderer/src/my-ai-forms.ts` (l.3-15, l.152-161, l.168-170, l.185-191, l.226-237)
- Modify: `apps/shell/src/renderer/src/my-ai-local-answer.ts` (l.7, l.14, l.31, l.87-90, l.148-151, l.263-273, l.316-321)
- Modify: `apps/shell/src/renderer/src/NewChatPane.tsx` (l.35, l.38, l.900-902, l.922-939, l.1652-1659)
- Modify: `apps/shell/src/renderer/src/home.css` (xóa l.3928-4005, 4703-4752, 4759-5050, 5321-5704, 5739-6053, 6086-6465, 7179-7206, 7264-7297, 7304-7326, 7337-7471, 7481-7502; sửa l.4006-4012)
- Test: `apps/shell/tests/my-ai-templates.test.ts`, `apps/shell/tests/my-ai-forms.test.ts`, `apps/shell/tests/my-ai-local-answer.test.ts`

**Interfaces:**
- Produces: `WbIdbMediaDump = { version: 1; tasks: Record<string, string> }` trong cả `workbench-media-backup.ts` và `shared/home-api.ts` (`WorkbenchIdbMediaDump`). ZIP backup cũ còn mang khóa `pets` và `health` vẫn nhập được, vì chỉ `tasks` được kiểm tra và khôi phục.
- Produces: `TemplateResolveResult = { template; slots; missing }` (bỏ `clientRow`). `buildFormFillBrief(opts: { form; vi; userHint; excerpt? })` (bỏ `clientRow`). Xóa `resolveFormFillContext`. `LocalAnswerSnapshot` bỏ `emails`, `LocalAnswerTopic` bỏ `'email'`.
- Produces: `DeskWidgetId = 'kpi-strip' | 'reminders' | 'tasks-ring' | 'calendar-14d'`. Layout đã lưu có id bị xóa được bộ lọc `isDeskWidgetId` sẵn có bỏ qua.
- Cố ý giữ lại: store việc cục bộ (`readTasks/writeTasks`, IndexedDB media của task) và store lịch (`readCalendar/writeCalendar`, không còn ghi kép sang events), cho tới khi tab Việc và Lịch từ server thay thế (Task 14, 15). CSS `.wb-pets-err` cũng giữ, vì `TasksPane.tsx:775` dùng nó (Task 14 xóa TasksPane, Task 17 xóa CSS).

- [ ] **Step 1: Cập nhật test theo hành vi mới**

`apps/shell/tests/my-ai-templates.test.ts`. Thay l.1-19 (các import và khối `vi.mock('../src/renderer/src/workbench-pins', …)`) bằng:
```ts
import { describe, expect, it } from 'vitest'
import {
  buildTemplateBrief,
  extractSlotsFromUserText,
  resolveTemplateSlots,
} from '../src/renderer/src/my-ai-templates'
```
Rồi thay `it('resolves sales-quote slots from clients + text', …)` (l.28-39) bằng:
```ts
  it('resolves sales-quote slots from the request text', () => {
    const r = resolveTemplateSlots(
      'sales',
      'sales-quote',
      'Soạn báo giá cho khách ABC gói Premier',
    )
    expect(r).not.toBeNull()
    expect(r!.missing).toHaveLength(0)
    expect(r!.slots.client).toBe('ABC')
    expect(r!.slots.party).toBe('ABC')
    expect(r!.slots.topic).toMatch(/Premier/i)
  })
```
và trong `builds structured brief with outline`, đổi `expect(brief).toMatch(/Công ty ABC/)` thành `expect(brief).toMatch(/Khách hàng: ABC/)`.

`apps/shell/tests/my-ai-forms.test.ts`. Xóa l.36 `  readClients: () => [{ id: 'c1', name: 'Công ty ABC', email: 'an@abc.vn' }],`. Rồi thay l.67-77 bằng:
```ts
  it('builds brief with excerpt + request', () => {
    const form = matchFormByQuery('sales', 'nghỉ phép')!
    const brief = buildFormFillBrief({
      form,
      vi: true,
      userHint: 'Điền biểu mẫu nghỉ phép cho khách ABC từ 10–12/10',
      excerpt: 'Họ tên: ____\nTừ ngày: ____',
    })
    expect(brief).toMatch(/Đơn xin nghỉ phép/)
    expect(brief).toMatch(/khách ABC/)
```
Các kỳ vọng `Họ tên`, `không bịa` và dấu `})` đóng giữ nguyên.

`apps/shell/tests/my-ai-local-answer.test.ts`. Xóa l.8 `  emails: [],`.

Xóa `apps/shell/tests/family-tree-layout.test.ts`: nó test `family-tree-layout.ts`, file bị xóa trong task này.

- [ ] **Step 2: Xóa các file pane**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell
git rm src/renderer/src/FinancePane.tsx src/renderer/src/HealthPane.tsx src/renderer/src/HealthMetricsViz.tsx src/renderer/src/FamilyPane.tsx src/renderer/src/FamilyTreeCanvas.tsx src/renderer/src/family-tree-layout.ts src/renderer/src/FriendsPane.tsx src/renderer/src/PetsPane.tsx src/renderer/src/EmailPane.tsx tests/family-tree-layout.test.ts
```

- [ ] **Step 3: Gỡ store khỏi `workbench-pins.ts`**

Xóa từ dưới lên, theo số dòng ở HEAD:
- l.760-1623: từ dòng trống sau `writePersonal` tới hết file. Gồm `readFinance/writeFinance`, `WbEventItem`, mọi kiểu, store và IndexedDB sức khỏe (`uniwork.wb.health.media`), `healthDeskCounts`, growth, `readEvents/writeEvents`, family, friends, pets cùng `compressPetImage` và `uniwork.wb.pets.media`, travel, và clients/contracts/matters. File kết thúc ở dấu `}` đóng `writePersonal`.
- l.669-735: `WbFinanceItem` tới `writeFinanceInvest` và dòng trống sau. `DEFAULT_PERSONAL` giữ lại.
- l.518-644: `WbEmailFolder` tới `createEmailDraft` và dòng trống sau.

Rồi bỏ việc ghi kép calendar↔events. Thay:
```ts
/** Guard re-entrant dual-write between Calendar ↔ Events. */
let calendarEventsSyncing = false

export function readCalendar(practiceId: PracticeId): WbCalendarItem[] {
  return readJson(`uniwork.wb.calendar.${practiceId}`, [])
}

export function writeCalendar(practiceId: PracticeId, items: WbCalendarItem[]): void {
  writeJson(`uniwork.wb.calendar.${practiceId}`, items)
  if (calendarEventsSyncing) return
  calendarEventsSyncing = true
  try {
    const events = readJson<WbEventItem[]>(`uniwork.wb.events.${practiceId}`, [])
    const map = new Map(events.map((e) => [e.id, e]))
    for (const c of items) {
      const prev = map.get(c.id)
      map.set(c.id, {
        id: c.id,
        date: c.date,
        title: c.title,
        ...(prev?.time ? { time: prev.time } : {}),
        ...(prev?.place ? { place: prev.place } : {}),
      })
    }
    writeJson(`uniwork.wb.events.${practiceId}`, [...map.values()])
  } finally {
    calendarEventsSyncing = false
  }
}
```
bằng:
```ts
export function readCalendar(practiceId: PracticeId): WbCalendarItem[] {
  return readJson(`uniwork.wb.calendar.${practiceId}`, [])
}

export function writeCalendar(practiceId: PracticeId, items: WbCalendarItem[]): void {
  writeJson(`uniwork.wb.calendar.${practiceId}`, items)
}
```
Khối import (l.1-19) giữ nguyên: mọi tên import vẫn được dùng.

- [ ] **Step 4: Gỡ nút mail/expand khỏi `WbRowActions.tsx`**

Xóa l.186-234 (`IconMail`, `IconChevron`, `WbMailBtn`, `WbExpandBtn`). Nơi dùng duy nhất là các pane vừa xóa và `WorkbenchModulePanes` (đã dọn ở Task 2). File kết thúc ở dấu `}` đóng `WbFileBtn`.

- [ ] **Step 5: Thay `workbench-desk.ts` (chỉ widget công việc)**

Thay toàn bộ file bằng:
```ts
import type { PracticeId } from '@uniwork/practice-core'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

/** Dashboard widget ids for Tab My Space (module id: desk). */
export type DeskWidgetId = 'kpi-strip' | 'reminders' | 'tasks-ring' | 'calendar-14d'

export interface DeskWidgetDef {
  id: DeskWidgetId
  labelVi: string
  labelEn: string
  hintVi: string
  hintEn: string
  /** Default visible for new layouts */
  defaultOn: boolean
  /** Wider card (full row) */
  wide?: boolean
}

export const DESK_WIDGETS: readonly DeskWidgetDef[] = [
  {
    id: 'kpi-strip',
    labelVi: 'Nhịp làm việc',
    labelEn: 'Work pulse',
    hintVi: 'Việc đang mở · lịch 7 ngày (dải hero)',
    hintEn: 'Open tasks · 7-day calendar (hero strip)',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'reminders',
    labelVi: 'Nhắc việc quan trọng',
    labelEn: 'Important reminders',
    hintVi: 'Hạn gần từ lịch và việc',
    hintEn: 'Upcoming from calendar and tasks',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'tasks-ring',
    labelVi: 'Tiến độ công việc',
    labelEn: 'Task progress',
    hintVi: 'Vòng hoàn thành việc',
    hintEn: 'Completion ring',
    defaultOn: true,
  },
  {
    id: 'calendar-14d',
    labelVi: 'Lịch 14 ngày',
    labelEn: '14-day calendar',
    hintVi: 'Mật độ mốc lịch',
    hintEn: 'Calendar density',
    defaultOn: true,
  },
] as const

/** Series colors for desk charts (screen UI). */
export const DESK_CHART = {
  tasks: '#4C8DFF',
  events: '#F5C542',
  track: 'color-mix(in srgb, var(--border) 70%, transparent)',
} as const

const LAYOUT_PREFIX = 'uniwork.wb.desk.layout.'

export function defaultDeskLayout(): DeskWidgetId[] {
  return DESK_WIDGETS.filter((w) => w.defaultOn).map((w) => w.id)
}

export function getDeskWidget(id: DeskWidgetId): DeskWidgetDef | undefined {
  return DESK_WIDGETS.find((w) => w.id === id)
}

export function isDeskWidgetId(value: unknown): value is DeskWidgetId {
  return typeof value === 'string' && DESK_WIDGETS.some((w) => w.id === value)
}

export function readDeskLayout(practiceId: PracticeId): DeskWidgetId[] {
  try {
    const raw = wbStoreGetRaw(LAYOUT_PREFIX + practiceId)
    if (raw === null) return defaultDeskLayout()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultDeskLayout()
    const ids = parsed.filter(isDeskWidgetId)
    return ids.length > 0 ? ids : defaultDeskLayout()
  } catch {
    return defaultDeskLayout()
  }
}

export function writeDeskLayout(practiceId: PracticeId, ids: DeskWidgetId[]): void {
  wbStoreSetRaw(LAYOUT_PREFIX + practiceId, JSON.stringify(ids))
}

export function daysFromToday(isoDate: string): number {
  const a = new Date()
  a.setHours(12, 0, 0, 0)
  const b = new Date(isoDate.slice(0, 10) + 'T12:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function addDaysIso(base: Date, delta: number): string {
  const d = new Date(base)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}
```
`DeskWidgetGroup`, `monthKey`, `formatMonthShort` và `lastNMonthKeys` chỉ widget tài chính dùng. `DESK_CHART` còn hex thô chỉ tạm thời: Task 13 xóa cả file khi Tổng quan thay `DeskPane`.

- [ ] **Step 6: Thay `DeskPane.tsx` (không còn đọc finance, health, growth, family, events, clients, contracts, matters)**

Thay toàn bộ file bằng:
```tsx
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  DESK_CHART,
  DESK_WIDGETS,
  addDaysIso,
  daysFromToday,
  getDeskWidget,
  readDeskLayout,
  writeDeskLayout,
  type DeskWidgetId,
} from './workbench-desk'
import { readCalendar, readTasks } from './workbench-pins'
import {
  remindersEnabled,
  requestReminderPermission,
  setRemindersEnabled,
  startWorkbenchReminderLoop,
} from './workbench-reminders'

interface Props {
  practiceId: PracticeId
  vi: boolean
}

interface ReminderItem {
  id: string
  date: string
  title: string
  source: string
}

export function DeskPane({ practiceId, vi }: Props): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [layout, setLayout] = useState<DeskWidgetId[]>(() => readDeskLayout(practiceId))
  const [customOpen, setCustomOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [notifyOn, setNotifyOn] = useState(() => remindersEnabled())

  useEffect(() => {
    setLayout(readDeskLayout(practiceId))
    setCustomOpen(false)
  }, [practiceId])

  useEffect(() => {
    if (!notifyOn) return
    return startWorkbenchReminderLoop(() => practiceId)
  }, [notifyOn, practiceId])

  const toggleNotify = async () => {
    if (notifyOn) {
      setRemindersEnabled(false)
      setNotifyOn(false)
      return
    }
    const ok = await requestReminderPermission()
    if (!ok) return
    setRemindersEnabled(true)
    setNotifyOn(true)
  }

  const persist = (next: DeskWidgetId[]) => {
    setLayout(next)
    writeDeskLayout(practiceId, next)
  }

  const data = useMemo(() => {
    void tick
    const L = (a: string, b: string) => (vi ? a : b)
    const calendar = readCalendar(practiceId)
    const tasks = readTasks(practiceId)
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)

    const openTasks = tasks.filter((t) => !t.done)
    const doneTasks = tasks.filter((t) => t.done)
    const calendar7 = calendar.filter((c) => {
      if (c.done) return false
      const d = daysFromToday(c.date)
      return d >= 0 && d <= 7
    })

    const dayCounts = Array.from({ length: 14 }, (_, i) => {
      const iso = addDaysIso(today, i)
      return { iso, n: calendar.filter((c) => c.date === iso && !c.done).length }
    })

    const reminders: ReminderItem[] = []
    for (const c of calendar) {
      if (c.done) continue
      const d = daysFromToday(c.date)
      if (d < 0 || d > 21) continue
      reminders.push({
        id: `cal-${c.id}`,
        date: c.date,
        title: c.title,
        source: L('Lịch', 'Calendar'),
      })
    }
    for (const t of openTasks.slice(0, 8)) {
      reminders.push({
        id: `task-${t.id}`,
        date: todayIso,
        title: t.title,
        source: L('Việc', 'Tasks'),
      })
    }
    reminders.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))

    return {
      openTasks: openTasks.length,
      doneTasks: doneTasks.length,
      taskTotal: tasks.length,
      calendar7: calendar7.length,
      dayCounts,
      reminders: reminders.slice(0, 8),
    }
  }, [practiceId, vi, tick])

  const hidden = DESK_WIDGETS.filter((w) => !layout.includes(w.id))

  const move = (id: DeskWidgetId, dir: -1 | 1) => {
    const i = layout.indexOf(id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= layout.length) return
    const next = [...layout]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    persist(next)
  }

  const remove = (id: DeskWidgetId) => persist(layout.filter((x) => x !== id))
  const add = (id: DeskWidgetId) => {
    if (layout.includes(id)) return
    persist([...layout, id])
  }
  const reset = () => persist(DESK_WIDGETS.filter((w) => w.defaultOn).map((w) => w.id))

  const now = new Date()
  const hour = now.getHours()
  const greet =
    hour < 12
      ? label('Chào buổi sáng', 'Good morning')
      : hour < 18
        ? label('Chào buổi chiều', 'Good afternoon')
        : label('Chào buổi tối', 'Good evening')
  const dateLine = now.toLocaleDateString(vi ? 'vi-VN' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const showPulse = layout.includes('kpi-strip')
  const gridIds = layout.filter((id) => id !== 'kpi-strip')
  const nextReminder = data.reminders[0]

  const widgetTone = (id: DeskWidgetId): string => {
    switch (id) {
      case 'reminders':
      case 'calendar-14d':
        return DESK_CHART.events
      case 'tasks-ring':
        return DESK_CHART.tasks
      default:
        return 'var(--accent)'
    }
  }

  return (
    <div className="wb-myspace">
      <header className="wb-ms-hero">
        <div className="wb-ms-hero-glow" aria-hidden />
        <div className="wb-ms-hero-copy">
          <p className="wb-ms-kicker">{label('Không gian của tôi', 'My Space')}</p>
          <h2 className="wb-ms-title">{greet}</h2>
          <p className="wb-ms-sub">
            {dateLine}
            {' · '}
            {label('Việc và lịch trong một khung nhìn', 'Tasks and calendar in one view')}
          </p>
          {nextReminder ? (
            <p className="wb-ms-next">
              <span>{label('Sắp tới', 'Up next')}</span>
              <strong>
                {nextReminder.date} — {nextReminder.title}
              </strong>
            </p>
          ) : (
            <p className="wb-ms-next is-quiet">
              {label('Chưa có nhắc gần.', 'No upcoming reminders.')}
            </p>
          )}
        </div>
        <div className="wb-ms-hero-actions">
          <button
            type="button"
            className={`btn btn-secondary${notifyOn ? ' is-active' : ''}`}
            onClick={() => void toggleNotify()}
            title={label(
              'Thông báo desktop khi việc đến hạn / lịch hôm nay (opt-in)',
              'Desktop alerts for due tasks / today’s calendar (opt-in)',
            )}
          >
            {notifyOn
              ? label('Nhắc: bật', 'Reminders: on')
              : label('Nhắc: tắt', 'Reminders: off')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setTick((t) => t + 1)}>
            {label('Làm mới', 'Refresh')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCustomOpen((o) => !o)}
          >
            {customOpen ? label('Xong', 'Done') : label('Tùy chỉnh', 'Customize')}
          </button>
        </div>
      </header>

      {showPulse ? (
        <div className="wb-ms-pulse" aria-label={label('Nhịp làm việc', 'Work pulse')}>
          <PulseChip
            label={label('Việc mở', 'Open tasks')}
            value={String(data.openTasks)}
            tone="tasks"
            delay={0}
          />
          <PulseChip
            label={label('Lịch 7 ngày', 'Calendar · 7d')}
            value={String(data.calendar7)}
            tone="events"
            delay={1}
          />
        </div>
      ) : null}

      {customOpen ? (
        <div className="wb-desk-customize wb-ms-customize">
          <div>
            <h3>{label('Đang hiện', 'Visible')}</h3>
            <ul className="wb-desk-customize-list">
              {layout.map((id, idx) => {
                const w = getDeskWidget(id)
                if (!w) return null
                return (
                  <li key={id}>
                    <div>
                      <strong>{vi ? w.labelVi : w.labelEn}</strong>
                      <span>{vi ? w.hintVi : w.hintEn}</span>
                    </div>
                    <div className="teacher-chip-row">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={idx === 0}
                        onClick={() => move(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={idx === layout.length - 1}
                        onClick={() => move(id, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => remove(id)}>
                        {label('Ẩn', 'Hide')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <h3>{label('Thêm vào Không gian của tôi', 'Add to My Space')}</h3>
            <ul className="wb-desk-customize-list">
              {hidden.length === 0 ? (
                <li className="teacher-empty">{label('Đã thêm hết.', 'All widgets added.')}</li>
              ) : (
                hidden.map((w) => (
                  <li key={w.id}>
                    <div>
                      <strong>{vi ? w.labelVi : w.labelEn}</strong>
                      <span>{vi ? w.hintVi : w.hintEn}</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => add(w.id)}>
                      {label('Thêm', 'Add')}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button type="button" className="btn btn-secondary" onClick={reset}>
              {label('Khôi phục mặc định', 'Reset defaults')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="wb-ms-bento">
        {gridIds.map((id, index) => {
          const def = getDeskWidget(id)
          const wide = def?.wide ? ' is-wide' : ''
          return (
            <article
              key={id}
              className={`wb-ms-card${wide}`}
              style={{
                ['--ms-i' as string]: String(index),
                ['--ms-tone' as string]: widgetTone(id),
              }}
            >
              <header className="wb-ms-card-head">
                <h3>{def ? (vi ? def.labelVi : def.labelEn) : id}</h3>
                {def ? <span>{vi ? def.hintVi : def.hintEn}</span> : null}
              </header>
              <div className="wb-ms-card-body">
                {id === 'reminders' &&
                  (data.reminders.length === 0 ? (
                    <p className="teacher-empty">
                      {label(
                        'Chưa có nhắc — thêm ở Lịch / Công việc.',
                        'No reminders — add in Calendar / Tasks.',
                      )}
                    </p>
                  ) : (
                    <ul className="wb-desk-reminders">
                      {data.reminders.map((r) => (
                        <li key={r.id}>
                          <span className="wb-desk-rem-date">{r.date}</span>
                          <strong>{r.title}</strong>
                          <span className="wb-desk-rem-src">{r.source}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                {id === 'tasks-ring' && (
                  <RingProgress
                    value={data.doneTasks}
                    total={data.taskTotal}
                    color={DESK_CHART.tasks}
                    caption={
                      data.taskTotal === 0
                        ? label('Chưa có việc — thêm ở tab Công việc.', 'No tasks yet — add in Tasks.')
                        : label(
                            `${data.doneTasks}/${data.taskTotal} hoàn thành`,
                            `${data.doneTasks}/${data.taskTotal} done`,
                          )
                    }
                  />
                )}
                {id === 'calendar-14d' && (
                  <DayDensityChart
                    days={data.dayCounts}
                    color={DESK_CHART.events}
                    empty={label('14 ngày tới chưa có mốc.', 'No items in the next 14 days.')}
                  />
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function PulseChip({
  label: lab,
  value,
  tone,
  delay,
}: {
  label: string
  value: string
  tone: 'tasks' | 'events'
  delay: number
}): ReactElement {
  return (
    <div
      className="wb-ms-pulse-chip"
      style={{ ['--wb-kpi' as string]: DESK_CHART[tone], ['--ms-i' as string]: String(delay) }}
    >
      <span>{lab}</span>
      <strong>{value}</strong>
    </div>
  )
}

function RingProgress({
  value,
  total,
  color,
  caption,
}: {
  value: number
  total: number
  color: string
  caption: string
}): ReactElement {
  const pct = total > 0 ? value / total : 0
  const r = 46
  const circ = 2 * Math.PI * r
  const len = pct * circ
  return (
    <div className="wb-desk-chart wb-desk-ring">
      <svg viewBox="0 0 120 120" className="wb-desk-svg" role="img">
        <circle cx="60" cy="60" r={r} fill="none" stroke={DESK_CHART.track} strokeWidth={12} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeDasharray={`${len} ${circ - len}`}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="64" textAnchor="middle" className="wb-desk-donut-value">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <p className="teacher-hint">{caption}</p>
    </div>
  )
}

function DayDensityChart({
  days,
  color,
  empty,
}: {
  days: { iso: string; n: number }[]
  color: string
  empty: string
}): ReactElement {
  const max = Math.max(1, ...days.map((d) => d.n))
  const has = days.some((d) => d.n > 0)
  if (!has) return <p className="teacher-empty">{empty}</p>
  const w = 320
  const h = 100
  const pad = 8
  const bw = (w - pad * 2) / days.length - 3
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wb-desk-svg" role="img">
      {days.map((d, i) => {
        const hh = (d.n / max) * (h - 28)
        const x = pad + i * ((w - pad * 2) / days.length)
        return (
          <g key={d.iso}>
            <rect
              x={x}
              y={h - 18 - hh}
              width={bw}
              height={Math.max(hh, d.n > 0 ? 4 : 0)}
              rx={3}
              fill={color}
              opacity={0.25 + (d.n / max) * 0.75}
            />
            {i % 2 === 0 ? (
              <text x={x + bw / 2} y={h - 4} textAnchor="middle" className="wb-desk-axis">
                {d.iso.slice(8)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 7: Bỏ slot media pets/health (renderer, kiểu dùng chung, main)**

`apps/shell/src/renderer/src/workbench-media-backup.ts`:
- l.3 ` * Stores: tasks attachments (Blob), pets photos (data URL), health body (data URL).` thành ` * Stores: tasks attachments (Blob).`
- Thay l.8-24:
```ts
export interface WbIdbMediaDump {
  version: 1
  tasks: Record<string, string>
  pets: Record<string, string>
  health: Record<string, string>
}

const STORES = [
  { db: 'uniwork.wb.tasks.media', store: 'blobs', slot: 'tasks' as const, kind: 'blob' as const },
  { db: 'uniwork.wb.pets.media', store: 'photos', slot: 'pets' as const, kind: 'string' as const },
  {
    db: 'uniwork.wb.health.media',
    store: 'blobs',
    slot: 'health' as const,
    kind: 'string' as const,
  },
]
```
bằng:
```ts
export interface WbIdbMediaDump {
  version: 1
  tasks: Record<string, string>
}

const STORES = [
  { db: 'uniwork.wb.tasks.media', store: 'blobs', slot: 'tasks' as const, kind: 'blob' as const },
]
```
- l.127 `  const dump: WbIdbMediaDump = { version: 1, tasks: {}, pets: {}, health: {} }` thành `  const dump: WbIdbMediaDump = { version: 1, tasks: {} }`.
- Trong `isWbIdbMediaDump`, thay `return ( … )` (l.211-219) bằng `  return v.version === 1 && typeof v.tasks === 'object' && v.tasks != null`.

`apps/shell/src/shared/home-api.ts` l.620-625: xóa hai dòng `  pets: Record<string, string>` và `  health: Record<string, string>` khỏi `WorkbenchIdbMediaDump`.

`apps/shell/src/main/workbench-backup.ts`, `isMediaDump` (l.28-36). Thay `return ( … )` bằng:
```ts
  return v.version === 1 && typeof v.tasks === 'object' && v.tasks != null
```
Thay đổi này bắt buộc. Nếu không, main từ chối dump `{version, tasks}` mới của renderer vì "không phải media", và backup âm thầm làm mất file đính kèm của việc.

- [ ] **Step 8: Gỡ phần đọc client/contract/matter và email khỏi My AI**

`apps/shell/src/renderer/src/my-ai-templates.ts`:
- Xóa l.7 `import { readClients, readContracts, readMatters, type WbClientItem } from './workbench-pins'`.
- Xóa `function stripDiacritics` (l.216-219 và dòng trống sau). Chỉ `matchClient` dùng nó.
- Thay l.284-300 (`function matchClient …` tới interface `TemplateResolveResult`) bằng:
```ts
export interface TemplateResolveResult {
  template: PracticeDocTemplate
  slots: ResolvedSlots
  missing: TemplateSlotDef[]
}
```
- Trong `resolveTemplateSlots`, thay toàn bộ từ `  const slots: ResolvedSlots = { ...extractSlotsFromUserText(userText) }` tới hết khối `try { const matters … } catch { … }` (l.310-343) bằng:
```ts
  const slots: ResolvedSlots = { ...extractSlotsFromUserText(userText) }

  // party / investor reuse the client named in the request
  if (!slots.party && slots.client) slots.party = slots.client
  if (!slots.investor && slots.client) slots.investor = slots.client
```
- `  return { template, slots, missing, clientRow }` thành `  return { template, slots, missing }`.
- Trong `buildTemplateBrief`: `  const { template, slots, clientRow } = result` thành `  const { template, slots } = result`. Xóa khối `  if (clientRow) { … }` (l.385-390).

`apps/shell/src/renderer/src/my-ai-forms.ts`:
- Thay l.3-15:
```ts
 * Uploaded files are read on-device via readAttachment; slots reuse clients when useful.
 */
import type { PracticeId } from '@uniwork/practice-core'
import {
  getTemplateById,
  type PracticeDocTemplate,
} from './my-ai-templates'
import {
  readClients,
  readForms,
  type WbClientItem,
  type WbFormItem,
} from './workbench-pins'
```
bằng:
```ts
 * Uploaded files are read on-device via readAttachment.
 */
import type { PracticeId } from '@uniwork/practice-core'
import type { PracticeDocTemplate } from './my-ai-templates'
import { readForms, type WbFormItem } from './workbench-pins'
```
- Xóa `function matchClientHint` (l.152-161 và dòng trống sau).
- Trong `buildFormFillBrief`, thay:
```ts
  excerpt?: string
  clientRow?: WbClientItem
}): string {
  const { form, vi, userHint, excerpt, clientRow } = opts
```
bằng:
```ts
  excerpt?: string
}): string {
  const { form, vi, userHint, excerpt } = opts
```
và xóa khối `  if (clientRow) { … }` (l.185-191).
- Xóa `resolveFormFillContext` cùng doc comment và dòng trống phía trước (l.225-237).

`apps/shell/src/renderer/src/NewChatPane.tsx`:
- Xóa l.35 `  resolveFormFillContext,` khỏi import `./my-ai-forms`.
- l.38 `import { readClients, readForms } from './workbench-pins'` thành `import { readForms } from './workbench-pins'`.
- Thay l.900-902:
```ts
      const { clientRow } = resolveFormFillContext(practiceId, form, hint)
      const excerpt = form.filePath ? await readFormFileExcerpt(form.filePath) : ''
      const brief = buildFormFillBrief({ form, vi, userHint: hint, excerpt, clientRow })
```
bằng:
```ts
      const excerpt = form.filePath ? await readFormFileExcerpt(form.filePath) : ''
      const brief = buildFormFillBrief({ form, vi, userHint: hint, excerpt })
```
- Thay l.922-939 (`const clients = readClients(practiceId).slice(0, 5)` tới dấu `}` đóng `if (needsClient) { … }`) bằng:
```ts
        const choices: ChatChoice[] = []
```
- Xóa khối `      if (local.topic === 'email') { … }` (l.1652-1659).

`apps/shell/src/renderer/src/my-ai-local-answer.ts`:
- l.7 thành `import { readCalendar, readNotes, readTasks } from './workbench-pins'`.
- Xóa l.14 `  | 'email'` (trong `LocalAnswerTopic`) và l.31 `  emails: { subject: string; folder: string; to?: string; from?: string }[]` (trong `LocalAnswerSnapshot`).
- Xóa `function wantsEmail` (l.87-90 và dòng trống sau), câu lệnh `const mailLines = …` (l.148-151), và khối `if (wantsEmail(lower)) { … }` (l.263-273 và dòng trống sau).
- Trong `buildLocalAnswerSnapshot`, xóa thuộc tính `emails: readEmails(practiceId).map(…)` (l.316-321).

- [ ] **Step 9: Xóa CSS của các module đã gỡ khỏi `home.css`**

Xóa các khoảng dòng HEAD sau, từ dưới lên để số dòng còn đúng:
1. `7481-7502` (`.wb-growth-main` … `.wb-growth-progress input[type='range']`)
2. `7337-7471` (`.wb-desk-bars` … `.wb-finance-summary strong`; `.wb-module-form select` ở 7472 giữ lại)
3. `7304-7326` (`.wb-desk-legend-list` …)
4. `7264-7297` (`.wb-desk-legend` … `.wb-desk-donut-label`; `.wb-desk-donut-value` ở 7298 giữ lại)
5. `7179-7206` (`.wb-desk-kpis`, `.wb-desk-kpi*`)
6. `6086-6465` (mục `/* ── Email MVP ── */`, kể cả `@media (max-width: 980px)` của nó)
7. `5739-6053` (`.wb-family-tree`, `.wb-family-gen h4`, `/* ── Family tree canvas ── */` `.wb-ft-*`, `.wb-family-check`)
8. `5321-5704` (`/* ── Health metrics dashboard ── */` `.wb-hdash*` cùng `@keyframes wb-hdash-pulse` và hai khối `@media`, `.wb-hm-form`, `.wb-health*`, `.wb-finance-goal-row`, `.wb-finance-alloc`; `.wb-subtabs` ở 5705 giữ lại)
9. `4759-5050` (`.wb-pets-empty` … `.wb-pets-gallery-tile > span`)
10. `4703-4752` (`/* ── Pets workbench ── */` … rule ngay trước `.wb-pets-err`. `.wb-pets-err` ở 4753-4757 giữ lại vì `TasksPane.tsx:775` dùng)
11. `3928-4005` (`.wb-row-actions .wb-row-chip` … `.wb-travel-check-add`)

Rồi thay rule dùng chung (trước đây l.4006-4012):
```css
.wb-family,
.wb-friends,
.wb-pets,
.wb-health,
.wb-finance,
.wb-cal,
.wb-tasks {
```
bằng:
```css
.wb-cal,
.wb-tasks {
```
Kiểm tra không còn class nào đã xóa:
```bash
cd /Users/ducquang/UNICOM/uniwork-office && grep -nE '\.wb-(pets-(hero|grid|card|empty|form|album|gallery|care|shot|toolbar|notes|photo|back)|pet-|hdash|health|finance|family|friends|ft-|email|travel|growth|assistant|row-chip|desk-(bars?|bar-|health|kpi|mini|legend|donut-(wrap|label)))' apps/shell/src/renderer/src/home.css
```
Kết quả mong đợi: không có output. File giảm từ 8462 xuống 6722 dòng.

- [ ] **Step 10: Typecheck, test, tìm tham chiếu còn sót**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run
cd /Users/ducquang/UNICOM/uniwork-office && grep -rnE "FinancePane|HealthPane|HealthMetricsViz|FamilyPane|FamilyTreeCanvas|family-tree-layout|FriendsPane|PetsPane|EmailPane|readEmails|readFinance|readHealth|readFamily|readFriends|readPets|readTravel|readClients|readContracts|readMatters|readEvents|readGrowth|compressPetImage|healthDeskCounts|WbMailBtn|WbExpandBtn" apps/shell/src apps/shell/tests
npm run check:theme-colors -- --base origin/main
```
Kết quả mong đợi:
- typecheck exit 0;
- mọi file test shell pass (`Test Files 134 passed`, `Tests 2106 passed` trên bản chạy thử; ít hơn một file vì `family-tree-layout.test.ts` đã xóa);
- grep không in gì;
- theme check pass (CSS chỉ bị xóa).

- [ ] **Step 11: Rebuild shell (có thay đổi main) và thử nhanh**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run build -w @genoffice/shell
```
Kết quả mong đợi: build thành công. `src/main/workbench-backup.ts` đã đổi, nên build shell cũ sẽ tiếp tục từ chối dump media mới.

Rồi chạy `npm run dev`. Trong Bàn làm việc:
- menu "+" của thanh tab chỉ liệt kê Ghi chú, Biểu mẫu, Cá nhân và 4 trụ cột; tab Việc và Lịch mở được;
- My Space hiện 2 chip nhịp và các thẻ Nhắc việc, Tiến độ công việc, Lịch 14 ngày;
- Cài đặt → sao lưu Bàn làm việc vẫn xuất ra ZIP.

- [ ] **Step 12: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add -A apps/shell/src/renderer/src/FinancePane.tsx apps/shell/src/renderer/src/HealthPane.tsx apps/shell/src/renderer/src/HealthMetricsViz.tsx apps/shell/src/renderer/src/FamilyPane.tsx apps/shell/src/renderer/src/FamilyTreeCanvas.tsx apps/shell/src/renderer/src/family-tree-layout.ts apps/shell/src/renderer/src/FriendsPane.tsx apps/shell/src/renderer/src/PetsPane.tsx apps/shell/src/renderer/src/EmailPane.tsx apps/shell/tests/family-tree-layout.test.ts
git add apps/shell/src/renderer/src/workbench-pins.ts apps/shell/src/renderer/src/WbRowActions.tsx apps/shell/src/renderer/src/workbench-desk.ts apps/shell/src/renderer/src/DeskPane.tsx apps/shell/src/renderer/src/workbench-media-backup.ts apps/shell/src/shared/home-api.ts apps/shell/src/main/workbench-backup.ts apps/shell/src/renderer/src/my-ai-templates.ts apps/shell/src/renderer/src/my-ai-forms.ts apps/shell/src/renderer/src/my-ai-local-answer.ts apps/shell/src/renderer/src/NewChatPane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/my-ai-templates.test.ts apps/shell/tests/my-ai-forms.test.ts apps/shell/tests/my-ai-local-answer.test.ts
git commit -m "refactor(shell): delete the life, client and email Workbench modules

Drops their panes, local stores (and the calendar-events double write),
desk widgets, pets/health backup media slots, My AI readers and CSS.
Local tasks and calendar stay until the server-backed tabs replace them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Rủi ro của Task 3: `main/workbench-backup.ts` và `shared/home-api.ts` phải đổi cùng commit với `workbench-media-backup.ts`. Nếu chỉ đổi phía renderer, xuất backup âm thầm mất file đính kèm của việc. Rebuild shell sau Task 3.

### Task 4: Gỡ giáo dục (Teacher home, vai trò teacher/principal, IPC bài giảng, kind `education` và skill domain)

Số dòng dưới đây tính ở commit `9194f306`. Task 1–3 có thể làm lệch (home-api.ts, main/index.ts, test practice-core), nên tìm mỗi chỗ sửa theo đoạn trích dẫn và sửa từ dưới lên trong một file.

Ghi chú hợp đồng: Task 4 gỡ các consumer duy nhất của `@uniwork/edu-core` (`main/edu-commercial.ts`, `TeacherHome.tsx`, `practices/teacher.ts`). Không còn ai import `hub.ts`, nên Task 5 xóa nó cùng `tests/edu-core.test.ts` và cả package; không chuyển gì (C7). Form Hub Token, ghi chú giá ở hero ("Desktop miễn phí; Token AI…") và các `window.confirm` "Tốn Token" chỉ nằm trong `TeacherHome.tsx`, nên bị gỡ ở đây. Modal "Dùng Token AI?" của `PracticeHome` giữ lại: kỹ năng nó chặn chạy với `autoRun: true` và tốn credit AI.

**Files:**
- Delete: `apps/shell/src/renderer/src/TeacherHome.tsx`, `apps/shell/src/main/edu-commercial.ts`, `packages/practice-core/src/practices/teacher.ts`, `packages/practice-core/src/practices/principal.ts`
- Modify: `apps/shell/src/renderer/src/Home.tsx` (import l.28, l.32, l.3447-3485)
- Modify: `apps/shell/src/main/index.ts` (l.84, l.4466-4484)
- Modify: `apps/shell/src/preload/index.ts` (l.271-278, l.298-305, l.900-912)
- Modify: `apps/shell/src/shared/home-api.ts` (l.397-403, 412-418, 823-882, 906, 911, 925-952, 1029-1035, 1142-1143, 1186-1188)
- Modify: `apps/docs/src/main/docs-main.ts` (l.82, l.4317-4383, l.4384-4403)
- Modify: `packages/project-store/src/{types.ts (l.65-201), store.ts (l.38, 52-75, 372-375, 1009-1022, 1027-1049, 1101-1138, 1163-1170), index.ts (l.6)}`
- Modify: `packages/practice-core/src/{types.ts (l.2-31), meta.ts (l.8-18), registry.ts (l.1-30), practices/business.ts (l.4-7), skill-domains.ts (l.6-17, 42-50, 159-197, 460-463)}`
- Modify: `apps/shell/src/renderer/src/{skill-domain-pins.ts (cả file), SkillDomainTabs.tsx (l.98), PracticeHome.tsx (l.327-331), my-ai-playbooks.ts (l.467-495), my-ai-templates.ts (l.151-174)}`
- Test: `packages/practice-core/tests/practice-core.test.ts`, `packages/practice-core/tests/agent-intent.test.ts`, `packages/project-store/tests/store.test.ts` (l.1145-1204), `apps/shell/tests/skill-domain-pins.test.ts` (mới), `apps/shell/tests/strings-visible-copy.test.ts` (l.103), `apps/shell/tests/{my-ai-history,my-ai-playbooks-consent,workbench-account-gate,workbench-accounts,workbench-db}.test.ts`

**Interfaces:**
- Consumes: `PRACTICE_IDS` sau khi cắt theo hợp đồng (13 id, mặc định `'entrepreneur'`).
- Produces:
  - `PRACTICE_IDS` không còn `'teacher'` và `'principal'`.
  - `type PracticeProjectKind = PracticeId`.
  - `defaultPinnedSkillDomains(practiceId: PracticeId): SkillDomainId[]` (trước đây không tham số); shell đọc vai trò đang chọn từ wb_kv `uniwork.activePracticeId`.
  - `SkillDomainId` không còn `'education'`.
  - `PracticeId`/`ProjectKind` của project-store không còn `teacher`, `principal`, `education`; `ProjectSummary` không còn `edu`.
  - Gỡ khỏi shell: `HomeApi.probeAiHub`, `HomeApi.exportLessonPack`, `ProjectHomeApi.{createEducationProject,getEduMeta,patchEduMeta}`, `ProjectSummaryEntry.edu`, `HOME_CHANNELS.{probeAiHub,exportLessonPack}`, `PROJECT_CHANNELS.{createEducation,getEduMeta,patchEduMeta}`.

Task chia thành ba commit, app build được sau mỗi commit. (A) gỡ UI Teacher và IPC của nó. (B) gỡ edu meta khỏi project-store. (C) gỡ vai trò và skill domain.

- [ ] **Step 1: (A) Xóa Teacher home và code AI Hub / lesson-pack ở main**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git rm apps/shell/src/renderer/src/TeacherHome.tsx apps/shell/src/main/edu-commercial.ts
```

`apps/shell/src/renderer/src/Home.tsx`:
- Xóa l.32 `import { TeacherHome } from './TeacherHome'`.
- Đổi l.28 từ `import { getPractice, isPracticeId, listPractices, type PracticeId } from '@uniwork/practice-core'` thành `import { getPractice, isPracticeId, requirePractice, type PracticeId } from '@uniwork/practice-core'`.
- Thay l.3447-3485. Trước:

```tsx
      ) : eduMode ? (
        activePracticeId === 'teacher' ? (
          <TeacherHome
            projects={projects}
            selectedId={eduSelectedId}
            onSelectPack={setEduSelectedId}
            onOpenPackFiles={(id) => {
              setEduMode(false)
              setChatMode(false)
              setSelectedProjectId(id)
              setSelectedFolder(null)
              setSelected(new Set())
              setRowMenu(null)
            }}
            onRefresh={refresh}
            onSwitchPractice={switchPractice}
          />
        ) : (
          <PracticeHome
            practice={
              getPractice(activePracticeId) ??
              listPractices().find((p) => p.id !== 'teacher') ??
              listPractices()[0]!
            }
            projects={projects}
            selectedId={eduSelectedId}
            onSelectPack={setEduSelectedId}
            onOpenPackFiles={(id) => {
              setEduMode(false)
              setChatMode(false)
              setSelectedProjectId(id)
              setSelectedFolder(null)
              setSelected(new Set())
              setRowMenu(null)
            }}
            onRefresh={refresh}
            onSwitchPractice={switchPractice}
          />
        )
      ) : selectedFolder && rootOf(selectedFolder, roots)?.readable ? (
```

Sau:

```tsx
      ) : eduMode ? (
        <PracticeHome
          practice={getPractice(activePracticeId) ?? requirePractice('entrepreneur')}
          projects={projects}
          selectedId={eduSelectedId}
          onSelectPack={setEduSelectedId}
          onOpenPackFiles={(id) => {
            setEduMode(false)
            setChatMode(false)
            setSelectedProjectId(id)
            setSelectedFolder(null)
            setSelected(new Set())
            setRowMenu(null)
          }}
          onRefresh={refresh}
          onSwitchPractice={switchPractice}
        />
      ) : selectedFolder && rootOf(selectedFolder, roots)?.readable ? (
```

Fallback của `useState` ở l.1152-1157 (`return 'entrepreneur'`) giữ nguyên.

`apps/shell/src/main/index.ts`:
- Xóa l.84 `import { exportLessonPackZip, probeAiHub } from './edu-commercial'`.
- Xóa l.4466-4484: toàn bộ khối `ipcMain.handle(HOME_CHANNELS.probeAiHub, …)`, toàn bộ khối `ipcMain.handle(HOME_CHANNELS.exportLessonPack, async (event, projectId: unknown) => { … })` và dòng trống sau, dừng ngay trước `ipcMain.handle(HOME_CHANNELS.newDoc, …`.

`apps/shell/src/preload/index.ts`:
- Xóa l.900-912: các member `async createEducationProject(args) {…}`, `async getEduMeta(projectId) {…}` và `async patchEduMeta(args) {…}`, dừng trước `async createPracticeProject(args) {`.
- Xóa l.298-305: member `async exportLessonPack(projectId) { … },`.
- Xóa l.271-278: member `async probeAiHub(opts) { … },`.

`apps/shell/src/shared/home-api.ts`:
- Xóa l.1186-1188 trong `PROJECT_CHANNELS`: `createEducation: 'project:createEducation',`, `getEduMeta: 'project:getEduMeta',` và `patchEduMeta: 'project:patchEduMeta',`.
- Xóa l.1142-1143 trong `HOME_CHANNELS`: `probeAiHub: 'home:probe-ai-hub',` và `exportLessonPack: 'home:export-lesson-pack',`.
- Xóa l.1029-1034 trong `ProjectHomeApi`: ba doc comment và các method `createEducationProject(…)`, `getEduMeta(…)`, `patchEduMeta(…)`.
- Xóa l.925-953: `export interface CreateEducationProjectArgs { … }`, `export interface PatchEducationMetaArgs { … }` và dòng trống sau.
- Xóa l.906 trong `ProjectSummaryEntry`: `  edu?: EduProjectMetaEntry`.
- Xóa l.823-849: `export type EduMaterialRoleEntry = …`, `/** Teacher lesson-pack metadata … */ export interface EduProjectMetaEntry { … }` và dòng trống sau.
- Xóa l.412-418: member `/** Zip an education lesson pack … */ exportLessonPack(projectId: string): Promise<{ … }>`.
- Xóa l.397-403: member `/** Probe OpenAI-compatible Hub … */ probeAiHub(opts: …): Promise<{ … }>`.

`apps/docs/src/main/docs-main.ts`: xóa l.4317-4383, từ `  /** Create a teacher lesson pack */` tới dấu `  )` đóng handler `'project:patchEduMeta'` và dòng trống sau. Dòng giữ lại tiếp theo là `  /** Create a non-teacher practice pack */`.

`apps/shell/tests/strings-visible-copy.test.ts` l.103: trước `const SOURCES = ['../src/renderer/src/UniAiPwaPane.tsx', '../src/main/edu-commercial.ts'] as const`, sau `const SOURCES = ['../src/renderer/src/UniAiPwaPane.tsx'] as const`.

- [ ] **Step 2: (A) Kiểm typecheck, test, chỗ sót và build shell**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "TeacherHome\|edu-commercial\|probeAiHub\|exportLessonPack\|createEducation\|EduMeta\|EduProjectMetaEntry\|CreateEducationProjectArgs" -- apps
npm run typecheck -w @genoffice/shell && npm run typecheck -w @genoffice/docs
cd apps/shell && npx vitest run tests/strings-visible-copy.test.ts tests/account-ui.test.ts && cd ../..
npx eslint apps/shell/src/renderer/src/Home.tsx apps/shell/src/main/index.ts apps/shell/src/preload/index.ts apps/shell/src/shared/home-api.ts apps/docs/src/main/docs-main.ts
npm run build -w @genoffice/shell
```

Kết quả mong đợi: grep không in gì; typecheck, test, eslint và build đều pass. Bắt buộc build vì code main process (shell main và docs main) đã đổi.

- [ ] **Step 3: (A) Commit**

```bash
git add apps/shell/src/renderer/src/Home.tsx apps/shell/src/main/index.ts apps/shell/src/preload/index.ts apps/shell/src/shared/home-api.ts apps/docs/src/main/docs-main.ts apps/shell/tests/strings-visible-copy.test.ts apps/shell/src/renderer/src/TeacherHome.tsx apps/shell/src/main/edu-commercial.ts
git commit -m "refactor(shell,docs): remove the Teacher home, lesson-pack IPC and the AI Hub probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: (B) Viết test project-store sẽ fail**

Trong `packages/project-store/tests/store.test.ts`, thay l.1145-1204 (banner `// Education lesson packs` và toàn bộ khối `describe('createEducationProject', …)`, tới dòng trống trước `describe('createPracticeProject'`) bằng:

```ts
// ────────────────────────────────────────────────────────────
// Legacy education packs (removed): edu/meta.json is no longer read
// ────────────────────────────────────────────────────────────

describe('legacy edu/meta.json', () => {
  let tmpDir: string
  let store: ProjectStore

  beforeEach(() => {
    tmpDir = makeTempDir()
    store = new ProjectStore(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('is not read into the project summary', () => {
    const data = store.createProject('Toán · Lớp 6 · Phân số')
    const eduDir = join(tmpDir, 'projects', data.id, 'edu')
    mkdirSyncHelper(eduDir)
    writeFileSync(
      join(eduDir, 'meta.json'),
      JSON.stringify({
        version: 2,
        kind: 'education',
        subject: 'Toán',
        grade: 'Lớp 6',
        lessonTitle: 'Phân số',
        objectives: [],
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      }),
    )
    const summary = store.listProjectsSummary().find((p) => p.id === data.id)
    expect(summary).toBeDefined()
    expect(summary).not.toHaveProperty('edu')
    expect(summary?.kind).toBeUndefined()
  })
})

```

- [ ] **Step 5: (B) Chạy và thấy test fail**

Chạy `cd /Users/ducquang/UNICOM/uniwork-office/packages/project-store && npx vitest run tests/store.test.ts`.
Kết quả mong đợi: FAIL, 1 test fail (`legacy edu/meta.json > is not read into the project summary`), vì summary vẫn có `edu` và `kind: 'education'`.

- [ ] **Step 6: (B) Gỡ phần edu khỏi project-store và kiểu ở docs-main**

`packages/project-store/src/types.ts`:
- `ProjectKind` (l.66-81): xóa `  | 'education'` và `  | 'principal'`.
- l.83: đổi `/** Practice pack ids (teacher uses legacy education kind). */` thành `/** Practice pack ids. */`. Trong `PracticeId` (l.84-99), xóa `  | 'teacher'` và `  | 'principal'`.
- l.101-104: thay comment bằng `/** Generic practice pack metadata (projects/<id>/practice/meta.json). */`.
- l.108: đổi `  practiceId: Exclude<PracticeId, 'teacher'> | PracticeId` thành `  practiceId: PracticeId`.
- Xóa l.118-148: comment `/** Education lesson-pack metadata … */`, `export type EduMaterialRole = …`, `export interface EduProjectMeta { … }` và dòng trống sau.
- Trong `ProjectInfo`: đổi `  /** Set for teacher / practice packs */` thành `  /** Set for practice packs */`.
- Trong `ProjectSummary` (l.197-199): xóa `  /** Present when kind === 'education' and edu/meta.json exists */` và `  edu?: EduProjectMeta`. Đổi `  /** Present when a non-teacher practice pack has practice/meta.json */` thành `  /** Present when a practice pack has practice/meta.json */`.

`packages/project-store/src/index.ts`: xóa l.6 `  EduProjectMeta,`.

`packages/project-store/src/store.ts`:
- Xóa l.38 `  EduProjectMeta,`.
- `PROJECT_KINDS` (l.52-68): xóa `  'education',` và `  'principal',`.
- `practiceKindToProjectKind`: xóa `  if (practiceId === 'teacher') return 'education'`.
- Xóa l.372-375: `  private eduMetaPath(projectId: string): string { … }` và dòng trống sau.
- `listProjectsSummary`, l.1009-1022. Trước:

```ts
      const edu = this.getEduMeta(info.id) ?? undefined
      const practice = this.getPracticeMeta(info.id) ?? undefined
      const kind =
        info.kind ??
        edu?.kind ??
        (practice ? practiceKindToProjectKind(practice.practiceId) : undefined)
      return {
        ...info,
        ...(kind ? { kind } : {}),
        fileCount,
        lastActiveAt,
        isDefault: info.id === 'default',
        ...(edu ? { edu } : {}),
        ...(practice ? { practice } : {}),
      }
```

Sau:

```ts
      const practice = this.getPracticeMeta(info.id) ?? undefined
      const kind =
        info.kind ?? (practice ? practiceKindToProjectKind(practice.practiceId) : undefined)
      return {
        ...info,
        ...(kind ? { kind } : {}),
        fileCount,
        lastActiveAt,
        isDefault: info.id === 'default',
        ...(practice ? { practice } : {}),
      }
```

- Xóa l.1027-1049: `getEduMeta(…) { … }`, `setEduMeta(…) { … }` và dòng trống sau.
- Xóa l.1101-1138: khối `/** Creates a teacher lesson pack … */ createEducationProject(…) { … }`, khối `/** Patch education metadata … */ patchEduMeta(…) { … }` và dòng trống sau.
- l.1163-1170. Trước:

```ts
  /**
   * Creates a non-teacher practice pack: project + kind + practice/meta.json.
   * Teacher packs continue to use createEducationProject.
   */
  createPracticeProject(name: string, meta: PracticeProjectMeta): ProjectData {
    if (meta.practiceId === 'teacher') {
      throw new Error('Use createEducationProject for teacher packs')
    }
    const data = this.createProject(name)
```

Sau:

```ts
  /** Creates a practice pack: project + kind + practice/meta.json. */
  createPracticeProject(name: string, meta: PracticeProjectMeta): ProjectData {
    const data = this.createProject(name)
```

`apps/docs/src/main/docs-main.ts`:
- Đổi l.82 từ `import { ProjectStore } from '@genoffice/project-store'` thành `import { ProjectStore, type PracticeId } from '@genoffice/project-store'`.
- Handler `'project:createPractice'`: đổi `  /** Create a non-teacher practice pack */` thành `  /** Create a practice pack */`.
- Đổi `        practiceId: 'legal' | 'construction' | 'procurement' | 'principal'` thành `        practiceId: PracticeId`.
- Đổi `      if (!title || !practiceId || practiceId === ('teacher' as string)) {` thành `      if (!title || !practiceId) {`.

- [ ] **Step 7: (B) Chạy test và typecheck**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/packages/project-store && npx vitest run && cd ../..
npm run typecheck -w @genoffice/project-store && npm run typecheck -w @genoffice/docs && npm run typecheck -w @genoffice/shell
git grep -n "EduProjectMeta\|getEduMeta\|createEducationProject\|eduMetaPath" -- packages apps
```

Kết quả mong đợi: test project-store pass (125 passed, 2 skipped: 126 trước đó, trừ 2 test edu, cộng 1 test mới), mọi typecheck pass, grep không in gì.

- [ ] **Step 8: (B) Commit**

```bash
git add packages/project-store/src/types.ts packages/project-store/src/store.ts packages/project-store/src/index.ts packages/project-store/tests/store.test.ts apps/docs/src/main/docs-main.ts
git commit -m "refactor(project-store): drop the education kind and the edu/meta.json read path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: (C) Viết test practice-core sẽ fail**

Trong `packages/practice-core/tests/practice-core.test.ts`, thay `it(...)` đầu tiên (l.23-50) bằng:

```ts
  it('registers the 13 business practices and no education role', () => {
    const ids = listPractices().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'legal',
        'construction',
        'procurement',
        'sales',
        'customer-care',
        'entrepreneur',
        'freelancer',
        'content-creator',
        'marketing',
        'hr',
        'accounting',
        'it',
        'real-estate',
      ]),
    )
    expect(ids).toHaveLength(13)
    expect(ids).not.toContain('teacher')
    expect(ids).not.toContain('principal')
    expect(practiceProjectKind('legal')).toBe('legal')
    expect(practiceProjectKind('sales')).toBe('sales')
    expect(practiceIdFromProjectKind('education')).toBeNull()
    expect(practiceIdFromProjectKind('content-creator')).toBe('content-creator')
  })
```

Test mới không còn gọi `getPractice` (dòng `getPractice('teacher')?.projectKind` cũ là nơi dùng duy nhất), nên xóa dòng `  getPractice,` khỏi khối import `../src/index.js` ở đầu file. Nếu không, `npx eslint packages/practice-core` (Task 15 Step 17) và `npm run lint` (Task 19 Step 7) báo `'getPractice' is defined but never used`.

Test `'exposes workbench modules and role defaults'` đã được Task 2 viết lại và không còn dòng `defaultPinnedModules('principal')` / `defaultPinnedModules('teacher')`; không cần sửa gì ở đó.

Thay test `'exposes skill domains with starter skills'` (l.122-141 ở HEAD) bằng:

```ts
  it('exposes skill domains with starter skills and role-based defaults', () => {
    const ids = SKILL_DOMAINS.map((d) => d.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'health',
        'legal',
        'design',
        'project-mgmt',
        'sales',
        'admin',
        'hr',
        'customer-care',
        'personal',
      ]),
    )
    expect(ids).not.toContain('education')
    expect(isSkillDomainId('education')).toBe(false)
    expect(defaultPinnedSkillDomains('entrepreneur')).toEqual(['sales', 'admin'])
    expect(defaultPinnedSkillDomains('legal')).toEqual(['legal', 'admin'])
    expect(defaultPinnedSkillDomains('accounting')).toEqual(['admin'])
    expect(isSkillDomainId('sales')).toBe(true)
    expect(skillsForDomain('legal').length).toBeGreaterThan(0)
    expect(skillsForDomain('personal').every((s) => s.domainId === 'personal')).toBe(true)
  })
```

Trong `packages/practice-core/tests/agent-intent.test.ts`, đổi l.36-39 (đoạn `parseAgentIntentTarget(null, 'education')`) thành:

```ts
    expect(parseAgentIntentTarget(null, 'legal')).toEqual({
      kind: 'skill-domain',
      id: 'legal',
    })
```

- [ ] **Step 10: (C) Viết test skill-pin của shell sẽ fail**

Tạo `apps/shell/tests/skill-domain-pins.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readActiveSkillDomain,
  readPinnedSkillDomains,
  unpinSkillDomain,
} from '../src/renderer/src/skill-domain-pins'

const store = new Map<string, string>()

vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
}))

describe('skill domain pins', () => {
  afterEach(() => {
    store.clear()
  })

  it('defaults to the active role, entrepreneur when none is stored', () => {
    expect(readPinnedSkillDomains()).toEqual(['sales', 'admin'])
    store.set('uniwork.activePracticeId', 'legal')
    expect(readPinnedSkillDomains()).toEqual(['legal', 'admin'])
  })

  it('drops a stored education pin and falls back to the role defaults', () => {
    store.set('uniwork.skill.domain.pins', JSON.stringify(['education']))
    store.set('uniwork.activePracticeId', 'hr')
    expect(readPinnedSkillDomains()).toEqual(['hr', 'admin'])
  })

  it('falls back to the first pin, never education', () => {
    store.set('uniwork.skill.domain.active', 'education')
    expect(readActiveSkillDomain(['legal', 'admin'])).toBe('legal')
    expect(readActiveSkillDomain([])).toBe('sales')
  })

  it('unpinning the last tab restores the role defaults', () => {
    store.set('uniwork.activePracticeId', 'accounting')
    store.set('uniwork.skill.domain.pins', JSON.stringify(['legal']))
    expect(unpinSkillDomain('legal')).toEqual(['admin'])
  })
})
```

- [ ] **Step 11: (C) Chạy cả hai và thấy test fail**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/skill-domain-pins.test.ts
```

Kết quả mong đợi:
- practice-core: FAIL, 2 test fail. Danh sách id dài 15, và `defaultPinnedSkillDomains('entrepreneur')` trả `['education','personal','admin']`.
- shell: FAIL, 4 test fail. Mặc định là `['education','personal','admin']`, pin `education` đã lưu vẫn giữ, và `readActiveSkillDomain([])` trả `'education'`.

- [ ] **Step 12: (C) Gỡ phần giáo dục khỏi practice-core**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git rm packages/practice-core/src/practices/teacher.ts packages/practice-core/src/practices/principal.ts
```

`packages/practice-core/src/types.ts`:
- Trong `PRACTICE_IDS` (l.2-18), xóa `  'teacher',` và `  'principal',`.
- Thay l.27-31 (`/** ProjectStore kind … Teacher keeps legacy education … */ export type PracticeProjectKind = 'education' | Exclude<PracticeId, 'teacher'>`) bằng:

```ts
/** ProjectStore `kind` for a practice pack: the practice id itself. */
export type PracticeProjectKind = PracticeId
```

`packages/practice-core/src/meta.ts`, thay l.8-18 (hai hàm) bằng:

```ts
export function practiceProjectKind(practiceId: PracticeId): PracticeProjectKind {
  return practiceId
}

export function practiceIdFromProjectKind(kind: string | undefined): PracticeId | null {
  return isPracticeId(kind) ? kind : null
}
```

`packages/practice-core/src/registry.ts`:
- Xóa l.4 `import { principalPractice } from './practices/principal.js'` và l.6 `import { teacherPractice } from './practices/teacher.js'`.
- Trong `PRACTICE_REGISTRY`, xóa `  teacherPractice,` và `  principalPractice,`.
- Trong `PRACTICE_GROUPS`, xóa nhóm đầu (l.25-30):

```ts
  {
    id: 'education',
    labelVi: 'Giáo dục',
    labelEn: 'Education',
    ids: ['teacher', 'principal'],
  },
```

`packages/practice-core/src/practices/business.ts` l.4-7. Trước:

```ts
type BusinessPracticeId = Exclude<
  PracticeId,
  'teacher' | 'legal' | 'construction' | 'procurement' | 'principal'
>
```

Sau:

```ts
type BusinessPracticeId = Exclude<PracticeId, 'legal' | 'construction' | 'procurement'>
```

`packages/practice-core/src/skill-domains.ts`:
- Sau comment đầu file (trước `export type SkillDomainId =`), thêm `import type { PracticeId } from './types.js'`.
- Trong union `SkillDomainId`, xóa `  | 'education'`.
- Trong `SKILL_DOMAINS`, xóa mục đầu (l.42-50, `{ id: 'education', … color: '#3276CD', available: true },`).
- Trong `DOMAIN_SKILLS`, xóa l.159-197, từ `  // Education` tới lời gọi `skill(…),` của `'slide-bai'` và dòng trống sau. Dòng giữ lại tiếp theo là `  // Health`.
- Thay l.460-463. Trước:

```ts
/** Domains pinned when the user has never customized Skill tabs. */
export function defaultPinnedSkillDomains(): SkillDomainId[] {
  return ['education', 'personal', 'admin']
}
```

Sau:

```ts
/** The Skill tab each role starts on. */
const PRACTICE_SKILL_DOMAIN: Record<PracticeId, SkillDomainId> = {
  legal: 'legal',
  construction: 'project-mgmt',
  procurement: 'admin',
  sales: 'sales',
  'customer-care': 'customer-care',
  entrepreneur: 'sales',
  freelancer: 'design',
  'content-creator': 'design',
  marketing: 'sales',
  hr: 'hr',
  accounting: 'admin',
  it: 'project-mgmt',
  'real-estate': 'sales',
}

/** Domains pinned when the user has never customized Skill tabs: the role's own domain, then office admin. */
export function defaultPinnedSkillDomains(practiceId: PracticeId): SkillDomainId[] {
  return [...new Set<SkillDomainId>([PRACTICE_SKILL_DOMAIN[practiceId], 'admin'])]
}
```

Chạy `cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run && cd ../.. && npm run typecheck -w @uniwork/practice-core`. Kết quả mong đợi: PASS (10 test) và typecheck sạch.

- [ ] **Step 13: (C) Typecheck shell để gom các lỗi đã biết**

Chạy `cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell`. Kết quả mong đợi: FAIL với đúng các lỗi sau (dự đoán từ việc đọc code; số dòng có thể lệch do Task 2–3):
- `src/renderer/src/PracticeHome.tsx(327,…)`: TS2367, "comparison appears to be unintentional … 'PracticeId' and '"teacher"'".
- `src/renderer/src/my-ai-playbooks.ts(469,…)`: TS2322, `'"teacher"'` và `'"principal"'` không gán được cho `PracticeId`.
- `src/renderer/src/skill-domain-pins.ts` (l.14, 16, 18, 20, 38): TS2554, "Expected 1 arguments, but got 0".
- `src/renderer/src/skill-domain-pins.ts(62,…)`: TS2322, `'"education"'` không gán được cho `SkillDomainId`.
- `src/renderer/src/SkillDomainTabs.tsx(98,…)`: TS2345, đối số `'"education"'`.

- [ ] **Step 14: (C) Sửa các lỗi đó**

Thay `apps/shell/src/renderer/src/skill-domain-pins.ts` bằng:

```ts
import {
  defaultPinnedSkillDomains,
  isPracticeId,
  isSkillDomainId,
  type SkillDomainId,
} from '@uniwork/practice-core'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

const KEY = 'uniwork.skill.domain.pins'
const ACTIVE_KEY = 'uniwork.skill.domain.active'
/** written by Home.tsx switchPractice */
const ACTIVE_PRACTICE_KEY = 'uniwork.activePracticeId'

/** Skill tabs of a user who never pinned any: they follow the active role. */
function roleDefaults(): SkillDomainId[] {
  const practice = wbStoreGetRaw(ACTIVE_PRACTICE_KEY)
  return defaultPinnedSkillDomains(isPracticeId(practice) ? practice : 'entrepreneur')
}

export function readPinnedSkillDomains(): SkillDomainId[] {
  try {
    const raw = wbStoreGetRaw(KEY)
    if (raw === null) return roleDefaults()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return roleDefaults()
    const ids = parsed.filter(isSkillDomainId)
    return ids.length > 0 ? ids : roleDefaults()
  } catch {
    return roleDefaults()
  }
}

export function writePinnedSkillDomains(pins: SkillDomainId[]): void {
  wbStoreSetRaw(KEY, JSON.stringify(pins))
}

export function pinSkillDomain(id: SkillDomainId): SkillDomainId[] {
  const cur = readPinnedSkillDomains()
  if (cur.includes(id)) return cur
  const next = [...cur, id]
  writePinnedSkillDomains(next)
  return next
}

export function unpinSkillDomain(id: SkillDomainId): SkillDomainId[] {
  const next = readPinnedSkillDomains().filter((x) => x !== id)
  const safe = next.length > 0 ? next : roleDefaults()
  writePinnedSkillDomains(safe)
  return safe
}

export function reorderPinnedSkillDomains(
  fromId: SkillDomainId,
  toId: SkillDomainId,
): SkillDomainId[] {
  const cur = readPinnedSkillDomains()
  const from = cur.indexOf(fromId)
  const to = cur.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return cur
  const next = [...cur]
  const [item] = next.splice(from, 1)
  if (!item) return cur
  next.splice(to, 0, item)
  writePinnedSkillDomains(next)
  return next
}

export function readActiveSkillDomain(pins: SkillDomainId[]): SkillDomainId {
  const raw = wbStoreGetRaw(ACTIVE_KEY)
  if (raw && isSkillDomainId(raw) && pins.includes(raw)) return raw
  return pins[0] ?? roleDefaults()[0]
}

export function writeActiveSkillDomain(id: SkillDomainId): void {
  wbStoreSetRaw(ACTIVE_KEY, id)
}
```

`apps/shell/src/renderer/src/SkillDomainTabs.tsx` l.98: đổi `    if (active === id) select(next[0] ?? 'education')` thành `    if (active === id) select(readActiveSkillDomain(next))`. `readActiveSkillDomain` đã được import ở l.14.

`apps/shell/src/renderer/src/PracticeHome.tsx` l.327-331. Trước:

```tsx
      if (practice.id === 'teacher') {
        throw new Error('Teacher packs use TeacherHome')
      }
      const created = await window.aiOfficeProject!.createPracticeProject({
        practiceId: practice.id as Exclude<PracticeId, 'teacher'>,
```

Sau:

```tsx
      const created = await window.aiOfficeProject!.createPracticeProject({
        practiceId: practice.id,
```

`apps/shell/src/renderer/src/my-ai-playbooks.ts`: xóa l.467-495, toàn bộ phần tử `{ id: 'teacher-lesson', practiceIds: ['teacher', 'principal'], … },`, dừng trước `  {\n    id: 'hr-offer',`.

`apps/shell/src/renderer/src/my-ai-templates.ts`: xóa l.151-174, toàn bộ phần tử `{ id: 'teacher-lesson', playbookId: 'teacher-lesson', … },`, dừng trước `  {\n    id: 'cs-reply',`.

`apps/shell/src/shared/home-api.ts`:
- Trong `PracticeIdEntry`, xóa `  | 'teacher'` và `  | 'principal'`.
- Trong `ProjectKindEntry`, xóa `  | 'education'` và `  | 'principal'`.
- Trong `CreatePracticeProjectArgs`, đổi `  practiceId: Exclude<PracticeIdEntry, 'teacher'>` thành `  practiceId: PracticeIdEntry`.
- Trong `ProjectHomeApi`, đổi `  /** create a non-teacher practice pack with practice/meta.json */` thành `  /** create a practice pack with practice/meta.json */`.

Import `PracticeId` của `PracticeHome.tsx` giữ nguyên: nó vẫn được dùng ở `PracticeHomeProps.onSwitchPractice` và `toPracticeMeta`.

- [ ] **Step 15: (C) Chuyển fixture test khỏi `'teacher'`**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell
sed -i '' 's/teacher/entrepreneur/g' tests/my-ai-history.test.ts tests/workbench-account-gate.test.ts tests/workbench-accounts.test.ts tests/workbench-db.test.ts
```

Trong `tests/my-ai-playbooks-consent.test.ts` (khoảng l.33-34 ở HEAD), trước:

```ts
  it('does not apply sales playbook on teacher practice', () => {
    const r = routeMyAiText('Soạn báo giá cho gói Pro', { practiceId: 'teacher' })
```

Sau:

```ts
  it('does not apply sales playbook on legal practice', () => {
    const r = routeMyAiText('Soạn báo giá cho gói Pro', { practiceId: 'legal' })
```

Dùng `'legal'` chứ không phải `'entrepreneur'`: `sales-quote` có `'entrepreneur'` trong `practiceIds` (my-ai-playbooks.ts:82), nên với `'entrepreneur'` test sẽ fail.

- [ ] **Step 16: (C) Kiểm toàn bộ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n -E "'teacher'|'principal'|'education'|teacher-lesson" -- apps packages ':!packages/edu-core'
npm run typecheck -w @uniwork/practice-core && npm run typecheck -w @genoffice/project-store && npm run typecheck -w @genoffice/docs && npm run typecheck -w @genoffice/shell
cd packages/practice-core && npx vitest run && cd ../project-store && npx vitest run && cd ../../apps/shell
npx vitest run tests/skill-domain-pins.test.ts tests/my-ai-history.test.ts tests/my-ai-playbooks-consent.test.ts tests/my-ai-templates.test.ts tests/my-ai-forms.test.ts tests/workbench-account-gate.test.ts tests/workbench-accounts.test.ts tests/workbench-db.test.ts tests/strings-visible-copy.test.ts tests/account-ui.test.ts
cd ../.. && npx eslint packages/practice-core/src apps/shell/src/renderer/src/skill-domain-pins.ts apps/shell/src/renderer/src/SkillDomainTabs.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/my-ai-playbooks.ts apps/shell/src/renderer/src/my-ai-templates.ts
npm run build -w @genoffice/shell
```

Kết quả mong đợi:
- grep không in gì.
- Mọi typecheck pass.
- practice-core 10 passed, project-store pass.
- Shell: mọi file pass, kể cả skill-domain-pins (4 passed).
- eslint sạch, build thành công.

Kiểm tay: chạy `npm run shell` và mở Bàn làm việc. Màn hiện practice home của "Chủ doanh nghiệp", dropdown vai trò không còn nhóm "Giáo dục", và tab Kỹ năng hiện "Bán hàng" và "Hành chính văn phòng".

- [ ] **Step 17: (C) Commit**

```bash
git add packages/practice-core apps/shell/src/renderer/src/skill-domain-pins.ts apps/shell/src/renderer/src/SkillDomainTabs.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/my-ai-playbooks.ts apps/shell/src/renderer/src/my-ai-templates.ts apps/shell/src/shared/home-api.ts apps/shell/tests/skill-domain-pins.test.ts apps/shell/tests/my-ai-history.test.ts apps/shell/tests/my-ai-playbooks-consent.test.ts apps/shell/tests/workbench-account-gate.test.ts apps/shell/tests/workbench-accounts.test.ts apps/shell/tests/workbench-db.test.ts
git commit -m "refactor(practice-core,shell): drop the teacher and principal roles and the education skill domain

Skill tabs a user never pinned now follow the active role.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Ghi chú cho phần CSS (spec 6.9): sau task này, các rule `home.css` sau đã chết vì chỉ TeacherHome dùng; Task 12 Step 14 xóa chúng (sau khi đổi tiền tố thành `wb-*`):
- `.teacher-filters` (l.7509-7538, danh sách selector chung còn gồm `.teacher-form select` và `.teacher-add-row select`)
- `.teacher-chip-row-spaced` (7617)
- `.teacher-hub-toggle`, `.teacher-hub-nested`, `.teacher-hub` (7621-7646)
- `.teacher-error-inline` (7778)
- `.teacher-detail-header` (7841-7852)
- `.teacher-chip-ai` (7895-7904)

### Task 5: Xóa `packages/edu-core`

**Files:**
- Delete: `packages/edu-core/` (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/{catalog,hub,index,knowledge,materials,meta,pack,prompts,skills,templates,types}.ts`, `tests/edu-core.test.ts`)
- Modify: `apps/shell/package.json:42`, `packages/practice-core/package.json:7,16-18`, `package.json:36-37`, `package-lock.json` (l.295, 6383-6386, 16201-16209, 16396-16398)
- Test: không có test mới. Sau Task 4 `hub.ts` không còn consumer, nên test của nó đi cùng package.

**Interfaces:**
- Consumes: Task 4 (không source nào import `@uniwork/edu-core` nữa).
- Produces: workspace `@uniwork/edu-core` không còn tồn tại.

- [ ] **Step 1: Xác nhận không ai import package**

Chạy `cd /Users/ducquang/UNICOM/uniwork-office && git grep -n "edu-core" -- apps packages package.json ':!packages/edu-core'`.
Kết quả mong đợi: đúng bốn dòng ở ba file:
- `apps/shell/package.json:42`
- `package.json:36`, `package.json:37`
- `packages/practice-core/package.json:17`

Nếu có kết quả nào dưới `src/`, Task 4 chưa xong. Dừng lại.

- [ ] **Step 2: Xóa package và các mục trong manifest**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git rm -r packages/edu-core
```

`apps/shell/package.json`: xóa dòng `    "@uniwork/edu-core": "*",`.

`package.json`:
- Trong `scripts.test`, đổi `npm run test -w @genoffice/i18n && npm run test -w @uniwork/edu-core && npm run test -w @uniwork/practice-core` thành `npm run test -w @genoffice/i18n && npm run test -w @uniwork/practice-core`.
- Trong `scripts.typecheck`, đổi `npm run typecheck -w @genoffice/i18n && npm run typecheck -w @uniwork/edu-core && npm run typecheck -w @uniwork/practice-core` thành `npm run typecheck -w @genoffice/i18n && npm run typecheck -w @uniwork/practice-core`.

`packages/practice-core/package.json`, cả file sau khi sửa:

```json
{
  "name": "@uniwork/practice-core",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "private": true,
  "type": "module",
  "description": "Business practice packs for UniWork Office (legal, sales, HR, and more)",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 3: Làm mới lockfile và bỏ symlink treo**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm install --package-lock-only --ignore-scripts
rm -f node_modules/@uniwork/edu-core
grep -c "edu-core" package-lock.json
```

Kết quả mong đợi: `0`. Trước khi plan bắt đầu, `package-lock.json` đã có 26 dòng xóa `"peer": true` không liên quan (nhiễu của npm). Chúng sẽ đi theo commit này trừ khi người dùng commit riêng trước, nên chạy `git diff --stat package-lock.json` và báo người dùng.

- [ ] **Step 4: Kiểm tra**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "edu-core" -- . ':!docs/**'
npm run typecheck -w @uniwork/practice-core && npm run typecheck -w @genoffice/shell && npm run typecheck -w @genoffice/project-store
npm run test -w @uniwork/practice-core
npm run build -w @genoffice/shell
```

Kết quả mong đợi: grep không in gì (comment trong `project-store/src/types.ts` đã gỡ ở Task 4), typecheck pass, practice-core 10 passed, build shell thành công.

- [ ] **Step 5: Commit**

```bash
git add -A packages/edu-core
git add apps/shell/package.json packages/practice-core/package.json package.json package-lock.json
git commit -m "chore: delete the @uniwork/edu-core package

Its last consumers (Teacher home, lesson-pack export, AI Hub probe, the
teacher practice) went in the previous commits; hub.ts had no other user.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Gỡ UI license/billing cục bộ, ô chọn ngôn ngữ của Bàn làm việc, khóa lưu trữ `uniwork.teacher*`, và cập nhật quy tắc rebrand

Ghi chú hợp đồng: UI phụ thuộc `license-entitlements.ts` là `LicenseDevicesPane.tsx` và `BillingPaymentPane.tsx`; helper duy nhất của chúng là `payment-account.ts` và `vietqr.ts`. Task này xóa cả năm. Cài đặt vẫn hiện tên gói qua `AccountPane.tsx:245`.

**Files:**
- Delete: `apps/shell/src/renderer/src/license-entitlements.ts`, `LicenseDevicesPane.tsx`, `BillingPaymentPane.tsx`, `payment-account.ts`, `vietqr.ts` (đều trong `apps/shell/src/renderer/src/`)
- Modify: `apps/shell/src/renderer/src/SettingsModal.tsx` (l.49, 56, 1730-1737)
- Modify: `apps/shell/src/renderer/src/settings.css` (l.1109-1390)
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx` (l.28-39, 77-85, 571-581)
- Modify: `apps/shell/src/renderer/src/backup-addons.ts` (l.196, 200), `apps/shell/src/renderer/src/workbench-store-client.ts` (l.29, 31), `apps/shell/src/main/workbench-db.ts` (l.255, 257). Có code main nên phải rebuild shell.
- Modify: `tools/rebrand/README.md` (l.3-5, 59), `tools/rebrand/sync-upstream.mjs:1188`, `MODIFICATIONS` (l.31-35)
- Test: `apps/shell/tests/account-ui.test.ts` (l.19-20, 674, 682-737)

**Interfaces:**
- Consumes: không có.
- Produces: không còn export `LicensePlanId`, `LicenseDevicesPane`, `BillingPaymentPane`. Cài đặt → Tài khoản hiện ô ngôn ngữ, `AccountPane` (vẫn hiện tên gói, `AccountPane.tsx:245`) và `UniworkCloudAccountRows`. Khóa `uniwork.teacher*` và `uniwork.teacherUiLang` không còn được lưu, sao lưu hay khôi phục (spec 4.2).

- [ ] **Step 1: Xóa file license/billing và chỗ gắn trong Cài đặt**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell/src/renderer/src
git rm license-entitlements.ts LicenseDevicesPane.tsx BillingPaymentPane.tsx payment-account.ts vietqr.ts
```

`SettingsModal.tsx`:
- Xóa l.49 `import { BillingPaymentPane } from './BillingPaymentPane'` và l.56 `import { LicenseDevicesPane } from './LicenseDevicesPane'`.
- l.1729-1738. Trước:

```tsx
                {loggedIn && <UniworkCloudAccountRows status={cloud} />}
                <LicenseDevicesPane
                  lang={lang}
                  loggedIn={loggedIn}
                  accountPlanName={
                    (loggedIn && account?.status?.entitlements?.planName) || undefined
                  }
                />
                <BillingPaymentPane lang={lang} signedIn={loggedIn} />
              </>
```

Sau:

```tsx
                {loggedIn && <UniworkCloudAccountRows status={cloud} />}
              </>
```

`settings.css`: xóa l.1109-1390, từ `/* ── License & devices ──… */` tới dấu `}` đóng `.set-billing-order span { … }`. Dòng giữ lại tiếp theo là `/* Settings → About: the one-click update entry next to the version row */`, dòng trống 1108 giữ nguyên.

`apps/shell/tests/account-ui.test.ts`:
- Xóa l.19 `import { BillingPaymentPane } from '../src/renderer/src/BillingPaymentPane'` và l.20 `import { LicenseDevicesPane } from '../src/renderer/src/LicenseDevicesPane'`.
- Xóa l.674 `    expect(settings).toMatch(/\.set-license-warn \{[^}]*color: var\(--danger-text\)/)`.
- Xóa l.682-737: dòng trống và toàn bộ khối `describe('legacy license panes next to the UniWork account', …)`, tới hết file.

- [ ] **Step 2: Kiểm tra (vòng xóa)**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "license-entitlements\|LicenseDevicesPane\|BillingPaymentPane\|payment-account\|vietqr\|set-license\|set-billing" -- apps e2e
npm run typecheck -w @genoffice/shell
cd apps/shell && npx vitest run tests/account-ui.test.ts && cd ../..
npm run check:theme-colors -- --base origin/main
```

Kết quả mong đợi: grep không in gì, typecheck pass, account-ui pass (ít hơn 4 test so với trước), theme check pass vì chỉ có xóa.

- [ ] **Step 3: Gỡ ô chọn ngôn ngữ ở hero của PracticeHome**

`apps/shell/src/renderer/src/PracticeHome.tsx`:
- Xóa l.28-39: dòng trống, `const UI_LANG_KEY = 'uniwork.teacherUiLang'`, `type WorkbenchUiLang = 'vi' | 'en'` và toàn bộ `function persistWorkbenchUiLang(…) { … }`. Giữ một dòng trống sau các import.
- l.77-85. Trước:

```tsx
  const { lang, setLang } = useI18n()
  const vi = lang === 'vi'
  const uiLang: WorkbenchUiLang = vi ? 'vi' : 'en'
  const label = (a: string, b: string) => (vi ? a : b)

  const changeUiLang = (next: WorkbenchUiLang) => {
    persistWorkbenchUiLang(next)
    setLang(next)
  }

```

Sau:

```tsx
  const { lang } = useI18n()
  const vi = lang === 'vi'
  const label = (a: string, b: string) => (vi ? a : b)

```

- Xóa l.571-581, `<label className="teacher-lang">` thứ hai (select "Ngôn ngữ / Language" có `value={uiLang}`) tới hết `</label>` của nó. Label chọn vai trò phía trên giữ lại (Task 12 thay cả hero bằng thanh trên). Ngôn ngữ app vẫn đổi ở Cài đặt → Tài khoản → Ngôn ngữ.

Chạy:

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "uiLang\|changeUiLang\|persistWorkbenchUiLang" -- apps/shell/src/renderer/src/PracticeHome.tsx
npm run typecheck -w @genoffice/shell && npx eslint apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/SettingsModal.tsx
```

Kết quả mong đợi: grep không in gì, typecheck và eslint sạch.

- [ ] **Step 4: Gỡ khóa `uniwork.teacher*` khỏi ba allowlist (spec 4.2)**

Sau Task 4 và Step 3, không còn nơi nào ghi `uniwork.teacher*` hay `uniwork.teacherUiLang`. Xóa hai dòng sau ở cả ba hàm `isBackupKey` (`apps/shell/src/renderer/src/backup-addons.ts`), `allowedKey` (`apps/shell/src/renderer/src/workbench-store-client.ts`) và `isAllowedWbKey` (`apps/shell/src/main/workbench-db.ts`). Tên biến là `k` trong `backup-addons.ts` và `key` ở hai file còn lại:

```ts
    k.startsWith('uniwork.teacher') ||
    k === 'uniwork.teacherUiLang' ||
```

```ts
    key.startsWith('uniwork.teacher') ||
    key === 'uniwork.teacherUiLang' ||
```

Biểu thức `||` còn lại vẫn hợp lệ vì cả hai dòng nằm giữa danh sách. Chạy:

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "uniwork\.teacher" -- apps
npm run typecheck -w @genoffice/shell
cd apps/shell && npx vitest run tests/workbench-db.test.ts tests/workbench-account-gate.test.ts && cd ../..
npm run build -w @genoffice/shell
```

Kết quả mong đợi: grep không in gì, typecheck và test pass, build shell thành công (bắt buộc vì `main/workbench-db.ts` đổi).

- [ ] **Step 5: Cập nhật quy tắc rebrand và MODIFICATIONS**

`tools/rebrand/README.md` l.3-5. Trước:

```
UniWork Office is genoffice (`genspark-ai/genoffice`) with a UniWork brand and
teacher-edu features on top. There is no shared git history with upstream, so
upstream changes arrive as patches and the brand is re-applied by script.
```

Sau:

```
UniWork Office is genoffice (`genspark-ai/genoffice`) with a UniWork brand and
UniWork work features (the Workbench, UniWork sign-in and cloud documents) on
top. The education features (Teacher mode, lesson packs, `@uniwork/edu-core`)
were removed on purpose in October 2026, so a sync must not restore them. There
is no shared git history with upstream, so upstream changes arrive as patches
and the brand is re-applied by script.
```

`tools/rebrand/README.md` l.59: trước `UniWork brand and teacher-edu work, upstream wins elsewhere), \`git add\` them and run \`--continue\`, which commits the`, sau `UniWork brand and UniWork work features, upstream wins elsewhere), \`git add\` them and run \`--continue\`, which commits the`.

`tools/rebrand/sync-upstream.mjs` l.1188: trước `      '1. Resolve every conflicted file: keep the UniWork brand and teacher-edu work, upstream wins elsewhere.',`, sau `      '1. Resolve every conflicted file: keep the UniWork brand and UniWork work features, upstream wins elsewhere.',`.

`MODIFICATIONS` l.31-35 (phần viết tay dưới "Summary of changes", `tools/legal` không sinh lại). Trước:

```
Education and practice features
  Teacher mode with lesson-pack templates and AI workflow prompts, practice
  packs for several professions, the UniWork Office Bridge client and its
  contracts, the UniAI web app, and additional Home panes (tasks, notes,
  calendar, family, health, finance and others) were added. Vietnamese copy
  was revised throughout.
```

Sau:

```
Work and practice features
  Practice packs for business roles, the UniWork Office Bridge client and its
  contracts, the UniAI web app, UniWork sign-in and cloud documents, and a
  Workbench with additional Home panes (tasks, calendar, notes, forms and
  others) were added. Vietnamese copy was revised throughout.
```

Chạy:

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git grep -n "teacher-edu" -- tools MODIFICATIONS
npm run test:rebrand && npm run legal:check && npm run check:brand && npm run format:check
```

Kết quả mong đợi: grep không in gì. `test:rebrand` báo 66 pass, `legal:check` báo "NOTICE, MODIFICATIONS and package metadata match legal.json", `check:brand` báo 0 vi phạm, format check sạch.

- [ ] **Step 6: Commit**

```bash
git add -A apps/shell/src/renderer/src/license-entitlements.ts apps/shell/src/renderer/src/LicenseDevicesPane.tsx apps/shell/src/renderer/src/BillingPaymentPane.tsx apps/shell/src/renderer/src/payment-account.ts apps/shell/src/renderer/src/vietqr.ts
git add apps/shell/src/renderer/src/SettingsModal.tsx apps/shell/src/renderer/src/settings.css apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/backup-addons.ts apps/shell/src/renderer/src/workbench-store-client.ts apps/shell/src/main/workbench-db.ts apps/shell/tests/account-ui.test.ts tools/rebrand/README.md tools/rebrand/sync-upstream.mjs MODIFICATIONS
git commit -m "refactor(shell): remove the local license/billing panes and the workbench language picker

The license endpoint never existed and billing was a local VietQR mock; the
plan name still shows in the UniWork account pane. The uniwork.teacher*
storage keys leave the store and backup allowlists. The rebrand rules no
longer tell a sync to keep teacher-edu work.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Chưa kiểm ở Task 4–6: không chạy e2e và chưa thử các sửa đổi trong worktree. Các lỗi tsc dự kiến ở Task 4 Step 13 được dự đoán từ việc đọc code (typecheck và test gốc sạch ở `9194f306`). Rủi ro: pack `edu/meta.json` có sẵn biến mất khỏi Bàn làm việc mà không có migration (D3).

### Task 7: Client main process cho route công việc của UniWork (`uniwork-work/client.ts`)

Ghi chú hợp đồng: Task 7 sở hữu thay đổi `slug`/`orgSlug` của `UniworkWorkspaceRef` (C5): kiểu, phần parse trong `uniwork-docs/client.ts`, stub e2e và test client tài liệu. Task 7 tạo `apps/shell/src/shared/uniwork-work-api.ts` với kiểu lỗi và kết quả, `workErrorOfDocCode`, các DTO và `WorkCreateTaskInput`; Task 8 thêm `WorkRecentDocument`, `WorkWebTarget`, `UNIWORK_WORK_CHANNELS` và `UniworkWorkApi` vào cuối file. `uniworkId` giờ từ chối cả giá trị không phải chuỗi: trước đây id không phải chuỗi từ IPC lọt qua regex dưới dạng chuỗi "undefined", nay thành `not_found` (renderer thấy `'forbidden'`). Caller của docs không bị ảnh hưởng. Quick add không gửi `allow_duplicate` (C15).

**Files:**
- Create: `apps/shell/src/shared/uniwork-work-api.ts`
- Create: `apps/shell/src/main/uniwork-work/parse.ts`
- Create: `apps/shell/src/main/uniwork-work/client.ts`
- Modify: `apps/shell/src/main/uniwork-docs/client.ts:78-81` (`id`), `:107-125` (đầu `send`), `:190-195` (đuôi `send`), `:219` (parse workspace)
- Modify: `apps/shell/src/shared/home-api.ts:146-150` (`UniworkWorkspaceRef`)
- Modify: `e2e/fixtures/uniwork-documents-stub.ts:33`, `:268-272`
- Test (create): `apps/shell/tests/uniwork-work-client.test.ts`
- Test (modify): `apps/shell/tests/uniwork-docs-client.test.ts:32-39`, thêm một khối describe trước `:115`

**Interfaces:**
- Consumes:
  - `UniworkDocsClientOptions`, `FetchLike`, `METADATA_TIMEOUT_MS` từ `main/uniwork-docs/client.ts`
  - `UniworkDocError`, `errorFromResponse` từ `main/uniwork-docs/errors.ts`
  - `TransportError` từ `main/uniwork-auth/transport.ts`
  - `UniworkDocErrorCode` từ `shared/home-api.ts`
- Produces:
  - `UniworkWorkError`, `UniworkWorkResult<T>`, `workErrorOfDocCode(code: UniworkDocErrorCode): UniworkWorkError`
  - `WorkTaskStatusKey`, `WorkTask`, `WorkTaskStatus`, `WorkMeeting`, `WorkNotification`, `WorkHomeSource`, `WorkHomeCounts`, `WorkHomeSummary`, `WorkCalendarEvent`, `WorkPerson`, `WorkCreateTaskInput` (đều trong `shared/uniwork-work-api.ts`)
  - `UniworkCall<T>`, `createUniworkSend(options: UniworkDocsClientOptions): <T>(call: UniworkCall<T>) => Promise<T>` và `uniworkId(value: string): string` (export từ `uniwork-docs/client.ts`)
  - `UniworkWorkClient` và `createUniworkWorkClient(options: UniworkDocsClientOptions): UniworkWorkClient`, throw `UniworkDocError`.
  - `UniworkWorkspaceRef` có thêm `slug: string` và `orgSlug: string`

- [ ] **Step 1: Viết test client sẽ fail.** Tạo `apps/shell/tests/uniwork-work-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { UniworkDocErrorCode } from '../src/shared/home-api'
import { workErrorOfDocCode, type UniworkWorkError } from '../src/shared/uniwork-work-api'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { FetchLike, UniworkDocsClientOptions } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkWorkClient } from '../src/main/uniwork-work/client'

const ORIGIN = 'https://uniwork.example'
const TOKEN = 'secret-token-7f3a'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

const TASK = {
  id: 't_1',
  organization_id: 'org_1',
  workspace_id: 'ws_1',
  number: 7,
  identifier: 'ENG-7',
  title: 'Call supplier',
  description: 'long text the UI does not read',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-14',
  project_id: null,
  position: 1,
  created_by: 'u_1',
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-13T08:00:00Z',
}
const PARSED_TASK = {
  id: 't_1',
  workspace_id: 'ws_1',
  identifier: 'ENG-7',
  title: 'Call supplier',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-14',
  project_id: null,
  updated_at: '2026-10-13T08:00:00Z',
}
const MEETING = {
  id: 'm_1',
  workspace_id: 'ws_1',
  title: 'Standup',
  description: '',
  starts_at: '2026-10-13T09:00:00Z',
  ends_at: '2026-10-13T09:15:00Z',
  room_name: 'room-1',
  created_by: 'u_1',
  status: 'IN_PROGRESS',
}
const NOTE = {
  id: 'n_1',
  kind: 'task_assigned',
  workspace_id: 'ws_1',
  resource_type: 'task',
  resource_id: 't_1',
  actor_kind: 'human',
  title_key: 'notifications.kind.task_assigned',
  params: { task: 'Call supplier' },
  created_at: '2026-10-13T07:00:00Z',
}
const HOME = {
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
  my_work: [TASK],
  upcoming_meetings: [MEETING],
  inbox: [NOTE],
  partial: [],
  generated_at: '2026-10-13T08:00:00Z',
}
const statusRow = (key: string, archived = false) => ({
  id: `s_${key}`,
  key,
  name: key,
  category: key,
  color: 'gray',
  position: 1,
  ...(archived ? { archived_at: '2026-01-01T00:00:00Z' } : {}),
})
const EVENT = {
  id: 'e_1',
  kind: 'meeting',
  entity_id: 'm_1',
  title: 'Standup',
  start: '2026-10-13T09:00:00Z',
  end: '2026-10-13T09:15:00Z',
  all_day: false,
  status: null,
  priority: null,
  project_id: null,
}
const PERSON = {
  user_id: 'u_1',
  display_name: 'Ada',
  email: 'ada@example.test',
  org_role: 'member',
  status: 'active',
  title: 'Engineer',
  department: { id: 'd_1', name: 'R&D' },
  manager: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

/** a fake server: one body per route; every body also echoes the Authorization header back */
function server(overrides: Record<string, () => Response> = {}) {
  return vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const echo = (init.headers as Record<string, string>).Authorization
    const override = overrides[path]
    if (override) return override()
    const bodies: Record<string, unknown> = {
      '/workspaces/ws_1/home': { ...HOME, echo, my_work: [{ ...TASK, echo }] },
      '/workspaces/ws_1/my-tasks': { tasks: [{ ...TASK, echo }], total: 1, limit: 200, offset: 0 },
      '/workspaces/ws_1/task-statuses': {
        statuses: [statusRow('todo'), statusRow('done'), statusRow('old', true)],
        categories: [],
        total: 3,
      },
      '/tasks/t_1': { task: { ...TASK, status: 'done', echo } },
      '/workspaces/ws_1/tasks': { task: { ...TASK, id: 't_2', title: 'Call', echo } },
      '/workspaces/ws_1/calendar/events': { events: [{ ...EVENT, echo }] },
      '/orgs/acme/people/u_1': { person: { ...PERSON, echo }, reports: [] },
    }
    return path in bodies ? json(200, bodies[path]) : envelope(404, 'not_found')
  })
}

function client(fetch: FetchLike, extra: Partial<UniworkDocsClientOptions> = {}) {
  return createUniworkWorkClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    isSignedIn: () => true,
    fetch,
    ...extra,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

const RANGE = { workspaceId: 'ws_1', from: '2026-10-13', to: '2026-10-27' }

describe('uniwork work client: routes', () => {
  it('calls only fixed routes under apiOrigin/api/v1, never follows redirects, never caches', async () => {
    const fetch = server()
    const api = client(fetch)
    await api.homeSummary('ws_1')
    await api.myTasks('ws_1')
    await api.taskStatuses('ws_1')
    await api.setTaskStatus('t_1', 'done')
    await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0001' })
    await api.calendarEvents(RANGE)
    await api.person('acme', 'u_1')
    expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/home`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/my-tasks?limit=200`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/task-statuses`,
      `PATCH ${ORIGIN}/api/v1/tasks/t_1`,
      `POST ${ORIGIN}/api/v1/workspaces/ws_1/tasks`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/calendar/events?from=2026-10-13&to=2026-10-27&mine=true`,
      `GET ${ORIGIN}/api/v1/orgs/acme/people/u_1`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('PATCH sends only the status key', async () => {
    const fetch = server()
    expect((await client(fetch).setTaskStatus('t_1', 'done')).status).toBe('done')
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ status: 'done' })
  })

  it('POST sends the trimmed title, the due date and the Idempotency-Key', async () => {
    const fetch = server()
    const api = client(fetch)
    const created = await api.createTask({
      workspaceId: 'ws_1',
      title: '  Call  ',
      dueDate: '2026-10-14',
      idempotencyKey: 'key-0001',
    })
    expect(created.id).toBe('t_2')
    await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0002' })
    const [first, second] = fetch.mock.calls.map(([, init]) => init)
    expect(JSON.parse(first!.body as string)).toEqual({ title: 'Call', due_date: '2026-10-14' })
    expect((first!.headers as Record<string, string>)['Idempotency-Key']).toBe('key-0001')
    expect(JSON.parse(second!.body as string)).toEqual({ title: 'Call' })
  })
})

describe('uniwork work client: parsing', () => {
  it('reads only the fields the Workbench shows', async () => {
    const api = client(server())
    expect(await api.homeSummary('ws_1')).toEqual({
      today: '2026-10-13',
      timezone: 'Asia/Ho_Chi_Minh',
      counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
      my_work: [PARSED_TASK],
      upcoming_meetings: [
        {
          id: 'm_1',
          workspace_id: 'ws_1',
          title: 'Standup',
          starts_at: '2026-10-13T09:00:00Z',
          ends_at: '2026-10-13T09:15:00Z',
          status: 'IN_PROGRESS',
        },
      ],
      inbox: [
        {
          id: 'n_1',
          kind: 'task_assigned',
          workspace_id: 'ws_1',
          resource_type: 'task',
          resource_id: 't_1',
          actor_kind: 'human',
          title_key: 'notifications.kind.task_assigned',
          params: { task: 'Call supplier' },
          created_at: '2026-10-13T07:00:00Z',
        },
      ],
      partial: [],
      generated_at: '2026-10-13T08:00:00Z',
    })
    expect(await api.myTasks('ws_1')).toEqual([PARSED_TASK])
    expect((await api.taskStatuses('ws_1')).map((s) => s.key)).toEqual(['todo', 'done'])
    expect(await api.calendarEvents(RANGE)).toEqual([
      {
        id: 'e_1',
        kind: 'meeting',
        entity_id: 'm_1',
        title: 'Standup',
        start: '2026-10-13T09:00:00Z',
        end: '2026-10-13T09:15:00Z',
        all_day: false,
        status: null,
        project_id: null,
      },
    ])
    expect(await api.person('acme', 'u_1')).toEqual({
      user_id: 'u_1',
      display_name: 'Ada',
      email: 'ada@example.test',
      title: 'Engineer',
      department: { id: 'd_1', name: 'R&D' },
      manager: null,
      timezone: 'Asia/Ho_Chi_Minh',
    })
  })

  it('a home section that fails its schema becomes [] and is named in partial', async () => {
    const fetch = server({
      '/workspaces/ws_1/home': () =>
        json(200, {
          ...HOME,
          upcoming_meetings: [{ id: 'm_1' }],
          inbox: 'not a list',
          partial: ['tasks', 'weather'],
        }),
    })
    const home = await client(fetch).homeSummary('ws_1')
    expect(home.my_work).toEqual([PARSED_TASK])
    expect(home.upcoming_meetings).toEqual([])
    expect(home.inbox).toEqual([])
    expect(home.partial).toEqual(['tasks', 'meetings', 'notifications'])
  })

  it('a drifted count reads 0; a home without today is malformed', async () => {
    const drifted = server({
      '/workspaces/ws_1/home': () =>
        json(200, { ...HOME, counts: { ...HOME.counts, overdue: -1, unread: 'x' } }),
    })
    expect((await client(drifted).homeSummary('ws_1')).counts).toEqual({
      open: 3,
      overdue: 0,
      due_today: 1,
      meetings_today: 1,
      unread: 0,
    })
    const noToday = server({
      '/workspaces/ws_1/home': () => json(200, { ...HOME, today: undefined }),
    })
    expect(await codeOf(client(noToday).homeSummary('ws_1'))).toBe('malformed_response')
  })

  it('a list route without its list is malformed', async () => {
    const fetch = server({ '/workspaces/ws_1/my-tasks': () => json(200, { tasks: null }) })
    expect(await codeOf(client(fetch).myTasks('ws_1'))).toBe('malformed_response')
  })
})

describe('uniwork work client: errors', () => {
  it('maps each failure to the work error the renderer shows', async () => {
    const cases: Array<[FetchLike, UniworkDocErrorCode, UniworkWorkError]> = [
      [async () => envelope(403, 'forbidden'), 'forbidden', 'forbidden'],
      [async () => envelope(404, 'not_found'), 'not_found', 'forbidden'],
      // a bare 403 from a proxy is not the server's verdict
      [async () => new Response('denied', { status: 403 }), 'server_error', 'server'],
      [async () => json(500, {}), 'server_error', 'server'],
      [
        async () => {
          throw new TypeError('fetch failed')
        },
        'network',
        'offline',
      ],
    ]
    for (const [fetch, code, work] of cases) {
      expect(await codeOf(client(fetch).homeSummary('ws_1'))).toBe(code)
      expect(workErrorOfDocCode(code)).toBe(work)
    }
  })

  it('a 401 refreshes once and retries; a second 401 is session_expired (signed-out)', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call('tok-1')
      } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'unauthorized') throw error
        return call('tok-2')
      }
    }
    expect(await codeOf(client(fetch, { authorized }).myTasks('ws_1'))).toBe('session_expired')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(workErrorOfDocCode('session_expired')).toBe('signed-out')
  })

  it('a call past its deadline is a timeout (offline)', async () => {
    const fetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    )
    expect(await codeOf(client(fetch, { metadataTimeoutMs: 10 }).homeSummary('ws_1'))).toBe(
      'timeout',
    )
    expect(workErrorOfDocCode('timeout')).toBe('offline')
  })

  it('signed out: nothing is sent', async () => {
    const fetch = server()
    expect(await codeOf(client(fetch, { isSignedIn: () => false }).myTasks('ws_1'))).toBe(
      'not_signed_in',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(workErrorOfDocCode('not_signed_in')).toBe('signed-out')
  })

  it('refuses renderer input the server must never see', async () => {
    const fetch = server()
    const api = client(fetch)
    expect(await codeOf(api.setTaskStatus('../me', 'done'))).toBe('not_found')
    expect(await codeOf(api.setTaskStatus('t_1', 'done; drop'))).toBe('server_error')
    const task = { workspaceId: 'ws_1', title: 'A', idempotencyKey: 'key-0001' }
    expect(await codeOf(api.createTask({ ...task, title: '   ' }))).toBe('server_error')
    expect(await codeOf(api.createTask({ ...task, dueDate: '14/10/2026' }))).toBe('server_error')
    expect(await codeOf(api.createTask({ ...task, idempotencyKey: '' }))).toBe('server_error')
    expect(await codeOf(api.calendarEvents({ ...RANGE, from: 'today' }))).toBe('server_error')
    expect(await codeOf(api.person('acme', 'u_1/../../admin'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no result or error carries the token, even when the server echoes it', async () => {
    const api = client(server())
    const results = [
      await api.homeSummary('ws_1'),
      await api.myTasks('ws_1'),
      await api.taskStatuses('ws_1'),
      await api.setTaskStatus('t_1', 'done'),
      await api.createTask({ workspaceId: 'ws_1', title: 'Call', idempotencyKey: 'key-0001' }),
      await api.calendarEvents(RANGE),
      await api.person('acme', 'u_1'),
    ]
    expect(JSON.stringify(results)).not.toContain(TOKEN)
    const failed: unknown = await client(async () =>
      json(403, { error: { code: 'forbidden', message: TOKEN } }),
    )
      .homeSummary('ws_1')
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(UniworkDocError)
    const error = failed as UniworkDocError
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(TOKEN)
  })
})

describe('workErrorOfDocCode', () => {
  it('maps every documents error code to one of the four work errors', () => {
    const table: Record<UniworkDocErrorCode, UniworkWorkError> = {
      not_signed_in: 'signed-out',
      session_expired: 'signed-out',
      wrong_deployment: 'signed-out',
      forbidden: 'forbidden',
      not_found: 'forbidden',
      deleted: 'forbidden',
      network: 'offline',
      timeout: 'offline',
      conflict: 'server',
      quota_exceeded: 'server',
      too_large: 'server',
      unsupported_format: 'server',
      engine_incompatible: 'server',
      idempotency_mismatch: 'server',
      ticket_invalid: 'server',
      ticket_expired: 'server',
      server_error: 'server',
      malformed_response: 'server',
    }
    for (const [code, work] of Object.entries(table)) {
      expect(workErrorOfDocCode(code as UniworkDocErrorCode)).toBe(work)
    }
  })
})
```

- [ ] **Step 2: Chạy test và thấy fail.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-work-client.test.ts`
  - Kết quả mong đợi: FAIL với `Failed to resolve import "../src/shared/uniwork-work-api"`. Các file chưa tồn tại.

- [ ] **Step 3: Tạo kiểu dùng chung.** Tạo `apps/shell/src/shared/uniwork-work-api.ts`:

```ts
import type { UniworkDocErrorCode } from './home-api'

/**
 * The Workbench's UniWork work data (home, my tasks, statuses, calendar,
 * profile) as main hands it to the renderer: the server's snake_case DTOs,
 * only the fields the UI reads. Handlers live in main/uniwork-work; the
 * token never leaves main.
 */

/** The only failures the renderer ever sees from a work call. */
export type UniworkWorkError = 'signed-out' | 'forbidden' | 'offline' | 'server'

export type UniworkWorkResult<T> = { ok: true; value: T } | { ok: false; error: UniworkWorkError }

/** UniworkDocError codes -> work errors (main handlers, and the renderer for the docs list calls) */
export function workErrorOfDocCode(code: UniworkDocErrorCode): UniworkWorkError {
  switch (code) {
    case 'not_signed_in':
    case 'session_expired':
    case 'wrong_deployment':
      return 'signed-out'
    case 'forbidden':
    case 'not_found':
    case 'deleted':
      return 'forbidden'
    case 'network':
    case 'timeout':
      return 'offline'
    default:
      return 'server'
  }
}

/** Server catalogue key. The built-in keys are listed; the server may send others. */
export type WorkTaskStatusKey =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled'
  | (string & {})

export interface WorkTask {
  id: string
  workspace_id: string
  /** "PREFIX-N"; '' when absent (shown in the project column, C9) */
  identifier: string
  title: string
  status: WorkTaskStatusKey
  /** none|low|medium|high|urgent (wider at runtime) */
  priority: string
  /** YYYY-MM-DD */
  due_date?: string
  /** RFC3339 */
  due_at?: string
  project_id?: string | null
  updated_at: string
}

/** GET /workspaces/{ws}/task-statuses -> `statuses[]` (archived rows dropped) */
export interface WorkTaskStatus {
  id: string
  /** what PATCH /tasks/{id} takes in `status` */
  key: string
  name: string
  /** one of the 7 built-in categories */
  category: string
  color: string
  position: number
}

export interface WorkMeeting {
  id: string
  workspace_id: string
  title: string
  starts_at: string
  ends_at: string
  /** 'IN_PROGRESS' = live */
  status?: string
}

export interface WorkNotification {
  id: string
  /** NOTIFICATION_KINDS, wider at runtime */
  kind: string
  workspace_id: string
  resource_type: string
  resource_id: string
  actor_kind: string
  /** e.g. "notifications.kind.task_assigned" */
  title_key: string
  params: Record<string, string>
  read_at?: string
  created_at: string
}

export type WorkHomeSource = 'tasks' | 'meetings' | 'notifications'

export interface WorkHomeCounts {
  open: number
  overdue: number
  due_today: number
  meetings_today: number
  unread: number
}

/**
 * GET /workspaces/{ws}/home. Each section degrades on its own: a section that
 * fails its schema becomes [] and its source is added to `partial`.
 */
export interface WorkHomeSummary {
  /** YYYY-MM-DD in `timezone`; a response without it is 'server' */
  today: string
  /** '' when absent */
  timezone: string
  counts: WorkHomeCounts
  my_work: WorkTask[]
  upcoming_meetings: WorkMeeting[]
  inbox: WorkNotification[]
  partial: WorkHomeSource[]
  generated_at: string
}

/** GET /workspaces/{ws}/calendar/events?from&to&mine=true -> `events[]` */
export interface WorkCalendarEvent {
  id: string
  kind: 'task' | 'meeting' | 'external' | (string & {})
  entity_id: string
  title: string
  start: string
  end?: string | null
  all_day: boolean
  status?: string | null
  project_id?: string | null
}

/** GET /orgs/{orgSlug}/people/{userId} -> `person` (`reports` ignored) */
export interface WorkPerson {
  user_id: string
  display_name: string
  email: string
  avatar_url?: string
  title: string
  department: { id: string; name: string } | null
  manager: { id: string; kind: string; display_name: string } | null
  timezone: string
}

export interface WorkCreateTaskInput {
  workspaceId: string
  title: string
  /** YYYY-MM-DD */
  dueDate?: string
  /** the renderer mints one (crypto.randomUUID()) per intent and reuses it on Retry */
  idempotencyKey: string
}
```

- [ ] **Step 4: Tách đường gửi đã gia cố ra khỏi client tài liệu.** Sửa ba chỗ trong `apps/shell/src/main/uniwork-docs/client.ts`. Thân `send` (l.126-189 hiện nay) giữ nguyên từng byte.

  Sửa A (l.78-81). Trước:
```ts
function id(value: string): string {
  if (!ID.test(value)) throw new UniworkDocError('not_found')
  return encodeURIComponent(value)
}
```
  Sau:
```ts
/** a route segment: an id the server issued, never a path (the work client uses it too) */
export function uniworkId(value: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new UniworkDocError('not_found')
  return encodeURIComponent(value)
}
const id = uniworkId
```
  Sửa B (l.107-125). Trước:
```ts
export function createUniworkDocsClient(options: UniworkDocsClientOptions): UniworkDocsClient {
  const origin = new URL(options.apiOrigin).origin
  const base = `${origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const metadataTimeout = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS

  interface Call<T> {
    method: 'GET' | 'POST'
    route: string
    query?: URLSearchParams
    json?: unknown
    form?: FormData
    idempotencyKey?: string
    timeoutMs: number
    read(response: Response): Promise<T>
  }

  async function send<T>(call: Call<T>): Promise<T> {
```
  Sau:
```ts
/** one request to a UniWork route (documents, and the Workbench's work routes) */
export interface UniworkCall<T> {
  method: 'GET' | 'POST' | 'PATCH'
  route: string
  query?: URLSearchParams
  json?: unknown
  form?: FormData
  idempotencyKey?: string
  timeoutMs: number
  read(response: Response): Promise<T>
}

/** the hardened request every UniWork client in main goes through (see the header) */
export function createUniworkSend(
  options: UniworkDocsClientOptions,
): <T>(call: UniworkCall<T>) => Promise<T> {
  const origin = new URL(options.apiOrigin).origin
  const base = `${origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  return async function send<T>(call: UniworkCall<T>): Promise<T> {
```
  Sửa C (l.190-195). Trước:
```ts
    } catch (error) {
      throw fromAuthFailure(error)
    }
  }

  const json = (response: Response): Promise<unknown> => response.json()
```
  Sau:
```ts
    } catch (error) {
      throw fromAuthFailure(error)
    }
  }
}

export function createUniworkDocsClient(options: UniworkDocsClientOptions): UniworkDocsClient {
  const metadataTimeout = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()
```
  Kiểm không có hồi quy:
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-docs-client.test.ts tests/uniwork-docs-save.test.ts`
  - Kết quả mong đợi: PASS (93 test).

- [ ] **Step 5: Viết parser.** Tạo `apps/shell/src/main/uniwork-work/parse.ts`:

```ts
import type {
  WorkCalendarEvent,
  WorkHomeSource,
  WorkHomeSummary,
  WorkMeeting,
  WorkNotification,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import { UniworkDocError } from '../uniwork-docs/errors'

/**
 * Readers for the UniWork work routes: the server's snake_case DTOs, only the
 * fields the Workbench reads (anything else, a token echoed back included,
 * never reaches the renderer). A bad list or object is `malformed_response`;
 * the Home sections instead degrade on their own into `partial`, like the web
 * client (uniwork:packages/core/api/endpoints/home.ts).
 */

function bad(): never {
  throw new UniworkDocError('malformed_response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad()
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') bad()
  return value
}

function id(value: unknown): string {
  const v = text(value)
  if (!v) bad()
  return v
}

/** absent and null both read as undefined */
function optional(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value)
}

function nullable(value: unknown): string | null | undefined {
  return value === null ? null : optional(value)
}

function rows<T>(raw: unknown, key: string, one: (value: unknown) => T): T[] {
  const list = record(raw)[key]
  if (!Array.isArray(list)) bad()
  return list.map(one)
}

export function parseTask(value: unknown): WorkTask {
  const r = record(value)
  return {
    id: id(r.id),
    workspace_id: id(r.workspace_id),
    identifier: optional(r.identifier) ?? '',
    title: text(r.title),
    status: id(r.status),
    priority: text(r.priority),
    due_date: optional(r.due_date),
    due_at: optional(r.due_at),
    project_id: nullable(r.project_id),
    updated_at: text(r.updated_at),
  }
}

function parseMeeting(value: unknown): WorkMeeting {
  const r = record(value)
  return {
    id: id(r.id),
    workspace_id: id(r.workspace_id),
    title: text(r.title),
    starts_at: text(r.starts_at),
    ends_at: text(r.ends_at),
    status: optional(r.status),
  }
}

function params(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {}
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(record(value))) out[key] = text(v)
  return out
}

function parseNotification(value: unknown): WorkNotification {
  const r = record(value)
  return {
    id: id(r.id),
    kind: text(r.kind),
    workspace_id: optional(r.workspace_id) ?? '',
    resource_type: text(r.resource_type),
    resource_id: text(r.resource_id),
    actor_kind: optional(r.actor_kind) ?? 'system',
    title_key: text(r.title_key),
    params: params(r.params),
    read_at: optional(r.read_at),
    created_at: text(r.created_at),
  }
}

const SOURCES: readonly WorkHomeSource[] = ['tasks', 'meetings', 'notifications']

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

/** the rows, or null when one of them (or the list itself) does not parse */
function section<T>(value: unknown, one: (value: unknown) => T): T[] | null {
  if (!Array.isArray(value)) return null
  try {
    return value.map(one)
  } catch {
    return null
  }
}

export function parseHome(raw: unknown): WorkHomeSummary {
  const r = record(raw)
  const today = id(r.today)
  const reported: unknown[] = Array.isArray(r.partial) ? r.partial : []
  const partial = SOURCES.filter((source) => reported.includes(source))
  const pick = <T>(value: unknown, source: WorkHomeSource, one: (value: unknown) => T): T[] => {
    const parsed = section(value, one)
    if (parsed) return parsed
    // a list the parse had to empty is a source the page cannot trust
    if (!partial.includes(source)) partial.push(source)
    return []
  }
  const c = r.counts && typeof r.counts === 'object' ? (r.counts as Record<string, unknown>) : {}
  const my_work = pick(r.my_work, 'tasks', parseTask)
  const upcoming_meetings = pick(r.upcoming_meetings, 'meetings', parseMeeting)
  const inbox = pick(r.inbox, 'notifications', parseNotification)
  return {
    today,
    timezone: typeof r.timezone === 'string' ? r.timezone : '',
    counts: {
      open: count(c.open),
      overdue: count(c.overdue),
      due_today: count(c.due_today),
      meetings_today: count(c.meetings_today),
      unread: count(c.unread),
    },
    my_work,
    upcoming_meetings,
    inbox,
    partial,
    generated_at: typeof r.generated_at === 'string' ? r.generated_at : '',
  }
}

/** `{tasks: [...]}` (my-tasks) */
export function parseTaskList(raw: unknown): WorkTask[] {
  return rows(raw, 'tasks', parseTask)
}

/** `{task}` (PATCH /tasks/{id}, POST /workspaces/{ws}/tasks) */
export function parseOneTask(raw: unknown): WorkTask {
  return parseTask(record(raw).task)
}

/** `{statuses: [...]}` without the archived rows */
export function parseTaskStatuses(raw: unknown): WorkTaskStatus[] {
  return rows(raw, 'statuses', record)
    .filter((r) => !r.archived_at)
    .map((r) => ({
      id: id(r.id),
      key: id(r.key),
      name: text(r.name),
      category: text(r.category),
      color: text(r.color),
      position: typeof r.position === 'number' ? r.position : bad(),
    }))
}

function parseEvent(value: unknown): WorkCalendarEvent {
  const r = record(value)
  if (typeof r.all_day !== 'boolean') bad()
  return {
    id: id(r.id),
    kind: text(r.kind),
    entity_id: text(r.entity_id),
    title: text(r.title),
    start: text(r.start),
    end: nullable(r.end),
    all_day: r.all_day,
    status: nullable(r.status),
    project_id: nullable(r.project_id),
  }
}

/** `{events: [...]}` */
export function parseCalendarEvents(raw: unknown): WorkCalendarEvent[] {
  return rows(raw, 'events', parseEvent)
}

/** `{person, reports}`; `reports` is not read */
export function parsePerson(raw: unknown): WorkPerson {
  const r = record(record(raw).person)
  const department = r.department == null ? null : record(r.department)
  const manager = r.manager == null ? null : record(r.manager)
  return {
    user_id: id(r.user_id),
    display_name: text(r.display_name),
    email: text(r.email),
    avatar_url: optional(r.avatar_url),
    title: optional(r.title) ?? '',
    department: department ? { id: id(department.id), name: text(department.name) } : null,
    manager: manager
      ? { id: id(manager.id), kind: text(manager.kind), display_name: text(manager.display_name) }
      : null,
    timezone: optional(r.timezone) ?? '',
  }
}
```

- [ ] **Step 6: Viết client.** Tạo `apps/shell/src/main/uniwork-work/client.ts`:

```ts
import type {
  WorkCalendarEvent,
  WorkCreateTaskInput,
  WorkHomeSummary,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import {
  METADATA_TIMEOUT_MS,
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import {
  parseCalendarEvents,
  parseHome,
  parseOneTask,
  parsePerson,
  parseTaskList,
  parseTaskStatuses,
} from './parse'

/**
 * Main-process client for the UniWork work routes the Workbench reads and
 * writes. Same hardened request as the documents client (API origin +
 * /api/v1 only, no redirect, no cache, the token only inside `authorized`).
 * Throws UniworkDocError; wiring.ts turns it into a UniworkWorkError.
 * Workspaces and recent cloud documents are not here: the renderer reuses
 * aiOffice.uniworkListWorkspaces / uniworkListDocuments.
 */

export interface UniworkWorkClient {
  homeSummary(workspaceId: string): Promise<WorkHomeSummary>
  myTasks(workspaceId: string): Promise<WorkTask[]>
  taskStatuses(workspaceId: string): Promise<WorkTaskStatus[]>
  /** `status` is a catalogue key ('done', 'todo', ...), not a status id */
  setTaskStatus(taskId: string, status: string): Promise<WorkTask>
  createTask(input: WorkCreateTaskInput): Promise<WorkTask>
  calendarEvents(input: {
    workspaceId: string
    from: string
    to: string
  }): Promise<WorkCalendarEvent[]>
  person(orgSlug: string, userId: string): Promise<WorkPerson>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUS_KEY = /^[A-Za-z0-9_-]{1,64}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/

/** a renderer value the server must never see */
function refuse(): never {
  throw new UniworkDocError('server_error')
}

export function createUniworkWorkClient(options: UniworkDocsClientOptions): UniworkWorkClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const read = (response: Response): Promise<unknown> => response.json()
  const get = (route: string, query?: URLSearchParams) =>
    send({ method: 'GET', route, query, timeoutMs, read })

  return {
    async homeSummary(workspaceId) {
      return parseHome(await get(`/workspaces/${uniworkId(workspaceId)}/home`))
    },

    async myTasks(workspaceId) {
      const query = new URLSearchParams({ limit: '200' })
      return parseTaskList(await get(`/workspaces/${uniworkId(workspaceId)}/my-tasks`, query))
    },

    async taskStatuses(workspaceId) {
      return parseTaskStatuses(await get(`/workspaces/${uniworkId(workspaceId)}/task-statuses`))
    },

    async setTaskStatus(taskId, status) {
      if (typeof status !== 'string' || !STATUS_KEY.test(status)) refuse()
      const raw = await send({
        method: 'PATCH',
        route: `/tasks/${uniworkId(taskId)}`,
        json: { status },
        timeoutMs,
        read,
      })
      return parseOneTask(raw)
    },

    async createTask(input) {
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      if (!title) refuse()
      if (input.dueDate !== undefined && !DATE.test(input.dueDate)) refuse()
      if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        refuse()
      }
      // no allow_duplicate: an open task with the same title is refused (409), like the web
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${uniworkId(input.workspaceId)}/tasks`,
        json: { title, ...(input.dueDate ? { due_date: input.dueDate } : {}) },
        idempotencyKey: input.idempotencyKey,
        timeoutMs,
        read,
      })
      return parseOneTask(raw)
    },

    async calendarEvents({ workspaceId, from, to }) {
      if (!DATE.test(from) || !DATE.test(to)) refuse()
      const query = new URLSearchParams({ from, to, mine: 'true' })
      const raw = await get(`/workspaces/${uniworkId(workspaceId)}/calendar/events`, query)
      return parseCalendarEvents(raw)
    },

    async person(orgSlug, userId) {
      return parsePerson(await get(`/orgs/${uniworkId(orgSlug)}/people/${uniworkId(userId)}`))
    },
  }
}
```

- [ ] **Step 7: Chạy test client và thấy pass.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-work-client.test.ts tests/uniwork-docs-client.test.ts`
  - Kết quả mong đợi: PASS (14 + 23 test).

- [ ] **Step 8: Commit.**
```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/shared/uniwork-work-api.ts apps/shell/src/main/uniwork-work/parse.ts apps/shell/src/main/uniwork-work/client.ts apps/shell/src/main/uniwork-docs/client.ts apps/shell/tests/uniwork-work-client.test.ts
git commit -m "feat(shell): main-process client for UniWork home, tasks, calendar and people

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Viết test slug workspace sẽ fail (C5).** Sửa hai chỗ trong `apps/shell/tests/uniwork-docs-client.test.ts`.

  Dòng 32-39, trước:
```ts
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { workspaces: [{ id: 'ws_1', name: 'Team', organization_id: 'org_a' }] }),
    )
    const api = client(fetch)
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a' },
    ])
```
  Sau:
```ts
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        workspaces: [
          {
            id: 'ws_1',
            name: 'Team',
            slug: 'team',
            organization_id: 'org_a',
            organization_slug: 'acme',
          },
        ],
      }),
    )
    const api = client(fetch)
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: 'team', orgSlug: 'acme' },
    ])
```
  Chèn khối này ngay trước `describe('error envelope mapping', () => {` (dòng 115):
```ts
describe('workspace slugs', () => {
  it('reads as empty when the server sends none', async () => {
    const api = client(async () => json(200, { workspaces: [{ id: 'ws_1', name: 'Team' }] }))
    expect(await api.listWorkspaces('org_a')).toEqual([
      { id: 'ws_1', name: 'Team', orgId: 'org_a', slug: '', orgSlug: '' },
    ])
  })
})

```
  Chạy:
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-docs-client.test.ts`
  - Kết quả mong đợi: FAIL ở 2 test; cả hai `toEqual` báo thiếu `slug` và `orgSlug`.

- [ ] **Step 10: Thêm slug vào kiểu, phần parse và stub e2e.**

  `apps/shell/src/shared/home-api.ts:146-150`, sau khi sửa:
```ts
export interface UniworkWorkspaceRef {
  id: string
  name: string
  orgId: string
  /** server `slug` ('' when absent): web links need it */
  slug: string
  /** server `organization_slug` ('' when absent) */
  orgSlug: string
}
```
  `apps/shell/src/main/uniwork-docs/client.ts`, trong `listWorkspaces`. Trước:
```ts
        return { id: r.id, name: r.name, orgId: rowOrg }
```
  Sau:
```ts
        return {
          id: r.id,
          name: r.name,
          orgId: rowOrg,
          slug: typeof r.slug === 'string' ? r.slug : '',
          orgSlug: typeof r.organization_slug === 'string' ? r.organization_slug : '',
        }
```
  `e2e/fixtures/uniwork-documents-stub.ts:33`. Trước:
```ts
export const STUB_WORKSPACE = { id: 'ws_e2e_01', name: 'Engineering notes' }
```
  Sau:
```ts
export const STUB_WORKSPACE = { id: 'ws_e2e_01', name: 'Engineering notes', slug: 'engineering' }
```
  `e2e/fixtures/uniwork-documents-stub.ts:270`. Trước:
```ts
          { id: STUB_WORKSPACE.id, name: STUB_WORKSPACE.name, organization_id: STUB_ORG.id },
```
  Sau:
```ts
          {
            id: STUB_WORKSPACE.id,
            name: STUB_WORKSPACE.name,
            slug: STUB_WORKSPACE.slug,
            organization_id: STUB_ORG.id,
            organization_slug: STUB_ORG.slug,
          },
```
  Chạy test và typecheck:
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-docs-client.test.ts tests/uniwork-docs-ui.test.ts tests/uniwork-work-client.test.ts`
    - Kết quả mong đợi: PASS.
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell`
    - Kết quả mong đợi: không lỗi. Object `UniworkWorkspaceRef` trong `src/` chỉ được tạo bởi phần parse trên, và test không nằm trong typecheck.

- [ ] **Step 11: Commit.**
```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/shared/home-api.ts apps/shell/src/main/uniwork-docs/client.ts apps/shell/tests/uniwork-docs-client.test.ts e2e/fixtures/uniwork-documents-stub.ts
git commit -m "feat(shell): carry workspace and org slugs for UniWork web links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: IPC `uniwork-work:*`, preload `window.uniworkWork` và kiểu cầu nối dùng chung

Ghi chú hợp đồng: Task 8 khai báo `window.uniworkWork` đúng một lần, **không optional** (`uniworkWork: UniworkWorkApi`, giống `aiOffice`), trong `declare global` của `Home.tsx`. File renderer sau dùng mà không khai báo lại. Task 8 thêm `authorizedRequest`, `uniworkAccount` và `uniworkDeploymentProfile` vào import `./uniwork-auth` trong `main/index.ts`; Task 9 dựa vào `uniworkAccount` từ import đó. `myProfile()` khi đã đăng nhập mà chưa chọn org trả `{ok:false, error:'server'}`.

**Files:**
- Modify: `apps/shell/src/shared/uniwork-work-api.ts` (import ở dòng 1, rồi thêm khối ở cuối file)
- Create: `apps/shell/src/main/uniwork-work/wiring.ts`
- Modify: `apps/shell/src/main/index.ts:92-104` (import), `:4184` (đăng ký cạnh `createUniworkDocs`)
- Modify: `apps/shell/src/preload/index.ts:61` (import), `:1044` (expose)
- Modify: `apps/shell/src/renderer/src/Home.tsx:18` (import), `:46-52` (`declare global`)
- Test (create): `apps/shell/tests/uniwork-work-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `createUniworkWorkClient` và `UniworkWorkClient` (Task 7)
  - `workErrorOfDocCode` và `UniworkWorkResult` (Task 7)
  - `uniworkDeploymentProfile`, `uniworkSessionIdentity`, `uniworkAccount().status().org` và `authorizedRequest` từ `main/uniwork-auth`
  - `shell.openExternal`
- Produces:
  - `UNIWORK_WORK_CHANNELS`, `UniworkWorkApi`, `WorkWebTarget` và `WorkRecentDocument` (trong `shared/uniwork-work-api.ts`)
  - `UniworkWorkDeps` và `registerUniworkWork(ipcMain: IpcMain, deps: UniworkWorkDeps): void`
  - `window.uniworkWork: UniworkWorkApi`, khai báo trong `Home.tsx`

- [ ] **Step 1: Viết test wiring sẽ fail.** Tạo `apps/shell/tests/uniwork-work-wiring.test.ts`:

```ts
import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { registerUniworkWork, type UniworkWorkDeps } from '../src/main/uniwork-work/wiring'
import { UNIWORK_WORK_CHANNELS as C } from '../src/shared/uniwork-work-api'

const PROFILE: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'secret-token-8c1d'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const HOME = {
  today: '2026-10-13',
  timezone: 'UTC',
  counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
  my_work: [],
  upcoming_meetings: [],
  inbox: [],
  partial: [],
  generated_at: '',
}
const PERSON = {
  user_id: 'acc_1',
  display_name: 'Ada',
  email: 'ada@example.test',
  title: '',
  department: null,
  manager: null,
  timezone: '',
}

type Handler = (event: unknown, ...args: unknown[]) => unknown

function setup(
  over: Partial<UniworkWorkDeps> = {},
  fetch: FetchLike = vi.fn<FetchLike>(async () => json(200, HOME)),
) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) }
  const openExternal = vi.fn(async (_url: string) => undefined)
  registerUniworkWork(ipc as unknown as IpcMain, {
    profile: () => PROFILE,
    identity: () => ({ accountId: 'acc_1' }),
    org: () => ({ id: 'org_1', slug: 'acme' }),
    authorized: (call) => call(TOKEN),
    openExternal,
    fetch,
    ...over,
  })
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)!({}, ...args))
  return { handlers, call, openExternal }
}

describe('uniwork-work IPC', () => {
  it('registers one handler per channel', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(Object.values(C).sort())
  })

  it('answers {ok, value} and never puts the token in a reply', async () => {
    const reply = await setup().call(C.homeSummary, 'ws_1')
    expect(reply).toMatchObject({ ok: true, value: { today: '2026-10-13' } })
    expect(JSON.stringify(reply)).not.toContain(TOKEN)
  })

  it('turns every failure into one of the four work errors', async () => {
    const failing = (fetch: FetchLike) => setup({}, fetch).call(C.myTasks, 'ws_1')
    expect(await setup({ identity: () => null }).call(C.myTasks, 'ws_1')).toEqual({
      ok: false,
      error: 'signed-out',
    })
    expect(await setup({ profile: () => null }).call(C.myTasks, 'ws_1')).toEqual({
      ok: false,
      error: 'signed-out',
    })
    expect(await failing(async () => json(403, { error: { code: 'forbidden' } }))).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(
      await failing(async () => {
        throw new TypeError('fetch failed')
      }),
    ).toEqual({ ok: false, error: 'offline' })
    expect(await failing(async () => json(502, {}))).toEqual({ ok: false, error: 'server' })
    expect(await setup().call(C.createTask, null)).toEqual({ ok: false, error: 'server' })
  })

  it('a non-string id never reaches the network', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, HOME))
    const { call } = setup({}, fetch)
    expect(await call(C.homeSummary, { id: 'ws_1' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await call(C.setTaskStatus, 42, 'done')).toEqual({ ok: false, error: 'forbidden' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('myProfile reads the selected org (by slug) and the signed-in account', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { person: PERSON, reports: [] }))
    expect(await setup({}, fetch).call(C.myProfile)).toMatchObject({
      ok: true,
      value: { user_id: 'acc_1', display_name: 'Ada' },
    })
    expect(fetch.mock.calls[0]![0]).toBe('https://uniwork.example/api/v1/orgs/acme/people/acc_1')
    expect(await setup({ org: () => null }).call(C.myProfile)).toEqual({
      ok: false,
      error: 'server',
    })
  })

  it('openWeb opens only the UniWork pages it builds itself', async () => {
    const { call, openExternal } = setup()
    expect(await call(C.openWeb, { kind: 'task', orgSlug: 'acme', wsSlug: 'eng', id: 't_1' })).toBe(
      true,
    )
    expect(await call(C.openWeb, { kind: 'room', orgSlug: 'acme', wsSlug: 'eng', id: 'm_1' })).toBe(
      true,
    )
    expect(await call(C.openWeb, { kind: 'my-tasks', orgSlug: 'acme', wsSlug: 'eng' })).toBe(true)
    expect(await call(C.openWeb, { kind: 'onboarding' })).toBe(true)
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://uniwork.example/acme/eng/tasks/t_1',
      'https://uniwork.example/acme/eng/meetings/m_1/room',
      'https://uniwork.example/acme/eng/my-tasks',
      'https://uniwork.example/onboarding',
    ])
  })

  it('openWeb refuses a bad slug, a missing id, an unknown kind or a URL', async () => {
    const { call, openExternal } = setup()
    for (const target of [
      { kind: 'task', orgSlug: '..', wsSlug: 'eng', id: 't_1' },
      { kind: 'task', orgSlug: 'acme', wsSlug: 'eng' },
      { kind: 'person', orgSlug: 'acme', wsSlug: 'eng', id: 'u/1' },
      { kind: 'constructor', orgSlug: 'acme', wsSlug: 'eng', id: 'x' },
      'https://evil.example',
      null,
    ]) {
      expect(await call(C.openWeb, target)).toBe(false)
    }
    expect(openExternal).not.toHaveBeenCalled()
    expect(await setup({ profile: () => null }).call(C.openWeb, { kind: 'onboarding' })).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test và thấy fail.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-work-wiring.test.ts`
  - Kết quả mong đợi: FAIL với `Failed to resolve import "../src/main/uniwork-work/wiring"`.

- [ ] **Step 3: Thêm kiểu cầu nối.** Sửa `apps/shell/src/shared/uniwork-work-api.ts`.

  Dòng 1, trước:
```ts
import type { UniworkDocErrorCode } from './home-api'
```
  Sau:
```ts
import type { RecentEntry, UniworkDocErrorCode, UniworkDocSummary } from './home-api'
```
  Thêm vào cuối file:
```ts

/** Overview "recent documents": UniWork rows (aiOffice.uniworkListDocuments) plus local recents */
export type WorkRecentDocument =
  { source: 'uniwork'; doc: UniworkDocSummary } | { source: 'local'; entry: RecentEntry }

/**
 * A UniWork web page to open. Main builds the URL; the renderer never passes
 * one (paths follow uniwork:packages/core/paths/paths.ts).
 */
export type WorkWebTarget =
  | { kind: 'task' | 'meeting' | 'room' | 'person'; orgSlug: string; wsSlug: string; id: string }
  | { kind: 'my-tasks' | 'calendar' | 'inbox' | 'tasks'; orgSlug: string; wsSlug: string }
  | { kind: 'onboarding' }

export const UNIWORK_WORK_CHANNELS = {
  homeSummary: 'uniwork-work:home-summary',
  myTasks: 'uniwork-work:my-tasks',
  taskStatuses: 'uniwork-work:task-statuses',
  setTaskStatus: 'uniwork-work:set-task-status',
  createTask: 'uniwork-work:create-task',
  calendarEvents: 'uniwork-work:calendar-events',
  myProfile: 'uniwork-work:my-profile',
  openWeb: 'uniwork-work:open-web',
} as const

/**
 * window.uniworkWork. Workspaces and recent cloud documents are not here:
 * reuse aiOffice.uniworkListWorkspaces() and
 * aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }) (slice to 6).
 */
export interface UniworkWorkApi {
  homeSummary(workspaceId: string): Promise<UniworkWorkResult<WorkHomeSummary>>
  myTasks(workspaceId: string): Promise<UniworkWorkResult<WorkTask[]>>
  taskStatuses(workspaceId: string): Promise<UniworkWorkResult<WorkTaskStatus[]>>
  /** `status` is a catalogue key ('done', 'todo', ...), not a status id */
  setTaskStatus(taskId: string, status: string): Promise<UniworkWorkResult<WorkTask>>
  createTask(input: WorkCreateTaskInput): Promise<UniworkWorkResult<WorkTask>>
  calendarEvents(input: {
    workspaceId: string
    from: string
    to: string
  }): Promise<UniworkWorkResult<WorkCalendarEvent[]>>
  /** the signed-in user in the selected org (main resolves the org slug and account id) */
  myProfile(): Promise<UniworkWorkResult<WorkPerson>>
  /** false when the target fails validation or no deployment profile is set */
  openWeb(target: WorkWebTarget): Promise<boolean>
}
```

- [ ] **Step 4: Viết wiring IPC.** Tạo `apps/shell/src/main/uniwork-work/wiring.ts`:

```ts
import type { IpcMain } from 'electron'
import {
  UNIWORK_WORK_CHANNELS,
  workErrorOfDocCode,
  type UniworkWorkResult,
  type WorkCreateTaskInput,
} from '../../shared/uniwork-work-api'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import type { FetchLike } from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import { createUniworkWorkClient, type UniworkWorkClient } from './client'

/**
 * IPC for window.uniworkWork. Every handler answers a UniworkWorkResult (or a
 * boolean for openWeb) and never throws; the token stays in main. Free of
 * Electron at runtime: index.ts passes the auth module and shell.openExternal.
 */

export interface UniworkWorkDeps {
  profile(): DeploymentProfile | null
  identity(): { accountId: string } | null
  org(): { id: string; slug: string } | null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  openExternal(url: string): Promise<void>
  fetch?: FetchLike
}

const SLUG = /^[A-Za-z0-9_-]{1,128}$/

/** the web path of a renderer target (uniwork:packages/core/paths/paths.ts), or null */
function webPathOf(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null
  const t = target as Record<string, unknown>
  if (t.kind === 'onboarding') return '/onboarding'
  const ok = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value)
  if (!ok(t.orgSlug) || !ok(t.wsSlug)) return null
  const base = `/${t.orgSlug}/${t.wsSlug}`
  switch (t.kind) {
    case 'my-tasks':
    case 'calendar':
    case 'inbox':
    case 'tasks':
      return `${base}/${t.kind}`
  }
  if (!ok(t.id)) return null
  switch (t.kind) {
    case 'task':
      return `${base}/tasks/${t.id}`
    case 'meeting':
      return `${base}/meetings/${t.id}`
    case 'room':
      return `${base}/meetings/${t.id}/room`
    case 'person':
      return `${base}/people/${t.id}`
    default:
      return null
  }
}

/** Registers the uniwork-work:* handlers. Main-process code: rebuild the shell after a change. */
export function registerUniworkWork(ipcMain: IpcMain, deps: UniworkWorkDeps): void {
  let cached: { origin: string; client: UniworkWorkClient } | null = null
  /** the client for the current profile origin (rebuilt when the origin changes) */
  const api = (): UniworkWorkClient => {
    const profile = deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (cached?.origin !== profile.apiOrigin) {
      cached = {
        origin: profile.apiOrigin,
        client: createUniworkWorkClient({
          apiOrigin: profile.apiOrigin,
          authorized: (call) => deps.authorized(call),
          isSignedIn: () => deps.identity() !== null,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
      }
    }
    return cached.client
  }
  const handle = <T>(channel: string, run: (...args: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<UniworkWorkResult<T>> => {
      try {
        return { ok: true, value: await run(...args) }
      } catch (error) {
        const code = error instanceof UniworkDocError ? error.code : 'server_error'
        return { ok: false, error: workErrorOfDocCode(code) }
      }
    })
  }
  // ids from the renderer: anything but a string fails the client's id check
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const C = UNIWORK_WORK_CHANNELS

  handle(C.homeSummary, (ws) => api().homeSummary(str(ws)))
  handle(C.myTasks, (ws) => api().myTasks(str(ws)))
  handle(C.taskStatuses, (ws) => api().taskStatuses(str(ws)))
  handle(C.setTaskStatus, (taskId, status) => api().setTaskStatus(str(taskId), str(status)))
  handle(C.createTask, (input) => api().createTask(input as WorkCreateTaskInput))
  handle(C.calendarEvents, (input) =>
    api().calendarEvents(input as { workspaceId: string; from: string; to: string }),
  )
  handle(C.myProfile, async () => {
    const who = deps.identity()
    if (!who) throw new UniworkDocError('not_signed_in')
    const org = deps.org()
    // signed in, but no org selected yet: there is no directory to read
    if (!org?.slug) throw new UniworkDocError('server_error')
    return api().person(org.slug, who.accountId)
  })
  ipcMain.handle(C.openWeb, async (_event, target: unknown): Promise<boolean> => {
    const profile = deps.profile()
    const path = webPathOf(target)
    if (!profile || !path) return false
    // shortcut: web origin = API origin (true on the prod edge); dev web runs elsewhere. Upgrade when the server exposes a web origin (C6).
    const url = `${new URL(profile.apiOrigin).origin}${path}`
    return deps.openExternal(url).then(
      () => true,
      () => false,
    )
  })
}
```

- [ ] **Step 5: Chạy test và thấy pass.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-work-wiring.test.ts tests/uniwork-work-client.test.ts`
  - Kết quả mong đợi: PASS (7 + 14 test).

- [ ] **Step 6: Đăng ký handler trong main.** Sửa `apps/shell/src/main/index.ts`.

  Dòng 101-104, trước:
```ts
  onUniworkAccountStatus,
  uniworkSessionIdentity,
} from './uniwork-auth'
import { createUniworkDocs, type UniworkDocsHandle } from './uniwork-docs/wiring'
```
  Sau:
```ts
  onUniworkAccountStatus,
  uniworkSessionIdentity,
  authorizedRequest,
  uniworkAccount,
  uniworkDeploymentProfile,
} from './uniwork-auth'
import { createUniworkDocs, type UniworkDocsHandle } from './uniwork-docs/wiring'
import { registerUniworkWork } from './uniwork-work/wiring'
```
  Dòng 4184, trước:
```ts
  uniworkDocs = createUniworkDocs(ipcMain, uniworkDocsWiring())
```
  Sau:
```ts
  uniworkDocs = createUniworkDocs(ipcMain, uniworkDocsWiring())
  // UniWork work data for the Workbench (home, tasks, calendar, profile); logic in ./uniwork-work
  registerUniworkWork(ipcMain, {
    profile: () => uniworkDeploymentProfile(),
    identity: () => uniworkSessionIdentity(),
    org: () => uniworkAccount().status().org ?? null,
    authorized: (call) => authorizedRequest(call),
    openExternal: (url) => shell.openExternal(url),
  })
```
  `shell` đã được import từ `electron` ở dòng 26.

- [ ] **Step 7: Expose `window.uniworkWork` trong preload.** Sửa `apps/shell/src/preload/index.ts`.

  Dòng 61, trước:
```ts
import { TABS_CHANNELS } from '../shared/tabs-api'
```
  Sau:
```ts
import { TABS_CHANNELS } from '../shared/tabs-api'
import { UNIWORK_WORK_CHANNELS } from '../shared/uniwork-work-api'
import type {
  UniworkWorkApi,
  UniworkWorkResult,
  WorkCalendarEvent,
  WorkHomeSummary,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../shared/uniwork-work-api'
```
  Dòng 1044, trước:
```ts
contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)
```
  Sau:
```ts
contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

/** main answers every work call with a result; anything else is a broken reply */
function asWorkResult<T>(result: unknown): UniworkWorkResult<T> {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { ok?: unknown }).ok === 'boolean'
  ) {
    return result as UniworkWorkResult<T>
  }
  return { ok: false, error: 'server' }
}

const workApi: UniworkWorkApi = {
  async homeSummary(workspaceId) {
    return asWorkResult<WorkHomeSummary>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.homeSummary, workspaceId),
    )
  },
  async myTasks(workspaceId) {
    return asWorkResult<WorkTask[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.myTasks, workspaceId),
    )
  },
  async taskStatuses(workspaceId) {
    return asWorkResult<WorkTaskStatus[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.taskStatuses, workspaceId),
    )
  },
  async setTaskStatus(taskId, status) {
    return asWorkResult<WorkTask>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.setTaskStatus, taskId, status),
    )
  },
  async createTask(input) {
    return asWorkResult<WorkTask>(await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.createTask, input))
  },
  async calendarEvents(input) {
    return asWorkResult<WorkCalendarEvent[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.calendarEvents, input),
    )
  },
  async myProfile() {
    return asWorkResult<WorkPerson>(await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.myProfile))
  },
  async openWeb(target) {
    return (await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.openWeb, target)) === true
  },
}

contextBridge.exposeInMainWorld('uniworkWork', workApi)
```

- [ ] **Step 8: Khai báo kiểu window một lần.** Sửa `apps/shell/src/renderer/src/Home.tsx`.

  Dòng 18, trước:
```ts
import type { IntegrationsApi } from '../../shared/integrations-api'
```
  Sau:
```ts
import type { IntegrationsApi } from '../../shared/integrations-api'
import type { UniworkWorkApi } from '../../shared/uniwork-work-api'
```
  Dòng 46-52, trước:
```ts
declare global {
  interface Window {
    aiOffice: HomeApi
    aiOfficeIntegrations?: IntegrationsApi
    aiOfficeProject?: ProjectHomeApi
  }
}
```
  Sau:
```ts
declare global {
  interface Window {
    aiOffice: HomeApi
    aiOfficeIntegrations?: IntegrationsApi
    aiOfficeProject?: ProjectHomeApi
    /** UniWork work data (preload, same lifetime as aiOffice); declared here only */
    uniworkWork: UniworkWorkApi
  }
}
```

- [ ] **Step 9: Typecheck và rebuild shell.** Main process và preload đã đổi, build shell cũ sẽ không chạy code mới.
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell && npm run build -w @genoffice/shell`
  - Kết quả mong đợi: không lỗi kiểu, build xong và ghi lại `out/main/index.js` và `out/preload/index.js`.
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-work-wiring.test.ts tests/uniwork-work-client.test.ts tests/uniwork-docs-wiring-owner.test.ts`
  - Kết quả mong đợi: PASS.

- [ ] **Step 10: Commit.**
```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/shared/uniwork-work-api.ts apps/shell/src/main/uniwork-work/wiring.ts apps/shell/src/main/index.ts apps/shell/src/preload/index.ts apps/shell/src/renderer/src/Home.tsx apps/shell/tests/uniwork-work-wiring.test.ts
git commit -m "feat(shell): expose UniWork work data to the renderer as window.uniworkWork

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Workspace đang chọn theo org, và bucket Bàn làm việc theo org

**Files:**
- Create: `apps/shell/src/renderer/src/active-workspace.ts`
- Modify: `apps/shell/src/renderer/src/uniwork-docs-model.ts:13` (import), `:394-397` (`initialPickerState`), `:464-465` (`'workspaces-loaded'`)
- Modify: `apps/shell/src/renderer/src/UniworkOpenDialog.tsx:20` (import), `:64` (`useReducer`), `:369` (`onChange`)
- Modify: `apps/shell/src/main/workbench-accounts.ts:12-13` (đầu file), `:29-44` (`WorkbenchOwner`, `workbenchBucketOf`)
- Modify: `apps/shell/src/main/index.ts:2921-2936` (`syncWorkbenchOwner`)
- Test (create): `apps/shell/tests/active-workspace.test.ts`
- Test (modify): `apps/shell/tests/workbench-accounts.test.ts:1`, `:25-28`, `:173`

**Interfaces:**
- Consumes:
  - `wbStoreGetRaw` và `wbStoreSetRaw` (`workbench-store-client.ts:201,239`)
  - `UniworkWorkspaceRef`, đã có `slug` và `orgSlug` sau Task 7
  - `uniworkAccount`, được import vào `main/index.ts` ở Task 8
- Produces:
  - `ACTIVE_WORKSPACE_KEY = 'uniwork.wb.activeWorkspace'`
  - `readActiveWorkspaceId(): string | null`
  - `writeActiveWorkspaceId(id: string): void`
  - `pickActiveWorkspace(items: readonly UniworkWorkspaceRef[], stored: string | null): string | null`
  - `initialPickerState(workspaceId?: string | null): PickerState`
  - `WorkbenchOwner.orgId: string` và `workbenchBucketOf(owner)` = `a-` + sha256(`${deploymentId}\n${accountId}\n${orgId}`) hex, 32 ký tự đầu. Owner null vẫn ra `local`.
- Consumers:
  - Task 12 gọi `pickActiveWorkspace(items, readActiveWorkspaceId())` sau `aiOffice.uniworkListWorkspaces()`, và gọi `writeActiveWorkspaceId` từ ô chọn workspace.
  - Vì bucket theo org, đổi org là đổi bucket, và workspace đã lưu của org mới (hoặc workspace đầu tiên) được dùng.

- [ ] **Step 1: Viết test active-workspace sẽ fail.** Tạo `apps/shell/tests/active-workspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import { pickActiveWorkspace } from '../src/renderer/src/active-workspace'
import {
  initialPickerState,
  pickerReducer,
  type PickerAction,
} from '../src/renderer/src/uniwork-docs-model'

const ws = (id: string): UniworkWorkspaceRef => ({
  id,
  name: id,
  orgId: 'org_a',
  slug: id,
  orgSlug: 'acme',
})
const ITEMS = [ws('w1'), ws('w2')]

describe('active workspace', () => {
  it('keeps the stored workspace while it is still listed', () => {
    expect(pickActiveWorkspace(ITEMS, 'w2')).toBe('w2')
  })

  it('falls back to the first workspace when nothing is stored or the stored one is gone', () => {
    expect(pickActiveWorkspace(ITEMS, null)).toBe('w1')
    expect(pickActiveWorkspace(ITEMS, 'w_removed')).toBe('w1')
  })

  it('is null when the org has no workspace (empty state + onboarding link)', () => {
    expect(pickActiveWorkspace([], 'w2')).toBeNull()
  })

  it('the Open from UniWork picker starts on the stored workspace', () => {
    const loaded: PickerAction = { type: 'workspaces-loaded', result: { ok: true, value: ITEMS } }
    expect(pickerReducer(initialPickerState('w2'), loaded).workspaceId).toBe('w2')
    expect(pickerReducer(initialPickerState('w_removed'), loaded).workspaceId).toBe('w1')
    expect(pickerReducer(initialPickerState(), loaded).workspaceId).toBe('w1')
  })
})
```

- [ ] **Step 2: Chạy test và thấy fail.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/active-workspace.test.ts`
  - Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/active-workspace"`.

- [ ] **Step 3: Tạo module.** Tạo `apps/shell/src/renderer/src/active-workspace.ts`:

```ts
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

/**
 * The UniWork workspace the Workbench and the Open from UniWork dialog show.
 * Kept in the workbench store, whose bucket is already per (deployment,
 * account, org): the key carries no ids, and an org switch starts from that
 * org's own choice (or its first workspace).
 */
export const ACTIVE_WORKSPACE_KEY = 'uniwork.wb.activeWorkspace'

export function readActiveWorkspaceId(): string | null {
  return wbStoreGetRaw(ACTIVE_WORKSPACE_KEY) || null
}

export function writeActiveWorkspaceId(id: string): void {
  wbStoreSetRaw(ACTIVE_WORKSPACE_KEY, id)
}

/** the stored workspace while it is still listed, else the first one, else null (no workspace yet) */
export function pickActiveWorkspace(
  items: readonly UniworkWorkspaceRef[],
  stored: string | null,
): string | null {
  return items.find((w) => w.id === stored)?.id ?? items[0]?.id ?? null
}
```
  Tiền tố `uniwork.wb.` đã được cả hai allowlist cho phép (`workbench-store-client.ts:26` và `main/workbench-db.ts:253`).

- [ ] **Step 4: Cho picker bắt đầu từ workspace đã lưu.**

  `apps/shell/src/renderer/src/uniwork-docs-model.ts:13`, trước:
```ts
import type { AccountView } from './account-model'
```
  Sau:
```ts
import type { AccountView } from './account-model'
import { pickActiveWorkspace } from './active-workspace'
```
  `uniwork-docs-model.ts:394-397`, trước:
```ts
export function initialPickerState(): PickerState {
  return {
    workspaces: { status: 'loading', items: [] },
    workspaceId: null,
```
  Sau:
```ts
/** `workspaceId`: the stored active workspace (active-workspace.ts), kept when still listed */
export function initialPickerState(workspaceId: string | null = null): PickerState {
  return {
    workspaces: { status: 'loading', items: [] },
    workspaceId,
```
  `uniwork-docs-model.ts:464-465`, trước:
```ts
      const keep = items.find((w) => w.id === state.workspaceId)
      const workspaceId = keep?.id ?? items[0]?.id ?? null
```
  Sau:
```ts
      const workspaceId = pickActiveWorkspace(items, state.workspaceId)
```
  `apps/shell/src/renderer/src/UniworkOpenDialog.tsx:20`, trước:
```ts
} from './uniwork-docs-model'
```
  Sau:
```ts
} from './uniwork-docs-model'
import { readActiveWorkspaceId, writeActiveWorkspaceId } from './active-workspace'
```
  `UniworkOpenDialog.tsx:64`, trước:
```ts
  const [state, dispatch] = useReducer(pickerReducer, undefined, initialPickerState)
```
  Sau:
```ts
  const [state, dispatch] = useReducer(pickerReducer, undefined, () =>
    initialPickerState(readActiveWorkspaceId()),
  )
```
  `UniworkOpenDialog.tsx:369`, trước:
```tsx
              onChange={(e) => dispatch({ type: 'select-workspace', id: e.target.value })}
```
  Sau:
```tsx
              onChange={(e) => {
                writeActiveWorkspaceId(e.target.value)
                dispatch({ type: 'select-workspace', id: e.target.value })
              }}
```

- [ ] **Step 5: Chạy test và thấy pass.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/active-workspace.test.ts tests/uniwork-docs-ui.test.ts tests/uniwork-docs-ui-components.test.ts`
  - Kết quả mong đợi: PASS (152 test).

- [ ] **Step 6: Commit.**
```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/renderer/src/active-workspace.ts apps/shell/src/renderer/src/uniwork-docs-model.ts apps/shell/src/renderer/src/UniworkOpenDialog.tsx apps/shell/tests/active-workspace.test.ts
git commit -m "feat(shell): remember the active UniWork workspace for the Workbench and the open dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Viết test bucket sẽ fail.** Sửa `apps/shell/tests/workbench-accounts.test.ts`.

  Dòng 1, trước:
```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
```
  Sau:
```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
```
  Dòng 25-28, trước:
```ts
const describeSqlite = sqliteAvailable() ? describe : describe.skip

const OWNER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-owner' }
const MEMBER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-member' }
```
  Sau:
```ts
const describeSqlite = sqliteAvailable() ? describe : describe.skip

describe('bucket key', () => {
  it('is one bucket per (deployment, account, org); signed out stays local', () => {
    const owner: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc', orgId: 'org_a' }
    expect(workbenchBucketOf(null)).toBe(LOCAL_BUCKET)
    expect(workbenchBucketOf(owner)).toBe(
      `a-${createHash('sha256').update('default\nacc\norg_a').digest('hex').slice(0, 32)}`,
    )
    expect(workbenchBucketOf({ ...owner, orgId: 'org_b' })).not.toBe(workbenchBucketOf(owner))
    // signed in before an org is selected: its own bucket until the org loads
    expect(workbenchBucketOf({ ...owner, orgId: '' })).not.toBe(workbenchBucketOf(owner))
    expect(workbenchBucketOf(owner)).not.toContain('org_a')
  })
})

const OWNER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-owner', orgId: 'org_a' }
const MEMBER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-member', orgId: 'org_a' }
```
  Dòng 173, trước:
```ts
    store.setOwner({ deploymentId: 'default', accountId: 'acc-42' })
```
  Sau:
```ts
    store.setOwner({ deploymentId: 'default', accountId: 'acc-42', orgId: 'org_a' })
```
  Chạy:
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-accounts.test.ts`
  - Kết quả mong đợi: FAIL ở 1 test (`is one bucket per (deployment, account, org)`); 14 test còn lại pass.

- [ ] **Step 8: Khóa bucket theo org, và lấy org từ phiên.**

  `apps/shell/src/main/workbench-accounts.ts:12-13`, trước:
```ts
 * The bucket name is a hash of deployment + account id: no account id or
 * email appears in a path.
```
  Sau:
```ts
 * The bucket name is a hash of deployment + account id + org id: no id or
 * email appears in a path. An org switch is a bucket switch (notes, forms
 * and the active workspace are per org).
```
  `workbench-accounts.ts:29-44`, trước:
```ts
/** the account a bucket belongs to (deployment-scoped, like working copies) */
export interface WorkbenchOwner {
  deploymentId: string
  accountId: string
}

export const LOCAL_BUCKET = 'local'

/** `local` for signed-out use, `a-<hash>` for an account */
export function workbenchBucketOf(owner: WorkbenchOwner | null): string {
  if (!owner) return LOCAL_BUCKET
  const digest = createHash('sha256')
    .update(`${owner.deploymentId}\n${owner.accountId}`)
    .digest('hex')
```
  Sau:
```ts
/** the account and org a bucket belongs to (deployment-scoped, like working copies) */
export interface WorkbenchOwner {
  deploymentId: string
  accountId: string
  /** the selected org; '' while signed in before an org is selected */
  orgId: string
}

export const LOCAL_BUCKET = 'local'

/** `local` for signed-out use, `a-<hash>` for an account in an org */
export function workbenchBucketOf(owner: WorkbenchOwner | null): string {
  if (!owner) return LOCAL_BUCKET
  const digest = createHash('sha256')
    .update(`${owner.deploymentId}\n${owner.accountId}\n${owner.orgId}`)
    .digest('hex')
```
  `apps/shell/src/main/index.ts:2921-2932`, trước:
```ts
/**
 * Points the workbench store at the live session's account (none = the
 * signed-out bucket). On a change the Home renderer drops everything it shows
 * and reloads from the new bucket.
 */
function syncWorkbenchOwner(): void {
  const identity = uniworkSessionIdentity()
  const owner = identity
    ? { deploymentId: identity.deploymentId, accountId: identity.accountId }
    : null
```
  Sau:
```ts
/**
 * Points the workbench store at the live session's account and selected org
 * (none = the signed-out bucket). On a change (sign-in, sign-out, org switch)
 * the Home renderer drops everything it shows and reloads from the new bucket.
 */
function syncWorkbenchOwner(): void {
  const identity = uniworkSessionIdentity()
  const owner = identity
    ? {
        deploymentId: identity.deploymentId,
        accountId: identity.accountId,
        orgId: uniworkAccount().status().org?.id ?? '',
      }
    : null
```
  Không cần đăng ký thêm. `selectOrg` kết thúc bằng `setState`, phát một status push (`manager.ts:351-372`). Push đó tới `onUniworkAccountStatus(() => syncWorkbenchOwner())` (`index.ts:6451`), và push `wbBucketChanged` sẵn có làm renderer tải lại. `uniworkAccount` có trong import `./uniwork-auth` từ Task 8; nó chỉ được gọi khi đã có identity nên manager luôn tồn tại.

- [ ] **Step 9: Chạy test, typecheck và rebuild shell.**
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-accounts.test.ts tests/workbench-account-gate.test.ts tests/workbench-db.test.ts tests/active-workspace.test.ts`
    - Kết quả mong đợi: PASS; `workbench-accounts` có 15 test.
  - Lệnh: `cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell && npm run build -w @genoffice/shell`
    - Kết quả mong đợi: không lỗi kiểu, build thành công. Bắt buộc rebuild shell vì main đã đổi.

- [ ] **Step 10: Commit.**
```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/main/workbench-accounts.ts apps/shell/src/main/index.ts apps/shell/tests/workbench-accounts.test.ts
git commit -m "feat(shell): keep workbench data per UniWork org, not only per account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Chưa kiểm ở Task 7–9: chạy thử trên bản sao `apps/shell` (test mới và test đã sửa pass, `tsc --noEmit` sạch, Prettier không báo gì), nhưng không chạy E2E, `npm run build`, hay gọi thật tới server dev. Test wiring cho thấy `/home` và `/my-tasks` được gọi đúng, không chứng minh server chấp nhận token desktop (spec §9.1, Task 1). Giới hạn đã biết: `openWeb` dùng origin của API làm origin web, đúng ở prod nhưng mở sai host ở dev; đăng nhập trước khi chọn org dùng một bucket tạm rồi đổi khi org tải xong (C14).

### Task 10: Token: tint UniWork, tín hiệu info, accent của shell, tone module

**Files:**
- Modify: `packages/ui/src/tokens.css`. Chèn sau `--warning-border` ở mỗi khối trong ba khối: `:root` l.50, `[data-theme='dark']` l.135, system dark l.204.
- Modify: `apps/shell/src/renderer/src/home.css`. Dòng light l.4-6 và l.22; dark l.62-63 và l.74-75; system-dark l.81-82 và l.93-94.
- Create: `apps/shell/src/renderer/src/module-tones.ts`
- Test: `packages/ui/tests/tint-tokens.test.ts` (mới)
- Test: `apps/shell/tests/shell-accent.test.ts` (mới)
- Test: `apps/shell/tests/module-tones.test.ts` (mới)

**Interfaces:**
- Consumes `WorkbenchModuleId`, đã thu hẹp còn `'desk' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'` ở Task 2, và `PracticePillarId = 'knowledge' | 'materials' | 'skills' | 'compose'`, đều từ `@uniwork/practice-core`. Nếu task này chạy trước Task 2, `tsc` báo thiếu 13 key module trong `MODULE_TONES`.
- Produces các token CSS sau, mỗi token có ở cả ba khối của `tokens.css`:
  - `--tint-{gray,green,yellow,orange,violet,blue,teal,pink}`
  - `--tint-<hue>-fg`
  - `--info`, `--info-bg`
- Đổi các token của shell:
  - `--accent`: `#0a52e6` light, `#5a96ff` dark
  - `--accent-hover`: `#0843bd` light, `#7aabff` dark (cùng giá trị với `--color-dialog-primary-hover`)
  - `--on-accent`: `#ffffff` light, `#0d1220` dark
  - `--shadow-btn-primary`: dùng rgb của accent mới
  - `--accent-soft` giữ nguyên `#eaf0fd` / `#24354d`; `account-ui.test.ts` kiểm độ tương phản của `--danger-text` trên nó.
- Produces:
  ```ts
  export type Tint = 'gray' | 'green' | 'yellow' | 'orange' | 'violet' | 'blue' | 'teal' | 'pink'
  export const MODULE_TONES: Record<WorkbenchModuleId | PracticePillarId, Tint>
  export const MEETING_TINT: Tint // 'violet'
  export const tintStyle: (t: Tint) => { background: string; color: string }
  ```

- [ ] **Step 1: Viết test token sẽ fail**

Tạo `packages/ui/tests/tint-tokens.test.ts`:

```ts
// UniWork module tints and the info signal (uniwork:packages/ui/styles/tokens.css, renamed
// -foreground -> -fg and info-soft -> info-bg) must be defined in all three tokens.css blocks:
// light in :root, the dark value in [data-theme='dark'] and in the system-dark fallback.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(__dirname, '../src/tokens.css'), 'utf8')
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

/** token -> [light, dark] */
const EXPECTED: Record<string, [string, string]> = {
  '--tint-gray': ['#eeeeef', '#262626'],
  '--tint-gray-fg': ['#5c5c5c', '#a1a1aa'],
  '--tint-green': ['#e6f7ee', '#16301f'],
  '--tint-green-fg': ['#137046', '#4ade80'],
  '--tint-yellow': ['#fff6d6', '#3a2f10'],
  '--tint-yellow-fg': ['#8f5300', '#fbbf24'],
  '--tint-orange': ['#ffece5', '#3d2416'],
  '--tint-orange-fg': ['#a84300', '#ffa06b'],
  '--tint-violet': ['#efedfd', '#2a1f4a'],
  '--tint-violet-fg': ['#7612fa', '#b38cff'],
  '--tint-blue': ['#e6f0ff', '#182640'],
  '--tint-blue-fg': ['#0a66bc', '#5db4ff'],
  '--tint-teal': ['#e0f5f2', '#123430'],
  '--tint-teal-fg': ['#0d6e66', '#3fd6c5'],
  '--tint-pink': ['#fff1fe', '#3d1a35'],
  '--tint-pink-fg': ['#b8107f', '#ff7ad9'],
  '--info': ['#0a66bc', '#5db4ff'],
  '--info-bg': ['#e6f0ff', '#182640'],
}

const valueIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

describe('UniWork tint and info tokens', () => {
  it('tokens.css still has exactly three theme blocks', () => {
    expect(blocks).toHaveLength(3)
  })

  it.each(Object.entries(EXPECTED))(
    '%s: light value in :root, dark value in both dark blocks',
    (name, [light, dark]) => {
      expect(valueIn(blocks[0]!, name)).toBe(light)
      expect(valueIn(blocks[1]!, name)).toBe(dark)
      expect(valueIn(blocks[2]!, name)).toBe(dark)
    },
  )
})
```

- [ ] **Step 2: Chạy và thấy fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/packages/ui && npx vitest run tests/tint-tokens.test.ts`
Kết quả mong đợi: FAIL. Test đếm khối pass; cả 18 trường hợp `it.each` fail với `expected undefined to be '#eeeeef'` và tương tự.

- [ ] **Step 3: Thêm token vào cả ba khối**

Trong `packages/ui/src/tokens.css`, khối `:root`. Trước:

```css
  --warning-border: #f2d9a6;
  --color-bg-overlay: rgb(0 0 0 / 50%);
```

Sau:

```css
  --warning-border: #f2d9a6;
  /* UniWork module tints (pale fill + readable glyph) and the info signal (uniwork tokens.css) */
  --tint-gray: #eeeeef;
  --tint-gray-fg: #5c5c5c;
  --tint-green: #e6f7ee;
  --tint-green-fg: #137046;
  --tint-yellow: #fff6d6;
  --tint-yellow-fg: #8f5300;
  --tint-orange: #ffece5;
  --tint-orange-fg: #a84300;
  --tint-violet: #efedfd;
  --tint-violet-fg: #7612fa;
  --tint-blue: #e6f0ff;
  --tint-blue-fg: #0a66bc;
  --tint-teal: #e0f5f2;
  --tint-teal-fg: #0d6e66;
  --tint-pink: #fff1fe;
  --tint-pink-fg: #b8107f;
  --info: #0a66bc;
  --info-bg: #e6f0ff;
  --color-bg-overlay: rgb(0 0 0 / 50%);
```

Khối `[data-theme='dark']`. Các dòng thụt 2 dấu cách; mốc là dòng bắt đầu bằng đúng 2 dấu cách rồi `--warning-border: #5a4a28;`. Trước:

```css
  --warning-border: #5a4a28;
  --color-bg-overlay: rgb(0 0 0 / 60%);
```

Sau:

```css
  --warning-border: #5a4a28;
  /* UniWork module tints (pale fill + readable glyph) and the info signal (uniwork tokens.css) */
  --tint-gray: #262626;
  --tint-gray-fg: #a1a1aa;
  --tint-green: #16301f;
  --tint-green-fg: #4ade80;
  --tint-yellow: #3a2f10;
  --tint-yellow-fg: #fbbf24;
  --tint-orange: #3d2416;
  --tint-orange-fg: #ffa06b;
  --tint-violet: #2a1f4a;
  --tint-violet-fg: #b38cff;
  --tint-blue: #182640;
  --tint-blue-fg: #5db4ff;
  --tint-teal: #123430;
  --tint-teal-fg: #3fd6c5;
  --tint-pink: #3d1a35;
  --tint-pink-fg: #ff7ad9;
  --info: #5db4ff;
  --info-bg: #182640;
  --color-bg-overlay: rgb(0 0 0 / 60%);
```

Khối `@media (prefers-color-scheme: dark)`. Các dòng thụt 4 dấu cách. Trước:

```css
    --warning-border: #5a4a28;
    --color-bg-overlay: rgb(0 0 0 / 60%);
```

Sau:

```css
    --warning-border: #5a4a28;
    /* UniWork module tints (pale fill + readable glyph) and the info signal (uniwork tokens.css) */
    --tint-gray: #262626;
    --tint-gray-fg: #a1a1aa;
    --tint-green: #16301f;
    --tint-green-fg: #4ade80;
    --tint-yellow: #3a2f10;
    --tint-yellow-fg: #fbbf24;
    --tint-orange: #3d2416;
    --tint-orange-fg: #ffa06b;
    --tint-violet: #2a1f4a;
    --tint-violet-fg: #b38cff;
    --tint-blue: #182640;
    --tint-blue-fg: #5db4ff;
    --tint-teal: #123430;
    --tint-teal-fg: #3fd6c5;
    --tint-pink: #3d1a35;
    --tint-pink-fg: #ff7ad9;
    --info: #5db4ff;
    --info-bg: #182640;
    --color-bg-overlay: rgb(0 0 0 / 60%);
```

- [ ] **Step 4: Chạy test token và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/packages/ui && npx vitest run tests/tint-tokens.test.ts tests/ai-send-off-token.test.ts`
Kết quả mong đợi: PASS (19 + 3 test).

- [ ] **Step 5: Viết test accent của shell sẽ fail**

Tạo `apps/shell/tests/shell-accent.test.ts`:

```ts
// Shell chrome uses the UniWork brand blue: #0a52e6 under white text in light, #5a96ff under a
// dark ink in both dark blocks (white on #5a96ff is under 3:1). --on-accent is the text token
// .btn-primary and .new-chat-send paint on --accent.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const home = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
const OPENERS = {
  light: '\n:root {',
  dark: "\n[data-theme='dark'] {",
  system: '\n@media (prefers-color-scheme: dark) {',
} as const

function blockOf(which: keyof typeof OPENERS): string {
  const start = home.indexOf(OPENERS[which])
  if (start < 0) throw new Error(`no ${which} block`)
  return home.slice(start, home.indexOf('\n}', start + 1))
}
const valueIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const EXPECTED = {
  light: { accent: '#0a52e6', hover: '#0843bd', on: '#ffffff', rgb: 'rgb(10 82 230' },
  dark: { accent: '#5a96ff', hover: '#7aabff', on: '#0d1220', rgb: 'rgb(90 150 255' },
  system: { accent: '#5a96ff', hover: '#7aabff', on: '#0d1220', rgb: 'rgb(90 150 255' },
} as const

describe('shell accent', () => {
  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    '%s: brand blue, its hover, readable text and a matching button shadow',
    (which) => {
      const block = blockOf(which)
      const want = EXPECTED[which]
      expect(valueIn(block, '--accent')).toBe(want.accent)
      expect(valueIn(block, '--accent-hover')).toBe(want.hover)
      expect(valueIn(block, '--on-accent')).toBe(want.on)
      expect(valueIn(block, '--shadow-btn-primary')).toContain(want.rgb)
      expect(contrast(want.on, want.accent)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
```

- [ ] **Step 6: Chạy và thấy fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/shell-accent.test.ts`
Kết quả mong đợi: FAIL cả 3 trường hợp. Light báo `expected '#0f7fff' to be '#0a52e6'`. Hai trường hợp dark báo `expected '#3f99ff' to be '#5a96ff'`.

- [ ] **Step 7: Đổi họ accent trong `apps/shell/src/renderer/src/home.css`**

Khối `:root`. Trước (l.4-6):

```css
  /* Genspark DS v4.1: guide/onboarding accent is the brand blue */
  --accent: #0f7fff;
  --accent-hover: #0e72e5;
```

Sau:

```css
  /* UniWork brand blue (uniwork tokens.css); dark themes put a dark ink on it (--on-accent) */
  --accent: #0a52e6;
  --accent-hover: #0843bd;
```

Trước (l.22):

```css
  --shadow-btn-primary: 0 2px 6px rgb(15 127 255 / 28%), 0 6px 18px rgb(15 127 255 / 18%);
```

Sau:

```css
  --shadow-btn-primary: 0 2px 6px rgb(10 82 230 / 28%), 0 6px 18px rgb(10 82 230 / 18%);
```

Khối `[data-theme='dark']`. Trước (l.62-63):

```css
  --accent: #3f99ff;
  --accent-hover: #5ba5ff;
```

Sau:

```css
  --accent: #5a96ff;
  --accent-hover: #7aabff;
```

Trước (l.74-75):

```css
  --shadow-btn-primary: 0 2px 8px rgb(63 153 255 / 35%), 0 8px 22px rgb(63 153 255 / 22%);
  --on-accent: #ffffff;
```

Sau:

```css
  --shadow-btn-primary: 0 2px 8px rgb(90 150 255 / 35%), 0 8px 22px rgb(90 150 255 / 22%);
  --on-accent: #0d1220;
```

Khối `@media (prefers-color-scheme: dark)`. Hai sửa đổi giống trên, thụt 4 dấu cách. Trước (l.81-82):

```css
    --accent: #3f99ff;
    --accent-hover: #5ba5ff;
```

Sau:

```css
    --accent: #5a96ff;
    --accent-hover: #7aabff;
```

Trước (l.93-94):

```css
    --shadow-btn-primary: 0 2px 8px rgb(63 153 255 / 35%), 0 8px 22px rgb(63 153 255 / 22%);
    --on-accent: #ffffff;
```

Sau:

```css
    --shadow-btn-primary: 0 2px 8px rgb(90 150 255 / 35%), 0 8px 22px rgb(90 150 255 / 22%);
    --on-accent: #0d1220;
```

Giữ nguyên `--account-avatar-bg: #3f99ff` (l.66, l.85). Đó là token riêng và `account-ui.test.ts` kiểm độ tương phản của nó.

- [ ] **Step 8: Chạy test accent và các test tương phản sẵn có, xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/shell-accent.test.ts tests/account-ui.test.ts`
Kết quả mong đợi: PASS. "error text contrast" của `account-ui.test.ts` vẫn pass vì `--accent-soft` không đổi.

- [ ] **Step 9: Viết test module-tones sẽ fail**

Tạo `apps/shell/tests/module-tones.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEETING_TINT, MODULE_TONES, tintStyle } from '../src/renderer/src/module-tones'

const tokens = readFileSync(
  join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'),
  'utf8',
)
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

describe('module tones', () => {
  it('follows the spec table (6.1)', () => {
    expect(MODULE_TONES).toEqual({
      desk: 'gray',
      tasks: 'green',
      calendar: 'yellow',
      personal: 'pink',
      forms: 'teal',
      notes: 'gray',
      knowledge: 'blue',
      materials: 'blue',
      skills: 'blue',
      compose: 'blue',
    })
    expect(MEETING_TINT).toBe('violet')
  })

  it('every tint it uses has a fill and a glyph token in all three theme blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const tint of new Set([...Object.values(MODULE_TONES), MEETING_TINT])) {
      for (const block of blocks) {
        expect(block).toMatch(new RegExp(`--tint-${tint}:\\s*#`))
        expect(block).toMatch(new RegExp(`--tint-${tint}-fg:\\s*#`))
      }
    }
  })

  it('tintStyle paints the fill with its readable glyph color', () => {
    expect(tintStyle('green')).toEqual({
      background: 'var(--tint-green)',
      color: 'var(--tint-green-fg)',
    })
  })
})
```

- [ ] **Step 10: Chạy và thấy fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/module-tones.test.ts`
Kết quả mong đợi: FAIL. Vitest không resolve được `../src/renderer/src/module-tones` vì file chưa có.

- [ ] **Step 11: Tạo `apps/shell/src/renderer/src/module-tones.ts`**

```ts
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'

/** UniWork tint hues; each is a --tint-<hue> fill + --tint-<hue>-fg glyph pair in tokens.css */
export type Tint = 'gray' | 'green' | 'yellow' | 'orange' | 'violet' | 'blue' | 'teal' | 'pink'

/** module identity color (spec 6.1); the 4 pillars are "Tri thức" and share blue */
export const MODULE_TONES: Record<WorkbenchModuleId | PracticePillarId, Tint> = {
  desk: 'gray',
  tasks: 'green',
  calendar: 'yellow',
  personal: 'pink',
  forms: 'teal',
  notes: 'gray',
  knowledge: 'blue',
  materials: 'blue',
  skills: 'blue',
  compose: 'blue',
}

/** calendar agenda: task rows use MODULE_TONES.tasks, meetings keep violet (as on UniWork web) */
export const MEETING_TINT: Tint = 'violet'

export const tintStyle = (t: Tint) => ({
  background: `var(--tint-${t})`,
  color: `var(--tint-${t}-fg)`,
})
```

- [ ] **Step 12: Chạy test, typecheck và theme check, xác nhận pass**

Chạy:

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/module-tones.test.ts tests/shell-accent.test.ts tests/account-ui.test.ts
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell && npm run typecheck -w @genoffice/ui
cd /Users/ducquang/UNICOM/uniwork-office && npm run check:theme-colors -- --base origin/main
cd /Users/ducquang/UNICOM/uniwork-office/packages/ui && npx vitest run
```

Kết quả mong đợi: mọi test PASS, cả hai typecheck exit 0. Theme check không in vi phạm nào, vì mọi dòng thêm vào `home.css` là định nghĩa `--x:` và `packages/ui` nằm ngoài phạm vi `apps/*/src/renderer/**.css` của checker.

- [ ] **Step 13: Xem ở cả hai theme (rủi ro spec 9.3)**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office && npm run dev`. Trong Cài đặt, đổi theme sang Light, rồi Dark, rồi System. Ở mỗi theme, kiểm:
- nút `.btn-primary` (Home và Cài đặt);
- nút Gửi của chat mới (`.new-chat-send`): chữ và icon phải là mực tối trên nền xanh ở dark mode;
- checkbox danh sách (`.col-check`);
- vạch chỉ báo của tab dock.

Dừng bằng Ctrl+C.

- [ ] **Step 14: Format và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run format
git add packages/ui/src/tokens.css packages/ui/tests/tint-tokens.test.ts apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/module-tones.ts apps/shell/tests/shell-accent.test.ts apps/shell/tests/module-tones.test.ts
git commit -m "feat(ui,shell): add UniWork tint and info tokens, brand-blue shell accent, module tones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Rủi ro của Task 10: ở dark mode, dấu tick của `.col-check` là SVG data URI màu trắng vẽ trên `#5a96ff`, tương phản khoảng 2.9:1, và không dùng token được. `.btn-danger` cũng dùng `--on-accent`, nên ở dark mode chữ của nó thành mực tối trên nền đỏ: dễ đọc hơn nhưng là thay đổi nhìn thấy được.

### Task 11: i18n: shard Bàn làm việc và nhãn navWorkbench

Ghi chú hòa giải: task này tạo hạ tầng shard và chỉ seed các key nhiều tab dùng chung: nhãn "trên máy này" (`wbOnThisDevice`, dùng ở Tổng quan, Biểu mẫu, Ghi chú, 4 trụ cột) và câu thông báo theo kind (C10). Mỗi task giao diện sau tự thêm key của mình (Task 12 `wbTop*`, Task 13 `wbOv*`, Task 14 `wbWork*`/`wbTasks*`, Task 15 `wbCal*`, Task 16 `wbProfile*`, Task 17 `wbNotes*`) vào `zh.ts`, `vi.ts`, `en.ts`; 18 shard còn lại là `{ ...en }` nên tự nhận key mới và không cần sửa lại.

**Files:**
- Create: `apps/shell/src/renderer/src/i18n/workbench/zh.ts` (định nghĩa bộ key)
- Create: `apps/shell/src/renderer/src/i18n/workbench/en.ts`, `.../workbench/vi.ts` (viết tay)
- Create: `apps/shell/src/renderer/src/i18n/workbench/{ja,ko,fr,de,es,th,id,ru,ar,pt,it,pl,cs,nl,ms,he,hi,zh-TW}.ts`. Mỗi file là `{ ...en }` như spec 6.8 yêu cầu.
- Create: `apps/shell/src/renderer/src/i18n/strings-workbench.ts`
- Modify: `apps/shell/src/renderer/src/locale.tsx` (import l.13-16, `StringKey` l.18-23, `dicts` l.26-36)
- Modify: `apps/shell/src/renderer/src/strings.ts`. Đổi tên 21 dòng `navTeacher:`, mỗi khối locale một dòng (zh l.10, en l.379, ja l.761, ko l.1158, fr l.1546, de l.1949, es l.2352, th l.2753, id l.3138, ru l.3534, ar l.3930, pt l.4318, it l.4709, pl l.5098, cs l.5485, nl l.5870, ms l.6259, he l.6651, hi l.7026, vi l.7409, zh-TW l.7787). Số dòng có thể lệch sau các task trước; script dưới khớp theo nội dung.
- Modify: `apps/shell/src/renderer/src/Home.tsx`. Đây là chỗ gọi `t('navTeacher')` duy nhất, khoảng l.3410.
- Test: `apps/shell/tests/strings-workbench.test.ts` (mới)

**Interfaces:**
- Produces `workbenchStrings` (`export const` trong `strings-workbench.ts`). Key của nó gộp vào `StringKey`, nên mọi `t()` ở renderer nhận `t('wbX', params)`.
- **Bộ key seed** (20 key):
  - `wbOnThisDevice`: nhãn file/tab chỉ lưu trên máy.
  - `wbNotif_<server kind>` cho 18 kind của `NOTIFICATION_KINDS` (`uniwork:packages/core/types/notification.ts:4-23`): `task_assigned{actor}{task}`, `task_status_changed{actor}{task}{status}`, `task_commented{actor}{task}`, `mentioned{actor}{task}`, `meeting_invited{actor}{meeting}`, `meeting_starting{meeting}{minutes}`, `meeting_summary_reminder{meeting}`, `member_added{actor}{workspace}`, `role_changed{actor}{role}`, `audit_export_ready`, `chat_follow_up`, `chat_reminder{body}`, `email_hub_new_mail{count}{mailbox}`, `document_commented{actor}{document}`, `document_mentioned{actor}{document}`, `chat_mentioned{actor}{room}`, `chat_dm{actor}`, `chat_thread_replied{actor}{room}`. Tham số lấy nguyên từ `params` của server; tên khớp `uniwork:packages/core/i18n/locales/en.json` (`{{actor}}`, `{{task}}`, …).
  - `wbNotifFallback`: câu cho kind lạ.
- Key sẵn có mà các task sau dùng lại thay vì định nghĩa lại: `acctSignInUniwork` ("Đăng nhập UniWork") và `acctRetry` ("Thử lại"). Không bao giờ định nghĩa `wbLoadFailedTitle` hay `wbLoadFailedBody`; shard account đã sở hữu chúng.
- Đổi tên: `navTeacher` → `navWorkbench` trong `strings.ts`.
- `t` từ `useI18n()` không ổn định. Nơi gọi lưu key và dịch lúc render, không bao giờ đưa `t` vào deps của hook.

- [ ] **Step 1: Viết test sẽ fail**

Tạo `apps/shell/tests/strings-workbench.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { strings } from '../src/renderer/src/strings'

/**
 * Workbench shard (i18n/workbench/<lang>.ts): zh defines the key set; vi and en are hand-written,
 * the other locales start as the English copy (spec 6.8) but must keep the key set and placeholders.
 */

const referenceKeys = Object.keys(workbenchStrings.zh).sort()
const PLACEHOLDER = /\{[a-zA-Z0-9]+\}/g
const placeholdersOf = (s: string) => (s.match(PLACEHOLDER) ?? []).sort().join(',')
const table = (lang: (typeof LANGS)[number]) => workbenchStrings[lang] as Record<string, string>

/** server NOTIFICATION_KINDS (uniwork:packages/core/types/notification.ts:4-23) */
const KINDS = [
  'task_assigned',
  'task_status_changed',
  'task_commented',
  'mentioned',
  'meeting_invited',
  'meeting_starting',
  'meeting_summary_reminder',
  'member_added',
  'role_changed',
  'audit_export_ready',
  'chat_follow_up',
  'chat_reminder',
  'email_hub_new_mail',
  'document_commented',
  'document_mentioned',
  'chat_mentioned',
  'chat_dm',
  'chat_thread_replied',
]
const notifKey = (kind: string) => `wbNotif_${kind}`

describe('workbench string shards', () => {
  it('covers every UI language', () => {
    expect(Object.keys(workbenchStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    expect(Object.keys(table(lang)).sort()).toEqual(referenceKeys)
    expect(Object.entries(table(lang)).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s keeps the zh placeholders', (lang) => {
    const zh = table('zh')
    expect(
      referenceKeys.filter((k) => placeholdersOf(table(lang)[k]!) !== placeholdersOf(zh[k]!)),
    ).toEqual([])
  })

  it('uses the wb prefix and collides with no other dictionary', () => {
    expect(referenceKeys.filter((k) => !k.startsWith('wb'))).toEqual([])
    expect(
      referenceKeys.filter(
        (k) =>
          k in strings.zh ||
          k in accountStrings.zh ||
          k in cloudStrings.zh ||
          k in syncStrings.zh ||
          k in uniworkDocumentStrings.zh,
      ),
    ).toEqual([])
  })

  it('has one sentence per server notification kind plus a fallback', () => {
    expect(KINDS.map(notifKey).filter((k) => !referenceKeys.includes(k))).toEqual([])
    expect(referenceKeys).toContain('wbNotifFallback')
  })

  it('says what the spec says in vi and en', () => {
    expect(workbenchStrings.vi.wbOnThisDevice).toBe('Trên máy này')
    expect(workbenchStrings.en.wbOnThisDevice).toBe('On this device')
    expect(workbenchStrings.vi.wbNotif_task_assigned).toBe('{actor} đã giao bạn việc “{task}”')
    expect(workbenchStrings.en.wbNotif_task_assigned).toBe('{actor} assigned you “{task}”')
    expect(workbenchStrings.vi.wbNotifFallback).toBe('Thông báo mới')
  })

  it('formal vi copy does not mix in English UI words', () => {
    // placeholders such as {workspace} or {task} are parameter names, not copy
    expect(
      Object.values(table('vi')).filter((v) =>
        /\b(workspace|task|meeting|tab|inbox|online|offline|profile)\b/i.test(
          v.replace(PLACEHOLDER, ''),
        ),
      ),
    ).toEqual([])
  })
})

describe('Workbench nav label', () => {
  const NAV: Record<(typeof LANGS)[number], string> = {
    zh: '工作台',
    en: 'Workbench',
    ja: 'ワークベンチ',
    ko: '워크벤치',
    fr: 'Plan de travail',
    de: 'Arbeitsplatz',
    es: 'Mesa de trabajo',
    th: 'โต๊ะทำงาน',
    id: 'Meja kerja',
    ru: 'Рабочее место',
    ar: 'مكتب العمل',
    pt: 'Bancada de trabalho',
    it: 'Banco di lavoro',
    pl: 'Stanowisko pracy',
    cs: 'Pracovní stůl',
    nl: 'Werkbank',
    ms: 'Meja kerja',
    he: 'עמדת עבודה',
    hi: 'वर्कबेंच',
    vi: 'Bàn làm việc',
    'zh-TW': '工作台',
  }

  it.each([...LANGS])('%s names the Workbench, not a teacher', (lang) => {
    const dict = strings[lang] as Record<string, string>
    expect(dict.navTeacher).toBeUndefined()
    expect(dict.navWorkbench).toBe(NAV[lang])
  })
})
```

Test "formal vi" bỏ placeholder trước khi dò từ tiếng Anh, vì `{workspace}`, `{task}`, `{meeting}` là tên tham số chứ không phải câu chữ.

- [ ] **Step 2: Chạy và thấy fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/strings-workbench.test.ts`
Kết quả mong đợi: FAIL. Vitest không resolve được `../src/renderer/src/i18n/strings-workbench`.

- [ ] **Step 3: Tạo `apps/shell/src/renderer/src/i18n/workbench/zh.ts`**

```ts
/**
 * Workbench strings; zh defines the key set. This file seeds the keys several
 * tabs share; Tasks 12–18 append their own (wbTop*, wbOv*, wbWork*, wbTasks*,
 * wbCal*, wbProfile*, wbNotes*, and Task 18's moved label() copy).
 */
export const zh = {
  // the local-only label (Overview recents, Forms, Notes, the four pillars)
  wbOnThisDevice: '在本机',
  // notifications (C10): wbNotif_<server kind>; params come from the server as-is
  wbNotifFallback: '新通知',
  wbNotif_task_assigned: '{actor} 给你分配了“{task}”',
  wbNotif_task_status_changed: '{actor} 将“{task}”改为 {status}',
  wbNotif_task_commented: '{actor} 评论了“{task}”',
  wbNotif_mentioned: '{actor} 在“{task}”中提到了你',
  wbNotif_meeting_invited: '{actor} 邀请你参加“{meeting}”',
  wbNotif_meeting_starting: '“{meeting}”将在 {minutes} 分钟后开始',
  wbNotif_meeting_summary_reminder: '“{meeting}”已结束 · 总结并创建任务',
  wbNotif_member_added: '{actor} 将你加入工作区 {workspace}',
  wbNotif_role_changed: '{actor} 将你的角色改为 {role}',
  wbNotif_audit_export_ready: '你的审计导出已就绪',
  wbNotif_chat_follow_up: '你为一条消息设置了跟进',
  wbNotif_chat_reminder: '提醒：{body}',
  wbNotif_email_hub_new_mail: '你有 {count} 封未读邮件 · {mailbox}',
  wbNotif_document_commented: '{actor} 评论了“{document}”',
  wbNotif_document_mentioned: '{actor} 在“{document}”中提到了你',
  wbNotif_chat_mentioned: '{actor} 在 {room} 中提到了你',
  wbNotif_chat_dm: '{actor} 给你发了消息',
  wbNotif_chat_thread_replied: '{actor} 回复了 {room} 中的话题',
}
```

- [ ] **Step 4: Tạo `apps/shell/src/renderer/src/i18n/workbench/en.ts`**

```ts
import type { zh } from './zh'

export const en = {
  wbOnThisDevice: 'On this device',
  wbNotifFallback: 'New notification',
  wbNotif_task_assigned: '{actor} assigned you “{task}”',
  wbNotif_task_status_changed: '{actor} moved “{task}” to {status}',
  wbNotif_task_commented: '{actor} commented on “{task}”',
  wbNotif_mentioned: '{actor} mentioned you in “{task}”',
  wbNotif_meeting_invited: '{actor} invited you to “{meeting}”',
  wbNotif_meeting_starting: '“{meeting}” starts in {minutes} min',
  wbNotif_meeting_summary_reminder: '“{meeting}” ended · Summarize it and create tasks',
  wbNotif_member_added: '{actor} added you to workspace {workspace}',
  wbNotif_role_changed: '{actor} changed your role to {role}',
  wbNotif_audit_export_ready: 'Your audit export is ready',
  wbNotif_chat_follow_up: 'You saved a follow-up on a message',
  wbNotif_chat_reminder: 'Reminder: {body}',
  wbNotif_email_hub_new_mail: 'Unread messages: {count} · {mailbox}',
  wbNotif_document_commented: '{actor} commented on “{document}”',
  wbNotif_document_mentioned: '{actor} mentioned you in “{document}”',
  wbNotif_chat_mentioned: '{actor} mentioned you in {room}',
  wbNotif_chat_dm: '{actor} sent you a message',
  wbNotif_chat_thread_replied: '{actor} replied to a thread in {room}',
} satisfies Record<keyof typeof zh, string>
```

- [ ] **Step 5: Tạo `apps/shell/src/renderer/src/i18n/workbench/vi.ts`**

Câu thông báo chuyển từ `uniwork:packages/core/i18n/locales/vi.json`, thay các từ tiếng Anh "workspace", "Follow-up" và "thread".

```ts
import type { zh } from './zh'

export const vi = {
  wbOnThisDevice: 'Trên máy này',
  wbNotifFallback: 'Thông báo mới',
  wbNotif_task_assigned: '{actor} đã giao bạn việc “{task}”',
  wbNotif_task_status_changed: '{actor} chuyển “{task}” sang {status}',
  wbNotif_task_commented: '{actor} đã bình luận trong “{task}”',
  wbNotif_mentioned: '{actor} đã nhắc đến bạn trong “{task}”',
  wbNotif_meeting_invited: '{actor} đã mời bạn họp “{meeting}”',
  wbNotif_meeting_starting: '“{meeting}” bắt đầu sau {minutes} phút',
  wbNotif_meeting_summary_reminder: '“{meeting}” đã kết thúc · Tóm tắt và tạo việc',
  wbNotif_member_added: '{actor} đã thêm bạn vào không gian làm việc {workspace}',
  wbNotif_role_changed: '{actor} đã đổi vai trò của bạn thành {role}',
  wbNotif_audit_export_ready: 'Bản xuất nhật ký của bạn đã sẵn sàng',
  wbNotif_chat_follow_up: 'Bạn đã đánh dấu cần theo dõi một tin nhắn',
  wbNotif_chat_reminder: 'Nhắc hẹn: {body}',
  wbNotif_email_hub_new_mail: 'Bạn có {count} thư chưa đọc · {mailbox}',
  wbNotif_document_commented: '{actor} đã bình luận trong “{document}”',
  wbNotif_document_mentioned: '{actor} đã nhắc đến bạn trong “{document}”',
  wbNotif_chat_mentioned: '{actor} đã nhắc đến bạn trong {room}',
  wbNotif_chat_dm: '{actor} đã nhắn tin cho bạn',
  wbNotif_chat_thread_replied: '{actor} đã trả lời một chuỗi tin nhắn trong {room}',
} satisfies Record<keyof typeof zh, string>
```

- [ ] **Step 6: Sinh 18 shard bản tiếng Anh**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell/src/renderer/src/i18n/workbench
for pair in ja:ja ko:ko fr:fr de:de es:es th:th id:id ru:ru ar:ar pt:pt it:it pl:pl cs:cs nl:nl ms:ms he:he hi:hi zh-TW:zhTW; do
  file=${pair%%:*}; name=${pair##*:}
  cat > "$file.ts" <<EOF
import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy until this locale is translated (spec 6.8); replace the spread with real strings then
export const $name = { ...en } satisfies Record<keyof typeof zh, string>
EOF
done
ls | wc -l   # expect 21
```

Vì 18 shard này spread `en`, các task sau chỉ thêm key vào `zh.ts`, `vi.ts` và `en.ts`.

- [ ] **Step 7: Tạo aggregator `apps/shell/src/renderer/src/i18n/strings-workbench.ts`**

```ts
import { defineStrings } from '@genoffice/i18n'
import { zh } from './workbench/zh'
import { en } from './workbench/en'
import { ja } from './workbench/ja'
import { ko } from './workbench/ko'
import { fr } from './workbench/fr'
import { de } from './workbench/de'
import { es } from './workbench/es'
import { th } from './workbench/th'
import { id } from './workbench/id'
import { ru } from './workbench/ru'
import { ar } from './workbench/ar'
import { pt } from './workbench/pt'
import { it } from './workbench/it'
import { pl } from './workbench/pl'
import { cs } from './workbench/cs'
import { nl } from './workbench/nl'
import { ms } from './workbench/ms'
import { he } from './workbench/he'
import { hi } from './workbench/hi'
import { zhTW } from './workbench/zh-TW'
import { vi } from './workbench/vi'

/** Workbench (Bàn làm việc) UI (sharded per locale; zh defines the key set) */
export const workbenchStrings = defineStrings({
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
})
```

- [ ] **Step 8: Đăng ký shard trong `apps/shell/src/renderer/src/locale.tsx`**

Trước (l.16-23):

```ts
import { syncStrings } from './i18n/strings-sync'

export type StringKey =
  | keyof typeof strings.zh
  | keyof typeof accountStrings.zh
  | keyof typeof cloudStrings.zh
  | keyof typeof uniworkDocumentStrings.zh
  | keyof typeof syncStrings.zh
```

Sau:

```ts
import { syncStrings } from './i18n/strings-sync'
import { workbenchStrings } from './i18n/strings-workbench'

export type StringKey =
  | keyof typeof strings.zh
  | keyof typeof accountStrings.zh
  | keyof typeof cloudStrings.zh
  | keyof typeof uniworkDocumentStrings.zh
  | keyof typeof syncStrings.zh
  | keyof typeof workbenchStrings.zh
```

Trước (l.33-34):

```ts
      ...uniworkDocumentStrings[l],
      ...syncStrings[l],
```

Sau:

```ts
      ...uniworkDocumentStrings[l],
      ...syncStrings[l],
      ...workbenchStrings[l],
```

- [ ] **Step 9: Chạy test. Test shard pass, test nav vẫn fail.**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/strings-workbench.test.ts`
Kết quả mong đợi: mọi test trong describe `workbench string shards` pass. Cả 21 trường hợp của `Workbench nav label` FAIL, ví dụ `navTeacher` của zh là `'专业工作台'` chứ không phải undefined.

- [ ] **Step 10: Đổi `navTeacher` → `navWorkbench` với bản dịch thật ở cả 21 khối locale**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && node -e '
const fs = require("fs"), f = "apps/shell/src/renderer/src/strings.ts"
const T = { zh: "工作台", en: "Workbench", ja: "ワークベンチ", ko: "워크벤치", fr: "Plan de travail",
  de: "Arbeitsplatz", es: "Mesa de trabajo", th: "โต๊ะทำงาน", id: "Meja kerja", ru: "Рабочее место",
  ar: "مكتب العمل", pt: "Bancada de trabalho", it: "Banco di lavoro", pl: "Stanowisko pracy",
  cs: "Pracovní stůl", nl: "Werkbank", ms: "Meja kerja", he: "עמדת עבודה", hi: "वर्कबेंच",
  vi: "Bàn làm việc", "zh-TW": "工作台" }
let lang = null, n = 0
const out = fs.readFileSync(f, "utf8").split("\n").map((l) => {
  const m = /^  (?:([a-z]{2})|\x27(zh-TW)\x27): \{$/.exec(l)
  if (m) lang = m[1] || m[2]
  if (!/^    navTeacher: /.test(l)) return l
  if (!T[lang]) throw new Error("no translation for " + lang)
  n++
  return `    navWorkbench: \x27${T[lang]}\x27,`
})
if (n !== 21) throw new Error("expected 21 navTeacher lines, got " + n)
fs.writeFileSync(f, out.join("\n"))'
```

Trong `apps/shell/src/renderer/src/Home.tsx`, trước:

```tsx
              <span className="nav-label">{t('navTeacher')}</span>
```

Sau:

```tsx
              <span className="nav-label">{t('navWorkbench')}</span>
```

Xác nhận không còn sót: `cd /Users/ducquang/UNICOM/uniwork-office && git grep -n navTeacher -- apps packages e2e`. Kết quả mong đợi: không có output.

- [ ] **Step 11: Chạy test và typecheck, xác nhận pass**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/strings-workbench.test.ts tests/strings-sync.test.ts tests/strings-account.test.ts tests/strings-cloud.test.ts tests/strings-uniwork-documents.test.ts
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell
```

Kết quả mong đợi: mọi test PASS, typecheck exit 0. Shard thiếu hoặc thừa key là lỗi `satisfies`; nếu key vẫn là `navTeacher` thì `t('navWorkbench')` là lỗi `StringKey`.

- [ ] **Step 12: Format và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office && npm run format
git add apps/shell/src/renderer/src/i18n/workbench apps/shell/src/renderer/src/i18n/strings-workbench.ts apps/shell/src/renderer/src/locale.tsx apps/shell/src/renderer/src/strings.ts apps/shell/src/renderer/src/Home.tsx apps/shell/tests/strings-workbench.test.ts
git commit -m "feat(shell): add the workbench i18n shard and rename navTeacher to navWorkbench

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Task 11 chưa chuyển các chuỗi `label(vi, en)` sẵn có trong `PracticeHome.tsx`, `WorkbenchTabs.tsx`, `SkillDomainTabs.tsx` và `WorkbenchModulePanes.tsx` (spec 6.8): Task 18 chuyển chúng sau khi Task 12–17 xong, để không phải viết lại chuỗi của những phần sắp bị xóa. Các tab mới (Task 12–17) dùng shard từ đầu.

### Task 12: Khung Bàn làm việc (thanh trên, ô icon tab tô tint, đổi `teacher-*` → `wb-*`)

**Files:**
- Create: `apps/shell/src/renderer/src/WorkbenchTopBar.tsx`
- Create: `apps/shell/tests/workbench-icons.test.ts`
- Create: `apps/shell/tests/workbench-topbar.test.ts`
- Modify: `apps/shell/src/renderer/src/WorkbenchIcons.tsx` (cả file)
- Modify: `apps/shell/src/renderer/src/WorkbenchTabs.tsx` (l.295 và l.319: `size={22}`; tên class qua bước đổi tên)
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx`:
  - import
  - props
  - đầu thân component (sau Task 6)
  - hero
- Modify: `apps/shell/src/renderer/src/Home.tsx` (khoảng l.3465-3483, phần tử `<PracticeHome`)
- Modify: `apps/shell/src/renderer/src/home.css`:
  - l.3371-3378: comment và `.teacher-home`
  - l.3557-3789: rule của tab
  - l.7509-7535, 7617-7697, 7711-7724, 7778-7780, 7841-7858, 7895-7904: rule hero, hub và filter đã chết (số dòng ở HEAD; tìm theo selector)
- Chỉ đổi tên (`teacher-` → `wb-` trong tên class): mọi file `*.tsx` / `*.css` dưới `apps/shell/src/renderer/src` còn chứa `teacher-[a-z]`. Hiện còn:
  - `AgentIntentBanner.tsx`
  - `CalendarPane.tsx`
  - `DeskPane.tsx`
  - `PracticeHome.tsx`
  - `TasksPane.tsx`
  - `WorkbenchModulePanes.tsx`
  - `WorkbenchTabs.tsx`
  - `home.css`

  `my-ai-playbooks.ts` và `my-ai-templates.ts` từng chứa id `'teacher-lesson'` (đã gỡ ở Task 4), không phải tên class; chúng là file `.ts` và không bị đụng.
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts` (thêm key; 18 shard còn lại spread `en`)

**Interfaces:**
- Consumes (từ task trước):
  - `MODULE_TONES`, `tintStyle`, `Tint` (`./module-tones`, Task 10)
  - `pickActiveWorkspace`, `readActiveWorkspaceId`, `writeActiveWorkspaceId` (`./active-workspace`, Task 9)
  - `UniworkWorkspaceRef` có `slug` và `orgSlug` (`shared/home-api.ts`, Task 7)
  - token `--tint-*`, `--tint-*-fg` và `--accent` của shell (Task 10)
  - shard `i18n/workbench` (Task 11)
- Produces:
  ```ts
  // WorkbenchIcons.tsx (signature unchanged)
  export function WorkbenchIcon({ id, size }: { id: PracticePillarId | WorkbenchModuleId | 'add'; size?: number }): ReactElement
  // WorkbenchTopBar.tsx
  export interface WorkbenchNewItem { ext: string; title: string; action: () => unknown }
  export function WorkbenchTopBar(props: {
    practice: PracticeDefinition
    onSwitchPractice: (id: PracticeId) => void
    workspaces: readonly UniworkWorkspaceRef[]
    workspaceId: string | null
    onSelectWorkspace: (id: string) => void
    newItems: readonly WorkbenchNewItem[]
    onNewTask: () => void
    onRefresh: () => void
  }): ReactElement
  // PracticeHome: new prop `newItems: readonly WorkbenchNewItem[]`.
  // New internal state `workspaces: UniworkWorkspaceRef[] | null` (null = loading),
  // `workspaceId: string | null`, `refreshTick: number`, `refresh()`. Tasks 13 and 14 consume them.
  ```
  - Script `insert.cjs` (trong `${TMPDIR:-/tmp}/wb-keys/`) để thêm key vào shard; Task 13–17 dùng lại.

Ghi chú: `wb-ms-breathe`, `wb-ms-fade-up` và gradient hero chỉ nằm trong khối CSS desk (`.wb-ms-*`). Task 13 xóa cả khối đó, nên task này không sửa những dòng sẽ bị xóa ngay sau. Task này chỉ bỏ chuyển động trang trí của chính khung: hiệu ứng nâng `translateY` khi hover và bóng đổ trên tab và mục menu.

- [ ] **Step 1: Viết test icon sẽ fail**

`apps/shell/tests/workbench-icons.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { WorkbenchIcon } from '../src/renderer/src/WorkbenchIcons'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type IconId = Parameters<typeof WorkbenchIcon>[0]['id']

function render(id: IconId): HTMLElement {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(WorkbenchIcon, { id, size: 18 })))
  return host
}

describe('WorkbenchIcon', () => {
  it('draws an 18px tile tinted from module-tones (Tasks = green)', () => {
    const tile = render('tasks').querySelector<HTMLElement>('.wb-icon-tile')!
    expect(tile.style.background).toBe('var(--tint-green)')
    expect(tile.style.color).toBe('var(--tint-green-fg)')
    expect(tile.style.width).toBe('18px')
  })

  it('tints the knowledge pillars blue and the add tile gray', () => {
    expect(render('skills').querySelector<HTMLElement>('.wb-icon-tile')!.style.background).toBe(
      'var(--tint-blue)',
    )
    expect(render('add').querySelector<HTMLElement>('.wb-icon-tile')!.style.background).toBe(
      'var(--tint-gray)',
    )
  })

  it.each([
    'desk',
    'tasks',
    'calendar',
    'forms',
    'notes',
    'personal',
    'knowledge',
    'materials',
    'skills',
    'compose',
    'add',
  ] as const)('%s carries no raw hex color', (id) => {
    expect(render(id).innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
```

- [ ] **Step 2: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-icons.test.ts`
Kết quả mong đợi: FAIL.
- Test đầu throw `TypeError: Cannot read properties of null (reading 'style')` vì chưa có `.wb-icon-tile`.
- Các test hex fail vì `fill="#2F9E8A"` và tương tự.

- [ ] **Step 3: Viết lại `WorkbenchIcons.tsx`**

Thay toàn bộ file bằng:
```tsx
import type { ReactElement } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
import { MODULE_TONES, tintStyle } from './module-tones'

type IconId = PracticePillarId | WorkbenchModuleId | 'add'

/**
 * Line glyphs on a 24-unit box, drawn in currentColor: the tile's tint
 * (module-tones.ts) sets both the fill and the glyph, in either theme.
 */
const GLYPH: Record<IconId, ReactElement> = {
  knowledge: (
    <>
      <path d="M7 6.5h10v11H7z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5V17.5M7 10.5h10" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  materials: (
    <>
      <path d="M7.5 5.5h7l3 3V18H7.5z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14.5 5.5V8.5h3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 11.5h5M10 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  skills: (
    <path
      d="M12 5.5 13.6 9.2l4 .6-2.9 2.9.7 4L12 14.8l-3.4 1.9.7-4-2.9-2.9 4-.6z"
      fill="currentColor"
    />
  ),
  compose: (
    <>
      <path d="M6.5 17 15.5 8l2 2-9 9H6.5z" fill="currentColor" />
      <path d="M14.8 7.2 16.5 5.5 18.2 7.2 16.5 8.9z" fill="currentColor" />
    </>
  ),
  desk: (
    <>
      <path
        d="M4.5 10.5 12 4.5l7.5 6V18a1 1 0 0 1-1 1h-4.2v-4.2H9.7V19H5.5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11.2" r="1.3" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="6.5" y="7" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 10h11M9 5.5v3M15 5.5v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  tasks: (
    <>
      <path d="M7 8h10M7 12h10M7 16h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M5.5 8l1 1 2-2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  notes: (
    <>
      <path d="M7 5.5h7.5L17.5 8.5V18H7z" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 11h5M9.5 13.5h5M9.5 16h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  forms: (
    <>
      <rect x="7" y="5.5" width="10" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 9h5M9.5 12h5M9.5 15h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  personal: (
    <>
      <circle cx="12" cy="9" r="2.4" fill="currentColor" />
      <path
        d="M6.5 18c.9-2.6 2.8-3.8 5.5-3.8S16.6 15.4 17.5 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  add: <path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
}

export function WorkbenchIcon({ id, size = 18 }: { id: IconId; size?: number }): ReactElement {
  return (
    <span
      className="wb-icon-tile"
      style={{ ...tintStyle(id === 'add' ? 'gray' : MODULE_TONES[id]), width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {GLYPH[id]}
      </svg>
    </span>
  )
}
```

- [ ] **Step 4: Chạy test icon và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-icons.test.ts`
Kết quả mong đợi: PASS (13 test).

- [ ] **Step 5: Đổi class `teacher-*` thành `wb-*`**

52 tên class đã được kiểm: không tên nào trùng một tên `wb-*` sẵn có.
```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell/src/renderer/src
grep -rlE 'teacher-[a-z]' --include='*.tsx' --include='*.css' . | xargs sed -i '' -E 's/teacher-([a-z])/wb-\1/g'
grep -rnE 'teacher-[a-z]' --include='*.tsx' --include='*.css' .
```
Kết quả mong đợi: lệnh cuối không in gì.

Trong `home.css` (l.3371), đổi comment mục:
```css
/* ── Teacher / education mode ── */
```
→
```css
/* ── Workbench ── */
```

- [ ] **Step 6: Làm lại thanh tab (gạch chân, ô 18px, radius 6/8/10/12, chữ 11/12/13)**

Trong `home.css`, thay rule `.wb-home` (trước là `.teacher-home`, l.3373-3378):
```css
.wb-home {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 48px;
}
```
→
```css
.wb-home {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 32px;
}
```
Tiếp theo, thay toàn bộ từ `.wb-tabs {` (trước là l.3557) tới hết `.wb-tab-menu-item strong { … }` (trước là l.3784-3789) bằng:
```css
.wb-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--border);
}

.wb-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: var(--radius-6) var(--radius-6) 0 0;
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 150ms ease,
    background 150ms ease,
    border-color 150ms ease;
}

.wb-tab:hover {
  background: var(--hover);
  color: var(--text);
}

.wb-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.wb-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.wb-tab-icon,
.wb-tab-menu-icon {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}

.wb-icon-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--radius-6);
  line-height: 0;
}

.wb-tab-module {
  cursor: grab;
}

.wb-tab-module:active {
  cursor: grabbing;
}

.wb-tab-module.is-dragging {
  opacity: 0.45;
}

.wb-tab-module.is-drag-over {
  background: var(--accent-soft);
}

.wb-tab-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  color: var(--text-tertiary);
  font-size: 11px;
  letter-spacing: -2px;
  line-height: 1;
  opacity: 0;
  user-select: none;
  transition: opacity 150ms ease;
}

.wb-tab-module:hover .wb-tab-grip {
  opacity: 1;
}

.wb-tab-unpin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-6);
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1;
  transition:
    background 150ms ease,
    color 150ms ease;
}

.wb-tab-unpin:hover {
  background: var(--hover);
  color: var(--text);
}

.wb-tab-add {
  padding: 8px;
}

.wb-tab-add-wrap {
  position: relative;
}

.wb-tab-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: min(320px, 92vw);
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-menu);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-tab-menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}

.wb-tab-menu-title {
  margin: 0 4px 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.wb-tab-menu-section {
  margin: 8px 4px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.wb-tab-menu-section:first-of-type {
  margin-top: 2px;
}

.wb-tab-menu-empty {
  margin: 0;
  padding: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.wb-tab-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 150ms ease;
}

.wb-tab-menu-item:hover,
.wb-tab-menu-item:focus-visible {
  background: var(--hover);
  outline: none;
}

.wb-tab-menu-item strong {
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
}
```
Trong `WorkbenchTabs.tsx`, icon menu thành ô 18px như tab. Ở cả l.295 và l.319:
```tsx
<WorkbenchIcon id={p.id} size={22} />
```
→
```tsx
<WorkbenchIcon id={p.id} size={18} />
```
và
```tsx
<WorkbenchIcon id={m.id} size={22} />
```
→
```tsx
<WorkbenchIcon id={m.id} size={18} />
```

- [ ] **Step 7: Chạy kiểm tra và commit phần khung**

Chạy:
```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell
cd apps/shell && npx vitest run && cd ../..
npm run check:theme-colors -- --base origin/main
npm run format
```
Kết quả mong đợi:
- typecheck exit 0;
- mọi test shell PASS;
- theme check không in vi phạm;
- prettier chỉ ghi lại các file đã đụng.

```bash
git add apps/shell/src/renderer/src apps/shell/tests/workbench-icons.test.ts
git commit -m "$(cat <<'EOF'
refactor(shell): tint Workbench tab tiles and rename teacher-* classes to wb-*

Tab icons are 18px tiles tinted from module-tones (no raw hex); the active
tab is underlined with the accent; the decorative hover lifts are gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Viết test thanh trên sẽ fail**

`apps/shell/tests/workbench-topbar.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchTopBar } from '../src/renderer/src/WorkbenchTopBar'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACES: UniworkWorkspaceRef[] = [
  { id: 'w1', name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'acme' },
  { id: 'w2', name: 'Sales', orgId: 'o1', slug: 'sales', orgSlug: 'acme' },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function props(over: Partial<Parameters<typeof WorkbenchTopBar>[0]> = {}) {
  return {
    practice: requirePractice('entrepreneur'),
    onSwitchPractice: vi.fn(),
    workspaces: WORKSPACES,
    workspaceId: 'w2' as string | null,
    onSelectWorkspace: vi.fn(),
    newItems: [{ ext: 'docx', title: 'New document', action: vi.fn() }],
    onNewTask: vi.fn(),
    onRefresh: vi.fn(),
    ...over,
  }
}

async function mount(p: ReturnType<typeof props>): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(WorkbenchTopBar, p)))
  })
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const button = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )

describe('WorkbenchTopBar', () => {
  it('shows the title, the selected workspace and the role', async () => {
    await mount(props())
    expect(host.querySelector('h1')?.textContent).toBe('Workbench')
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!.value).toBe('w2')
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!.value).toBe(
      'entrepreneur',
    )
  })

  it('reports a workspace or a role change', async () => {
    const p = props()
    await mount(p)
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!, 'w1')
    expect(p.onSelectWorkspace).toHaveBeenCalledWith('w1')
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!, 'sales')
    expect(p.onSwitchPractice).toHaveBeenCalledWith('sales')
  })

  it('hides the workspace select when there is no workspace (signed out)', async () => {
    await mount(props({ workspaces: [], workspaceId: null }))
    expect(host.querySelector('select[aria-label="Workspace"]')).toBeNull()
    expect(host.querySelector('select[aria-label="Role"]')).not.toBeNull()
  })

  it('+ New lists New task and the file types, and runs the chosen one', async () => {
    const p = props()
    await mount(p)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => button('+ New')!.click())
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    act(() => button('New document')!.click())
    expect(p.newItems[0]!.action).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => button('+ New')!.click())
    act(() => button('New task')!.click())
    expect(p.onNewTask).toHaveBeenCalledTimes(1)
  })

  it('Refresh asks the page to reload', async () => {
    const p = props()
    await mount(p)
    act(() => button('Refresh')!.click())
    expect(p.onRefresh).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 9: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-topbar.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/WorkbenchTopBar"`.

- [ ] **Step 10: Tạo script thêm key và thêm chuỗi của thanh trên**

Script này nối một khối dòng vào cuối object của mỗi shard (trước dấu `}` cuối cùng). Task 13–17 dùng lại; nếu thư mục tạm bị xóa, tạo lại từ bước này.
```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"; mkdir -p "$K"
cat > "$K/insert.cjs" <<'EOF'
// usage: node insert.cjs <block.txt> <shard.ts>... (appends the block as the last keys of each shard object)
const fs = require('node:fs')
const [block, ...files] = process.argv.slice(2)
const add = fs.readFileSync(block, 'utf8').trimEnd()
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const end = src.lastIndexOf('\n}')
  if (end < 0) throw new Error(`no object end in ${file}`)
  fs.writeFileSync(file, `${src.slice(0, end)}\n${add}${src.slice(end)}`)
}
EOF
cat > "$K/t12-zh.txt" <<'EOF'
  wbTopTitle: '工作台',
  wbTopWorkspace: '工作区',
  wbTopRole: '角色',
  wbTopNew: '新建',
  wbTopNewTask: '新任务',
  wbTopRefresh: '刷新',
EOF
cat > "$K/t12-vi.txt" <<'EOF'
  wbTopTitle: 'Bàn làm việc',
  wbTopWorkspace: 'Không gian làm việc',
  wbTopRole: 'Vai trò',
  wbTopNew: 'Tạo mới',
  wbTopNewTask: 'Việc mới',
  wbTopRefresh: 'Làm mới',
EOF
cat > "$K/t12-en.txt" <<'EOF'
  wbTopTitle: 'Workbench',
  wbTopWorkspace: 'Workspace',
  wbTopRole: 'Role',
  wbTopNew: 'New',
  wbTopNewTask: 'New task',
  wbTopRefresh: 'Refresh',
EOF
node "$K/insert.cjs" "$K/t12-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t12-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t12-en.txt" $D/en.ts
npx prettier --write $D
npm run typecheck -w @genoffice/shell
```
Kết quả mong đợi: typecheck exit 0. 18 shard còn lại là `{ ...en }` nên tự có key mới (spec §6.8).

- [ ] **Step 11: Viết `WorkbenchTopBar.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  listPracticeGroups,
  type PracticeDefinition,
  type PracticeId,
} from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { WorkbenchIcon } from './WorkbenchIcons'

/** one entry of Home's "New" list (Home.tsx NEW_ITEMS) */
export interface WorkbenchNewItem {
  ext: string
  title: string
  action: () => unknown
}

interface Props {
  practice: PracticeDefinition
  onSwitchPractice: (id: PracticeId) => void
  /** empty while signed out or still loading: the workspace select is hidden */
  workspaces: readonly UniworkWorkspaceRef[]
  workspaceId: string | null
  onSelectWorkspace: (id: string) => void
  newItems: readonly WorkbenchNewItem[]
  onNewTask: () => void
  onRefresh: () => void
}

/** Workbench title, the "workspace · role" picker, + New and Refresh. */
export function WorkbenchTopBar({
  practice,
  onSwitchPractice,
  workspaces,
  workspaceId,
  onSelectWorkspace,
  newItems,
  onNewTask,
  onRefresh,
}: Props): ReactElement {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const run = (action: () => unknown) => {
    setMenuOpen(false)
    void action()
  }

  return (
    <header className="wb-topbar">
      <h1 className="wb-topbar-title">{t('wbTopTitle')}</h1>
      <div className="wb-topbar-picker">
        {workspaces.length > 0 ? (
          <>
            <select
              aria-label={t('wbTopWorkspace')}
              value={workspaceId ?? ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <span className="wb-topbar-sep" aria-hidden="true">
              ·
            </span>
          </>
        ) : null}
        <select
          aria-label={t('wbTopRole')}
          value={practice.id}
          onChange={(e) => onSwitchPractice(e.target.value as PracticeId)}
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
      </div>
      <div className="wb-topbar-actions">
        <button type="button" className="btn btn-secondary" onClick={onRefresh}>
          {t('wbTopRefresh')}
        </button>
        <div className="wb-new-wrap" ref={wrapRef}>
          <button
            type="button"
            className="btn btn-primary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            + {t('wbTopNew')}
          </button>
          {menuOpen ? (
            <div className="wb-new-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="wb-new-item"
                onClick={() => run(onNewTask)}
              >
                <WorkbenchIcon id="tasks" size={18} />
                <span>{t('wbTopNewTask')}</span>
              </button>
              {newItems.map((item) => (
                <button
                  key={item.ext}
                  type="button"
                  role="menuitem"
                  className="wb-new-item"
                  onClick={() => run(item.action)}
                >
                  <FileBadge ext={item.ext} size={18} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 12: Chạy test thanh trên và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-topbar.test.ts`
Kết quả mong đợi: PASS (5 test).

- [ ] **Step 13: Gắn thanh trên vào `PracticeHome` và `Home`**

Task 6 đã gỡ `UI_LANG_KEY`, `persistWorkbenchUiLang`, `uiLang`, `changeUiLang` và ô chọn ngôn ngữ; các sửa sau dựa trên trạng thái đó.

1. Import của `PracticeHome.tsx`: xóa `listPracticeGroups,` khỏi danh sách import `@uniwork/practice-core`, rồi thay như sau.

   Thay:
   ```ts
   import type { ProjectSummaryEntry } from '../../shared/home-api'
   ```
   bằng:
   ```ts
   import type { ProjectSummaryEntry, UniworkWorkspaceRef } from '../../shared/home-api'
   import { pickActiveWorkspace, readActiveWorkspaceId, writeActiveWorkspaceId } from './active-workspace'
   ```
   Thay:
   ```ts
   import { WorkbenchTabs } from './WorkbenchTabs'
   ```
   bằng:
   ```ts
   import { WorkbenchTabs } from './WorkbenchTabs'
   import { WorkbenchTopBar, type WorkbenchNewItem } from './WorkbenchTopBar'
   ```

2. Props: sau `onSwitchPractice: (id: PracticeId) => void` trong `interface PracticeHomeProps`, thêm:
   ```ts
     /** Home's NEW_ITEMS, for the top bar's + New menu */
     newItems: readonly WorkbenchNewItem[]
   ```
   Trong phần destructuring, sau `onSwitchPractice,` thêm `newItems,`.

3. Thay đầu thân component (kết quả của Task 6 Step 3):
   ```ts
     const { lang } = useI18n()
     const vi = lang === 'vi'
     const label = (a: string, b: string) => (vi ? a : b)
   ```
   bằng:
   ```ts
     const { lang } = useI18n()
     const vi = lang === 'vi'
     const label = (a: string, b: string) => (vi ? a : b)

     // null while the list loads; Home remounts on an account or org change
     // (WorkbenchAccountGate keys it by bucket), so one load per mount plus Refresh is enough
     const [workspaces, setWorkspaces] = useState<UniworkWorkspaceRef[] | null>(null)
     const [workspaceId, setWorkspaceId] = useState<string | null>(null)
     const [refreshTick, setRefreshTick] = useState(0)

     useEffect(() => {
       let live = true
       void window.aiOffice.uniworkListWorkspaces().then(
         (result) => {
           if (!live) return
           const items = result.ok ? result.value : []
           setWorkspaces(items)
           setWorkspaceId(pickActiveWorkspace(items, readActiveWorkspaceId()))
         },
         () => {
           if (live) setWorkspaces([])
         },
       )
       return () => {
         live = false
       }
     }, [refreshTick])

     const selectWorkspace = (id: string) => {
       setWorkspaceId(id)
       writeActiveWorkspaceId(id)
     }

     const refresh = () => {
       onRefresh()
       setRefreshTick((n) => n + 1)
     }
   ```

4. Thay toàn bộ hero `<section className="wb-hero"> … </section>` (sau Step 5 đã đổi tên từ `teacher-hero`; sau Task 6 gồm tiêu đề, phụ đề, số pack và ô chọn vai trò) bằng:
   ```tsx
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
   ```

5. `Home.tsx`, trong phần tử `<PracticeHome` (khoảng l.3465-3483, sau Task 4), sau dòng `onSwitchPractice={switchPractice}`, thêm:
   ```tsx
               newItems={NEW_ITEMS}
   ```
   `NEW_ITEMS` (l.2009) có trong scope và khớp cấu trúc `WorkbenchNewItem`. Ở chế độ Bàn làm việc `selectedProjectId` là null, nên file mới vào vị trí mặc định.

- [ ] **Step 14: Thêm CSS thanh trên và xóa rule hero, hub, filter đã chết**

1. Trong `home.css`, ngay sau rule `.wb-home { … }`, thêm:
   ```css
   .wb-topbar {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     gap: 8px 12px;
   }

   .wb-topbar-title {
     margin: 0;
     font-size: 20px;
     font-weight: 600;
     color: var(--text);
   }

   .wb-topbar-picker {
     display: inline-flex;
     align-items: center;
     gap: 2px;
     padding: 2px;
     border: 1px solid var(--border);
     border-radius: var(--radius-8);
     background: var(--surface);
   }

   .wb-topbar-picker select {
     max-width: 220px;
     border: none;
     border-radius: var(--radius-6);
     background: transparent;
     color: var(--text);
     padding: 4px 6px;
     font: inherit;
     font-size: 13px;
     cursor: pointer;
   }

   .wb-topbar-picker select:hover,
   .wb-topbar-picker select:focus-visible {
     background: var(--hover);
     outline: none;
   }

   .wb-topbar-sep {
     color: var(--text-tertiary);
     font-size: 13px;
   }

   .wb-topbar-actions {
     display: flex;
     align-items: center;
     gap: 8px;
     margin-left: auto;
   }

   .wb-new-wrap {
     position: relative;
   }

   .wb-new-menu {
     position: absolute;
     top: calc(100% + 4px);
     right: 0;
     z-index: 40;
     display: flex;
     flex-direction: column;
     min-width: 220px;
     padding: 4px;
     border: 1px solid var(--border);
     border-radius: 10px;
     background: var(--surface);
     box-shadow: var(--shadow-menu);
   }

   .wb-new-item {
     display: flex;
     align-items: center;
     gap: 8px;
     padding: 6px 8px;
     border: none;
     border-radius: var(--radius-6);
     background: transparent;
     color: var(--text);
     font: inherit;
     font-size: 13px;
     text-align: left;
     cursor: pointer;
     transition: background 150ms ease;
   }

   .wb-new-item:hover,
   .wb-new-item:focus-visible {
     background: var(--hover);
     outline: none;
   }
   ```

2. Xác nhận không còn gì vẽ các class sắp xóa. Chúng đã chết sau khi thay hero, xóa TeacherHome và bỏ Hub Token.
   ```bash
   cd /Users/ducquang/UNICOM/uniwork-office/apps/shell/src/renderer/src
   grep -rnE "wb-(hero|lang|title|subtitle|hub|filters|actions|chip-ai|chip-row-spaced|detail-header|error-inline)\b" --include='*.tsx' .
   ```
   Kết quả mong đợi: không có output.

3. Xóa nguyên các khối rule sau khỏi `home.css` ở bất kỳ đâu chúng còn:
   - `.wb-filters`
   - `@media (max-width: 960px) { .wb-filters … }`
   - `.wb-filters label`
   - `.wb-chip-row-spaced`
   - `.wb-hub-toggle`
   - `.wb-hub-nested`
   - `.wb-hub`
   - `.wb-hub h2`
   - `.wb-hub .wb-form`
   - `.wb-hero-top`
   - `.wb-hero-controls`
   - `.wb-lang`
   - `.wb-lang select`
   - `.wb-title`
   - `.wb-subtitle`
   - `.wb-error-inline`
   - `.wb-detail-header`
   - `.wb-detail-header p`
   - `.wb-actions`
   - `.wb-chip-ai`
   - `.wb-chip-ai:hover:not(:disabled)`

   Giữ `.wb-form-spaced`: `PracticeHome` vẫn dùng.

4. Sửa hai selector gộp. Thứ nhất:
   ```css
   .wb-filters select,
   .wb-filters input,
   .wb-form select,
   .wb-add-row select {
   ```
   →
   ```css
   .wb-form select,
   .wb-add-row select {
   ```
   Thứ hai:
   ```css
   .wb-create h2,
   .wb-packs h2,
   .wb-detail h2,
   .wb-actions h3 {
   ```
   →
   ```css
   .wb-create h2,
   .wb-packs h2,
   .wb-detail h2 {
   ```

- [ ] **Step 15: Kiểm tra và commit**

Chạy:
```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell
cd apps/shell && npx vitest run && cd ../..
npm run check:theme-colors -- --base origin/main
npm run format
npm run dev
```
Kết quả mong đợi:
- typecheck exit 0;
- mọi test shell PASS, kể cả các test `strings*` và kiểm bộ key của shard Bàn làm việc;
- theme check sạch.

Kiểm trong app (task chỉ đổi renderer nên không cần rebuild shell). Mở Bàn làm việc và xác nhận:
- thanh trên hiện "Bàn làm việc", ô chọn workspace khi đã đăng nhập, ô chọn vai trò, "+ Tạo mới" (Việc mới cùng 6 loại file) và "Làm mới";
- tab có ô icon 18px tô tint và gạch chân accent ở tab đang chọn;
- cả theme light và dark đều đúng.

```bash
git add apps/shell/src/renderer/src apps/shell/tests/workbench-topbar.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Workbench top bar with workspace and role picker, + New and Refresh

Replaces the hero (title, role select, pack count) with one bar; the
workspace comes from the active-workspace store, + New reuses Home's
NEW_ITEMS plus New task. Dead hero/hub/filter CSS is removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 13: Tab Tổng quan (Home của server) thay DeskPane

**Files:**
- Create: `apps/shell/src/renderer/src/work-home.ts` (hàm thuần và hai hook)
- Create: `apps/shell/src/renderer/src/WorkOverview.tsx`
- Create: `apps/shell/tests/work-home.test.ts`
- Create: `apps/shell/tests/work-overview.test.ts`
- Modify: `apps/shell/src/renderer/src/uniwork-open.ts` (l.1-33: tách `openUniworkDocument`)
- Modify: `apps/shell/tests/uniwork-docs-ui.test.ts` (import l.32, thêm một `describe` sau l.530)
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx`:
  - import
  - effect workspace thêm ở Task 12
  - bộ chuyển pane (khoảng l.601-610 ở HEAD)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`: import `DeskPane`, `hideChrome`, nhánh desk
- Modify: `packages/practice-core/src/modules.ts` (l.41-48, mục `desk`)
- Modify: `apps/shell/src/renderer/src/home.css`:
  - thêm các rule `.wb-ov*`, `.wb-pill`, `.wb-link` và `.wb-toast`
  - xóa mọi rule `.wb-myspace*`, `.wb-ms-*`, `.wb-desk-*` cùng keyframes `wb-ms-fade-up` / `wb-ms-breathe`
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts`
- Delete:
  - `apps/shell/src/renderer/src/DeskPane.tsx`
  - `apps/shell/src/renderer/src/workbench-desk.ts`
  - `apps/shell/src/renderer/src/workbench-reminders.ts` (chỉ DeskPane import nó, và nó nhắc việc của store cục bộ mà server thay thế)

**Interfaces:**
- Consumes:
  - `window.uniworkWork: UniworkWorkApi` (khai báo ở `Home.tsx`, Task 8): `homeSummary`, `setTaskStatus`, `openWeb`
  - kiểu `UniworkWorkError`, `UniworkWorkResult`, `WorkHomeSummary`, `WorkHomeCounts`, `WorkHomeSource`, `WorkTask`, `WorkNotification`, `WorkRecentDocument`, `WorkWebTarget`, và `workErrorOfDocCode` (`shared/uniwork-work-api.ts`)
  - `window.aiOffice`: `uniworkListDocuments({ workspaceId, limit: 20 })`, `recents({ limit: 12 })`, `uniworkOpenDocument`, `openPath`, `accountStatus`, `accountLogin`
  - từ Task 12: `workspaces`, `workspaceId`, `refreshTick`, `refresh` trong `PracticeHome`
  - từ Task 11: key `wbOnThisDevice`, `wbNotif_<kind>`, `wbNotifFallback`
  - `currentWorkbenchBucket()`, `isOpenable`, `docExtension`, `formatWhen`, `FileBadge`
- Produces:
  ```ts
  // uniwork-open.ts
  export function openUniworkDocument(
    source: { documentId: string; title: string },
    api: Pick<HomeApi, 'uniworkOpenDocument'>,
    notify?: (event: UniworkLaunchEvent) => void,
  ): Promise<void>
  // work-home.ts
  export function overdueDays(today: string, due: string | undefined): number
  export function localDay(iso: string, timeZone: string): string
  export function hourIn(timeZone: string | undefined, now?: Date): number
  export function clock(iso: string, locale: string, timeZone?: string): string
  export function greetingKey(hour: number): StringKey
  export interface WorkHeadline { key: StringKey; params: Record<string, string | number>; at?: string; liveMeetingId?: string }
  export function buildHeadline(summary: WorkHomeSummary): WorkHeadline
  export type DueState = 'overdue' | 'today' | 'later' | 'none'
  export function dueState(task: WorkTask, today: string): DueState
  export function isQuiet(summary: WorkHomeSummary): boolean
  export function withTaskStatus(summary: WorkHomeSummary, taskId: string, status: string): WorkHomeSummary
  export function mergeRecentDocuments(cloud: readonly UniworkDocSummary[], local: readonly RecentEntry[], limit?: number): WorkRecentDocument[]
  export function inboxTarget(n: WorkNotification, ws: { orgSlug: string; wsSlug: string }): WorkWebTarget
  export function notificationKey(kind: string): StringKey
  export type OverviewView = 'loading' | 'ready' | 'stale' | 'no-workspace' | 'signed-out' | 'forbidden' | 'unreachable'
  export function overviewView(i: { workspaces: readonly unknown[] | null; workspaceError: UniworkWorkError | null; summary: WorkHomeSummary | null; error: UniworkWorkError | null }): OverviewView
  export function settleWork<T>(call: Promise<UniworkWorkResult<T>>): Promise<UniworkWorkResult<T>>
  export const HOME_REFRESH_MS = 60_000
  export interface WorkHome { summary: WorkHomeSummary | null; updatedAt: number | null; error: UniworkWorkError | null; reload(): void; update(edit: (s: WorkHomeSummary) => WorkHomeSummary): void }
  export function useWorkHome(workspaceId: string | null, refreshTick: number): WorkHome
  export function useRecentDocuments(workspaceId: string | null, refreshTick: number): WorkRecentDocument[]
  // WorkOverview.tsx
  export function WorkOverview(props: {
    workspaces: readonly UniworkWorkspaceRef[] | null
    workspaceId: string | null
    workspaceError: UniworkWorkError | null
    refreshTick: number
    onReload: () => void
    onCompose: () => void
  }): ReactElement
  // PracticeHome: new state `workspaceError: UniworkWorkError | null` (Task 14 keeps it)
  ```
  - Selector cho E2E (Task 19): 5 ô `.wb-ov-stat` theo thứ tự Đang mở, Quá hạn, Đến hạn hôm nay, Họp hôm nay, Chưa đọc; thẻ tài liệu gần đây `.wb-ov-recent`.

Ghi chú:
- `buildHeadline` không nhận `now`. Đây là bản chuyển trực tiếp của `uniwork:packages/core/home/brief.ts`, chỉ đọc summary vì "hôm nay" đến từ server theo múi giờ người dùng.
- Cache summary là một `Map` cấp module khóa theo `${currentWorkbenchBucket()}|${workspaceId}`, nên tài khoản hay org này không bao giờ thấy cache của tài khoản/org khác.
- Cột "dự án" hiện `identifier` (C9).
- Chữ của Thông báo lấy từ key desktop `wbNotif_<kind>` và `wbNotifFallback` (Task 11, C10).
- `work-home.ts` không có `declare global`: `window.uniworkWork` chỉ khai báo ở `Home.tsx` (Task 8).

- [ ] **Step 1: Thêm chuỗi Tổng quan (zh, vi, en)**

Câu tiếng Việt chuyển từ `uniwork:packages/core/i18n/locales/vi.json`, thay các từ tiếng Anh. 18 shard còn lại nhận bản tiếng Anh qua `{ ...en }` (spec §6.8). `insert.cjs` là script ở Task 12 Step 10.
```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"   # insert.cjs from Task 12 Step 10; re-create it from there if the temp dir was cleared
cat > "$K/t13-zh.txt" <<'EOF'
  wbOvGreetingMorning: '早上好，{name}',
  wbOvGreetingNoon: '中午好，{name}',
  wbOvGreetingAfternoon: '下午好，{name}',
  wbOvGreetingEvening: '晚上好，{name}',
  wbOvHeadlineLive: '“{title}”正在进行。',
  wbOvHeadlinePartial: '部分数据未能加载，下方数字可能不完整。',
  wbOvHeadlineOverdue: '先处理“{title}”，已逾期 {count} 天。',
  wbOvHeadlineOverduePlain: '有 {count} 项任务已逾期，从最早的开始。',
  wbOvHeadlineMeeting: '下一场会议 {time}：“{title}”。',
  wbOvHeadlineDueToday: '今天有 {count} 项任务到期，没有逾期任务。',
  wbOvHeadlineUnread: '没有紧急事项。有 {count} 条通知等你查看。',
  wbOvHeadlineClear: '今天没有紧急事项。',
  wbOvJoin: '加入会议',
  wbOvLive: '进行中',
  wbOvTomorrow: '明天',
  wbOvStatsLabel: '今日概览',
  wbOvStatOpen: '未完成',
  wbOvStatOverdue: '已逾期',
  wbOvStatDueToday: '今天到期',
  wbOvStatMeetingsToday: '今日会议',
  wbOvStatUnread: '未读',
  wbOvLoadFailed: '未能加载',
  wbOvRecentDocs: '最近的文档',
  wbOvMyWork: '我的任务',
  wbOvMyWorkEmpty: '没有分配给你的未完成任务。',
  wbOvMarkDone: '标记完成：{title}',
  wbOvDueOverdue: '逾期 {count} 天',
  wbOvDueToday: '今天到期',
  wbOvDueOn: '{date} 到期',
  wbOvMeetings: '即将开始的会议',
  wbOvMeetingsEmpty: '今天和明天没有会议。',
  wbOvInbox: '通知',
  wbOvInboxEmpty: '没有等你处理的通知。',
  wbOvQuiet: '没有待处理的事项',
  wbOvQuietAction: '新建',
  wbOvUpdatedAt: '更新于 {time}',
  wbOvSignedOutTitle: '登录后查看你的工作',
  wbOvSignedOutBody: '任务、会议和通知来自你的 UniWork 账户。',
  wbOvForbiddenTitle: '你已无法访问此工作区',
  wbOvForbiddenBody: '请在上方栏中选择其他工作区。',
  wbOvOfflineTitle: '无法连接 UniWork',
  wbOvOfflineBody: '请检查网络连接后重试。',
  wbOvNoWorkspaceTitle: '你还没有加入任何工作区',
  wbOvNoWorkspaceAction: '在网页上设置',
  wbOvTaskUpdateFailed: '无法更新任务，已撤销更改。',
  wbOvDismiss: '关闭',
EOF
cat > "$K/t13-vi.txt" <<'EOF'
  wbOvGreetingMorning: 'Chào buổi sáng, {name}',
  wbOvGreetingNoon: 'Chào buổi trưa, {name}',
  wbOvGreetingAfternoon: 'Chào buổi chiều, {name}',
  wbOvGreetingEvening: 'Chào buổi tối, {name}',
  wbOvHeadlineLive: '“{title}” đang diễn ra.',
  wbOvHeadlinePartial: 'Một phần dữ liệu chưa tải được, số liệu dưới đây có thể thiếu.',
  wbOvHeadlineOverdue: 'Nên xử lý trước: “{title}”, đã quá hạn {count} ngày.',
  wbOvHeadlineOverduePlain: '{count} việc đang quá hạn, bắt đầu từ việc cũ nhất.',
  wbOvHeadlineMeeting: 'Cuộc họp kế tiếp lúc {time}: “{title}”.',
  wbOvHeadlineDueToday: '{count} việc đến hạn hôm nay, chưa có việc nào quá hạn.',
  wbOvHeadlineUnread: 'Không có việc gấp. {count} thông báo đang chờ bạn đọc.',
  wbOvHeadlineClear: 'Hôm nay bạn không có việc gấp.',
  wbOvJoin: 'Vào họp',
  wbOvLive: 'Đang diễn ra',
  wbOvTomorrow: 'Ngày mai',
  wbOvStatsLabel: 'Tổng quan hôm nay',
  wbOvStatOpen: 'Đang mở',
  wbOvStatOverdue: 'Quá hạn',
  wbOvStatDueToday: 'Đến hạn hôm nay',
  wbOvStatMeetingsToday: 'Họp hôm nay',
  wbOvStatUnread: 'Chưa đọc',
  wbOvLoadFailed: 'Không tải được',
  wbOvRecentDocs: 'Tài liệu gần đây',
  wbOvMyWork: 'Việc của tôi',
  wbOvMyWorkEmpty: 'Không có việc nào đang giao cho bạn.',
  wbOvMarkDone: 'Đánh dấu xong: {title}',
  wbOvDueOverdue: 'Quá hạn {count} ngày',
  wbOvDueToday: 'Hạn hôm nay',
  wbOvDueOn: 'Hạn {date}',
  wbOvMeetings: 'Họp sắp tới',
  wbOvMeetingsEmpty: 'Bạn không có cuộc họp nào hôm nay và ngày mai.',
  wbOvInbox: 'Thông báo',
  wbOvInboxEmpty: 'Không có thông báo nào đang chờ bạn.',
  wbOvQuiet: 'Không có việc nào đang chờ',
  wbOvQuietAction: 'Soạn mới',
  wbOvUpdatedAt: 'Cập nhật lúc {time}',
  wbOvSignedOutTitle: 'Đăng nhập để xem công việc của bạn',
  wbOvSignedOutBody: 'Việc, lịch họp và thông báo được lấy từ tài khoản UniWork của bạn.',
  wbOvForbiddenTitle: 'Bạn không còn quyền truy cập không gian làm việc này',
  wbOvForbiddenBody: 'Hãy chọn không gian làm việc khác ở thanh phía trên.',
  wbOvOfflineTitle: 'Không kết nối được UniWork',
  wbOvOfflineBody: 'Hãy kiểm tra kết nối mạng rồi thử lại.',
  wbOvNoWorkspaceTitle: 'Bạn chưa tham gia không gian làm việc nào',
  wbOvNoWorkspaceAction: 'Thiết lập trên web',
  wbOvTaskUpdateFailed: 'Không cập nhật được việc. Đã hoàn tác thay đổi.',
  wbOvDismiss: 'Đóng',
EOF
cat > "$K/t13-en.txt" <<'EOF'
  wbOvGreetingMorning: 'Good morning, {name}',
  wbOvGreetingNoon: 'Good afternoon, {name}',
  wbOvGreetingAfternoon: 'Good afternoon, {name}',
  wbOvGreetingEvening: 'Good evening, {name}',
  wbOvHeadlineLive: '“{title}” is in progress.',
  wbOvHeadlinePartial: 'Part of your data did not load, so the figures below may be incomplete.',
  wbOvHeadlineOverdue: 'Start with “{title}”. Days overdue: {count}.',
  wbOvHeadlineOverduePlain: 'Overdue tasks: {count}. Start with the oldest.',
  wbOvHeadlineMeeting: 'Next meeting at {time}: “{title}”.',
  wbOvHeadlineDueToday: 'Tasks due today: {count}. Nothing is overdue.',
  wbOvHeadlineUnread: 'Nothing urgent. Unread notifications: {count}.',
  wbOvHeadlineClear: 'Nothing urgent today.',
  wbOvJoin: 'Join',
  wbOvLive: 'In progress',
  wbOvTomorrow: 'Tomorrow',
  wbOvStatsLabel: 'Today at a glance',
  wbOvStatOpen: 'Open',
  wbOvStatOverdue: 'Overdue',
  wbOvStatDueToday: 'Due today',
  wbOvStatMeetingsToday: 'Meetings today',
  wbOvStatUnread: 'Unread',
  wbOvLoadFailed: 'Couldn’t load',
  wbOvRecentDocs: 'Recent documents',
  wbOvMyWork: 'My work',
  wbOvMyWorkEmpty: 'No open work is assigned to you.',
  wbOvMarkDone: 'Mark done: {title}',
  wbOvDueOverdue: 'Days overdue: {count}',
  wbOvDueToday: 'Due today',
  wbOvDueOn: 'Due {date}',
  wbOvMeetings: 'Upcoming meetings',
  wbOvMeetingsEmpty: 'You have no meetings today or tomorrow.',
  wbOvInbox: 'Notifications',
  wbOvInboxEmpty: 'Nothing is waiting for you.',
  wbOvQuiet: 'Nothing is waiting for you',
  wbOvQuietAction: 'Compose',
  wbOvUpdatedAt: 'Updated at {time}',
  wbOvSignedOutTitle: 'Sign in to see your work',
  wbOvSignedOutBody: 'Tasks, meetings and notifications come from your UniWork account.',
  wbOvForbiddenTitle: 'You no longer have access to this workspace',
  wbOvForbiddenBody: 'Choose another workspace in the bar above.',
  wbOvOfflineTitle: 'Couldn’t reach UniWork',
  wbOvOfflineBody: 'Check your connection, then try again.',
  wbOvNoWorkspaceTitle: 'You are not in a workspace yet',
  wbOvNoWorkspaceAction: 'Set up on the web',
  wbOvTaskUpdateFailed: 'Couldn’t update the task. The change was undone.',
  wbOvDismiss: 'Dismiss',
EOF
node "$K/insert.cjs" "$K/t13-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t13-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t13-en.txt" $D/en.ts
npx prettier --write $D
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell && cd apps/shell && npx vitest run strings`
Kết quả mong đợi: typecheck exit 0 vì mọi shard có bộ key của zh; các test `strings*` PASS.

- [ ] **Step 2: Viết test `openUniworkDocument` sẽ fail**

Trong `apps/shell/tests/uniwork-docs-ui.test.ts`, thay l.32:
```ts
import { openRecentEntry } from '../src/renderer/src/uniwork-open'
```
bằng:
```ts
import { openRecentEntry, openUniworkDocument } from '../src/renderer/src/uniwork-open'
```
Thêm sau khối `describe('openRecentEntry', …)`:
```ts
describe('openUniworkDocument', () => {
  it('opens a cloud document by id and reports progress in the notice', async () => {
    const api = {
      uniworkOpenDocument: vi.fn(async () => ({ ok: true as const, value: { path: '/w/Plan.docx' } })),
    }
    const notify = vi.fn()
    await openUniworkDocument({ documentId: 'd1', title: 'Plan' }, api as never, notify)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      { phase: 'opening', title: 'Plan' },
      { phase: 'opened', path: '/w/Plan.docx', title: 'Plan' },
    ])
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-docs-ui.test.ts`
Kết quả mong đợi: FAIL với `openUniworkDocument is not a function`.

- [ ] **Step 3: Tách `openUniworkDocument` trong `uniwork-open.ts`**

Thay phần thân sau dòng `type OpenApi = …` bằng:
```ts
/**
 * Open a UniWork document through UniWork (so the binding, the permission
 * check and a fresh download when needed all apply). Progress and failures
 * land in the tab strip's notice.
 */
export async function openUniworkDocument(
  source: { documentId: string; title: string },
  api: Pick<HomeApi, 'uniworkOpenDocument'>,
  notify: (event: UniworkLaunchEvent) => void = publishUniworkNotice,
): Promise<void> {
  notify({ phase: 'opening', title: source.title })
  try {
    const result = await api.uniworkOpenDocument(source.documentId)
    notify(
      result.ok
        ? { phase: 'opened', path: result.value.path, title: source.title }
        : { phase: 'failed', error: result.error },
    )
  } catch {
    notify({ phase: 'failed', error: 'network' })
  }
}

/**
 * Open a recents row. A UniWork document goes through UniWork and never
 * through its working-copy path; any other row opens as a local file does.
 */
export async function openRecentEntry(
  entry: RecentEntry,
  api: OpenApi,
  notify: (event: UniworkLaunchEvent) => void = publishUniworkNotice,
): Promise<void> {
  if (!entry.uniwork) {
    await api.openPath(entry.path)
    return
  }
  await openUniworkDocument(entry.uniwork, api, notify)
}
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/uniwork-docs-ui.test.ts`
Kết quả mong đợi: PASS. Các test `openRecentEntry` sẵn có không đổi.

- [ ] **Step 4: Viết test hàm thuần sẽ fail**

`apps/shell/tests/work-home.test.ts` (khối `the summary zone decides today near midnight` ở cuối là test ghim cho Review Focus 2):
```ts
import { describe, expect, it } from 'vitest'
import type { RecentEntry, UniworkDocSummary } from '../src/shared/home-api'
import type {
  WorkHomeSummary,
  WorkMeeting,
  WorkNotification,
  WorkTask,
} from '../src/shared/uniwork-work-api'
import {
  buildHeadline,
  dueState,
  greetingKey,
  hourIn,
  inboxTarget,
  isQuiet,
  localDay,
  mergeRecentDocuments,
  notificationKey,
  overdueDays,
  overviewView,
  withTaskStatus,
} from '../src/renderer/src/work-home'

const TODAY = '2026-10-13'

function task(over: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 't1',
    workspace_id: 'w',
    identifier: 'OPS-7',
    title: 'Send the contract',
    status: 'todo',
    priority: 'high',
    due_date: '2026-10-10',
    updated_at: '2026-10-10T08:00:00Z',
    ...over,
  }
}

function meeting(over: Partial<WorkMeeting> = {}): WorkMeeting {
  return {
    id: 'm1',
    workspace_id: 'w',
    title: 'Weekly sync',
    starts_at: '2026-10-13T08:00:00Z',
    ends_at: '2026-10-13T09:00:00Z',
    status: 'SCHEDULED',
    ...over,
  }
}

const ZERO = { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 }

function summary(over: Partial<WorkHomeSummary> = {}): WorkHomeSummary {
  return {
    today: TODAY,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: ZERO,
    my_work: [],
    upcoming_meetings: [],
    inbox: [],
    partial: [],
    generated_at: '2026-10-13T03:00:00Z',
    ...over,
  }
}

function note(over: Partial<WorkNotification> = {}): WorkNotification {
  return {
    id: 'n1',
    kind: 'task_assigned',
    workspace_id: 'w',
    resource_type: 'task',
    resource_id: 't9',
    actor_kind: 'user',
    title_key: 'notifications.kind.task_assigned',
    params: {},
    created_at: '2026-10-13T01:00:00Z',
    ...over,
  }
}

describe('greetingKey', () => {
  it.each([
    [0, 'wbOvGreetingMorning'],
    [10, 'wbOvGreetingMorning'],
    [11, 'wbOvGreetingNoon'],
    [13, 'wbOvGreetingNoon'],
    [14, 'wbOvGreetingAfternoon'],
    [17, 'wbOvGreetingAfternoon'],
    [18, 'wbOvGreetingEvening'],
    [23, 'wbOvGreetingEvening'],
  ] as const)('hour %i → %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key)
  })
})

describe('hourIn', () => {
  it('reads the hour in the summary zone', () => {
    expect(hourIn('Asia/Ho_Chi_Minh', new Date('2026-10-13T02:30:00Z'))).toBe(9)
  })
  it('falls back to the device clock for an unknown zone', () => {
    const now = new Date('2026-10-13T02:30:00Z')
    expect(hourIn('Not/AZone', now)).toBe(now.getHours())
  })
})

describe('buildHeadline (port of uniwork core/home/brief.ts)', () => {
  it('puts a live meeting first and carries its id', () => {
    const h = buildHeadline(
      summary({
        counts: { ...ZERO, overdue: 1 },
        partial: ['notifications'],
        upcoming_meetings: [meeting({ status: 'IN_PROGRESS' })],
      }),
    )
    expect(h).toEqual({ key: 'wbOvHeadlineLive', params: { title: 'Weekly sync' }, liveMeetingId: 'm1' })
  })
  it('then a failed source, because its zeros are not true', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, overdue: 1 }, partial: ['tasks'] })).key).toBe(
      'wbOvHeadlinePartial',
    )
  })
  it('then the oldest open overdue task with its days late', () => {
    const h = buildHeadline(
      summary({
        counts: { ...ZERO, overdue: 2 },
        my_work: [task({ id: 'done', status: 'done', due_date: '2026-10-01' }), task()],
      }),
    )
    expect(h).toEqual({ key: 'wbOvHeadlineOverdue', params: { title: 'Send the contract', count: 3 } })
  })
  it('counts overdue work that is not in the list', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, overdue: 2 } }))).toEqual({
      key: 'wbOvHeadlineOverduePlain',
      params: { count: 2 },
    })
  })
  it('then the next meeting of today, with its start to format', () => {
    const h = buildHeadline(
      summary({ counts: { ...ZERO, meetings_today: 1 }, upcoming_meetings: [meeting()] }),
    )
    expect(h).toEqual({
      key: 'wbOvHeadlineMeeting',
      params: { title: 'Weekly sync' },
      at: '2026-10-13T08:00:00Z',
    })
  })
  it('then due today, then unread, then a clear day', () => {
    expect(buildHeadline(summary({ counts: { ...ZERO, due_today: 2, unread: 1 } })).key).toBe(
      'wbOvHeadlineDueToday',
    )
    expect(buildHeadline(summary({ counts: { ...ZERO, unread: 4 } }))).toEqual({
      key: 'wbOvHeadlineUnread',
      params: { count: 4 },
    })
    expect(buildHeadline(summary()).key).toBe('wbOvHeadlineClear')
  })
})

describe('overdueDays and dueState', () => {
  it('counts whole days late; 0 when on time or undated', () => {
    expect(overdueDays(TODAY, '2026-10-10')).toBe(3)
    expect(overdueDays(TODAY, TODAY)).toBe(0)
    expect(overdueDays(TODAY, undefined)).toBe(0)
  })
  it('labels a row overdue, today, later or none (done or undated)', () => {
    expect(dueState(task(), TODAY)).toBe('overdue')
    expect(dueState(task({ due_date: TODAY }), TODAY)).toBe('today')
    expect(dueState(task({ due_date: '2026-10-20' }), TODAY)).toBe('later')
    expect(dueState(task({ due_date: undefined }), TODAY)).toBe('none')
    expect(dueState(task({ status: 'done' }), TODAY)).toBe('none')
  })
})

describe('isQuiet and withTaskStatus', () => {
  it('is quiet only when nothing waits and every source answered', () => {
    expect(isQuiet(summary())).toBe(true)
    expect(isQuiet(summary({ partial: ['tasks'] }))).toBe(false)
    expect(isQuiet(summary({ my_work: [task()] }))).toBe(false)
  })
  it('changes the status of one task only', () => {
    const s = summary({ my_work: [task(), task({ id: 't2' })] })
    expect(withTaskStatus(s, 't2', 'done').my_work.map((t) => t.status)).toEqual(['todo', 'done'])
    expect(s.my_work[1]!.status).toBe('todo')
  })
})

describe('mergeRecentDocuments', () => {
  const doc = (id: string, title: string, format: UniworkDocSummary['format'], updatedAt: string) =>
    ({ id, workspaceId: 'w', title, format, updatedAt }) as UniworkDocSummary
  const entry = (path: string, iso: string, over: Partial<RecentEntry> = {}) =>
    ({ path, name: path.slice(1), ext: 'docx', mtimeMs: Date.parse(iso), sizeBytes: 1, starred: false, ...over }) as RecentEntry

  it('drops files that cannot open, missing files and working copies, newest first', () => {
    const rows = mergeRecentDocuments(
      [doc('d1', 'Plan.docx', 'docx', '2026-10-12T09:00:00Z'), doc('d2', 'Photo.png', null, '2026-10-13T09:00:00Z')],
      [
        entry('/a.docx', '2026-10-11T09:00:00Z'),
        entry('/gone.docx', '2026-10-14T09:00:00Z', { missing: true }),
        entry('/copy.docx', '2026-10-14T09:00:00Z', {
          uniwork: { documentId: 'd1', workspaceId: 'w', title: 'Plan', access: 'edit' },
        }),
      ],
    )
    expect(rows.map((r) => (r.source === 'uniwork' ? r.doc.id : r.entry.path))).toEqual(['d1', '/a.docx'])
  })
  it('shows at most six', () => {
    const local = Array.from({ length: 9 }, (_, i) => entry(`/f${i}.docx`, `2026-10-0${i + 1}T09:00:00Z`))
    expect(mergeRecentDocuments([], local)).toHaveLength(6)
  })
})

describe('notificationKey and inboxTarget', () => {
  it('uses the desktop sentence of a known kind, else the fallback', () => {
    expect(notificationKey('task_assigned')).toBe('wbNotif_task_assigned')
    expect(notificationKey('something_new')).toBe('wbNotifFallback')
    expect(notificationKey('constructor')).toBe('wbNotifFallback')
  })
  it('opens a task or a meeting on the web, anything else in the web inbox', () => {
    const ws = { orgSlug: 'acme', wsSlug: 'team' }
    expect(inboxTarget(note(), ws)).toEqual({ kind: 'task', orgSlug: 'acme', wsSlug: 'team', id: 't9' })
    expect(inboxTarget(note({ resource_type: 'meeting', resource_id: 'm2' }), ws)).toEqual({
      kind: 'meeting',
      orgSlug: 'acme',
      wsSlug: 'team',
      id: 'm2',
    })
    expect(inboxTarget(note({ resource_type: 'document' }), ws)).toEqual({
      kind: 'inbox',
      orgSlug: 'acme',
      wsSlug: 'team',
    })
  })
})

describe('overviewView', () => {
  const ws = [{}]
  const s = summary()
  const v = (
    workspaces: readonly unknown[] | null,
    workspaceError: Parameters<typeof overviewView>[0]['workspaceError'],
    sum: WorkHomeSummary | null,
    error: Parameters<typeof overviewView>[0]['error'],
  ) => overviewView({ workspaces, workspaceError, summary: sum, error })

  it('maps list and summary state to one view (spec §7)', () => {
    expect(v([], 'signed-out', null, null)).toBe('signed-out')
    expect(v([], 'offline', null, null)).toBe('unreachable')
    expect(v(null, null, null, null)).toBe('loading')
    expect(v([], null, null, null)).toBe('no-workspace')
    expect(v(ws, null, null, null)).toBe('loading')
    expect(v(ws, null, s, null)).toBe('ready')
    expect(v(ws, null, s, 'offline')).toBe('stale')
    expect(v(ws, null, s, 'server')).toBe('stale')
    expect(v(ws, null, s, 'forbidden')).toBe('forbidden')
    expect(v(ws, null, null, 'signed-out')).toBe('signed-out')
    expect(v(ws, null, null, 'offline')).toBe('unreachable')
  })
})

describe('the summary zone decides today near midnight', () => {
  it('a meeting just after midnight in the user zone is tomorrow, not today’s headline', () => {
    // 17:30 UTC on the 13th is 00:30 on the 14th in Ho Chi Minh City
    expect(localDay('2026-10-13T17:30:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-10-14')
    const h = buildHeadline(
      summary({
        counts: { ...ZERO, meetings_today: 1, unread: 2 },
        upcoming_meetings: [meeting({ starts_at: '2026-10-13T17:30:00Z' })],
      }),
    )
    expect(h).toEqual({ key: 'wbOvHeadlineUnread', params: { count: 2 } })
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-home.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/work-home"`.

- [ ] **Step 5: Viết `work-home.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecentEntry, UniworkDocSummary } from '../../shared/home-api'
import type {
  UniworkWorkError,
  UniworkWorkResult,
  WorkHomeSummary,
  WorkNotification,
  WorkRecentDocument,
  WorkTask,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { workbenchStrings } from './i18n/strings-workbench'
import type { StringKey } from './locale'
import { isOpenable } from './uniwork-docs-model'
import { currentWorkbenchBucket } from './workbench-bucket'

// window.uniworkWork is declared once, in Home.tsx (Task 8)

// ── Pure helpers (ported from uniwork:packages/core/home/brief.ts and views/home) ──

const DAY_MS = 86_400_000

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

/** whole days a due date lies before `today` (both YYYY-MM-DD); 0 when not overdue */
export function overdueDays(today: string, due: string | undefined): number {
  if (!due) return 0
  const t = dayNumber(today)
  const d = dayNumber(due)
  if (t === null || d === null) return 0
  return Math.max(0, t - d)
}

/** calendar day of an instant in the person's zone, as YYYY-MM-DD */
export function localDay(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return iso.slice(0, 10)
  }
}

/** hour of day (0-23) now, in the given zone when it is a real one */
export function hourIn(timeZone: string | undefined, now = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: timeZone || undefined,
    }).format(now)
    const n = Number.parseInt(h, 10)
    return Number.isNaN(n) ? now.getHours() : n
  } catch {
    return now.getHours()
  }
}

/** wall-clock HH:mm of an instant, in the summary's zone when it names one */
export function clock(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timeZone || undefined }).format(d)
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(d)
  }
}

/** same bands as the web home */
export function greetingKey(hour: number): StringKey {
  if (hour < 11) return 'wbOvGreetingMorning'
  if (hour < 14) return 'wbOvGreetingNoon'
  if (hour < 18) return 'wbOvGreetingAfternoon'
  return 'wbOvGreetingEvening'
}

export interface WorkHeadline {
  key: StringKey
  params: Record<string, string | number>
  /** a meeting start the view formats into {time} */
  at?: string
  /** a meeting in progress, which the header offers to join */
  liveMeetingId?: string
}

function oldestOverdue(summary: WorkHomeSummary): WorkTask | undefined {
  return summary.my_work.find(
    (t) => t.status !== 'done' && overdueDays(summary.today, t.due_date) > 0,
  )
}

function nextMeetingToday(summary: WorkHomeSummary) {
  return summary.upcoming_meetings.find(
    (m) =>
      m.status !== 'IN_PROGRESS' &&
      localDay(m.starts_at, summary.timezone || 'UTC') === summary.today,
  )
}

/**
 * The one sentence under the greeting: a live meeting, then a failed source
 * (its zeros are not true), the oldest overdue task, the next meeting today,
 * what is due today, what is unread, else a clear day.
 */
export function buildHeadline(summary: WorkHomeSummary): WorkHeadline {
  const { counts, today } = summary
  const live = summary.upcoming_meetings.find((m) => m.status === 'IN_PROGRESS')
  if (live) return { key: 'wbOvHeadlineLive', params: { title: live.title }, liveMeetingId: live.id }
  if (summary.partial.length > 0) return { key: 'wbOvHeadlinePartial', params: {} }
  if (counts.overdue > 0) {
    const oldest = oldestOverdue(summary)
    return oldest
      ? {
          key: 'wbOvHeadlineOverdue',
          params: { title: oldest.title, count: overdueDays(today, oldest.due_date) },
        }
      : { key: 'wbOvHeadlineOverduePlain', params: { count: counts.overdue } }
  }
  if (counts.meetings_today > 0) {
    const next = nextMeetingToday(summary)
    if (next) return { key: 'wbOvHeadlineMeeting', params: { title: next.title }, at: next.starts_at }
  }
  if (counts.due_today > 0) return { key: 'wbOvHeadlineDueToday', params: { count: counts.due_today } }
  if (counts.unread > 0) return { key: 'wbOvHeadlineUnread', params: { count: counts.unread } }
  return { key: 'wbOvHeadlineClear', params: {} }
}

export type DueState = 'overdue' | 'today' | 'later' | 'none'

export function dueState(task: WorkTask, today: string): DueState {
  if (task.status === 'done' || !task.due_date) return 'none'
  if (overdueDays(today, task.due_date) > 0) return 'overdue'
  return task.due_date === today ? 'today' : 'later'
}

/** nothing assigned, scheduled or unread, and every source answered */
export function isQuiet(summary: WorkHomeSummary): boolean {
  const c = summary.counts
  return (
    summary.partial.length === 0 &&
    summary.my_work.length === 0 &&
    summary.upcoming_meetings.length === 0 &&
    summary.inbox.length === 0 &&
    c.open + c.overdue + c.due_today + c.meetings_today + c.unread === 0
  )
}

export function withTaskStatus(
  summary: WorkHomeSummary,
  taskId: string,
  status: string,
): WorkHomeSummary {
  return {
    ...summary,
    my_work: summary.my_work.map((t) => (t.id === taskId ? { ...t, status } : t)),
  }
}

/**
 * Cloud documents that open in the editor plus local recents, newest first.
 * A local working copy of a UniWork document is left out: the cloud row opens it.
 */
export function mergeRecentDocuments(
  cloud: readonly UniworkDocSummary[],
  local: readonly RecentEntry[],
  limit = 6,
): WorkRecentDocument[] {
  const rows: { at: number; row: WorkRecentDocument }[] = [
    ...cloud
      .filter(isOpenable)
      .map((doc) => ({ at: Date.parse(doc.updatedAt) || 0, row: { source: 'uniwork' as const, doc } })),
    ...local
      .filter((entry) => !entry.missing && !entry.uniwork)
      .map((entry) => ({ at: entry.mtimeMs, row: { source: 'local' as const, entry } })),
  ]
  return rows
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((r) => r.row)
}

export function inboxTarget(
  n: WorkNotification,
  ws: { orgSlug: string; wsSlug: string },
): WorkWebTarget {
  if (n.resource_type === 'task') return { kind: 'task', ...ws, id: n.resource_id }
  if (n.resource_type === 'meeting') return { kind: 'meeting', ...ws, id: n.resource_id }
  return { kind: 'inbox', ...ws }
}

/** the server sends title_key + params; the desktop keeps one sentence per kind (C10) */
export function notificationKey(kind: string): StringKey {
  const key = `wbNotif_${kind}`
  return Object.hasOwn(workbenchStrings.zh, key) ? (key as StringKey) : 'wbNotifFallback'
}

export type OverviewView =
  | 'loading'
  | 'ready'
  | 'stale'
  | 'no-workspace'
  | 'signed-out'
  | 'forbidden'
  | 'unreachable'

/** which of the spec §7 states the Overview shows */
export function overviewView(i: {
  workspaces: readonly unknown[] | null
  workspaceError: UniworkWorkError | null
  summary: WorkHomeSummary | null
  error: UniworkWorkError | null
}): OverviewView {
  const error = i.workspaceError ?? i.error
  if (error === 'signed-out' || error === 'forbidden') return error
  if (i.workspaceError) return 'unreachable'
  if (i.workspaces === null) return 'loading'
  if (i.workspaces.length === 0) return 'no-workspace'
  if (i.summary) return i.error ? 'stale' : 'ready'
  return i.error ? 'unreachable' : 'loading'
}

/** a rejected IPC call reads as offline (the preload already maps malformed replies) */
export async function settleWork<T>(
  call: Promise<UniworkWorkResult<T>>,
): Promise<UniworkWorkResult<T>> {
  try {
    return await call
  } catch {
    return { ok: false, error: 'offline' }
  }
}

// ── Hooks ──

export const HOME_REFRESH_MS = 60_000

/** last good summary per (bucket, workspace): shown at once and while offline */
const homeCache = new Map<string, { summary: WorkHomeSummary; at: number }>()
const cacheKey = (workspaceId: string) => `${currentWorkbenchBucket()}|${workspaceId}`

interface HomeState {
  summary: WorkHomeSummary | null
  updatedAt: number | null
  error: UniworkWorkError | null
}

function fromCache(workspaceId: string | null): HomeState {
  const hit = workspaceId ? homeCache.get(cacheKey(workspaceId)) : undefined
  return { summary: hit?.summary ?? null, updatedAt: hit?.at ?? null, error: null }
}

export interface WorkHome extends HomeState {
  reload: () => void
  /** optimistic edit of the summary on screen (the cache keeps server truth) */
  update: (edit: (summary: WorkHomeSummary) => WorkHomeSummary) => void
}

/** GET /home for the workspace: on mount (tab open), refreshTick, window focus, and every 60 s while visible */
export function useWorkHome(workspaceId: string | null, refreshTick: number): WorkHome {
  const [state, setState] = useState<HomeState>(() => fromCache(workspaceId))
  const seq = useRef(0)

  const reload = useCallback(() => {
    const mine = ++seq.current
    if (!workspaceId) return
    void settleWork(window.uniworkWork.homeSummary(workspaceId)).then((result) => {
      if (mine !== seq.current) return
      if (result.ok) {
        const entry = { summary: result.value, at: Date.now() }
        homeCache.set(cacheKey(workspaceId), entry)
        setState({ summary: entry.summary, updatedAt: entry.at, error: null })
      } else {
        setState((s) => ({ ...s, error: result.error }))
      }
    })
  }, [workspaceId])

  useEffect(() => {
    setState(fromCache(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    reload()
  }, [reload, refreshTick])

  useEffect(() => {
    const onFocus = () => reload()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, HOME_REFRESH_MS)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [reload])

  const update = useCallback((edit: (summary: WorkHomeSummary) => WorkHomeSummary) => {
    setState((s) => (s.summary ? { ...s, summary: edit(s.summary) } : s))
  }, [])

  return { ...state, reload, update }
}

/** "Tài liệu gần đây": the workspace's cloud recents (signed in) plus this device's recents */
export function useRecentDocuments(
  workspaceId: string | null,
  refreshTick: number,
): WorkRecentDocument[] {
  const [docs, setDocs] = useState<WorkRecentDocument[]>([])
  useEffect(() => {
    let live = true
    const local = window.aiOffice.recents({ limit: 12 }).then(
      (page) => page.entries,
      () => [] as RecentEntry[],
    )
    const cloud = workspaceId
      ? window.aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }).then(
          (r) => (r.ok ? r.value.documents : []),
          () => [] as UniworkDocSummary[],
        )
      : Promise.resolve([] as UniworkDocSummary[])
    void Promise.all([cloud, local]).then(([c, l]) => {
      if (live) setDocs(mergeRecentDocuments(c, l))
    })
    return () => {
      live = false
    }
  }, [workspaceId, refreshTick])
  return docs
}
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-home.test.ts`
Kết quả mong đợi: PASS.

- [ ] **Step 6: Commit các hàm hỗ trợ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run format
git add apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/uniwork-open.ts apps/shell/src/renderer/src/i18n/workbench apps/shell/tests/work-home.test.ts apps/shell/tests/uniwork-docs-ui.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Workbench home data hook and headline helpers

useWorkHome caches the server Home summary per bucket and workspace and
refreshes on open, focus, Refresh and every 60 s while visible; the
headline and greeting follow the web home's logic.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Viết test component Tổng quan sẽ fail**

`apps/shell/tests/work-overview.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, RecentEntry, UniworkDocSummary, UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi, WorkHomeSummary, WorkTask } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkOverview } from '../src/renderer/src/WorkOverview'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-10-13'

function task(over: Partial<WorkTask> = {}): WorkTask {
  return {
    id: 't1',
    workspace_id: 'w',
    identifier: 'OPS-7',
    title: 'Send the contract',
    status: 'todo',
    priority: 'high',
    due_date: '2026-10-10',
    updated_at: '2026-10-10T08:00:00Z',
    ...over,
  }
}

function summary(over: Partial<WorkHomeSummary> = {}): WorkHomeSummary {
  return {
    today: TODAY,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: { open: 4, overdue: 1, due_today: 2, meetings_today: 1, unread: 3 },
    my_work: [task()],
    upcoming_meetings: [
      {
        id: 'm1',
        workspace_id: 'w',
        title: 'Weekly sync',
        starts_at: '2026-10-13T02:00:00Z',
        ends_at: '2026-10-13T03:00:00Z',
        status: 'IN_PROGRESS',
      },
    ],
    inbox: [
      {
        id: 'n1',
        kind: 'task_assigned',
        workspace_id: 'w',
        resource_type: 'task',
        resource_id: 't9',
        actor_kind: 'user',
        title_key: 'notifications.kind.task_assigned',
        params: { actor: 'Linh', task: 'Draft the quote' },
        created_at: '2026-10-13T01:00:00Z',
      },
    ],
    partial: [],
    generated_at: '2026-10-13T03:00:00Z',
    ...over,
  }
}

const CLOUD: UniworkDocSummary = {
  id: 'd1',
  workspaceId: 'w',
  title: 'Plan.docx',
  format: 'docx',
  updatedAt: '2026-10-12T09:00:00Z',
}
const LOCAL = {
  path: '/docs/notes.docx',
  name: 'notes.docx',
  ext: 'docx',
  mtimeMs: Date.parse('2026-10-11T09:00:00Z'),
  sizeBytes: 10,
  starred: false,
} as RecentEntry

let host: HTMLDivElement
let root: Root
let work: {
  homeSummary: ReturnType<typeof vi.fn<UniworkWorkApi['homeSummary']>>
  setTaskStatus: ReturnType<typeof vi.fn<UniworkWorkApi['setTaskStatus']>>
  openWeb: ReturnType<typeof vi.fn<UniworkWorkApi['openWeb']>>
}
let api: Record<string, ReturnType<typeof vi.fn>>
let wsSeq = 0

// each test gets its own workspace id: the summary cache lives at module level
function workspace(): UniworkWorkspaceRef {
  wsSeq += 1
  return { id: `w${wsSeq}`, name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'acme' }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  work = {
    homeSummary: vi.fn<UniworkWorkApi['homeSummary']>(async () => ({ ok: true, value: summary() })),
    setTaskStatus: vi.fn<UniworkWorkApi['setTaskStatus']>(async () => ({
      ok: true,
      value: task({ status: 'done' }),
    })),
    openWeb: vi.fn<UniworkWorkApi['openWeb']>(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
  api = {
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [LOCAL], total: 1, totalAll: 1 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [CLOUD], nextCursor: null },
    })),
    uniworkOpenDocument: vi.fn(async () => ({ ok: true, value: { path: '/w/Plan.docx' } })),
    openPath: vi.fn(async () => undefined),
    setLanguage: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type Props = Parameters<typeof WorkOverview>[0]

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function render(props: Props): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(WorkOverview, props)))
  })
  await flush()
}

async function mount(over: Partial<Props> = {}): Promise<Props> {
  const ws = workspace()
  const props: Props = {
    workspaces: [ws],
    workspaceId: ws.id,
    workspaceError: null,
    refreshTick: 0,
    onReload: vi.fn(),
    onCompose: vi.fn(),
    ...over,
  }
  await render(props)
  return props
}

async function click(el: Element | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const text = () => host.textContent ?? ''
const buttons = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.textContent?.trim() === label,
  )
const stat = (key: string) => host.querySelector(`[data-testid="wb-stat-${key}"]`)?.textContent

describe('WorkOverview', () => {
  it('full: greeting, headline, five counts, my work, a live meeting, the inbox and recents', async () => {
    const props = await mount()
    expect(host.querySelector('.wb-ov-greeting')?.textContent).toContain('Linh')
    expect(text()).toContain('“Weekly sync” is in progress.')
    expect(['open', 'overdue', 'due_today', 'meetings_today', 'unread'].map(stat)).toEqual([
      '4',
      '1',
      '2',
      '1',
      '3',
    ])
    expect(text()).toContain('Send the contract')
    expect(text()).toContain('OPS-7')
    expect(text()).toContain('Days overdue: 3')
    expect(text()).toContain('Linh assigned you “Draft the quote”')
    expect(text()).toContain('Plan.docx')
    expect(text()).toContain('notes.docx')
    expect(text()).toContain('On this device')
    expect(api.uniworkListDocuments).toHaveBeenCalledWith({ workspaceId: props.workspaceId, limit: 20 })

    await click(buttons('Join')[0])
    expect(work.openWeb).toHaveBeenCalledWith({ kind: 'room', orgSlug: 'acme', wsSlug: 'team', id: 'm1' })

    const cloudCard = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Plan.docx'),
    )
    await click(cloudCard)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
  })

  it('partial: the failed source shows a dash and Retry, never a zero', async () => {
    work.homeSummary.mockResolvedValue({
      ok: true,
      value: summary({
        partial: ['meetings'],
        counts: { open: 4, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
        upcoming_meetings: [],
        inbox: [],
      }),
    })
    await mount()
    expect(stat('meetings_today')).toBeUndefined()
    expect(text()).toContain('—')
    expect(text()).toContain('Part of your data did not load')
    expect(text()).toContain('Couldn’t load')
    await click(buttons('Retry')[0])
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
  })

  it('quiet: one line and a shortcut to Compose instead of empty lists', async () => {
    work.homeSummary.mockResolvedValue({
      ok: true,
      value: summary({
        counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
        my_work: [],
        upcoming_meetings: [],
        inbox: [],
      }),
    })
    const props = await mount()
    expect(text()).toContain('Nothing is waiting for you')
    expect(host.querySelector('.wb-ov-stats')).toBeNull()
    await click(buttons('Compose')[0])
    expect(props.onCompose).toHaveBeenCalledTimes(1)
  })

  it('signed out: one sign-in panel and only this device’s recents', async () => {
    await mount({ workspaces: [], workspaceId: null, workspaceError: 'signed-out' })
    expect(work.homeSummary).not.toHaveBeenCalled()
    expect(api.uniworkListDocuments).not.toHaveBeenCalled()
    expect(text()).toContain('Sign in to see your work')
    expect(text()).toContain('notes.docx')
    expect(text()).toContain('On this device')
    await click(buttons('Sign in to UniWork')[0])
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('offline after a load: keeps the cached data and says when it was updated', async () => {
    const props = await mount()
    expect(text()).toContain('Send the contract')
    work.homeSummary.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await render({ ...props, refreshTick: 1 })
    expect(work.homeSummary).toHaveBeenCalledTimes(2)
    expect(text()).toContain('Send the contract')
    expect(text()).toContain('Updated at')
  })

  it('offline with nothing cached: an empty state with Retry', async () => {
    work.homeSummary.mockResolvedValue({ ok: false, error: 'offline' })
    const props = await mount()
    expect(text()).toContain('Couldn’t reach UniWork')
    await click(buttons('Retry')[0])
    expect(props.onReload).toHaveBeenCalledTimes(1)
  })

  it('forbidden: says access was lost and suggests another workspace', async () => {
    work.homeSummary.mockResolvedValue({ ok: false, error: 'forbidden' })
    await mount()
    expect(text()).toContain('You no longer have access to this workspace')
    expect(text()).not.toContain('Send the contract')
  })

  it('done checkbox: stays checked when the server accepts', async () => {
    await mount()
    await click(host.querySelector('input[type="checkbox"]') ?? undefined)
    expect(work.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('done checkbox: rolls back and offers Retry when the server refuses', async () => {
    work.setTaskStatus.mockResolvedValue({ ok: false, error: 'server' })
    await mount()
    await click(host.querySelector('input[type="checkbox"]') ?? undefined)
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    const alert = host.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Couldn’t update the task')
    await click(buttons('Retry').find((b) => alert.contains(b)))
    expect(work.setTaskStatus).toHaveBeenCalledTimes(2)
    expect(work.setTaskStatus).toHaveBeenLastCalledWith('t1', 'done')
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-overview.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/WorkOverview"`.

- [ ] **Step 8: Viết `WorkOverview.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkHomeCounts,
  WorkHomeSource,
  WorkHomeSummary,
  WorkTask,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openRecentEntry, openUniworkDocument } from './uniwork-open'
import {
  buildHeadline,
  clock,
  dueState,
  greetingKey,
  hourIn,
  inboxTarget,
  isQuiet,
  localDay,
  notificationKey,
  overdueDays,
  overviewView,
  settleWork,
  useRecentDocuments,
  useWorkHome,
  withTaskStatus,
} from './work-home'

interface Props {
  /** null while the list loads */
  workspaces: readonly UniworkWorkspaceRef[] | null
  workspaceId: string | null
  workspaceError: UniworkWorkError | null
  refreshTick: number
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  onCompose: () => void
}

const STATS: readonly {
  key: keyof WorkHomeCounts
  source: WorkHomeSource
  label: StringKey
  tone?: 'danger' | 'warning'
  section: string
}[] = [
  { key: 'open', source: 'tasks', label: 'wbOvStatOpen', section: 'wb-ov-mywork' },
  { key: 'overdue', source: 'tasks', label: 'wbOvStatOverdue', tone: 'danger', section: 'wb-ov-mywork' },
  { key: 'due_today', source: 'tasks', label: 'wbOvStatDueToday', tone: 'warning', section: 'wb-ov-mywork' },
  { key: 'meetings_today', source: 'meetings', label: 'wbOvStatMeetingsToday', section: 'wb-ov-meetings' },
  { key: 'unread', source: 'notifications', label: 'wbOvStatUnread', section: 'wb-ov-inbox' },
]

/** a YYYY-MM-DD day as the summary names it (its own zone, not the device's) */
function formatDay(day: string, locale: string, long: boolean): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat(
    locale,
    long
      ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' },
  ).format(date)
}

/** Tổng quan: the desktop window onto UniWork Home (spec §6.3, states §7). */
export function WorkOverview({
  workspaces,
  workspaceId,
  workspaceError,
  refreshTick,
  onReload,
  onCompose,
}: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const home = useWorkHome(workspace?.id ?? null, refreshTick)
  const recents = useRecentDocuments(workspace?.id ?? null, refreshTick)
  const [name, setName] = useState('')
  const [failedWrite, setFailedWrite] = useState<{ task: WorkTask; status: string } | null>(null)
  const view = overviewView({ workspaces, workspaceError, summary: home.summary, error: home.error })
  const shown = view === 'ready' || view === 'stale' ? home.summary : null
  const base = workspace ? { orgSlug: workspace.orgSlug, wsSlug: workspace.slug } : null

  useEffect(() => {
    void window.aiOffice.accountStatus().then(
      (status) => setName(status.profile?.displayName ?? ''),
      () => undefined,
    )
  }, [])

  const openWeb = (target: WorkWebTarget) => {
    void window.uniworkWork.openWeb(target).catch(() => false)
  }
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: 'start' })

  const setStatus = async (task: WorkTask, status: string) => {
    setFailedWrite(null)
    home.update((s) => withTaskStatus(s, task.id, status))
    const result = await settleWork(window.uniworkWork.setTaskStatus(task.id, status))
    if (result.ok) return
    home.update((s) => withTaskStatus(s, task.id, task.status))
    setFailedWrite({ task, status })
  }

  const retryLine = (
    <p className="wb-ov-partial">
      {t('wbOvLoadFailed')} ·{' '}
      <button type="button" className="wb-link" onClick={home.reload}>
        {t('acctRetry')}
      </button>
    </p>
  )

  const state = (
    title: StringKey,
    body: StringKey | null,
    action?: { label: StringKey; run: () => void },
  ) => (
    <div className="wb-ov-state" role="status">
      <h3>{t(title)}</h3>
      {body ? <p>{t(body)}</p> : null}
      {action ? (
        <button type="button" className="btn btn-primary" onClick={action.run}>
          {t(action.label)}
        </button>
      ) : null}
    </div>
  )

  const header = (s: WorkHomeSummary): ReactNode => {
    const headline = buildHeadline(s)
    const liveId = headline.liveMeetingId
    const time = headline.at ? { time: clock(headline.at, dateLocale, s.timezone) } : {}
    return (
      <header className="wb-ov-head">
        <p className="wb-ov-date">{formatDay(s.today, dateLocale, true)}</p>
        <h2 className="wb-ov-greeting">{t(greetingKey(hourIn(s.timezone)), { name })}</h2>
        <div className="wb-ov-headline">
          <p>{t(headline.key, { ...headline.params, ...time })}</p>
          {liveId && base ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openWeb({ kind: 'room', ...base, id: liveId })}
            >
              {t('wbOvJoin')}
            </button>
          ) : null}
        </div>
        {view === 'stale' && home.updatedAt !== null ? (
          <p className="wb-ov-stale">
            {t('wbOvUpdatedAt', { time: clock(new Date(home.updatedAt).toISOString(), dateLocale) })}{' '}
            ·{' '}
            <button type="button" className="wb-link" onClick={home.reload}>
              {t('acctRetry')}
            </button>
          </p>
        ) : null}
      </header>
    )
  }

  const stats = (s: WorkHomeSummary) => (
    <ul className="wb-ov-stats" aria-label={t('wbOvStatsLabel')}>
      {STATS.map((item) => {
        const value = s.counts[item.key]
        return (
          <li key={item.key} className="wb-ov-stat">
            {s.partial.includes(item.source) ? (
              <div className="wb-ov-stat-body">
                <span className="wb-ov-stat-value is-muted">—</span>
                <span className="wb-ov-stat-label">{t(item.label)}</span>
                <button type="button" className="wb-link" onClick={home.reload}>
                  {t('acctRetry')}
                </button>
              </div>
            ) : (
              <button type="button" className="wb-ov-stat-body" onClick={() => jump(item.section)}>
                <span
                  className={`wb-ov-stat-value${value > 0 && item.tone ? ` is-${item.tone}` : ''}`}
                  data-testid={`wb-stat-${item.key}`}
                >
                  {value}
                </span>
                <span className="wb-ov-stat-label">{t(item.label)}</span>
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )

  const myWork = (s: WorkHomeSummary) => (
    <section id="wb-ov-mywork" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMyWork')}</h3>
      {s.partial.includes('tasks') ? (
        retryLine
      ) : s.my_work.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvMyWorkEmpty')}</p>
      ) : (
        <ul className="wb-ov-list">
          {s.my_work.map((task) => {
            const done = task.status === 'done'
            const due = dueState(task, s.today)
            return (
              <li key={task.id} className={`wb-ov-row${done ? ' is-done' : ''}`}>
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={t('wbOvMarkDone', { title: task.title })}
                  onChange={() => void setStatus(task, done ? 'todo' : 'done')}
                />
                <button
                  type="button"
                  className="wb-ov-row-title"
                  onClick={() => base && openWeb({ kind: 'task', ...base, id: task.id })}
                >
                  {task.title}
                </button>
                {task.identifier ? <span className="wb-ov-row-meta">{task.identifier}</span> : null}
                {due === 'overdue' ? (
                  <span className="wb-pill is-danger">
                    {t('wbOvDueOverdue', { count: overdueDays(s.today, task.due_date) })}
                  </span>
                ) : due === 'today' ? (
                  <span className="wb-pill is-warning">{t('wbOvDueToday')}</span>
                ) : due === 'later' && task.due_date ? (
                  <span className="wb-pill">
                    {t('wbOvDueOn', { date: formatDay(task.due_date, dateLocale, false) })}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const meetings = (s: WorkHomeSummary) => (
    <section id="wb-ov-meetings" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMeetings')}</h3>
      {s.partial.includes('meetings') ? (
        retryLine
      ) : s.upcoming_meetings.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvMeetingsEmpty')}</p>
      ) : (
        <ul className="wb-ov-list">
          {s.upcoming_meetings.map((m) => {
            const live = m.status === 'IN_PROGRESS'
            const tomorrow = localDay(m.starts_at, s.timezone || 'UTC') !== s.today
            return (
              <li key={m.id} className="wb-ov-row">
                <span className="wb-ov-row-meta">
                  {tomorrow ? `${t('wbOvTomorrow')} ` : ''}
                  {clock(m.starts_at, dateLocale, s.timezone)}
                </span>
                <button
                  type="button"
                  className="wb-ov-row-title"
                  onClick={() => base && openWeb({ kind: 'meeting', ...base, id: m.id })}
                >
                  {m.title}
                </button>
                {live ? (
                  <>
                    <span className="wb-pill is-success">{t('wbOvLive')}</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => base && openWeb({ kind: 'room', ...base, id: m.id })}
                    >
                      {t('wbOvJoin')}
                    </button>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const inbox = (s: WorkHomeSummary) => (
    <section id="wb-ov-inbox" className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvInbox')}</h3>
      {s.partial.includes('notifications') ? (
        retryLine
      ) : s.inbox.length === 0 ? (
        <p className="wb-ov-note">{t('wbOvInboxEmpty')}</p>
      ) : (
        <ul className="wb-ov-list">
          {s.inbox.map((n) => (
            <li key={n.id} className="wb-ov-row">
              <button
                type="button"
                className="wb-ov-row-title"
                onClick={() => base && openWeb(inboxTarget(n, base))}
              >
                {t(notificationKey(n.kind), n.params)}
              </button>
              <span className="wb-ov-row-meta">{formatWhen(n.created_at, dateLocale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  const recentStrip = (
    <section className="wb-ov-recents">
      <h3 className="wb-ov-card-title">{t('wbOvRecentDocs')}</h3>
      <ul className="wb-ov-recent-grid">
        {recents.map((r) =>
          r.source === 'uniwork' ? (
            <li key={`u:${r.doc.id}`}>
              <button
                type="button"
                className="wb-ov-recent"
                onClick={() =>
                  void openUniworkDocument({ documentId: r.doc.id, title: r.doc.title }, window.aiOffice)
                }
              >
                <FileBadge ext={docExtension(r.doc)} size={24} />
                <span className="wb-ov-recent-name">{r.doc.title}</span>
                <span className="wb-ov-recent-meta">{formatWhen(r.doc.updatedAt, dateLocale)}</span>
              </button>
            </li>
          ) : (
            <li key={`l:${r.entry.path}`}>
              <button
                type="button"
                className="wb-ov-recent"
                onClick={() => void openRecentEntry(r.entry, window.aiOffice)}
              >
                <FileBadge ext={r.entry.ext} size={24} />
                <span className="wb-ov-recent-name">{r.entry.name}</span>
                <span className="wb-ov-recent-meta">
                  {formatWhen(new Date(r.entry.mtimeMs).toISOString(), dateLocale)} ·{' '}
                  {t('wbOnThisDevice')}
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  )

  return (
    <div className="wb-ov">
      {shown ? header(shown) : null}
      {view === 'loading' ? (
        <div className="wb-ov-skel" aria-hidden="true">
          <span className="uw-skel uw-skel-line short" />
          <span className="uw-skel uw-skel-line" />
          <span className="uw-skel uw-skel-line" />
        </div>
      ) : null}
      {view === 'signed-out'
        ? state('wbOvSignedOutTitle', 'wbOvSignedOutBody', {
            label: 'acctSignInUniwork',
            run: () => void window.aiOffice.accountLogin(),
          })
        : null}
      {view === 'forbidden' ? state('wbOvForbiddenTitle', 'wbOvForbiddenBody') : null}
      {view === 'unreachable'
        ? state('wbOvOfflineTitle', 'wbOvOfflineBody', { label: 'acctRetry', run: onReload })
        : null}
      {view === 'no-workspace'
        ? state('wbOvNoWorkspaceTitle', null, {
            label: 'wbOvNoWorkspaceAction',
            run: () => openWeb({ kind: 'onboarding' }),
          })
        : null}
      {shown && !isQuiet(shown) ? stats(shown) : null}
      {recents.length > 0 ? recentStrip : null}
      {shown ? (
        isQuiet(shown) ? (
          <div className="wb-ov-quiet" role="status">
            <span>{t('wbOvQuiet')}</span>
            <button type="button" className="btn btn-secondary" onClick={onCompose}>
              {t('wbOvQuietAction')}
            </button>
          </div>
        ) : (
          <div className="wb-ov-body">
            {myWork(shown)}
            <div className="wb-ov-aside">
              {meetings(shown)}
              {inbox(shown)}
            </div>
          </div>
        )
      ) : null}
      {failedWrite ? (
        <div className="wb-toast" role="alert">
          <span>{t('wbOvTaskUpdateFailed')}</span>
          <button
            type="button"
            className="wb-link"
            onClick={() => void setStatus(failedWrite.task, failedWrite.status)}
          >
            {t('acctRetry')}
          </button>
          <button type="button" className="wb-link" onClick={() => setFailedWrite(null)}>
            {t('wbOvDismiss')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 9: Chạy test Tổng quan và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-overview.test.ts tests/work-home.test.ts`
Kết quả mong đợi: PASS (9 test component cùng toàn bộ test hàm thuần).

- [ ] **Step 10: CSS của Tổng quan (chỉ token)**

Trong `home.css`, ngay sau rule `.wb-new-item:hover, .wb-new-item:focus-visible { … }` của Task 12, thêm:
```css
/* ── Workbench Overview (desk tab) ── */
.wb-ov {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wb-ov-date {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.wb-ov-greeting {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}

.wb-ov-headline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 4px;
}

.wb-ov-headline p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.wb-ov-stale,
.wb-ov-note,
.wb-ov-partial {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.wb-ov-partial {
  color: var(--danger-text);
}

.wb-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.wb-link:hover {
  text-decoration: underline;
}

.wb-ov-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-ov-stat {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.wb-ov-stat-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

button.wb-ov-stat-body {
  cursor: pointer;
  transition: background 150ms ease;
}

button.wb-ov-stat-body:hover {
  background: var(--hover);
}

.wb-ov-stat-value {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.wb-ov-stat-value.is-danger {
  color: var(--danger);
}

.wb-ov-stat-value.is-warning {
  color: var(--warning-text);
}

.wb-ov-stat-value.is-muted {
  color: var(--text-tertiary);
}

.wb-ov-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.wb-ov-body {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .wb-ov-body {
    grid-template-columns: 1fr;
  }
}

.wb-ov-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.wb-ov-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--surface);
}

.wb-ov-card-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.wb-ov-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-ov-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 6px;
  border-radius: var(--radius-6);
}

.wb-ov-row:hover {
  background: var(--hover);
}

.wb-ov-row input[type='checkbox'] {
  margin: 0;
  accent-color: var(--accent);
}

.wb-ov-row.is-done {
  opacity: 0.6;
}

.wb-ov-row.is-done .wb-ov-row-title {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.wb-ov-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.wb-ov-row-title:hover {
  text-decoration: underline;
}

.wb-ov-row-meta {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.wb-pill {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  padding: 1px 6px;
  border-radius: var(--radius-6);
  background: var(--tint-gray);
  color: var(--tint-gray-fg);
  font-size: 11px;
  font-weight: 500;
}

.wb-pill.is-danger {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.wb-pill.is-warning {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.wb-pill.is-success {
  background: var(--success-bg);
  color: var(--success);
}

.wb-ov-recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-ov-recent {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  column-gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

.wb-ov-recent > :first-child {
  grid-row: 1 / span 2;
}

.wb-ov-recent:hover {
  background: var(--hover);
  border-color: var(--border-hover);
}

.wb-ov-recent-name,
.wb-ov-recent-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-ov-recent-name {
  font-size: 13px;
  font-weight: 500;
}

.wb-ov-recent-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.wb-ov-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-12);
}

.wb-ov-state h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.wb-ov-state p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.wb-ov-quiet {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-secondary);
}

.wb-ov-skel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
}

.wb-toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--surface);
  box-shadow: var(--shadow-menu);
  color: var(--text);
  font-size: 13px;
  transform: translateX(-50%);
}
```

- [ ] **Step 11: Gắn Tổng quan vào `PracticeHome` và bỏ `DeskPane`**

1. Import của `PracticeHome.tsx`: sau import `active-workspace`, thêm:
   ```ts
   import { workErrorOfDocCode, type UniworkWorkError } from '../../shared/uniwork-work-api'
   import { WorkOverview } from './WorkOverview'
   ```

2. Effect workspace (thêm ở Task 12). Sau dòng `const [workspaceId, setWorkspaceId] = useState<string | null>(null)`, thêm:
   ```ts
     const [workspaceError, setWorkspaceError] = useState<UniworkWorkError | null>(null)
   ```
   Rồi thay:
   ```ts
         (result) => {
           if (!live) return
           const items = result.ok ? result.value : []
           setWorkspaces(items)
           setWorkspaceId(pickActiveWorkspace(items, readActiveWorkspaceId()))
         },
         () => {
           if (live) setWorkspaces([])
         },
   ```
   bằng:
   ```ts
         (result) => {
           if (!live) return
           const items = result.ok ? result.value : []
           setWorkspaces(items)
           setWorkspaceError(result.ok ? null : workErrorOfDocCode(result.error))
           setWorkspaceId(pickActiveWorkspace(items, readActiveWorkspaceId()))
         },
         () => {
           if (!live) return
           setWorkspaces([])
           setWorkspaceError('offline')
         },
   ```

3. Sau `const refresh = () => { … }`, thêm (`pinPillar` đã được import từ `./workbench-pins`):
   ```ts
     const openCompose = () => {
       pinPillar(practice.id, 'compose')
       window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
       setTab('compose')
     }
   ```

4. Bộ chuyển pane. Thay:
   ```tsx
         {isWorkbenchModuleId(tab) ? (
           <WorkbenchModulePane
   ```
   bằng:
   ```tsx
         {tab === 'desk' ? (
           <WorkOverview
             workspaces={workspaces}
             workspaceId={workspaceId}
             workspaceError={workspaceError}
             refreshTick={refreshTick}
             onReload={refresh}
             onCompose={openCompose}
           />
         ) : isWorkbenchModuleId(tab) ? (
           <WorkbenchModulePane
   ```

5. `WorkbenchModulePanes.tsx`:
   - xóa `import { DeskPane } from './DeskPane'`;
   - xóa `{moduleId === 'desk' && <DeskPane practiceId={practiceId} vi={vi} />}`;
   - đổi `const hideChrome = moduleId === 'desk' || moduleId === 'notes'` (kết quả của Task 2) thành `const hideChrome = moduleId === 'notes'`.

6. `packages/practice-core/src/modules.ts`, trong mục `desk` (giá trị sau Task 2):
   ```ts
       labelVi: 'Không gian của tôi',
       labelEn: 'My Space',
       hintVi: 'Tổng hợp việc và lịch — chỉ số, nhắc, biểu đồ',
       hintEn: 'Tasks and calendar at a glance — KPIs, reminders, charts',
   ```
   →
   ```ts
       labelVi: 'Tổng quan',
       labelEn: 'Overview',
       hintVi: 'Việc, lịch họp và thông báo hôm nay',
       hintEn: 'Today’s work, meetings and notifications',
   ```

7. Xóa code desk cũ:
   ```bash
   cd /Users/ducquang/UNICOM/uniwork-office
   git rm apps/shell/src/renderer/src/DeskPane.tsx apps/shell/src/renderer/src/workbench-desk.ts apps/shell/src/renderer/src/workbench-reminders.ts
   ```

8. Xóa CSS desk trong `home.css` bằng script gỡ rule (Task 14, 15, 17 dùng lại script này; nếu thư mục tạm bị xóa, tạo lại từ đây):
   ```bash
   mkdir -p "${TMPDIR:-/tmp}/wb-css"
   cat > "${TMPDIR:-/tmp}/wb-css/strip-css-rules.cjs" <<'EOF'
   // usage: node strip-css-rules.cjs <file.css> <class-prefix>... [--vars <var-prefix>...]
   // Drops every selector whose first compound starts with a class prefix (a rule
   // left with none is removed), every custom property starting with a var prefix,
   // then at-rules left empty.
   const fs = require('node:fs')
   const postcss = require('postcss')
   const [file, ...rest] = process.argv.slice(2)
   const cut = rest.indexOf('--vars')
   const classes = cut < 0 ? rest : rest.slice(0, cut)
   const vars = cut < 0 ? [] : rest.slice(cut + 1)
   const hit = (sel) => {
     const head = sel.trim().split(/[\s>+~]/)[0]
     return classes.some((p) => head === p || ['-', '.', ':', '['].some((c) => head.startsWith(p + c)))
   }
   const root = postcss.parse(fs.readFileSync(file, 'utf8'))
   let rules = 0
   let decls = 0
   root.walkRules((rule) => {
     if (rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
     const keep = rule.selectors.filter((s) => !hit(s))
     if (keep.length === rule.selectors.length) return
     rules++
     if (keep.length === 0) rule.remove()
     else rule.selectors = keep
   })
   root.walkDecls((d) => {
     if (vars.some((v) => d.prop.startsWith(v))) {
       d.remove()
       decls++
     }
   })
   root.walkAtRules((at) => {
     if (at.nodes && at.nodes.length === 0) at.remove()
   })
   fs.writeFileSync(file, root.toString())
   console.log(`rules touched: ${rules}, vars removed: ${decls}`)
   EOF
   cd /Users/ducquang/UNICOM/uniwork-office
   NODE_PATH=$PWD/node_modules node "${TMPDIR:-/tmp}/wb-css/strip-css-rules.cjs" apps/shell/src/renderer/src/home.css .wb-myspace .wb-ms .wb-desk
   ```
   Kết quả mong đợi: `rules touched:` với một số lớn hơn 0 và `vars removed: 0`. Sau đó sửa tay:
   - xóa nguyên hai khối `@keyframes wb-ms-fade-up { … }` và `@keyframes wb-ms-breathe { … }` (script không gỡ keyframes);
   - đổi comment `/* ── My Space (desk module) ─────────────────────────────── */` thành `/* ── Immersive module panes ── */`;
   - giữ rule `.wb-detail.is-immersive { … }` dưới comment đó (Ghi chú vẫn dùng tới Task 17).

   Phạm vi đã gỡ gồm mọi rule `.wb-ms-*` và `.wb-desk-*`, keyframes `wb-ms-fade-up` và `wb-ms-breathe` (hiệu ứng "breathe" của spec), gradient radial/linear của hero, khối `@media (prefers-reduced-motion: reduce)` cho `.wb-ms-*`, và các khối `@media (max-width: 900px)` chỉ chứa rule desk.

9. Kiểm không còn gì tham chiếu code đã xóa:
   ```bash
   grep -rnE "DeskPane|workbench-desk|workbench-reminders|wb-ms-|wb-desk-|wb-myspace|DESK_CHART" apps/shell/src apps/shell/tests
   ```
   Kết quả mong đợi: không có output. Ở HEAD chỉ có một selector `is-immersive` (`.teacher-detail.is-immersive`, giữ lại tới Task 17), không có selector con nào chứa `.wb-myspace`.

- [ ] **Step 12: Kiểm toàn bộ và commit**

Chạy:
```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell
npm run typecheck -w @uniwork/practice-core
cd packages/practice-core && npx vitest run && cd ../..
cd apps/shell && npx vitest run && cd ../..
npm run check:theme-colors -- --base origin/main
npm run format
npm run dev
```
Kết quả mong đợi:
- cả hai typecheck exit 0;
- test practice-core PASS (chúng kiểm id module, không kiểm nhãn);
- mọi test shell PASS, kể cả `work-home`, `work-overview`, `uniwork-docs-ui` và các test `strings*`;
- theme check không in vi phạm.

Kiểm trong app (chỉ đổi renderer nên không cần rebuild shell). Tab lõi hiện "Tổng quan" / "Overview".
- **Chưa đăng nhập:** một bảng đăng nhập và các file gần đây trên máy mang nhãn "Trên máy này".
- **Đã đăng nhập:**
  - dòng ngày, lời chào và câu đầu trang;
  - năm ô số, mỗi ô nhảy tới danh sách của nó;
  - tài liệu cloud gần đây mở được trong editor;
  - Việc của tôi với checkbox xong hoạt động;
  - Họp sắp tới, nút Vào họp mở phòng họp trên web;
  - Thông báo;
  - Làm mới và focus lại cửa sổ đều tải lại dữ liệu.
- **Tắt mạng rồi bấm Làm mới:** dữ liệu cache vẫn hiện kèm "Cập nhật lúc HH:mm".
- Kiểm cả theme light và dark.

```bash
git add apps/shell/src/renderer/src apps/shell/tests/work-overview.test.ts packages/practice-core/src/modules.ts
git commit -m "$(cat <<'EOF'
feat(shell): Workbench Overview from UniWork Home replaces My Space

Header with greeting and headline, five counts (a failed source shows a
dash and Retry), recent cloud and local documents, My work with an
optimistic done checkbox and rollback toast, upcoming meetings with Join,
and the inbox. Signed-out, forbidden, offline-with-cache and quiet states
follow spec §7. DeskPane, its widget layout and the local reminder loop
are deleted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Chưa làm ở Task 13:
- Lời chào dùng toàn bộ display name, chưa theo quy tắc `greetingName` (chỉ tên) của web.
- Checkbox ở Tổng quan coi đúng key `'done'` là xong; một key tùy biến thuộc nhóm done (ví dụ `shipped`) hiện chưa tick ở Tổng quan nhưng là đã đóng ở tab Việc (Task 14 dùng `closedStatusKeys`). Server thường không trả việc đã đóng trong `my_work`.
- Thiếu slug thì `openWeb` từ chối target, nên liên kết việc, họp và thông báo không làm gì (C5 đảm bảo có slug khi server gửi).

### Task 14: Tab Việc dùng dữ liệu UniWork (thay TasksPane cục bộ)

Ghi chú hợp đồng: Task 14–19 dựa trên trạng thái sau Task 1–13: các module đã cắt; `DeskPane.tsx`, `EmailPane.tsx`, `workbench-reminders.ts` và store events/finance/health/growth/travel/pets đã xóa; `moduleSupportsAddItem` chỉ đúng với `tasks | notes | calendar`; `window.uniworkWork: UniworkWorkApi` khai báo trong `declare global` của `Home.tsx`; `PracticeHome` giữ `workspaces`, `workspaceId`, `workspaceError`, `refreshTick`, `refresh()`. Task này thêm `WB_REFRESH_EVENT = 'uniwork:wb-refresh'` ở `work-cache.ts`; các tab server tải lại khi có event này và khi cửa sổ được focus, và `refresh()` của `PracticeHome` phát event (Step 18). Theo C9, cột "dự án" hiện `identifier`, nhãn "Mã việc" / "Key". Theo C15, quick add không gửi `allow_duplicate`; 409 thành `'server'` và hiện "Could not add the task." My AI `add_item` → Việc giờ tạo việc trên UniWork nên `applyAgentIntent` thành async.

**Files:**
- Create: `apps/shell/src/renderer/src/work-tasks.ts`, `apps/shell/src/renderer/src/work-cache.ts`, `apps/shell/src/renderer/src/WorkErrorState.tsx`, `apps/shell/src/renderer/src/WorkTasksPane.tsx`
- Test (create): `apps/shell/tests/work-tasks.test.ts`, `apps/shell/tests/work-cache.test.ts`, `apps/shell/tests/work-tasks-pane.test.ts`, `apps/shell/tests/agent-intent-apply-tasks.test.ts`
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts` (thêm key)
- Modify: `apps/shell/src/renderer/src/home.css` (thêm khối mới; gỡ `.wb-tasks*`)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (prop `workspace`, import `TasksPane`, nhánh tasks)
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx` (suy ra `workspace`, skeleton khi đang tải, `refresh()` phát `WB_REFRESH_EVENT`)
- Modify: `packages/practice-core/src/modules.ts` (gợi ý của mục tasks)
- Modify: `apps/shell/src/renderer/src/agent-intent-apply.ts` (import, `addItem`, undo, `applyAgentIntent`)
- Modify: `apps/shell/src/renderer/src/AgentIntentBanner.tsx` (`runApply`), `apps/shell/src/renderer/src/NewChatPane.tsx` (`executeStep`)
- Modify: `apps/shell/src/renderer/src/context-manager.ts`, `apps/shell/src/renderer/src/my-ai-local-answer.ts`
- Modify: `apps/shell/src/renderer/src/workbench-pins.ts` (gỡ store việc cục bộ)
- Delete: `apps/shell/src/renderer/src/TasksPane.tsx`

**Interfaces:**
- Consumes: `UniworkWorkApi.myTasks(ws)`, `.taskStatuses(ws)`, `.setTaskStatus(taskId, statusKey)`, `.createTask(WorkCreateTaskInput)`, `.openWeb(WorkWebTarget)`. Kiểu `WorkTask`, `WorkTaskStatus`, `UniworkWorkError`, `UniworkWorkResult<T>` (`shared/uniwork-work-api.ts`). `UniworkWorkspaceRef {id,name,orgId,slug,orgSlug}` (`shared/home-api.ts`). `readActiveWorkspaceId(): string | null` và `pickActiveWorkspace(items, stored)` (`active-workspace.ts`). `currentWorkbenchBucket()` và `isWorkbenchBucketCleared()` (`workbench-bucket.ts`). `useAccount().signIn` và `useAccount().view` (`account-model.ts`). `useI18n(): { t, dateLocale }`. `insert.cjs` (Task 12) và `strip-css-rules.cjs` (Task 13).
- Produces:
  - `work-tasks.ts`: `type TaskDueGroup = 'overdue'|'today'|'week'|'later'|'none'`; `localIsoDate(d: Date): string`; `endOfWeek(today: string): string`; `groupTasksByDue(tasks: readonly WorkTask[], today: string): { group: TaskDueGroup; tasks: WorkTask[] }[]`; `closedStatusKeys(statuses: readonly WorkTaskStatus[]): Set<string>`
  - `work-cache.ts`: `WB_REFRESH_EVENT`; `cacheWork(key: string, value: unknown): void`; `cachedWork<T>(key: string): { value: T; at: number } | null`; `cachedOpenTasks(): WorkTask[]`
  - `WorkErrorState.tsx`: `WorkErrorState({ state: UniworkWorkError; onRetry: () => void })`; `WorkNoWorkspace()`; `WorkStaleNote({ at: number; onRetry: () => void })`
  - `WorkTasksPane({ workspace: UniworkWorkspaceRef | null }): ReactElement`
  - `WorkbenchModulePane` nhận prop `workspace: UniworkWorkspaceRef | null` (null = chưa đăng nhập hoặc không thuộc workspace nào, không bao giờ là "đang tải")
  - `applyAgentIntent(intent, practiceId): Promise<AgentIntentApplyResult>` (giờ là async)

- [ ] **Step 1: Kiểm điều kiện đầu vào và truyền workspace đang chọn vào các module pane**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
ls apps/shell/src/renderer/src/DeskPane.tsx apps/shell/src/renderer/src/EmailPane.tsx apps/shell/src/renderer/src/workbench-reminders.ts 2>&1 | grep -c 'No such file'
grep -n "uniworkWork: UniworkWorkApi" apps/shell/src/renderer/src/Home.tsx
grep -n "workspaceError\|refreshTick" apps/shell/src/renderer/src/PracticeHome.tsx | head -3
ls apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/active-workspace.ts apps/shell/src/renderer/src/module-tones.ts apps/shell/src/shared/uniwork-work-api.ts
```
Kết quả mong đợi:
- `3`
- một kết quả trong `Home.tsx`
- `PracticeHome.tsx` có `workspaceError` và `refreshTick` (Task 12–13)
- cả bốn file đều có

Nếu `PracticeHome.tsx` chưa có state workspace, dừng lại: Task 12–13 phải xong trước.

`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- thêm `import type { UniworkWorkspaceRef } from '../../shared/home-api'`;
- thêm vào `interface Props`:
  ```ts
    /** the active UniWork workspace; null = signed out or a member of none */
    workspace: UniworkWorkspaceRef | null
  ```
- thêm `workspace,` vào phần destructuring của `WorkbenchModulePane`.

`apps/shell/src/renderer/src/PracticeHome.tsx`:
- sau dòng `const [workspaceError, setWorkspaceError] = …` (Task 13), thêm:
  ```ts
    const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  ```
- trong bộ chuyển pane (sau Task 13), thay:
  ```tsx
        ) : isWorkbenchModuleId(tab) ? (
          <WorkbenchModulePane
  ```
  bằng:
  ```tsx
        ) : isWorkbenchModuleId(tab) && workspaces === null && tab !== 'forms' && tab !== 'notes' ? (
          // server tabs wait for the workspace list: null would read as "no workspace"
          <div className="wb-work-skeleton" aria-busy="true" />
        ) : isWorkbenchModuleId(tab) ? (
          <WorkbenchModulePane
  ```
- thêm `workspace={workspace}` vào các prop của phần tử `<WorkbenchModulePane …>` đó.

`.wb-work-skeleton` được thêm ở Step 16 của task này.

- [ ] **Step 2: Viết test hàm hạn chót sẽ fail**

`apps/shell/tests/work-tasks.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { WorkTask, WorkTaskStatus } from '../src/shared/uniwork-work-api'
import {
  closedStatusKeys,
  endOfWeek,
  groupTasksByDue,
  localIsoDate,
} from '../src/renderer/src/work-tasks'

const task = (id: string, due?: string, title = id): WorkTask => ({
  id,
  workspace_id: 'w1',
  identifier: `OPS-${id}`,
  title,
  status: 'todo',
  priority: 'medium',
  ...(due ? { due_date: due } : {}),
  updated_at: '2026-10-13T08:00:00Z',
})

describe('localIsoDate', () => {
  it('formats the local calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('endOfWeek', () => {
  it('is the Sunday that closes the week', () => {
    expect(endOfWeek('2026-10-13')).toBe('2026-10-18') // Tuesday
    expect(endOfWeek('2026-10-12')).toBe('2026-10-18') // Monday
    expect(endOfWeek('2026-10-18')).toBe('2026-10-18') // Sunday
    expect(endOfWeek('2026-12-29')).toBe('2027-01-03') // across the year
  })
})

describe('groupTasksByDue', () => {
  const today = '2026-10-13'

  it('splits into overdue / today / this week / later / no date, in that order', () => {
    const groups = groupTasksByDue(
      [
        task('later', '2026-10-19'),
        task('none'),
        task('week', '2026-10-18'),
        task('today', '2026-10-13'),
        task('late', '2026-10-01'),
      ],
      today,
    )
    expect(groups.map((g) => [g.group, g.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['late']],
      ['today', ['today']],
      ['week', ['week']],
      ['later', ['later']],
      ['none', ['none']],
    ])
  })

  it('leaves out empty groups and sorts a group by due date, then title', () => {
    const groups = groupTasksByDue(
      [task('b', '2026-10-16', 'Beta'), task('a', '2026-10-16', 'Alpha'), task('c', '2026-10-14')],
      today,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.group).toBe('week')
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('reads only the date part of a due value', () => {
    expect(groupTasksByDue([task('x', '2026-10-13T23:00:00Z')], today)[0]!.group).toBe('today')
  })
})

describe('closedStatusKeys', () => {
  it('closes the done and cancelled categories, built-in keys included without a catalogue', () => {
    const statuses: WorkTaskStatus[] = [
      { id: '1', key: 'todo', name: 'To do', category: 'todo', color: '', position: 1 },
      { id: '2', key: 'shipped', name: 'Shipped', category: 'done', color: '', position: 2 },
      { id: '3', key: 'dropped', name: 'Dropped', category: 'cancelled', color: '', position: 3 },
    ]
    expect([...closedStatusKeys(statuses)].sort()).toEqual(['cancelled', 'done', 'dropped', 'shipped'])
    expect([...closedStatusKeys([])].sort()).toEqual(['cancelled', 'done'])
  })
})
```

- [ ] **Step 3: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-tasks.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/work-tasks"`.

- [ ] **Step 4: Viết `work-tasks.ts`**

`apps/shell/src/renderer/src/work-tasks.ts`:
```ts
/**
 * Tasks tab helpers (pure): due-date groups like the web My work list, plus
 * the catalogue statuses that close a task.
 */
import type { WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'

export type TaskDueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none'

const ORDER: readonly TaskDueGroup[] = ['overdue', 'today', 'week', 'later', 'none']

/** YYYY-MM-DD of `d` in the local time zone */
export function localIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** The Sunday that closes the (Monday-first) week holding `today` (YYYY-MM-DD). */
export function endOfWeek(today: string): string {
  const d = new Date(`${today}T00:00:00`)
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return localIsoDate(d)
}

function groupOf(due: string | undefined, today: string, weekEnd: string): TaskDueGroup {
  if (!due) return 'none'
  const day = due.slice(0, 10)
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  return day <= weekEnd ? 'week' : 'later'
}

/** Non-empty groups in display order; inside a group by due date, then title. */
export function groupTasksByDue(
  tasks: readonly WorkTask[],
  today: string,
): { group: TaskDueGroup; tasks: WorkTask[] }[] {
  const weekEnd = endOfWeek(today)
  const byGroup = new Map<TaskDueGroup, WorkTask[]>()
  for (const task of tasks) {
    const group = groupOf(task.due_date, today, weekEnd)
    byGroup.set(group, [...(byGroup.get(group) ?? []), task])
  }
  return ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    tasks: byGroup
      .get(group)!
      .sort(
        (a, b) =>
          (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.title.localeCompare(b.title),
      ),
  }))
}

/** Status keys that close a task: catalogue rows in the done / cancelled categories, plus the built-in keys. */
export function closedStatusKeys(statuses: readonly WorkTaskStatus[]): Set<string> {
  const keys = new Set(['done', 'cancelled'])
  for (const s of statuses) if (s.category === 'done' || s.category === 'cancelled') keys.add(s.key)
  return keys
}
```

- [ ] **Step 5: Chạy và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-tasks.test.ts`
Kết quả mong đợi: PASS, 6 test.

- [ ] **Step 6: Viết test cache công việc sẽ fail**

`apps/shell/tests/work-cache.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkTask, WorkTaskStatus } from '../src/shared/uniwork-work-api'

const env = vi.hoisted(() => ({ bucket: 'a-one', cleared: false, active: 'w1' as string | null }))
vi.mock('../src/renderer/src/workbench-bucket', () => ({
  currentWorkbenchBucket: () => env.bucket,
  isWorkbenchBucketCleared: () => env.cleared,
}))
vi.mock('../src/renderer/src/active-workspace', () => ({ readActiveWorkspaceId: () => env.active }))

import { cacheWork, cachedOpenTasks, cachedWork } from '../src/renderer/src/work-cache'

const task = (id: string, status: string): WorkTask => ({
  id,
  workspace_id: 'w1',
  identifier: '',
  title: id,
  status,
  priority: 'none',
  updated_at: '',
})

beforeEach(() => {
  env.bucket = 'a-one'
  env.cleared = false
  env.active = 'w1'
})

describe('work cache', () => {
  it('keeps an answer per bucket with its time', () => {
    cacheWork('tasks:w9', [task('a', 'todo')])
    expect(cachedWork<WorkTask[]>('tasks:w9')?.value.map((x) => x.id)).toEqual(['a'])
    expect(typeof cachedWork('tasks:w9')?.at).toBe('number')
    env.bucket = 'a-two'
    expect(cachedWork('tasks:w9')).toBeNull()
  })

  it('stores and returns nothing while the bucket is cleared', () => {
    env.cleared = true
    cacheWork('tasks:w8', [])
    expect(cachedWork('tasks:w8')).toBeNull()
    env.cleared = false
    expect(cachedWork('tasks:w8')).toBeNull()
  })

  it('My AI sees the open tasks of the active workspace only', () => {
    const statuses: WorkTaskStatus[] = [
      { id: 's', key: 'shipped', name: 'Shipped', category: 'done', color: '', position: 1 },
    ]
    cacheWork('taskStatuses:w1', statuses)
    cacheWork('tasks:w1', [task('open', 'todo'), task('d', 'done'), task('s', 'shipped')])
    expect(cachedOpenTasks().map((x) => x.id)).toEqual(['open'])
    env.active = null
    expect(cachedOpenTasks()).toEqual([])
  })
})
```

- [ ] **Step 7: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-cache.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/work-cache"`.

- [ ] **Step 8: Viết `work-cache.ts`**

`apps/shell/src/renderer/src/work-cache.ts`:
```ts
/**
 * The last server answer per key, kept in memory for this window: shown with
 * its time when a reload is offline, and read by My AI's on-device context.
 * Keys carry the workspace id and live under the current Workbench bucket
 * (deployment + account + org), so a switch never shows another account's rows.
 */
import type { WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'
import { readActiveWorkspaceId } from './active-workspace'
import { currentWorkbenchBucket, isWorkbenchBucketCleared } from './workbench-bucket'
import { closedStatusKeys } from './work-tasks'

/** Dispatched on window by the Workbench Refresh button; the server tabs reload on it. */
export const WB_REFRESH_EVENT = 'uniwork:wb-refresh'

const entries = new Map<string, { value: unknown; at: number }>()

export function cacheWork(key: string, value: unknown): void {
  // between an account change and the next bucket load nothing is kept
  if (isWorkbenchBucketCleared()) return
  entries.set(`${currentWorkbenchBucket()}\n${key}`, { value, at: Date.now() })
}

export function cachedWork<T>(key: string): { value: T; at: number } | null {
  if (isWorkbenchBucketCleared()) return null
  const hit = entries.get(`${currentWorkbenchBucket()}\n${key}`)
  return (hit as { value: T; at: number } | undefined) ?? null
}

/** Open tasks of the active workspace from the last load (My AI grounding); [] before any load. */
export function cachedOpenTasks(): WorkTask[] {
  const ws = readActiveWorkspaceId()
  if (!ws) return []
  const closed = closedStatusKeys(cachedWork<WorkTaskStatus[]>(`taskStatuses:${ws}`)?.value ?? [])
  return (cachedWork<WorkTask[]>(`tasks:${ws}`)?.value ?? []).filter((x) => !closed.has(x.status))
}
```

- [ ] **Step 9: Chạy và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-cache.test.ts tests/work-tasks.test.ts`
Kết quả mong đợi: PASS, 9 test.

- [ ] **Step 10: Commit các hàm hỗ trợ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run format
git add apps/shell/src/renderer/src/work-tasks.ts apps/shell/src/renderer/src/work-cache.ts apps/shell/tests/work-tasks.test.ts apps/shell/tests/work-cache.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): due-date groups and an in-memory cache for Workbench server tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Thêm chuỗi tab Việc và trạng thái dùng chung (zh, vi, en)**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"   # insert.cjs from Task 12 Step 10; re-create it from there if the temp dir was cleared
cat > "$K/t14-zh.txt" <<'EOF'
  wbWorkSignedOut: '登录 UniWork 以查看你的任务、日程和个人资料。',
  wbWorkSignIn: '登录 UniWork',
  wbWorkNoWorkspace: '你的账号还没有加入任何工作区。',
  wbWorkOpenOnboarding: '在网页上设置',
  wbWorkForbidden: '你已无权访问此工作区，请选择其他工作区。',
  wbWorkLoadFailed: '无法加载数据。',
  wbWorkRetry: '重试',
  wbWorkUpdatedAt: '更新于 {time}',
  wbWorkOpenOnWeb: '在网页上打开',
  wbTasksGroupOverdue: '已逾期',
  wbTasksGroupToday: '今天',
  wbTasksGroupWeek: '本周',
  wbTasksGroupLater: '以后',
  wbTasksGroupNone: '无截止日期',
  wbTasksColTitle: '标题',
  wbTasksColKey: '编号',
  wbTasksColStatus: '状态',
  wbTasksColDue: '截止',
  wbTasksQuickAdd: '快速添加任务',
  wbTasksAdd: '添加',
  wbTasksEmpty: '没有待处理的任务。',
  wbTasksMarkDone: '标记为完成：{title}',
  wbTasksReopen: '重新打开：{title}',
  wbTasksSaveFailed: '无法保存更改。',
  wbTasksAddFailed: '无法添加任务。',
EOF
cat > "$K/t14-vi.txt" <<'EOF'
  wbWorkSignedOut: 'Đăng nhập UniWork để xem việc, lịch và hồ sơ của bạn.',
  wbWorkSignIn: 'Đăng nhập UniWork',
  wbWorkNoWorkspace: 'Tài khoản của bạn chưa thuộc không gian làm việc nào.',
  wbWorkOpenOnboarding: 'Thiết lập trên web',
  wbWorkForbidden: 'Bạn không còn quyền truy cập không gian làm việc này. Hãy chọn không gian làm việc khác.',
  wbWorkLoadFailed: 'Không tải được dữ liệu.',
  wbWorkRetry: 'Thử lại',
  wbWorkUpdatedAt: 'Cập nhật lúc {time}',
  wbWorkOpenOnWeb: 'Mở trên web',
  wbTasksGroupOverdue: 'Quá hạn',
  wbTasksGroupToday: 'Hôm nay',
  wbTasksGroupWeek: 'Tuần này',
  wbTasksGroupLater: 'Sau đó',
  wbTasksGroupNone: 'Không có hạn',
  wbTasksColTitle: 'Tiêu đề',
  wbTasksColKey: 'Mã việc',
  wbTasksColStatus: 'Trạng thái',
  wbTasksColDue: 'Hạn',
  wbTasksQuickAdd: 'Thêm việc nhanh',
  wbTasksAdd: 'Thêm',
  wbTasksEmpty: 'Không có việc nào đang chờ.',
  wbTasksMarkDone: 'Đánh dấu hoàn thành: {title}',
  wbTasksReopen: 'Mở lại: {title}',
  wbTasksSaveFailed: 'Không lưu được thay đổi.',
  wbTasksAddFailed: 'Không thêm được việc.',
EOF
cat > "$K/t14-en.txt" <<'EOF'
  wbWorkSignedOut: 'Sign in to UniWork to see your tasks, calendar and profile.',
  wbWorkSignIn: 'Sign in to UniWork',
  wbWorkNoWorkspace: 'Your account is not in any workspace yet.',
  wbWorkOpenOnboarding: 'Set up on the web',
  wbWorkForbidden: 'You no longer have access to this workspace. Choose another workspace.',
  wbWorkLoadFailed: 'Could not load the data.',
  wbWorkRetry: 'Retry',
  wbWorkUpdatedAt: 'Updated at {time}',
  wbWorkOpenOnWeb: 'Open on the web',
  wbTasksGroupOverdue: 'Overdue',
  wbTasksGroupToday: 'Today',
  wbTasksGroupWeek: 'This week',
  wbTasksGroupLater: 'Later',
  wbTasksGroupNone: 'No due date',
  wbTasksColTitle: 'Title',
  wbTasksColKey: 'Key',
  wbTasksColStatus: 'Status',
  wbTasksColDue: 'Due',
  wbTasksQuickAdd: 'Quick add a task',
  wbTasksAdd: 'Add',
  wbTasksEmpty: 'Nothing is waiting on you.',
  wbTasksMarkDone: 'Mark done: {title}',
  wbTasksReopen: 'Reopen: {title}',
  wbTasksSaveFailed: 'Could not save the change.',
  wbTasksAddFailed: 'Could not add the task.',
EOF
node "$K/insert.cjs" "$K/t14-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t14-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t14-en.txt" $D/en.ts
npx prettier --write $D
npm run typecheck -w @genoffice/shell
```
Kết quả mong đợi: typecheck pass, vì `satisfies Record<keyof typeof zh, string>` đúng ở mọi shard (18 locale còn lại spread `en`, spec §6.8). Đã kiểm bằng script: không key `wbWork*` / `wbTasks*` nào trùng key của Task 11–13, 15–18 hay của `strings.ts` và các shard account, cloud, sync, uniwork-documents.

- [ ] **Step 12: Viết test component tab Việc sẽ fail**

Ba test cuối là test ghim của Review Focus 1, 3 và 4.

`apps/shell/tests/work-tasks-pane.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkResult, WorkTask, WorkTaskStatus } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkTasksPane } from '../src/renderer/src/WorkTasksPane'
import { localIsoDate } from '../src/renderer/src/work-tasks'

vi.mock('../src/renderer/src/active-workspace', () => ({ readActiveWorkspaceId: () => 'w1' }))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
const TASK: WorkTask = {
  id: 't1',
  workspace_id: 'w1',
  identifier: 'OPS-7',
  title: 'Send the quote',
  status: 'todo',
  priority: 'medium',
  due_date: localIsoDate(new Date()),
  updated_at: '2026-10-13T08:00:00Z',
}
const STATUSES: WorkTaskStatus[] = [
  { id: 's1', key: 'todo', name: 'To do', category: 'todo', color: '', position: 1 },
  { id: 's2', key: 'done', name: 'Done', category: 'done', color: '', position: 2 },
]

function makeApi() {
  return {
    homeSummary: vi.fn(),
    myTasks: vi.fn(async (): Promise<UniworkWorkResult<WorkTask[]>> => ({ ok: true, value: [TASK] })),
    taskStatuses: vi.fn(
      async (): Promise<UniworkWorkResult<WorkTaskStatus[]>> => ({ ok: true, value: STATUSES }),
    ),
    setTaskStatus: vi.fn(
      async (_id: string, status: string): Promise<UniworkWorkResult<WorkTask>> => ({
        ok: true,
        value: { ...TASK, status },
      }),
    ),
    createTask: vi.fn(),
    calendarEvents: vi.fn(),
    myProfile: vi.fn(),
    openWeb: vi.fn(async () => true),
  }
}

let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function render(workspace: UniworkWorkspaceRef): Promise<void> {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkTasksPane, { workspace })),
    )
  })
  await flush()
}

// the work cache lives at module level: tests that must start with nothing cached use their own workspace id
async function mount(workspace: UniworkWorkspaceRef = WS): Promise<void> {
  await render(workspace)
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const checkbox = () => host.querySelector<HTMLInputElement>('.wb-work-row input[type="checkbox"]')!
const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = makeApi()
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Tasks tab', () => {
  it('lists the task under Today with its key, status name and due pill', async () => {
    await mount()
    expect(api.myTasks).toHaveBeenCalledWith('w1')
    const text = host.textContent ?? ''
    expect(text).toContain('Today')
    expect(text).toContain('Send the quote')
    expect(text).toContain('OPS-7')
    expect(text).toContain('To do')
  })

  it('ticking the checkbox sets the status to done', async () => {
    await mount()
    await click(checkbox())
    expect(api.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(checkbox().checked).toBe(true)
    expect(host.querySelector('.wb-work-row')!.classList.contains('is-done')).toBe(true)
  })

  it('a failed save puts the checkbox back and offers Retry', async () => {
    api.setTaskStatus.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await mount()
    await click(checkbox())
    expect(checkbox().checked).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save the change.')
    await click(buttonByText('Retry'))
    expect(api.setTaskStatus).toHaveBeenCalledTimes(2)
    expect(checkbox().checked).toBe(true)
  })

  it('quick add retries with the same idempotency key', async () => {
    api.createTask
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: true, value: { ...TASK, id: 't2', title: 'Call the bank' } })
    await mount()
    const input = host.querySelector<HTMLInputElement>('.wb-work-quick input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Call the bank')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    await click(buttonByText('Retry'))
    expect(api.createTask).toHaveBeenCalledTimes(2)
    const first = api.createTask.mock.calls[0]![0]
    const second = api.createTask.mock.calls[1]![0]
    expect(first).toEqual({ workspaceId: 'w1', title: 'Call the bank', idempotencyKey: expect.any(String) })
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(host.textContent).toContain('Call the bank')
  })

  it('a late answer for the previous workspace never replaces the new one', async () => {
    let releaseOld: (r: UniworkWorkResult<WorkTask[]>) => void = () => undefined
    api.myTasks.mockImplementationOnce(
      () =>
        new Promise<UniworkWorkResult<WorkTask[]>>((resolve) => {
          releaseOld = resolve
        }),
    )
    await mount({ ...WS, id: 'w-old' })
    api.myTasks.mockResolvedValueOnce({
      ok: true,
      value: [{ ...TASK, id: 't2', workspace_id: 'w-new', title: 'Second workspace task' }],
    })
    await render({ ...WS, id: 'w-new', slug: 'new' })
    releaseOld({ ok: true, value: [TASK] })
    await flush()
    expect(host.textContent).toContain('Second workspace task')
    expect(host.textContent).not.toContain('Send the quote')
  })

  it('offline on first load with nothing cached: an error with Retry, then the list', async () => {
    api.myTasks.mockResolvedValueOnce({ ok: false, error: 'offline' })
    await mount({ ...WS, id: 'w-fresh' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load the data.')
    expect(host.querySelector('.wb-work-skeleton')).toBeNull()
    await click(buttonByText('Retry'))
    expect(host.textContent).toContain('Send the quote')
  })

  it('a status key missing from the catalogue shows as-is and stays open', async () => {
    api.myTasks.mockResolvedValueOnce({ ok: true, value: [{ ...TASK, status: 'qa_hold' }] })
    await mount({ ...WS, id: 'w-unknown' })
    expect(host.textContent).toContain('qa_hold')
    expect(checkbox().checked).toBe(false)
    await click(checkbox())
    expect(api.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
  })
})
```

- [ ] **Step 13: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-tasks-pane.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/WorkTasksPane"`.

- [ ] **Step 14: Tạo các trạng thái dùng chung của tab server**

`apps/shell/src/renderer/src/WorkErrorState.tsx`:
```tsx
import type { ReactElement } from 'react'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { useAccount } from './account-model'
import { useI18n } from './locale'

function SignInPrompt(): ReactElement {
  const { t } = useI18n()
  const account = useAccount()
  return (
    <div className="wb-work-state" role="status">
      <p>{t('wbWorkSignedOut')}</p>
      <button type="button" className="btn btn-primary" onClick={account.signIn}>
        {t('wbWorkSignIn')}
      </button>
    </div>
  )
}

/** A server tab's load failed: sign-in prompt, lost access, or a retryable error. */
export function WorkErrorState({
  state,
  onRetry,
}: {
  state: UniworkWorkError
  onRetry: () => void
}): ReactElement {
  const { t } = useI18n()
  if (state === 'signed-out') return <SignInPrompt />
  if (state === 'forbidden') {
    return (
      <p className="wb-work-state" role="alert">
        {t('wbWorkForbidden')}
      </p>
    )
  }
  return (
    <div className="wb-work-state" role="alert">
      <p>{t('wbWorkLoadFailed')}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        {t('wbWorkRetry')}
      </button>
    </div>
  )
}

/** No workspace to show: the sign-in prompt when signed out, else the web onboarding link. */
export function WorkNoWorkspace(): ReactElement | null {
  const { t } = useI18n()
  const account = useAccount()
  if (account.view === 'loading') return null
  if (account.view !== 'signed-in' && account.view !== 'refreshing') return <SignInPrompt />
  return (
    <div className="wb-work-state" role="status">
      <p>{t('wbWorkNoWorkspace')}</p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void window.uniworkWork.openWeb({ kind: 'onboarding' })}
      >
        {t('wbWorkOpenOnboarding')}
      </button>
    </div>
  )
}

/** Offline with a cached answer: when it was loaded, and a retry. */
export function WorkStaleNote({ at, onRetry }: { at: number; onRetry: () => void }): ReactElement {
  const { t, dateLocale } = useI18n()
  const time = new Date(at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  return (
    <p className="wb-work-stale" role="status">
      {t('wbWorkUpdatedAt', { time })}
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        {t('wbWorkRetry')}
      </button>
    </p>
  )
}
```

- [ ] **Step 15: Tạo tab Việc**

`apps/shell/src/renderer/src/WorkTasksPane.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkCreateTaskInput,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { WB_REFRESH_EVENT, cacheWork, cachedWork } from './work-cache'
import { closedStatusKeys, groupTasksByDue, localIsoDate, type TaskDueGroup } from './work-tasks'
import { WorkErrorState, WorkNoWorkspace, WorkStaleNote } from './WorkErrorState'

const GROUP_LABEL: Record<TaskDueGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  week: 'wbTasksGroupWeek',
  later: 'wbTasksGroupLater',
  none: 'wbTasksGroupNone',
}

/** A write the server refused: shown with a Retry that repeats the same request. */
interface WriteFailure {
  message: StringKey
  retry: () => void
}

/**
 * Tasks tab: the signed-in user's UniWork tasks in the active workspace,
 * grouped by due date. Ticking a row sets its status (optimistic, put back on
 * failure); quick add creates a task; a title opens the task on the web.
 */
export function WorkTasksPane({ workspace }: { workspace: UniworkWorkspaceRef | null }): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const wsRef = useRef(wsId)
  wsRef.current = wsId
  const loadSeq = useRef(0)
  const [tasks, setTasks] = useState<WorkTask[] | null>(null)
  const [statuses, setStatuses] = useState<WorkTaskStatus[]>([])
  const [error, setError] = useState<UniworkWorkError | null>(null)
  const [staleAt, setStaleAt] = useState<number | null>(null)
  // ticked this session: stays listed (dimmed) until the next load, like the web
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [failure, setFailure] = useState<WriteFailure | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!wsId) return
    const mine = ++loadSeq.current
    const [list, catalogue] = await Promise.all([
      window.uniworkWork.myTasks(wsId),
      window.uniworkWork.taskStatuses(wsId),
    ])
    if (mine !== loadSeq.current) return // a newer load (another workspace) owns the state
    if (catalogue.ok) {
      cacheWork(`taskStatuses:${wsId}`, catalogue.value)
      setStatuses(catalogue.value)
    }
    if (list.ok) {
      cacheWork(`tasks:${wsId}`, list.value)
      setTasks(list.value)
      setError(null)
      setStaleAt(null)
      setTouched(new Set())
      return
    }
    const cached = list.error === 'offline' ? cachedWork<WorkTask[]>(`tasks:${wsId}`) : null
    setTasks(cached?.value ?? null)
    setStaleAt(cached?.at ?? null)
    setError(list.error)
  }, [wsId])

  useEffect(() => {
    setTasks(null)
    setStatuses([])
    setError(null)
    setStaleAt(null)
    setFailure(null)
    setTouched(new Set())
    void load()
    const reload = () => void load()
    window.addEventListener('focus', reload)
    window.addEventListener(WB_REFRESH_EVENT, reload)
    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener(WB_REFRESH_EVENT, reload)
    }
  }, [load])

  const closed = useMemo(() => closedStatusKeys(statuses), [statuses])
  const statusName = useMemo(() => new Map(statuses.map((s) => [s.key, s.name])), [statuses])

  const patchStatus = (id: string, status: string) =>
    setTasks((cur) => cur?.map((x) => (x.id === id ? { ...x, status } : x)) ?? cur)

  const setDone = async (task: WorkTask, done: boolean): Promise<void> => {
    const next = done ? 'done' : 'todo'
    setFailure(null)
    setTouched((cur) => new Set(cur).add(task.id))
    patchStatus(task.id, next)
    const r = await window.uniworkWork.setTaskStatus(task.id, next)
    if (r.ok) {
      setTasks((cur) => cur?.map((x) => (x.id === task.id ? r.value : x)) ?? cur)
      return
    }
    patchStatus(task.id, task.status)
    setFailure({ message: 'wbTasksSaveFailed', retry: () => void setDone(task, done) })
  }

  const create = async (input: WorkCreateTaskInput): Promise<void> => {
    setFailure(null)
    setAdding(true)
    const r = await window.uniworkWork.createTask(input)
    setAdding(false)
    if (input.workspaceId !== wsRef.current) return
    if (r.ok) {
      setDraft('')
      setTasks((cur) => [r.value, ...(cur ?? [])])
      return
    }
    // Retry sends the same Idempotency-Key: a lost answer never creates a second task
    setFailure({ message: 'wbTasksAddFailed', retry: () => void create(input) })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.trim()
    if (!wsId || !title || adding) return
    void create({ workspaceId: wsId, title, idempotencyKey: crypto.randomUUID() })
  }

  if (!workspace) return <WorkNoWorkspace />
  if (!tasks) {
    return error ? (
      <WorkErrorState state={error} onRetry={() => void load()} />
    ) : (
      <div className="wb-work-skeleton" aria-busy="true" />
    )
  }

  const today = localIsoDate(new Date())
  const groups = groupTasksByDue(
    tasks.filter((x) => !closed.has(x.status) || touched.has(x.id)),
    today,
  )
  const openOnWeb = (task: WorkTask) =>
    void window.uniworkWork.openWeb({
      kind: 'task',
      orgSlug: workspace.orgSlug,
      wsSlug: workspace.slug,
      id: task.id,
    })
  const dueText = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })

  return (
    <div className="wb-work">
      {staleAt !== null ? <WorkStaleNote at={staleAt} onRetry={() => void load()} /> : null}
      <form className="wb-work-quick" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbTasksQuickAdd')}
          aria-label={t('wbTasksQuickAdd')}
          disabled={adding}
        />
        <button type="submit" className="btn btn-primary" disabled={adding || !draft.trim()}>
          {t('wbTasksAdd')}
        </button>
      </form>
      {failure ? (
        <div className="wb-work-alert" role="alert">
          <span>{t(failure.message)}</span>
          <button type="button" className="btn btn-secondary" onClick={failure.retry}>
            {t('wbWorkRetry')}
          </button>
        </div>
      ) : null}
      {groups.length === 0 ? (
        <p className="wb-work-state">{t('wbTasksEmpty')}</p>
      ) : (
        <table className="wb-work-table">
          <thead>
            <tr>
              <th className="wb-work-check" />
              <th>{t('wbTasksColTitle')}</th>
              <th>{t('wbTasksColKey')}</th>
              <th>{t('wbTasksColStatus')}</th>
              <th>{t('wbTasksColDue')}</th>
            </tr>
          </thead>
          {groups.map(({ group, tasks: rows }) => (
            <tbody key={group}>
              <tr className={`wb-work-group is-${group}`}>
                <th colSpan={5} scope="colgroup">
                  {t(GROUP_LABEL[group])}
                </th>
              </tr>
              {rows.map((task) => {
                const done = closed.has(task.status)
                const day = task.due_date?.slice(0, 10)
                return (
                  <tr key={task.id} className={`wb-work-row${done ? ' is-done' : ''}`}>
                    <td className="wb-work-check">
                      <input
                        type="checkbox"
                        checked={done}
                        aria-label={t(done ? 'wbTasksReopen' : 'wbTasksMarkDone', { title: task.title })}
                        onChange={(e) => void setDone(task, e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="wb-work-title"
                        title={t('wbWorkOpenOnWeb')}
                        onClick={() => openOnWeb(task)}
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="wb-work-muted">{task.identifier}</td>
                    <td>
                      <span className="wb-work-pill">{statusName.get(task.status) ?? task.status}</span>
                    </td>
                    <td>
                      {day ? (
                        <span
                          className={`wb-work-pill${day < today ? ' is-overdue' : day === today ? ' is-today' : ''}`}
                        >
                          {day === today ? t('wbTasksGroupToday') : dueText(day)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 16: Thêm style tab server (chỉ token) vào `home.css`**

Thêm vào cuối `apps/shell/src/renderer/src/home.css`:
```css
/* ── Workbench server tabs (Tasks / Calendar / Profile) ───────────── */
.wb-work {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wb-work-quick {
  display: flex;
  gap: 8px;
}

.wb-work-quick input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-work-quick input:focus {
  border-color: var(--accent);
  outline: none;
}

.wb-work-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.wb-work-table th,
.wb-work-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: start;
  vertical-align: middle;
}

.wb-work-table thead th {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.wb-work-group th {
  padding-top: 14px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.wb-work-group.is-overdue th {
  color: var(--danger-text);
}

.wb-work-check {
  width: 28px;
}

.wb-work-title {
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.wb-work-title:hover {
  text-decoration: underline;
}

.wb-work-row.is-done .wb-work-title {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.wb-work-muted {
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-work-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--tint-gray);
  color: var(--tint-gray-fg);
  font-size: 12px;
  white-space: nowrap;
}

.wb-work-pill.is-overdue {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.wb-work-pill.is-today {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.wb-work-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}

.wb-work-state p {
  margin: 0;
}

.wb-work-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: 13px;
}

.wb-work-stale {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-work-skeleton {
  height: 120px;
  border-radius: 10px;
  background: var(--surface-subtle);
}
```

- [ ] **Step 17: Chạy test component và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-tasks-pane.test.ts`
Kết quả mong đợi: PASS, 7 test.

- [ ] **Step 18: Gắn tab Việc vào Bàn làm việc và cho nút Làm mới tới được nó**

Trong `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- trước: `import { TasksPane } from './TasksPane'`
  sau: `import { WorkTasksPane } from './WorkTasksPane'`
- trước: `      {moduleId === 'tasks' && <TasksPane practiceId={practiceId} vi={vi} />}`
  sau: `      {moduleId === 'tasks' && <WorkTasksPane workspace={workspace} />}`

Trong `packages/practice-core/src/modules.ts` (mục tasks):
- trước:
```ts
    hintVi: 'Tự quản trị việc cá nhân — List, Kanban, Lịch, Dashboard',
    hintEn: 'Personal task board — list, kanban, calendar, dashboard',
```
- sau:
```ts
    hintVi: 'Việc của bạn trên UniWork, chia theo hạn',
    hintEn: 'Your UniWork tasks, grouped by due date',
```

Trong `apps/shell/src/renderer/src/PracticeHome.tsx`, cho `refresh()` (Task 12) phát event để các tab server tải lại:
- thêm `import { WB_REFRESH_EVENT } from './work-cache'`;
- trước:
```ts
  const refresh = () => {
    onRefresh()
    setRefreshTick((n) => n + 1)
  }
```
- sau:
```ts
  const refresh = () => {
    window.dispatchEvent(new Event(WB_REFRESH_EVENT))
    onRefresh()
    setRefreshTick((n) => n + 1)
  }
```

- [ ] **Step 19: Typecheck, lint và commit phần gắn kết**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/WorkErrorState.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/tests/work-tasks-pane.test.ts
npm run format
git add apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/WorkErrorState.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench packages/practice-core/src/modules.ts apps/shell/tests/work-tasks-pane.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Tasks tab lists, ticks and adds UniWork tasks

Grouped Overdue / Today / This week / Later / No date; status from the
workspace catalogue; a failed tick is put back with Retry; quick add retries
with the same Idempotency-Key; a title opens the task on the web.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
Kết quả mong đợi: typecheck và eslint đều exit 0.

- [ ] **Step 20: Viết test My AI "thêm việc" sẽ fail**

`apps/shell/tests/agent-intent-apply-tasks.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentIntent } from '@uniwork/practice-core'

vi.mock('../src/renderer/src/workbench-pins', () => ({
  pinModule: vi.fn(),
  pinPillar: vi.fn(),
  readPinnedModules: () => ['desk', 'tasks', 'calendar'],
}))
vi.mock('../src/renderer/src/skill-domain-pins', () => ({
  pinSkillDomain: vi.fn(),
  writeActiveSkillDomain: vi.fn(),
}))
vi.mock('../src/renderer/src/my-ai-consent', () => ({ workbenchModuleLabel: (id: string) => id }))
vi.mock('../src/renderer/src/active-workspace', () => ({
  readActiveWorkspaceId: () => 'w2',
  pickActiveWorkspace: (items: { id: string }[], stored: string | null) =>
    items.some((w) => w.id === stored) ? stored : (items[0]?.id ?? null),
}))

import { applyAgentIntent } from '../src/renderer/src/agent-intent-apply'

const WORKSPACES = [
  { id: 'w1', name: 'A', orgId: 'o1', slug: 'a', orgSlug: 'acme' },
  { id: 'w2', name: 'B', orgId: 'o1', slug: 'b', orgSlug: 'acme' },
]
const addTask = (text: string) =>
  createAgentIntent({
    target: { kind: 'module', id: 'tasks' },
    action: 'add_item',
    source: 'desktop',
    summary: 'Thêm việc',
    text,
  })

let listWorkspaces: ReturnType<typeof vi.fn>
let createTask: ReturnType<typeof vi.fn>

beforeEach(() => {
  listWorkspaces = vi.fn(async () => ({ ok: true, value: WORKSPACES }))
  createTask = vi.fn(async (input: { title: string }) => ({
    ok: true,
    value: { id: 't9', title: input.title },
  }))
  vi.stubGlobal('window', {
    aiOffice: { uniworkListWorkspaces: listWorkspaces },
    uniworkWork: { createTask },
    dispatchEvent: vi.fn(),
  })
})

describe('My AI add_item → Tasks', () => {
  it('creates the task on UniWork in the active workspace, with no local Undo', async () => {
    const r = await applyAgentIntent(addTask('Gọi lại khách'), 'entrepreneur')
    expect(createTask).toHaveBeenCalledWith({
      workspaceId: 'w2',
      title: 'Gọi lại khách',
      idempotencyKey: expect.any(String),
    })
    expect(r).toMatchObject({ ok: true, tabId: 'tasks', messageEn: 'Added to tasks: Gọi lại khách' })
    expect(r.undo).toBeUndefined()
  })

  it('reports a failure when the server refuses', async () => {
    createTask.mockResolvedValueOnce({ ok: false, error: 'server' })
    const r = await applyAgentIntent(addTask('X'), 'entrepreneur')
    expect(r.ok).toBe(false)
  })

  it('does not call the server without a workspace (signed out)', async () => {
    listWorkspaces.mockResolvedValueOnce({ ok: false, error: 'not_signed_in' })
    const r = await applyAgentIntent(addTask('X'), 'entrepreneur')
    expect(createTask).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 21: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/agent-intent-apply-tasks.test.ts`
Kết quả mong đợi: FAIL. `addItem` vẫn ghi store cục bộ, nên thấy `[vitest] No "writeTasks" export is defined on the mock` và `createTask` không được gọi.

- [ ] **Step 22: Cho việc từ My AI đi lên UniWork**

Trong `apps/shell/src/renderer/src/agent-intent-apply.ts`:

1. Xóa dòng `  readTasks,` và `  writeTasks,` khỏi import `./workbench-pins` (import nhiều dòng từ Task 2). Dưới import `./my-ai-consent`, thêm:
```ts
import { pickActiveWorkspace, readActiveWorkspaceId } from './active-workspace'
```
2. Thay như sau:
- trước:
```ts
function addItem(
  practiceId: PracticeId,
  moduleId: WorkbenchModuleId,
  text: string,
): { vi: string; en: string; undo: AgentAddUndo } | null {
  const title = text.trim() || 'Untitled'
  if (!moduleSupportsAddItem(moduleId)) return null
  const place = workbenchModuleLabel(moduleId, true)
  const placeEn = workbenchModuleLabel(moduleId, false)

  if (moduleId === 'tasks') {
    const id = newId()
    const now = new Date().toISOString()
    writeTasks(practiceId, [
      {
        id,
        title,
        done: false,
        status: 'todo',
        priority: 'medium',
        createdAt: now,
        updatedAt: now,
      },
      ...readTasks(practiceId),
    ])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
```
- sau:
```ts
interface AddItemOutcome {
  vi: string
  en: string
  /** on-device rows only: a UniWork task has no local Undo */
  undo?: AgentAddUndo
  failed?: boolean
}

/** The workspace a My AI task lands in: the Workbench's active one, else the first listed. */
async function agentWorkspaceId(): Promise<string | null> {
  const listed = await window.aiOffice.uniworkListWorkspaces()
  return listed.ok ? pickActiveWorkspace(listed.value, readActiveWorkspaceId()) : null
}

async function addItem(
  practiceId: PracticeId,
  moduleId: WorkbenchModuleId,
  text: string,
): Promise<AddItemOutcome | null> {
  const title = text.trim() || 'Untitled'
  if (!moduleSupportsAddItem(moduleId)) return null
  const place = workbenchModuleLabel(moduleId, true)
  const placeEn = workbenchModuleLabel(moduleId, false)

  if (moduleId === 'tasks') {
    const workspaceId = await agentWorkspaceId()
    const created = workspaceId
      ? await window.uniworkWork.createTask({
          workspaceId,
          title,
          idempotencyKey: crypto.randomUUID(),
        })
      : null
    if (!created?.ok) {
      return {
        vi: `Không thêm được vào ${place} trên UniWork: ${title}`,
        en: `Could not add to ${placeEn} on UniWork: ${title}`,
        failed: true,
      }
    }
    return { vi: `Đã thêm vào ${place}: ${title}`, en: `Added to ${placeEn}: ${title}` }
  }
```
3. Trong `undoAgentAddItem`:
- trước:
```ts
  if (moduleId === 'tasks') {
    writeTasks(
      practiceId,
      readTasks(practiceId).filter((t) => t.id !== itemId),
    )
  } else if (moduleId === 'notes') {
```
- sau:
```ts
  if (moduleId === 'notes') {
```
4. Cho `applyAgentIntent` thành async:
- trước: `export function applyAgentIntent(` … `): AgentIntentApplyResult {`
  sau: `export async function applyAgentIntent(` … `): Promise<AgentIntentApplyResult> {`
- trước: `    const msg = addItem(practiceId, intent.target.id, intent.text ?? intent.summary)`
  sau: `    const msg = await addItem(practiceId, intent.target.id, intent.text ?? intent.summary)`
- trước:
```ts
    if (msg) {
      return {
        ok: true,
        tabId,
        messageVi: msg.vi,
        messageEn: msg.en,
        undo: msg.undo,
      }
    }
```
- sau:
```ts
    if (msg) {
      return {
        ok: !msg.failed,
        tabId,
        messageVi: msg.vi,
        messageEn: msg.en,
        ...(msg.undo ? { undo: msg.undo } : {}),
      }
    }
```

- [ ] **Step 23: Cho hai nơi gọi chờ kết quả**

`apps/shell/src/renderer/src/NewChatPane.tsx` (trong `executeStep` async):
- trước: `    const result = applyAgentIntent(step.intent, practiceId)`
- sau: `    const result = await applyAgentIntent(step.intent, practiceId)`

`apps/shell/src/renderer/src/AgentIntentBanner.tsx`:
- trước:
```ts
  const runApply = (intent: AgentIntent) => {
    // Switch into Workbench first; navigate bus keeps the tab switch if home mounts late.
    ensureWorkbench()
    const result = applyAgentIntent(intent, practiceId)
```
- sau:
```ts
  const runApply = async (intent: AgentIntent) => {
    // Switch into Workbench first; navigate bus keeps the tab switch if home mounts late.
    ensureWorkbench()
    const result = await applyAgentIntent(intent, practiceId)
```
- trước: `<button type="button" className="btn btn-primary" onClick={() => runApply(pending)}>` (dòng 106 ở HEAD; Task 12 không đổi dòng này vì nó không có class `teacher-*`)
- sau: `<button type="button" className="btn btn-primary" onClick={() => void runApply(pending)}>`

- [ ] **Step 24: Chạy, typecheck và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/agent-intent-apply-tasks.test.ts
cd /Users/ducquang/UNICOM/uniwork-office && npm run typecheck -w @genoffice/shell
npx eslint apps/shell/src/renderer/src/agent-intent-apply.ts apps/shell/src/renderer/src/AgentIntentBanner.tsx apps/shell/src/renderer/src/NewChatPane.tsx apps/shell/tests/agent-intent-apply-tasks.test.ts
npm run format
git add apps/shell/src/renderer/src/agent-intent-apply.ts apps/shell/src/renderer/src/AgentIntentBanner.tsx apps/shell/src/renderer/src/NewChatPane.tsx apps/shell/tests/agent-intent-apply-tasks.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): My AI adds tasks to UniWork instead of the local list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
Kết quả mong đợi: PASS, 3 test; typecheck và eslint đều exit 0.

- [ ] **Step 25: Cho ngữ cảnh My AI đọc việc từ cache server**

`apps/shell/src/renderer/src/context-manager.ts`:
- trước (import một dòng từ Task 2): `import { readCalendar, readNotes, readTasks } from './workbench-pins'`
  sau:
  ```ts
  import { readCalendar, readNotes } from './workbench-pins'
  import { cachedOpenTasks } from './work-cache'
  ```
- trước: `    const open = readTasks(practiceId).filter((t) => !t.done).slice(0, MAX_LIST)`
  sau: `    const open = cachedOpenTasks().slice(0, MAX_LIST)`
- trước: `    const tasks = readTasks(practiceId).filter((t) => !t.done).length`
  sau: `    const tasks = cachedOpenTasks().length`
- trước: `  const openTasks = readTasks(practiceId).filter((t) => !t.done).slice(0, MAX_LIST)`
  sau: `  const openTasks = cachedOpenTasks().slice(0, MAX_LIST)`
- Thay cả hai `source: 'local:tasks',` bằng `source: 'uniwork:tasks',` (replace_all).

`apps/shell/src/renderer/src/my-ai-local-answer.ts`:
- trước (sau Task 3): `import { readCalendar, readNotes, readTasks } from './workbench-pins'`
  sau:
  ```ts
  import { readCalendar, readNotes } from './workbench-pins'
  import { cachedOpenTasks } from './work-cache'
  ```
- trước: `    tasks: readTasks(practiceId).map((t) => ({ title: t.title, done: t.done })),`
  sau: `    tasks: cachedOpenTasks().map((t) => ({ title: t.title, done: false })),`

- [ ] **Step 26: Gỡ store việc cục bộ và pane cũ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git rm apps/shell/src/renderer/src/TasksPane.tsx
```
`workbench-reminders.ts` đã bị xóa ở Task 13 cùng `DeskPane`; việc đến hạn giờ hiện ở Tổng quan và inbox trên web.

Trong `apps/shell/src/renderer/src/workbench-pins.ts`, xóa:
- khối từ `/** Personal task board — no approval workflow. */` tới dấu `}` đóng `export function taskWithStatus(…)`. Gồm `WbTaskStatus`, `WbTaskPriority`, `TasksViewId`, `WbTaskAttachmentMeta`, `WbTaskItem`, `normalizeTaskItem` và `taskWithStatus`;
- khối từ `export function readTasks(practiceId: PracticeId): WbTaskItem[] {` tới dấu `}` đóng `export async function deleteTaskAttachmentBlob(…)`. Gồm `readTasks`, `writeTasks`, `readTasksView`, `writeTasksView`, `TASK_MEDIA_DB`, `TASK_MEDIA_STORE`, `openTaskMediaDb`, `putTaskAttachmentBlob`, `getTaskAttachmentBlob` và `deleteTaskAttachmentBlob`;
- dòng `import { wbMediaDbName } from './workbench-bucket'`. Ở HEAD `wbMediaDbName` được gọi ba chỗ: `openTaskMediaDb` (xóa ở bước này), store media sức khỏe và pets (xóa ở Task 3 Step 3), nên sau bước này import không còn ai dùng và ESLint sẽ báo nếu giữ lại.

Giữ nguyên slot `tasks` trong `workbench-media-backup.ts` (xem ghi chú cuối Task 19).

- [ ] **Step 27: Gỡ CSS `.wb-tasks*` cũ**

Dùng `strip-css-rules.cjs` (Task 13 Step 11; nếu thư mục tạm bị xóa, tạo lại từ đó):
```bash
cd /Users/ducquang/UNICOM/uniwork-office
NODE_PATH=$PWD/node_modules node "${TMPDIR:-/tmp}/wb-css/strip-css-rules.cjs" apps/shell/src/renderer/src/home.css .wb-tasks
```
Kết quả mong đợi: `rules touched:` với một số trên 100 (133 trên file hiện tại) và `vars removed: 0`. Trong rule gộp `.wb-cal, .wb-tasks {` (Task 3 đã thu gọn), chỉ selector `.wb-tasks` bị bỏ.

- [ ] **Step 28: Xác nhận không còn gì dùng store việc cục bộ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
grep -rnw -e readTasks -e writeTasks -e WbTaskItem -e normalizeTaskItem -e putTaskAttachmentBlob -e getTaskAttachmentBlob -e deleteTaskAttachmentBlob -e TasksPane -e workbench-reminders -e wb-tasks apps/shell/src apps/shell/tests e2e
```
Kết quả mong đợi: không có output.

- [ ] **Step 29: Typecheck, lint và chạy mọi test shell và practice-core**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src apps/shell/tests
cd apps/shell && npx vitest run && cd ../../packages/practice-core && npx vitest run
```
Kết quả mong đợi: typecheck exit 0, eslint exit 0, mọi suite shell và practice-core pass.

- [ ] **Step 30: Commit phần gỡ bỏ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run format
git add -A apps/shell/src/renderer/src/TasksPane.tsx apps/shell/src/renderer/src/workbench-pins.ts apps/shell/src/renderer/src/context-manager.ts apps/shell/src/renderer/src/my-ai-local-answer.ts apps/shell/src/renderer/src/home.css
git commit -m "$(cat <<'EOF'
refactor(shell): drop the local tasks store and the old Tasks pane

UniWork is the source of truth for tasks (ADR 0016); My AI context reads
the last loaded server tasks of the active workspace.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 15: Tab Lịch dùng dữ liệu UniWork (agenda 14 ngày)

Ghi chú hợp đồng: `add_item` của My AI cho Lịch được đổi thành `open`, vì không có route tạo cuộc họp (họp tạo trên web).

**Files:**
- Create: `apps/shell/src/renderer/src/work-calendar.ts`, `apps/shell/src/renderer/src/WorkCalendarPane.tsx`
- Test (create): `apps/shell/tests/work-calendar.test.ts`, `apps/shell/tests/work-calendar-pane.test.ts`
- Test (modify): `apps/shell/tests/work-cache.test.ts`, `apps/shell/tests/agent-intent-apply-tasks.test.ts`, `packages/practice-core/tests/agent-intent.test.ts`
- Modify: `apps/shell/src/renderer/src/work-cache.ts` (thêm `cachedAgendaItems`)
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts`
- Modify: `apps/shell/src/renderer/src/home.css` (thêm khối; gỡ `.wb-cal*`, `.wb-task-check`)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (import `CalendarPane`, nhánh calendar)
- Modify: `packages/practice-core/src/modules.ts` (gợi ý của mục calendar), `packages/practice-core/src/agent-intent.ts` (resolver; `moduleSupportsAddItem`)
- Modify: `apps/shell/src/renderer/src/agent-intent-apply.ts` (nhánh calendar, helper `newId`/`todayIso`), `apps/shell/src/renderer/src/context-manager.ts` (import calendar và 2 chỗ đọc), `apps/shell/src/renderer/src/my-ai-local-answer.ts` (import calendar và một dòng)
- Modify: `apps/shell/src/renderer/src/workbench-pins.ts` (gỡ store lịch cục bộ)
- Delete: `apps/shell/src/renderer/src/CalendarPane.tsx`

**Interfaces:**
- Consumes:
  - `UniworkWorkApi.calendarEvents({ workspaceId, from, to }): Promise<UniworkWorkResult<WorkCalendarEvent[]>>` và `.openWeb(WorkWebTarget)`;
  - `MODULE_TONES`, `MEETING_TINT`, `tintStyle(t: Tint)` và `Tint` (`module-tones.ts`);
  - từ Task 14: `localIsoDate`, `cacheWork`, `cachedWork`, `WB_REFRESH_EVENT`, `WorkErrorState`, `WorkNoWorkspace`, `WorkStaleNote`, và prop `workspace` của `WorkbenchModulePane`.
- Produces:
  - `work-calendar.ts`: `AGENDA_DAYS = 14`; `agendaRange(today: string, days?: number): { from: string; to: string }`; `eventDay(e: WorkCalendarEvent): string | null`; `groupAgenda(events: readonly WorkCalendarEvent[], from: string, to: string): { day: string; events: WorkCalendarEvent[] }[]`
  - `work-cache.ts`: `cachedAgendaItems(): { date: string; title: string }[]`
  - `WorkCalendarPane({ workspace: UniworkWorkspaceRef | null }): ReactElement`
  - practice-core: `moduleSupportsAddItem(id)` chỉ đúng với `tasks | notes`; `resolveAgentIntentFromText` đổi `add_item` trên module không hỗ trợ thêm thành `open`.

- [ ] **Step 1: Viết test hàm agenda sẽ fail**

`apps/shell/tests/work-calendar.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { WorkCalendarEvent } from '../src/shared/uniwork-work-api'
import { agendaRange, eventDay, groupAgenda } from '../src/renderer/src/work-calendar'

const ev = (id: string, start: string, allDay: boolean, kind = 'task', title = id): WorkCalendarEvent => ({
  id,
  kind,
  entity_id: id,
  title,
  start,
  all_day: allDay,
})

describe('agendaRange', () => {
  it('covers 14 days starting today, both ends inclusive', () => {
    expect(agendaRange('2026-10-13')).toEqual({ from: '2026-10-13', to: '2026-10-26' })
    expect(agendaRange('2026-12-25')).toEqual({ from: '2026-12-25', to: '2027-01-07' })
  })
})

describe('eventDay', () => {
  it('keeps an all-day date and converts a timed start to the local day', () => {
    expect(eventDay(ev('a', '2026-10-14', true))).toBe('2026-10-14')
    const lateEvening = new Date(2026, 9, 15, 23, 30)
    expect(eventDay(ev('m', lateEvening.toISOString(), false, 'meeting'))).toBe('2026-10-15')
  })

  it('is null for an unreadable start', () => {
    expect(eventDay(ev('x', 'soon', false))).toBeNull()
  })
})

describe('groupAgenda', () => {
  const from = '2026-10-13'
  const to = '2026-10-26'

  it('groups by day in order, all-day rows first, then by start time', () => {
    const nine = new Date(2026, 9, 14, 9, 0).toISOString()
    const eight = new Date(2026, 9, 14, 8, 0).toISOString()
    const days = groupAgenda(
      [
        ev('m9', nine, false, 'meeting'),
        ev('t', '2026-10-14', true),
        ev('m8', eight, false, 'meeting'),
        ev('first', '2026-10-13', true),
      ],
      from,
      to,
    )
    expect(days.map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ['2026-10-13', ['first']],
      ['2026-10-14', ['t', 'm8', 'm9']],
    ])
  })

  it('puts an event that began before the range on the first day and drops days after it', () => {
    const days = groupAgenda([ev('old', '2026-10-10', true), ev('late', '2026-10-27', true)], from, to)
    expect(days).toEqual([{ day: from, events: [expect.objectContaining({ id: 'old' })] }])
  })
})
```

- [ ] **Step 2: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-calendar.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/work-calendar"`.

- [ ] **Step 3: Viết `work-calendar.ts`**

`apps/shell/src/renderer/src/work-calendar.ts`:
```ts
/** Calendar tab helpers (pure): the 14-day agenda window and its day groups. */
import type { WorkCalendarEvent } from '../../shared/uniwork-work-api'
import { localIsoDate } from './work-tasks'

export const AGENDA_DAYS = 14

/** [from, to] (YYYY-MM-DD, both inclusive, as the server reads them) starting on `today` */
export function agendaRange(today: string, days = AGENDA_DAYS): { from: string; to: string } {
  const last = new Date(`${today}T00:00:00`)
  last.setDate(last.getDate() + days - 1)
  return { from: today, to: localIsoDate(last) }
}

/** Local day of an event: an all-day start is a date already, a timed (RFC 3339) start is converted; null when unreadable. */
export function eventDay(e: WorkCalendarEvent): string | null {
  if (e.all_day) return /^\d{4}-\d{2}-\d{2}/.test(e.start) ? e.start.slice(0, 10) : null
  const at = new Date(e.start)
  return Number.isNaN(at.getTime()) ? null : localIsoDate(at)
}

/**
 * Days of [from, to] that have events, in order; all-day rows first, then by
 * start time, then title. An event that began before `from` lands on `from`.
 */
export function groupAgenda(
  events: readonly WorkCalendarEvent[],
  from: string,
  to: string,
): { day: string; events: WorkCalendarEvent[] }[] {
  const byDay = new Map<string, WorkCalendarEvent[]>()
  for (const e of events) {
    const raw = eventDay(e)
    if (!raw || raw > to) continue
    const day = raw < from ? from : raw
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  return [...byDay.keys()].sort().map((day) => ({
    day,
    events: byDay
      .get(day)!
      .sort(
        (a, b) =>
          Number(b.all_day) - Number(a.all_day) ||
          Date.parse(a.start) - Date.parse(b.start) ||
          a.title.localeCompare(b.title),
      ),
  }))
}
```

- [ ] **Step 4: Chạy và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-calendar.test.ts`
Kết quả mong đợi: PASS, 5 test.

- [ ] **Step 5: Thêm test cache agenda của My AI sẽ fail**

Trong `apps/shell/tests/work-cache.test.ts`:
- trước: `import { cacheWork, cachedOpenTasks, cachedWork } from '../src/renderer/src/work-cache'`
  sau: `import { cacheWork, cachedAgendaItems, cachedOpenTasks, cachedWork } from '../src/renderer/src/work-cache'`
- Thêm `it` này làm test cuối trong `describe('work cache', …)`:
```ts
  it('My AI sees the active workspace agenda as day + title, unreadable rows dropped', () => {
    cacheWork('calendar:w1', [
      { id: 'e1', kind: 'task', entity_id: 't1', title: 'Send quote', start: '2026-10-14', all_day: true },
      { id: 'e2', kind: 'meeting', entity_id: 'm1', title: 'Broken', start: 'later', all_day: false },
    ])
    expect(cachedAgendaItems()).toEqual([{ date: '2026-10-14', title: 'Send quote' }])
    env.active = null
    expect(cachedAgendaItems()).toEqual([])
  })
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-cache.test.ts`
Kết quả mong đợi: FAIL với `cachedAgendaItems is not a function`.

- [ ] **Step 6: Viết `cachedAgendaItems`**

Trong `apps/shell/src/renderer/src/work-cache.ts`:
- trước: `import type { WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'`
  sau: `import type { WorkCalendarEvent, WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'`
- dưới import `./workbench-bucket`, thêm `import { eventDay } from './work-calendar'`
- thêm vào cuối file:
```ts
/** The active workspace's agenda from the last load, as day + title (My AI grounding). */
export function cachedAgendaItems(): { date: string; title: string }[] {
  const ws = readActiveWorkspaceId()
  const events = ws ? (cachedWork<WorkCalendarEvent[]>(`calendar:${ws}`)?.value ?? []) : []
  return events.flatMap((e) => {
    const date = eventDay(e)
    return date ? [{ date, title: e.title }] : []
  })
}
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-cache.test.ts tests/work-calendar.test.ts`
Kết quả mong đợi: PASS, 9 test.

- [ ] **Step 7: Commit các hàm hỗ trợ**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run format
git add apps/shell/src/renderer/src/work-calendar.ts apps/shell/src/renderer/src/work-cache.ts apps/shell/tests/work-calendar.test.ts apps/shell/tests/work-cache.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): 14-day agenda helpers for the Workbench Calendar tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Thêm chuỗi Lịch (zh, vi, en)**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"   # insert.cjs from Task 12 Step 10; re-create it from there if the temp dir was cleared
cat > "$K/t15-zh.txt" <<'EOF'
  wbCalToday: '今天',
  wbCalAllDay: '全天',
  wbCalEmpty: '未来 14 天没有任务或会议。',
  wbCalKindTask: '任务',
  wbCalKindMeeting: '会议',
  wbCalKindExternal: '外部日历',
EOF
cat > "$K/t15-vi.txt" <<'EOF'
  wbCalToday: 'Hôm nay',
  wbCalAllDay: 'Cả ngày',
  wbCalEmpty: 'Không có việc hay cuộc họp nào trong 14 ngày tới.',
  wbCalKindTask: 'Việc',
  wbCalKindMeeting: 'Cuộc họp',
  wbCalKindExternal: 'Lịch bên ngoài',
EOF
cat > "$K/t15-en.txt" <<'EOF'
  wbCalToday: 'Today',
  wbCalAllDay: 'All day',
  wbCalEmpty: 'No tasks or meetings in the next 14 days.',
  wbCalKindTask: 'Task',
  wbCalKindMeeting: 'Meeting',
  wbCalKindExternal: 'External calendar',
EOF
node "$K/insert.cjs" "$K/t15-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t15-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t15-en.txt" $D/en.ts
npx prettier --write $D
npm run typecheck -w @genoffice/shell
```
Kết quả mong đợi: typecheck exit 0.

- [ ] **Step 9: Viết test component tab Lịch sẽ fail**

Test cuối là test ghim của Review Focus 5.

`apps/shell/tests/work-calendar-pane.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { WorkCalendarEvent } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkCalendarPane } from '../src/renderer/src/WorkCalendarPane'
import { agendaRange } from '../src/renderer/src/work-calendar'
import { localIsoDate } from '../src/renderer/src/work-tasks'

vi.mock('../src/renderer/src/active-workspace', () => ({ readActiveWorkspaceId: () => 'w1' }))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
const TODAY = localIsoDate(new Date())
const inOneHour = new Date(Date.now() + 3_600_000)
const EVENTS: WorkCalendarEvent[] = [
  { id: 'task:t1', kind: 'task', entity_id: 't1', title: 'File the report', start: TODAY, all_day: true },
  {
    id: 'meeting:m1',
    kind: 'meeting',
    entity_id: 'm1',
    title: 'Weekly sync',
    start: inOneHour.toISOString(),
    all_day: false,
  },
]

let host: HTMLDivElement
let root: Root
const api = {
  calendarEvents: vi.fn(async () => ({ ok: true as const, value: EVENTS })),
  openWeb: vi.fn(async () => true),
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api.calendarEvents.mockClear()
  api.openWeb.mockClear()
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkCalendarPane, { workspace: WS })),
    )
  })
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

describe('Calendar tab', () => {
  it('asks for my 14-day window and tells tasks from meetings', async () => {
    await mount()
    expect(api.calendarEvents).toHaveBeenCalledWith({ workspaceId: 'w1', ...agendaRange(TODAY) })
    const labels = Array.from(host.querySelectorAll('.wb-agenda-icon')).map((n) => n.getAttribute('aria-label'))
    expect(labels).toEqual(['Task', 'Meeting'])
    expect(host.textContent).toContain('All day')
  })

  it('a row opens the item on the web', async () => {
    await mount()
    const meeting = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-agenda-row')).find((b) =>
      b.textContent?.includes('Weekly sync'),
    )!
    await act(async () => meeting.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'meeting', orgSlug: 'acme', wsSlug: 'ops', id: 'm1' })
  })

  it('an event kind the desktop does not know shows as external and opens the web calendar', async () => {
    api.calendarEvents.mockResolvedValueOnce({
      ok: true,
      value: [
        { id: 'x:1', kind: 'reminder', entity_id: 'r1', title: 'Renew licence', start: TODAY, all_day: true },
      ],
    })
    await mount()
    expect(host.querySelector('.wb-agenda-icon')?.getAttribute('aria-label')).toBe('External calendar')
    expect(host.textContent).toContain('Renew licence')
    const row = host.querySelector<HTMLButtonElement>('.wb-agenda-row')!
    await act(async () => row.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'calendar', orgSlug: 'acme', wsSlug: 'ops' })
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-calendar-pane.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/WorkCalendarPane"`.

- [ ] **Step 10: Tạo tab Lịch**

`apps/shell/src/renderer/src/WorkCalendarPane.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError, WorkCalendarEvent, WorkWebTarget } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MEETING_TINT, MODULE_TONES, tintStyle, type Tint } from './module-tones'
import { WB_REFRESH_EVENT, cacheWork, cachedWork } from './work-cache'
import { agendaRange, groupAgenda } from './work-calendar'
import { localIsoDate } from './work-tasks'
import { WorkErrorState, WorkNoWorkspace, WorkStaleNote } from './WorkErrorState'

type AgendaKind = 'task' | 'meeting' | 'external'

const KIND: Record<AgendaKind, { tint: Tint; label: StringKey }> = {
  task: { tint: MODULE_TONES.tasks, label: 'wbCalKindTask' },
  meeting: { tint: MEETING_TINT, label: 'wbCalKindMeeting' },
  external: { tint: 'gray', label: 'wbCalKindExternal' },
}

const kindOf = (e: WorkCalendarEvent): AgendaKind =>
  e.kind === 'task' ? 'task' : e.kind === 'meeting' ? 'meeting' : 'external'

function webTarget(e: WorkCalendarEvent, ws: UniworkWorkspaceRef): WorkWebTarget {
  const at = { orgSlug: ws.orgSlug, wsSlug: ws.slug }
  if (e.kind === 'task') return { kind: 'task', ...at, id: e.entity_id }
  if (e.kind === 'meeting') return { kind: 'meeting', ...at, id: e.entity_id }
  return { kind: 'calendar', ...at }
}

function KindIcon({ kind }: { kind: AgendaKind }): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {kind === 'task' ? (
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : kind === 'meeting' ? (
        <>
          <rect x="2" y="4.5" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 7l4-2v6l-4-2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" />
        </>
      )}
    </svg>
  )
}

/** Calendar tab: the next 14 days of the user's UniWork tasks and meetings, by day; a row opens on the web. */
export function WorkCalendarPane({ workspace }: { workspace: UniworkWorkspaceRef | null }): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const loadSeq = useRef(0)
  const [events, setEvents] = useState<WorkCalendarEvent[] | null>(null)
  const [error, setError] = useState<UniworkWorkError | null>(null)
  const [staleAt, setStaleAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!wsId) return
    const mine = ++loadSeq.current
    const r = await window.uniworkWork.calendarEvents({
      workspaceId: wsId,
      ...agendaRange(localIsoDate(new Date())),
    })
    if (mine !== loadSeq.current) return
    if (r.ok) {
      cacheWork(`calendar:${wsId}`, r.value)
      setEvents(r.value)
      setError(null)
      setStaleAt(null)
      return
    }
    const cached = r.error === 'offline' ? cachedWork<WorkCalendarEvent[]>(`calendar:${wsId}`) : null
    setEvents(cached?.value ?? null)
    setStaleAt(cached?.at ?? null)
    setError(r.error)
  }, [wsId])

  useEffect(() => {
    setEvents(null)
    setError(null)
    setStaleAt(null)
    void load()
    const reload = () => void load()
    window.addEventListener('focus', reload)
    window.addEventListener(WB_REFRESH_EVENT, reload)
    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener(WB_REFRESH_EVENT, reload)
    }
  }, [load])

  if (!workspace) return <WorkNoWorkspace />
  if (!events) {
    return error ? (
      <WorkErrorState state={error} onRetry={() => void load()} />
    ) : (
      <div className="wb-work-skeleton" aria-busy="true" />
    )
  }

  const today = localIsoDate(new Date())
  const { from, to } = agendaRange(today)
  const days = groupAgenda(events, from, to)
  const dayTitle = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString(dateLocale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="wb-work">
      {staleAt !== null ? <WorkStaleNote at={staleAt} onRetry={() => void load()} /> : null}
      {days.length === 0 ? (
        <p className="wb-work-state">{t('wbCalEmpty')}</p>
      ) : (
        days.map(({ day, events: rows }) => (
          <section key={day} className="wb-agenda-day">
            <h3>{day === today ? `${t('wbCalToday')} · ${dayTitle(day)}` : dayTitle(day)}</h3>
            <ul>
              {rows.map((e) => {
                const kind = kindOf(e)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="wb-agenda-row"
                      title={t('wbWorkOpenOnWeb')}
                      onClick={() => void window.uniworkWork.openWeb(webTarget(e, workspace))}
                    >
                      <span
                        className="wb-agenda-icon"
                        style={tintStyle(KIND[kind].tint)}
                        role="img"
                        aria-label={t(KIND[kind].label)}
                      >
                        <KindIcon kind={kind} />
                      </span>
                      <span className="wb-agenda-time">
                        {e.all_day ? t('wbCalAllDay') : timeOf(e.start)}
                      </span>
                      <span className="wb-agenda-title">{e.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
```

Thêm vào cuối `apps/shell/src/renderer/src/home.css`:
```css
.wb-agenda-day h3 {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.wb-agenda-day ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-agenda-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: start;
  cursor: pointer;
}

.wb-agenda-row:hover {
  background: var(--hover);
}

.wb-agenda-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
}

.wb-agenda-time {
  flex: none;
  width: 72px;
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-agenda-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-calendar-pane.test.ts`
Kết quả mong đợi: PASS, 3 test.

- [ ] **Step 11: Gắn tab Lịch và commit**

`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- trước: `import { CalendarPane } from './CalendarPane'`
  sau: `import { WorkCalendarPane } from './WorkCalendarPane'`
- trước: `      {moduleId === 'calendar' && <CalendarPane practiceId={practiceId} vi={vi} />}`
  sau: `      {moduleId === 'calendar' && <WorkCalendarPane workspace={workspace} />}`

`packages/practice-core/src/modules.ts` (mục calendar):
- trước:
```ts
    hintVi: 'Xem dạng Calendar hoặc danh sách · mốc hạn theo vai trò',
    hintEn: 'Calendar or list view · role deadlines',
```
- sau:
```ts
    hintVi: 'Việc có hạn và cuộc họp trong 14 ngày tới',
    hintEn: 'Due tasks and meetings in the next 14 days',
```
```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/tests/work-calendar-pane.test.ts
npm run format
git add apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench packages/practice-core/src/modules.ts apps/shell/tests/work-calendar-pane.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Calendar tab shows the 14-day UniWork agenda

Tasks (green) and meetings (violet) by icon and tint; a row opens the item
on the web.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Viết test `add_item` của Lịch sẽ fail**

Thêm `it` này làm test cuối trong `describe('agent-intent catalog', …)` của `packages/practice-core/tests/agent-intent.test.ts`:
```ts
  it('opens Calendar for an add request: meetings are created on the web', () => {
    const intent = resolveAgentIntentFromText('Thêm cuộc họp vào lịch tuần sau')
    expect(intent?.target).toEqual({ kind: 'module', id: 'calendar' })
    expect(intent?.action).toBe('open')
    expect(moduleSupportsAddItem('calendar')).toBe(false)
    expect(moduleSupportsAddItem('tasks')).toBe(true)
  })
```
Thêm `it` này làm test cuối trong `apps/shell/tests/agent-intent-apply-tasks.test.ts`:
```ts
  it('an add request for Calendar opens the tab and writes nothing', async () => {
    const r = await applyAgentIntent(
      createAgentIntent({
        target: { kind: 'module', id: 'calendar' },
        action: 'add_item',
        source: 'desktop',
        summary: 'x',
        text: 'Họp khách',
      }),
      'entrepreneur',
    )
    expect(r).toMatchObject({ ok: true, tabId: 'calendar', messageEn: 'Opened calendar.' })
    expect(createTask).not.toHaveBeenCalled()
  })
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run tests/agent-intent.test.ts; cd ../../apps/shell && npx vitest run tests/agent-intent-apply-tasks.test.ts`
Kết quả mong đợi: cả hai FAIL. practice-core báo `expected 'add_item' to be 'open'`. Shell báo `[vitest] No "writeCalendar" export is defined on the mock`.

- [ ] **Step 13: Bỏ `add_item` của Lịch và việc ghi lịch cục bộ**

Trong `packages/practice-core/src/agent-intent.ts`:
- Thay toàn bộ hàm `moduleSupportsAddItem` bằng:
```ts
/** Modules that support add_item (must write a real row): Tasks on UniWork, Notes on this device. */
export function moduleSupportsAddItem(id: WorkbenchModuleId): boolean {
  return id === 'tasks' || id === 'notes'
}
```
- Trong `resolveAgentIntentFromText`:
  - trước:
```ts
    if (action === 'add_item') {
      target = { kind: 'module', id: 'tasks' }
    } else {
      return null
    }
  }

  const modLabel =
```
  - sau:
```ts
    if (action === 'add_item') {
      target = { kind: 'module', id: 'tasks' }
    } else {
      return null
    }
  }
  // a tab without add_item (Calendar: meetings are created on the web) opens instead
  if (action === 'add_item' && target.kind === 'module' && !moduleSupportsAddItem(target.id)) {
    action = 'open'
  }

  const modLabel =
```

Trong `apps/shell/src/renderer/src/agent-intent-apply.ts`:
- Xóa dòng `  readCalendar,` và `  writeCalendar,` khỏi import `./workbench-pins`.
- Xóa khối này trong `addItem`:
```ts
  if (moduleId === 'calendar') {
    const id = newId()
    writeCalendar(practiceId, [{ id, date: todayIso(), title }, ...readCalendar(practiceId)])
    return {
      vi: `Đã thêm vào ${place}: ${title}`,
      en: `Added to ${placeEn}: ${title}`,
      undo: { moduleId, itemId: id },
    }
  }
```
- Xóa nhánh này trong `undoAgentAddItem`:
```ts
  } else if (moduleId === 'calendar') {
    writeCalendar(
      practiceId,
      readCalendar(practiceId).filter((c) => c.id !== itemId),
    )
```
- Chạy `grep -n "newId()\|todayIso()" apps/shell/src/renderer/src/agent-intent-apply.ts`. Khi chỉ còn hai dòng định nghĩa `function`, xóa `function newId(): string {…}` và `function todayIso(): string {…}`.

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/packages/practice-core && npx vitest run; cd ../../apps/shell && npx vitest run tests/agent-intent-apply-tasks.test.ts`
Kết quả mong đợi: PASS, practice-core xanh toàn bộ (11 test) và agent-intent-apply 4 test.

- [ ] **Step 14: Cho ngữ cảnh My AI đọc agenda từ cache**

`apps/shell/src/renderer/src/context-manager.ts`:
- trước (sau Task 14): `import { readCalendar, readNotes } from './workbench-pins'`
  sau: `import { readNotes } from './workbench-pins'`
- trước: `import { cachedOpenTasks } from './work-cache'`
  sau: `import { cachedAgendaItems, cachedOpenTasks } from './work-cache'`
- trước: `    const items = readCalendar(practiceId).slice(0, MAX_LIST)`
  sau: `    const items = cachedAgendaItems().slice(0, MAX_LIST)`
- trước: `  const cal = readCalendar(practiceId).slice(0, MAX_LIST)`
  sau: `  const cal = cachedAgendaItems().slice(0, MAX_LIST)`
- Thay cả hai `source: 'local:calendar',` bằng `source: 'uniwork:calendar',` (replace_all).

`apps/shell/src/renderer/src/my-ai-local-answer.ts`:
- trước (sau Task 14): `import { readCalendar, readNotes } from './workbench-pins'`
  sau: `import { readNotes } from './workbench-pins'`
- trước: `import { cachedOpenTasks } from './work-cache'`
  sau: `import { cachedAgendaItems, cachedOpenTasks } from './work-cache'`
- trước: `    calendar: readCalendar(practiceId).map((c) => ({ date: c.date, title: c.title })),`
  sau: `    calendar: cachedAgendaItems(),`

- [ ] **Step 15: Gỡ store lịch cục bộ, pane cũ và CSS của nó**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git rm apps/shell/src/renderer/src/CalendarPane.tsx
grep -rn "wb-task-check\|wb-cal-\|\"wb-cal\"" apps/shell/src/renderer/src --include='*.tsx'
```
Kết quả mong đợi: grep không in gì. Những nơi khác từng dùng (GrowthPane, TravelPane, HealthPane) đã bị xóa ở Task 2–3.

Trong `apps/shell/src/renderer/src/workbench-pins.ts`, xóa:
- `export interface WbCalendarItem {…}`, `export type CalendarViewMode`, `export function readCalendarView(…)` và `export function writeCalendarView(…)`. Giữ comment `// ── Lightweight local module data (per practice) ───────────` phía trên;
- `export function readCalendar(…) {…}` và `export function writeCalendar(…) {…}`.

```bash
NODE_PATH=$PWD/node_modules node "${TMPDIR:-/tmp}/wb-css/strip-css-rules.cjs" apps/shell/src/renderer/src/home.css .wb-cal .wb-task-check
```
(Script ở Task 13 Step 11; tạo lại từ đó nếu thư mục tạm bị xóa.)
Kết quả mong đợi: `rules touched:` với một số trên 30 và `vars removed: 0`.

- [ ] **Step 16: Xác nhận không còn gì dùng store lịch cục bộ**

```bash
grep -rnw -e readCalendar -e writeCalendar -e WbCalendarItem -e readCalendarView -e writeCalendarView -e CalendarPane -e calendarEventsSyncing -e wb-cal -e wb-task-check apps/shell/src apps/shell/tests e2e
```
Kết quả mong đợi: không có output.

- [ ] **Step 17: Typecheck, lint, test và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src apps/shell/tests packages/practice-core
cd apps/shell && npx vitest run && cd ../../packages/practice-core && npx vitest run && cd ../..
npm run format
git add -A apps/shell/src/renderer/src/CalendarPane.tsx apps/shell/src/renderer/src/workbench-pins.ts apps/shell/src/renderer/src/agent-intent-apply.ts apps/shell/src/renderer/src/context-manager.ts apps/shell/src/renderer/src/my-ai-local-answer.ts apps/shell/src/renderer/src/home.css packages/practice-core/src/agent-intent.ts packages/practice-core/tests/agent-intent.test.ts apps/shell/tests/agent-intent-apply-tasks.test.ts
git commit -m "$(cat <<'EOF'
refactor(shell): drop the local calendar store and the old Calendar pane

A calendar add request from My AI opens the tab (meetings are created on
the web); My AI context reads the last loaded agenda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
Kết quả mong đợi: typecheck và eslint đều exit 0, mọi suite pass.

### Task 16: Tab Hồ sơ từ person của UniWork

**Files:**
- Create: `apps/shell/src/renderer/src/WorkProfilePane.tsx`
- Test (create): `apps/shell/tests/work-profile-pane.test.ts`
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts`
- Modify: `apps/shell/src/renderer/src/home.css` (thêm)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (import, nhánh personal, `FormsPane.openForm`, xóa `PersonalPane`)
- Modify: `packages/practice-core/src/modules.ts` (mục personal)
- Modify: `apps/shell/src/renderer/src/workbench-pins.ts` (gỡ `WbPersonalProfile`, `DEFAULT_PERSONAL`, `readPersonal`/`writePersonal`)

**Interfaces:**
- Consumes: `UniworkWorkApi.myProfile(): Promise<UniworkWorkResult<WorkPerson>>` và `.openWeb({ kind: 'person', orgSlug, wsSlug, id })`. `WorkPerson { user_id, display_name, email, title, department: {id,name}|null, manager: {id,kind,display_name}|null, timezone }`. Từ Task 14: `cacheWork`, `cachedWork`, `WB_REFRESH_EVENT`, `WorkErrorState`, `WorkNoWorkspace`, `WorkStaleNote`.
- Produces: `WorkProfilePane({ workspace: UniworkWorkspaceRef | null }): ReactElement`. Nút "Soạn" của `FormsPane` trộn `display_name`, `department.name` và `title` từ person trên server (spec 6.6).

- [ ] **Step 1: Thêm chuỗi Hồ sơ (zh, vi, en)**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"   # insert.cjs from Task 12 Step 10
cat > "$K/t16-zh.txt" <<'EOF'
  wbProfileJobTitle: '职位',
  wbProfileDepartment: '部门',
  wbProfileManager: '上级',
  wbProfileEmail: '邮箱',
  wbProfileTimezone: '时区',
  wbProfileHint: 'UniAI 起草文档时会使用这些信息。',
  wbProfileEditOnWeb: '在网页上编辑',
EOF
cat > "$K/t16-vi.txt" <<'EOF'
  wbProfileJobTitle: 'Chức danh',
  wbProfileDepartment: 'Phòng ban',
  wbProfileManager: 'Quản lý trực tiếp',
  wbProfileEmail: 'Email',
  wbProfileTimezone: 'Múi giờ',
  wbProfileHint: 'UniAI dùng thông tin này khi soạn văn bản.',
  wbProfileEditOnWeb: 'Sửa trên web',
EOF
cat > "$K/t16-en.txt" <<'EOF'
  wbProfileJobTitle: 'Job title',
  wbProfileDepartment: 'Department',
  wbProfileManager: 'Manager',
  wbProfileEmail: 'Email',
  wbProfileTimezone: 'Time zone',
  wbProfileHint: 'UniAI uses this information when drafting documents.',
  wbProfileEditOnWeb: 'Edit on the web',
EOF
node "$K/insert.cjs" "$K/t16-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t16-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t16-en.txt" $D/en.ts
npx prettier --write $D
npm run typecheck -w @genoffice/shell
```
Kết quả mong đợi: typecheck exit 0.

- [ ] **Step 2: Viết test component sẽ fail**

`apps/shell/tests/work-profile-pane.test.ts`:
```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkResult, WorkPerson } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkProfilePane } from '../src/renderer/src/WorkProfilePane'

vi.mock('../src/renderer/src/active-workspace', () => ({ readActiveWorkspaceId: () => 'w1' }))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
const PERSON: WorkPerson = {
  user_id: 'u1',
  display_name: 'Lan Nguyen',
  email: 'lan@example.test',
  title: 'Sales lead',
  department: { id: 'd1', name: 'Sales' },
  manager: { id: 'u0', kind: 'human', display_name: 'Minh Tran' },
  timezone: 'Asia/Ho_Chi_Minh',
}

let host: HTMLDivElement
let root: Root
let api: {
  myProfile: ReturnType<typeof vi.fn>
  openWeb: ReturnType<typeof vi.fn>
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkProfilePane, { workspace: WS })),
    )
  })
  await flush()
}

const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    myProfile: vi.fn(async (): Promise<UniworkWorkResult<WorkPerson>> => ({ ok: true, value: PERSON })),
    openWeb: vi.fn(async () => true),
  }
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Profile tab', () => {
  it('shows the read-only UniWork profile and opens it on the web', async () => {
    await mount()
    const text = host.textContent ?? ''
    for (const v of ['Lan Nguyen', 'Sales lead', 'Sales', 'Minh Tran', 'Asia/Ho_Chi_Minh']) {
      expect(text).toContain(v)
    }
    expect(host.querySelector('input, textarea')).toBeNull()
    await act(async () => buttonByText('Edit on the web')!.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'person', orgSlug: 'acme', wsSlug: 'ops', id: 'u1' })
  })

  it('a failed load offers Retry', async () => {
    api.myProfile.mockResolvedValueOnce({ ok: false, error: 'server' })
    await mount()
    expect(host.textContent).toContain('Could not load the data.')
    await act(async () => buttonByText('Retry')!.click())
    await flush()
    expect(host.textContent).toContain('Lan Nguyen')
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-profile-pane.test.ts`
Kết quả mong đợi: FAIL với `Failed to resolve import "../src/renderer/src/WorkProfilePane"`.

- [ ] **Step 3: Tạo tab Hồ sơ**

`apps/shell/src/renderer/src/WorkProfilePane.tsx`:
```tsx
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError, WorkPerson } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { WB_REFRESH_EVENT, cacheWork, cachedWork } from './work-cache'
import { WorkErrorState, WorkNoWorkspace, WorkStaleNote } from './WorkErrorState'

/** Profile tab: the signed-in user's UniWork profile, read-only; edits happen on the web. */
export function WorkProfilePane({ workspace }: { workspace: UniworkWorkspaceRef | null }): ReactElement {
  const { t } = useI18n()
  const orgId = workspace?.orgId ?? null
  const loadSeq = useRef(0)
  const [person, setPerson] = useState<WorkPerson | null>(null)
  const [error, setError] = useState<UniworkWorkError | null>(null)
  const [staleAt, setStaleAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    const mine = ++loadSeq.current
    const r = await window.uniworkWork.myProfile()
    if (mine !== loadSeq.current) return
    if (r.ok) {
      cacheWork(`profile:${orgId}`, r.value)
      setPerson(r.value)
      setError(null)
      setStaleAt(null)
      return
    }
    const cached = r.error === 'offline' ? cachedWork<WorkPerson>(`profile:${orgId}`) : null
    setPerson(cached?.value ?? null)
    setStaleAt(cached?.at ?? null)
    setError(r.error)
  }, [orgId])

  useEffect(() => {
    setPerson(null)
    setError(null)
    setStaleAt(null)
    void load()
    const reload = () => void load()
    window.addEventListener('focus', reload)
    window.addEventListener(WB_REFRESH_EVENT, reload)
    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener(WB_REFRESH_EVENT, reload)
    }
  }, [load])

  if (!workspace) return <WorkNoWorkspace />
  if (!person) {
    return error ? (
      <WorkErrorState state={error} onRetry={() => void load()} />
    ) : (
      <div className="wb-work-skeleton" aria-busy="true" />
    )
  }

  const rows: [StringKey, string][] = [
    ['wbProfileJobTitle', person.title],
    ['wbProfileDepartment', person.department?.name ?? ''],
    ['wbProfileManager', person.manager?.display_name ?? ''],
    ['wbProfileEmail', person.email],
    ['wbProfileTimezone', person.timezone],
  ]

  return (
    <div className="wb-work">
      {staleAt !== null ? <WorkStaleNote at={staleAt} onRetry={() => void load()} /> : null}
      <strong className="wb-profile-name">{person.display_name}</strong>
      <dl className="wb-profile">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{t(label)}</dt>
            <dd>{value || '—'}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="wb-work-muted">{t('wbProfileHint')}</p>
      <div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            void window.uniworkWork.openWeb({
              kind: 'person',
              orgSlug: workspace.orgSlug,
              wsSlug: workspace.slug,
              id: person.user_id,
            })
          }
        >
          {t('wbProfileEditOnWeb')}
        </button>
      </div>
    </div>
  )
}
```
Thêm vào cuối `apps/shell/src/renderer/src/home.css`:
```css
.wb-profile-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.wb-profile {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
  font-size: 13px;
}

.wb-profile dt {
  color: var(--text-secondary);
}

.wb-profile dd {
  margin: 0;
  color: var(--text);
}
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/work-profile-pane.test.ts`
Kết quả mong đợi: PASS, 2 test.

- [ ] **Step 4: Dùng tab Hồ sơ và cho "Soạn" của Biểu mẫu đọc hồ sơ server**

`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- Xóa các dòng `  readPersonal,`, `  writePersonal,` và `  type WbPersonalProfile,` khỏi import `./workbench-pins` (import nhiều dòng từ Task 2). Dưới import `./NotesPane`, thêm `import { WorkProfilePane } from './WorkProfilePane'`.
- trước: `      {moduleId === 'personal' && <PersonalPane vi={vi} />}`
  sau: `      {moduleId === 'personal' && <WorkProfilePane workspace={workspace} />}`
- Xóa toàn bộ `function PersonalPane({ vi }: { vi: boolean }): ReactElement { … }`.
- Trong `openForm` của `FormsPane` (đã là `async`):
  - trước:
```ts
    const profile = readPersonal()
    const metaLines = [
      profile.fullName ? `<p><strong>Họ tên:</strong> ${escapeHtml(profile.fullName)}</p>` : '',
      profile.org ? `<p><strong>Đơn vị:</strong> ${escapeHtml(profile.org)}</p>` : '',
      profile.title ? `<p><strong>Chức danh:</strong> ${escapeHtml(profile.title)}</p>` : '',
    ]
```
  - sau:
```ts
    // merge fields come from the UniWork profile; signed out, the draft has none
    const me = await window.uniworkWork.myProfile()
    const profile = me.ok ? me.value : null
    const metaLines = [
      profile?.display_name
        ? `<p><strong>Họ tên:</strong> ${escapeHtml(profile.display_name)}</p>`
        : '',
      profile?.department
        ? `<p><strong>Đơn vị:</strong> ${escapeHtml(profile.department.name)}</p>`
        : '',
      profile?.title ? `<p><strong>Chức danh:</strong> ${escapeHtml(profile.title)}</p>` : '',
    ]
```

`packages/practice-core/src/modules.ts` (mục personal):
- trước:
```ts
    labelVi: 'Cá nhân',
    labelEn: 'Personal',
    hintVi: 'Hồ sơ cá nhân dùng khi soạn văn bản',
    hintEn: 'Personal profile for drafting',
```
- sau:
```ts
    labelVi: 'Hồ sơ',
    labelEn: 'Profile',
    hintVi: 'Hồ sơ UniWork của bạn, chỉ đọc',
    hintEn: 'Your UniWork profile, read-only',
```

- [ ] **Step 5: Gỡ store hồ sơ cục bộ**

Trong `apps/shell/src/renderer/src/workbench-pins.ts`, xóa `export interface WbPersonalProfile {…}`, `const DEFAULT_PERSONAL: WbPersonalProfile = {…}`, `export function readPersonal(): WbPersonalProfile {…}` và `export function writePersonal(profile: WbPersonalProfile): void {…}`.

```bash
cd /Users/ducquang/UNICOM/uniwork-office
grep -rnw -e readPersonal -e writePersonal -e WbPersonalProfile -e PersonalPane -e DEFAULT_PERSONAL apps/shell/src apps/shell/tests
grep -rn "uniwork.wb.personal" apps/shell/src apps/shell/tests
```
Kết quả mong đợi: cả hai grep không in gì. Nơi đọc còn lại duy nhất, `EmailPane.tsx`, đã bị xóa ở Task 3.

- [ ] **Step 6: Typecheck, lint, test và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src/WorkProfilePane.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/workbench-pins.ts apps/shell/tests/work-profile-pane.test.ts
cd apps/shell && npx vitest run && cd ../..
npm run format
git add apps/shell/src/renderer/src/WorkProfilePane.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/workbench-pins.ts apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench packages/practice-core/src/modules.ts apps/shell/tests/work-profile-pane.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Profile tab shows the UniWork profile; Forms merge it

Read-only card (name, title, department, manager, time zone) with Edit on
the web; the local personal profile store is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 17: Làm lại các tab cục bộ (Biểu mẫu, Ghi chú, 4 trụ cột) và màu Bàn làm việc chỉ dùng token

**Files:**
- Create: `apps/shell/src/renderer/src/LocalTag.tsx`
- Rewrite: `apps/shell/src/renderer/src/NotesPane.tsx`
- Modify: `apps/shell/src/renderer/src/workbench-pins.ts` (khóa lưu của ghi chú và biểu mẫu không còn theo vai trò, spec §5.6)
- Test (create): `apps/shell/tests/workbench-local-data.test.ts`
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts`
- Modify: `apps/shell/src/renderer/src/home.css` (gỡ rule `.wb-notes*`, `.wb-sticky*`, `.wb-pet(s)*` và `.wb-detail.is-immersive`; gỡ định nghĩa `--wb-sticky-*` và `--wb-board-*`; thêm rule mới)
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (bỏ `hideChrome`, nhánh notes)
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx` (trước dòng `{tab === 'knowledge' && (`)
- Modify: `apps/shell/src/renderer/src/SkillDomainTabs.tsx` (`DomainBadge`)
- Modify: `packages/practice-core/src/modules.ts` (gợi ý của mục notes)
- Chỉ kiểm: `apps/shell/src/renderer/src/WorkbenchIcons.tsx` (Task 12 đã chuyển sang tint), `apps/shell/src/renderer/src/workbench-desk.ts` (Task 13 đã xóa cùng `DESK_CHART`)

**Interfaces:**
- Consumes: `MODULE_TONES`, `tintStyle(t: Tint): { background: string; color: string }` và `Tint` (`module-tones.ts`). `readStickyNotes`, `writeStickyNotes`, `createStickyNote` và `normalizeStickyNote` (`workbench-pins.ts`, không đổi; trường màu và x/y vẫn nằm trong dữ liệu, không dùng). Key `wbOnThisDevice` (Task 11).
- Produces: `LocalTag(): ReactElement` và `NotesPane({ practiceId }: { practiceId: PracticeId }): ReactElement` (bỏ prop `vi`). `WorkbenchModulePane` luôn hiện tiêu đề và gợi ý của module (không còn chế độ immersive).
- Produces: ghi chú và biểu mẫu lưu dưới khóa `uniwork.wb.stickies` và `uniwork.wb.forms`, chung cho mọi vai trò trong một bucket. Chữ ký `readStickyNotes(practiceId)`, `writeStickyNotes(_practiceId, items)`, `createStickyNote(practiceId, body, color?)`, `readNotes(practiceId)`, `readForms(_practiceId)` và `writeForms(_practiceId, items)` giữ nguyên nên không nơi gọi nào phải sửa. Theo D3, ghi chú và biểu mẫu cũ lưu theo từng vai trò bị bỏ qua.

- [ ] **Step 1: Thêm chuỗi Ghi chú (zh, vi, en)**

Nhãn "trên máy này" dùng key `wbOnThisDevice` có sẵn từ Task 11.
```bash
cd /Users/ducquang/UNICOM/uniwork-office
D=apps/shell/src/renderer/src/i18n/workbench
K="${TMPDIR:-/tmp}/wb-keys"   # insert.cjs from Task 12 Step 10
cat > "$K/t17-zh.txt" <<'EOF'
  wbNotesPlaceholder: '输入新笔记，按 Enter 添加',
  wbNotesAdd: '添加笔记',
  wbNotesEmpty: '还没有笔记。',
  wbNotesBodyLabel: '笔记内容',
  wbNotesDelete: '删除笔记',
  wbNotesEdited: '编辑于 {time}',
EOF
cat > "$K/t17-vi.txt" <<'EOF'
  wbNotesPlaceholder: 'Viết ghi chú mới, nhấn Enter để thêm',
  wbNotesAdd: 'Thêm ghi chú',
  wbNotesEmpty: 'Chưa có ghi chú nào.',
  wbNotesBodyLabel: 'Nội dung ghi chú',
  wbNotesDelete: 'Xóa ghi chú',
  wbNotesEdited: 'Sửa lúc {time}',
EOF
cat > "$K/t17-en.txt" <<'EOF'
  wbNotesPlaceholder: 'Write a new note and press Enter',
  wbNotesAdd: 'Add note',
  wbNotesEmpty: 'No notes yet.',
  wbNotesBodyLabel: 'Note text',
  wbNotesDelete: 'Delete note',
  wbNotesEdited: 'Edited {time}',
EOF
node "$K/insert.cjs" "$K/t17-zh.txt" $D/zh.ts
node "$K/insert.cjs" "$K/t17-vi.txt" $D/vi.ts
node "$K/insert.cjs" "$K/t17-en.txt" $D/en.ts
npx prettier --write $D
```

- [ ] **Step 2: Viết lại Ghi chú thành danh sách thẻ phẳng**

Thay toàn bộ `apps/shell/src/renderer/src/NotesPane.tsx` bằng:
```tsx
import { useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  writeStickyNotes,
  type WbStickyNote,
} from './workbench-pins'

/**
 * Notes: a flat list of cards, stored on this device. The stored paper color
 * and board position (from the old pinboard) are kept in the data, unused.
 */
export function NotesPane({ practiceId }: { practiceId: PracticeId }): ReactElement {
  const { t, dateLocale } = useI18n()
  const [items, setItems] = useState<WbStickyNote[]>(() => readStickyNotes(practiceId))
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }, [practiceId])

  const persist = (next: WbStickyNote[]) => {
    setItems(next)
    writeStickyNotes(practiceId, next)
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    createStickyNote(practiceId, body)
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }

  const edit = (id: string, body: string) =>
    persist(
      items.map((n) =>
        n.id === id ? normalizeStickyNote({ ...n, body, updatedAt: new Date().toISOString() }) : n,
      ),
    )

  return (
    <div className="wb-notes">
      <form className="wb-work-quick" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbNotesPlaceholder')}
          aria-label={t('wbNotesPlaceholder')}
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          {t('wbNotesAdd')}
        </button>
      </form>
      {items.length === 0 ? (
        <p className="wb-work-state">{t('wbNotesEmpty')}</p>
      ) : (
        <ul className="wb-notes-list">
          {items.map((note) => (
            <li key={note.id} className="wb-notes-card">
              <textarea
                value={note.body}
                rows={3}
                aria-label={t('wbNotesBodyLabel')}
                onChange={(e) => edit(note.id, e.target.value)}
              />
              <footer>
                <span>
                  {t('wbNotesEdited', {
                    time: new Date(note.updatedAt).toLocaleString(dateLocale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
                <button
                  type="button"
                  className="wb-notes-delete"
                  onClick={() => persist(items.filter((n) => n.id !== note.id))}
                >
                  {t('wbNotesDelete')}
                </button>
              </footer>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Thêm nhãn "Trên máy này" và dùng ở Biểu mẫu, Ghi chú và 4 trụ cột**

`apps/shell/src/renderer/src/LocalTag.tsx`:
```tsx
import type { ReactElement } from 'react'
import { useI18n } from './locale'

/** "On this device" tag of the local-only Workbench tabs (Forms, Notes, the four pillars). */
export function LocalTag(): ReactElement {
  const { t } = useI18n()
  return <span className="wb-local-tag">{t('wbOnThisDevice')}</span>
}
```
`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- Dưới import `./NotesPane`, thêm `import { LocalTag } from './LocalTag'`.
- Ghi chú giờ hiện tiêu đề và gợi ý bình thường, nên bỏ chế độ immersive. Trước (sau Task 2, 12, 13):
```tsx
  const hideChrome = moduleId === 'notes'

  return (
    <section
      className={`wb-panel wb-detail${hideChrome ? ' is-immersive' : ''}`}
      aria-label={vi ? mod.labelVi : mod.labelEn}
    >
      {!hideChrome && (
        <>
          <h2>{vi ? mod.labelVi : mod.labelEn}</h2>
          <p className="wb-hint">
            {vi ? mod.hintVi : mod.hintEn}
            {contextTitle ? ` · ${contextTitle}` : ''}
          </p>
        </>
      )}
```
  Sau:
```tsx
  return (
    <section className="wb-panel wb-detail" aria-label={vi ? mod.labelVi : mod.labelEn}>
      <h2>{vi ? mod.labelVi : mod.labelEn}</h2>
      <p className="wb-hint">
        {vi ? mod.hintVi : mod.hintEn}
        {contextTitle ? ` · ${contextTitle}` : ''}
      </p>
```
- trước: `      {moduleId === 'notes' && <NotesPane practiceId={practiceId} vi={vi} />}`
- sau:
```tsx
      {moduleId === 'notes' && <NotesPane practiceId={practiceId} />}
      {(moduleId === 'forms' || moduleId === 'notes') && <LocalTag />}
```
`apps/shell/src/renderer/src/PracticeHome.tsx` (`isPracticePillarId` đã được import):
- Dưới import `./WorkbenchModulePanes`, thêm `import { LocalTag } from './LocalTag'`.
- trước: `      {tab === 'knowledge' && (`
- sau:
```tsx
      {isPracticePillarId(tab) && <LocalTag />}

      {tab === 'knowledge' && (
```
`packages/practice-core/src/modules.ts` (mục notes):
- trước:
```ts
    hintVi: 'Bảng ghim giấy note — kéo thả, đổi màu',
    hintEn: 'Sticky pinboard — drag, recolor, pin notes',
```
- sau:
```ts
    hintVi: 'Ghi chú nhanh, lưu trên máy này',
    hintEn: 'Quick notes, stored on this device',
```

- [ ] **Step 4: Cho badge domain của Kỹ năng dùng tint thay hex**

Trong `apps/shell/src/renderer/src/SkillDomainTabs.tsx`:
- Dưới import `./skill-domain-pins`, thêm `import { MODULE_TONES, tintStyle } from './module-tones'`.
- trước:
```tsx
function DomainBadge({ id, size = 18 }: { id: SkillDomainId; size?: number }): ReactElement {
  const def = getSkillDomain(id)
  const letter = (def?.labelEn ?? id).slice(0, 1).toUpperCase()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill={def?.color ?? '#64748B'} />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="#fff"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  )
}
```
- sau:
```tsx
function DomainBadge({ id, size = 18 }: { id: SkillDomainId; size?: number }): ReactElement {
  const def = getSkillDomain(id)
  const letter = (def?.labelEn ?? id).slice(0, 1).toUpperCase()
  return (
    <span
      className="wb-domain-badge"
      style={{ ...tintStyle(MODULE_TONES.skills), width: size, height: size }}
      aria-hidden
    >
      {letter}
    </span>
  )
}
```

- [ ] **Step 5: Kiểm icon module và trụ cột không còn hex**

Task 12 đã viết lại `WorkbenchIcons.tsx` theo tint. Chạy:
```bash
cd /Users/ducquang/UNICOM/uniwork-office
grep -cE "#[0-9a-fA-F]{3,8}\b" apps/shell/src/renderer/src/WorkbenchIcons.tsx
```
Kết quả mong đợi: `0`. Nếu khác 0, Task 12 Step 3 chưa xong; làm lại bước đó.

- [ ] **Step 6: Kiểm bảng màu biểu đồ Desk đã mất**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
grep -rn "DESK_CHART" apps/shell/src
ls apps/shell/src/renderer/src/workbench-desk.ts 2>&1 | grep -c 'No such file'
```
Kết quả mong đợi: grep đầu không in gì, lệnh sau in `1` (Task 13 đã xóa `workbench-desk.ts`).

- [ ] **Step 7: Gỡ CSS pinboard, Pets và immersive, rồi thêm rule mới**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
NODE_PATH=$PWD/node_modules node "${TMPDIR:-/tmp}/wb-css/strip-css-rules.cjs" apps/shell/src/renderer/src/home.css .wb-notes .wb-sticky .wb-pets .wb-pet --vars --wb-sticky- --wb-board-
grep -n "Sticky notes board (paper colors\|is-immersive\|Immersive module panes" apps/shell/src/renderer/src/home.css
```
(Script ở Task 13 Step 11; tạo lại từ đó nếu thư mục tạm bị xóa.)
Kết quả mong đợi: `vars removed: 30` và `rules touched:` với một số trên 50. Grep cho thấy comment mồ côi trong `:root`, rule `.wb-detail.is-immersive` và comment `Immersive module panes` (Task 13). Xóa tay:
- comment mồ côi và dòng trống phía trên nó:
  - trước:
```css
  --on-accent: #ffffff;

  /* Sticky notes board (paper colors stay vivid in both themes) */
}
```
  - sau:
```css
  --on-accent: #ffffff;
}
```
- toàn bộ rule `.wb-detail.is-immersive { … }` và comment `/* ── Immersive module panes ── */` phía trên nó (không còn gì dùng class `is-immersive`).

Thêm vào cuối `apps/shell/src/renderer/src/home.css`:
```css
/* ── Local-only tabs (Forms / Notes / pillars) ───────────── */
.wb-local-tag {
  order: -1;
  align-self: flex-start;
  width: fit-content;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--tint-gray);
  color: var(--tint-gray-fg);
  font-size: 11px;
  font-weight: 600;
}

.wb-notes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wb-notes-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-notes-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.wb-notes-card:focus-within {
  border-color: var(--accent);
}

.wb-notes-card textarea {
  width: 100%;
  min-height: 64px;
  padding: 0;
  border: none;
  resize: vertical;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-notes-card textarea:focus {
  outline: none;
}

.wb-notes-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-notes-delete {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.wb-notes-delete:hover {
  color: var(--danger-text);
}

.wb-domain-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
```

- [ ] **Step 8: Kiểm không còn màu thô trong vùng Bàn làm việc**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
cat > "${TMPDIR:-/tmp}/wb-css/list-raw-colors.cjs" <<'EOF'
// usage: node list-raw-colors.cjs <file.css> <selector-regex>
// Raw colors (#hex, rgb(), hsl()) in rules whose selector matches; custom-property lines are allowed (CLAUDE.md).
const fs = require('node:fs')
const postcss = require('postcss')
const [file, re] = process.argv.slice(2)
const sel = new RegExp(re)
const raw = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
postcss.parse(fs.readFileSync(file, 'utf8')).walkDecls((d) => {
  if (d.prop.startsWith('--') || !raw.test(d.value)) return
  const rule = d.parent
  if (rule.type === 'rule' && sel.test(rule.selector))
    console.log(`${d.source.start.line}\t${rule.selector.replace(/\s+/g, ' ')}\t${d.prop}: ${d.value}`)
})
EOF
NODE_PATH=$PWD/node_modules node "${TMPDIR:-/tmp}/wb-css/list-raw-colors.cjs" apps/shell/src/renderer/src/home.css '\.(wb|teacher)-'
cd apps/shell/src/renderer/src
grep -nE "#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(" PracticeHome.tsx WorkbenchModulePanes.tsx WorkbenchTabs.tsx WorkbenchIcons.tsx WorkbenchTopBar.tsx SkillDomainTabs.tsx NotesPane.tsx LocalTag.tsx WorkOverview.tsx WorkTasksPane.tsx WorkCalendarPane.tsx WorkProfilePane.tsx WorkErrorState.tsx WbRowActions.tsx WorkbenchAccountGate.tsx module-tones.ts work-home.ts
```
Kết quả mong đợi: cả hai lệnh không in gì. Đã chạy thử lệnh CSS trên `9194f306`: nó in 15 khai báo, và cả 15 nằm trong rule bị gỡ ở Task 3 (`.wb-pets-*`, `.wb-pet-*`, `.wb-health*`…), Task 14 (`.wb-tasks-bar-track …`) hoặc Step 7 ở trên. Hex duy nhất trong các file TSX liệt kê là `'#64748B'` và `"#fff"` của `DomainBadge`, đã gỡ ở Step 4. Nếu lệnh vẫn in một dòng, một bước gỡ trước đó chưa chạy: quay lại bước đó, không sửa màu tại chỗ.

- [ ] **Step 9: Ghi chú và biểu mẫu thuộc về người dùng, không theo vai trò (spec §5.6)**

Spec §5.6: vai trò không còn là namespace dữ liệu. Hiện ghi chú lưu ở `uniwork.wb.stickies.<vai trò>` và biểu mẫu ở `uniwork.wb.forms.<vai trò>`, nên đổi vai trò làm "mất" ghi chú. Bucket đã tách theo deployment + account + org (Task 9), nên một khóa cố định là đủ. Ghim tab vẫn theo vai trò, vì vai trò quyết định tab ghim mặc định (§5.6).

Tạo `apps/shell/tests/workbench-local-data.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import {
  createStickyNote,
  readForms,
  readNotes,
  readStickyNotes,
  writeForms,
} from '../src/renderer/src/workbench-pins'

beforeEach(() => store.clear())

describe('notes and forms are not per role (spec 5.6)', () => {
  it('a note written under one role is read under another', () => {
    createStickyNote('legal', 'Call the notary')
    expect(readStickyNotes('sales').map((n) => n.body)).toEqual(['Call the notary'])
    expect(readNotes('hr')).toBe('Call the notary')
  })

  it('a form saved under one role is listed under another', () => {
    writeForms('legal', [{ id: 'f1', title: 'Leave request' }])
    expect(readForms('accounting').map((f) => f.id)).toEqual(['f1'])
  })
})
```
Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-local-data.test.ts`
Kết quả mong đợi: FAIL ở cả 2 test (`expected [] to deeply equal [ 'Call the notary' ]` và `expected [] to deeply equal [ 'f1' ]`).

Trong `apps/shell/src/renderer/src/workbench-pins.ts`:
- trước:
```ts
function stickyKey(practiceId: PracticeId): string {
  return `uniwork.wb.stickies.${practiceId}`
}
```
- sau:
```ts
/** Notes and forms belong to the user, not the role (spec 5.6): one list per Workbench bucket. */
const STICKIES_KEY = 'uniwork.wb.stickies'
const FORMS_KEY = 'uniwork.wb.forms'
```
- trong `readStickyNotes`, trước: `  const key = stickyKey(practiceId)`; sau: `  const key = STICKIES_KEY`. (`migrateLegacyNotes(practiceId)` ngay dưới vẫn dùng `practiceId`, nên tham số được giữ.)
- trước:
```ts
export function writeStickyNotes(practiceId: PracticeId, items: WbStickyNote[]): void {
  writeJson(
    stickyKey(practiceId),
    items.map((n) => normalizeStickyNote(n)),
  )
}
```
- sau:
```ts
export function writeStickyNotes(_practiceId: PracticeId, items: WbStickyNote[]): void {
  writeJson(
    STICKIES_KEY,
    items.map((n) => normalizeStickyNote(n)),
  )
}
```
- trước:
```ts
export function readForms(practiceId: PracticeId): WbFormItem[] {
  return readJson(`uniwork.wb.forms.${practiceId}`, [])
}

export function writeForms(practiceId: PracticeId, items: WbFormItem[]): void {
  writeJson(`uniwork.wb.forms.${practiceId}`, items)
}
```
- sau:
```ts
export function readForms(_practiceId: PracticeId): WbFormItem[] {
  return readJson(FORMS_KEY, [])
}

export function writeForms(_practiceId: PracticeId, items: WbFormItem[]): void {
  writeJson(FORMS_KEY, items)
}
```
Tham số `_practiceId` được giữ để không phải sửa nơi gọi (NotesPane, FormsPane, my-ai-forms, NewChatPane, context-manager, agent-intent-apply); tiền tố `_` theo `argsIgnorePattern` của ESLint, giống `defaultPinnedModules(_practiceId)` trong practice-core.

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-local-data.test.ts tests/my-ai-forms.test.ts tests/workbench-db.test.ts`
Kết quả mong đợi: PASS (2 test mới; `my-ai-forms` mock `readForms` nên không đổi; `uniwork.wb.forms` và `uniwork.wb.stickies` vẫn qua allowlist tiền tố `uniwork.wb.`).

- [ ] **Step 10: Typecheck, lint, theme check, test và commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core
npx eslint apps/shell/src/renderer/src apps/shell/tests
npm run check:theme-colors -- --base origin/main
cd apps/shell && npx vitest run && cd ../..
npm run format
git add apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/LocalTag.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/SkillDomainTabs.tsx apps/shell/src/renderer/src/workbench-pins.ts apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench packages/practice-core/src/modules.ts apps/shell/tests/workbench-local-data.test.ts
git commit -m "$(cat <<'EOF'
style(shell): flat Notes cards, On-this-device tags, token-only Workbench colors

Notes leave the sticky pinboard for a flat card list; Forms, Notes and the
four pillars carry an "On this device" tag; skill-domain badges use the
module tints; pinboard, Pets and immersive-pane CSS go. Notes and forms
are kept per account and org, no longer per role (spec 5.6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
Kết quả mong đợi: typecheck và eslint đều exit 0, `check:theme-colors` không in vi phạm, mọi suite shell pass.

### Task 18: Chuyển chuỗi `label(vi, en)` còn lại của Bàn làm việc vào shard (spec §6.8)

Spec §6.8: chuỗi của Bàn làm việc đang viết qua `label(vi, en)` chuyển sang `i18n/workbench/<lang>.ts`. Sau Task 2–17 còn đúng 95 lời gọi `label(…)` trong bốn file: `PracticeHome.tsx` (56: Tri thức, Tài liệu, Kỹ năng, Soạn mới, hộp xác nhận Token và các thông báo), `WorkbenchTabs.tsx` (10), `SkillDomainTabs.tsx` (6) và `WorkbenchModulePanes.tsx` (23: `WorkbenchModulePane` và `FormsPane`). Hero, `AssistantPane`, `PersonalPane` và các pane đời sống đã bị xóa ở Task 2, 6, 12 và 16, nên chuỗi của chúng không có ở đây. Đã chạy thử script dưới trên bản sao bốn file ở `9194f306` (bỏ hero dòng 543-584 của `PracticeHome.tsx`, bỏ `AssistantPane` và mọi pane sau `FormsPane`): 95 lời gọi được thay, không còn `label(` nào.

Ngoài phạm vi task này (giữ nguyên):
- `vi ? x.labelVi : x.labelEn` đọc nhãn từ dữ liệu practice-core (module, trụ cột, vai trò, kỹ năng). Đó là dữ liệu hai ngôn ngữ, không phải chuỗi UI viết tay.
- `vi ? 'Mẫu gốc' : 'Source template'` và `vi ? 'Nội dung' : 'Content'` trong `openForm` của `FormsPane`: đây là nội dung văn bản nháp được tạo ra (quy tắc 4 của CLAUDE.md), không phải chrome.
- `AgentIntentBanner.tsx`: banner của My AI, không thuộc Bàn làm việc.

Câu tiếng Việt trong shard được viết lại ở chỗ code cũ trộn tiếng Anh (spec §6.8, và test `formal vi copy` của Task 11 chặn `tab`): "Bỏ tab" thành "Bỏ ghim", "Thêm tab" thành "Thêm khu vực", "Mở Skills" thành "Đã mở Kỹ năng", "file" thành "tệp", "Module" thành "Mô-đun", "My AI … seed Docs" thành "Trợ lý của bạn … tạo văn bản". Câu tiếng Anh giữ nguyên. Thông báo vẫn được lưu vào state dưới dạng chuỗi đã dịch như code hiện tại; `t` không được thêm vào mảng phụ thuộc nào.

**Files:**
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx`, `apps/shell/src/renderer/src/WorkbenchTabs.tsx`, `apps/shell/src/renderer/src/SkillDomainTabs.tsx`, `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`
- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,vi,en}.ts` (85 key; 18 shard còn lại spread `en`)
- Test (create): `apps/shell/tests/workbench-copy.test.ts`

**Interfaces:**
- Consumes: shard `i18n/workbench` (Task 11) và các key Task 12–17 đã thêm; `useI18n()` (`locale.tsx`).
- Produces: 85 key mới với tiền tố `wbCommon*`, `wbAgentApplied`, `wbKn*`, `wbMat*`, `wbSk*`, `wbCmp*`, `wbTabs*`, `wbSkTabs*`, `wbModuleUnknown`, `wbForms*`. Không key nào trùng key của Task 11–17 hay của `strings.ts` và các shard khác (đã kiểm bằng script). Bốn file trên không còn helper `label`.

- [ ] **Step 1: Viết test chặn sẽ fail**

`apps/shell/tests/workbench-copy.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'

/** Workbench chrome reads its copy from the i18n shard (spec 6.8), not from label(vi, en). */
const FILES = ['PracticeHome.tsx', 'WorkbenchTabs.tsx', 'SkillDomainTabs.tsx', 'WorkbenchModulePanes.tsx']

describe('Workbench copy lives in the i18n shard', () => {
  it.each(FILES)('%s has no label(vi, en) helper left', (file) => {
    const source = readFileSync(join(__dirname, '../src/renderer/src', file), 'utf8')
    expect(source).not.toMatch(/\blabel\(/)
    expect(source).not.toMatch(/const label = /)
  })

  it('keeps the copy in formal Vietnamese and in English', () => {
    expect(workbenchStrings.vi.wbCommonUnpin).toBe('Bỏ ghim')
    expect(workbenchStrings.en.wbCommonUnpin).toBe('Unpin tab')
    expect(workbenchStrings.vi.wbKnDeletePackConfirm).toContain('{title}')
    expect(workbenchStrings.zh.wbFormsDraft).toBe('起草')
  })
})
```

- [ ] **Step 2: Chạy và xác nhận fail**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office/apps/shell && npx vitest run tests/workbench-copy.test.ts`
Kết quả mong đợi: FAIL ở cả 5 test. Bốn test file báo `expected '…' not to match /\blabel\(/`; test cuối báo `expected undefined to be 'Bỏ ghim'`.

- [ ] **Step 3: Tạo script thay chuỗi và bảng chuỗi**

Script nằm cạnh `insert.cjs` của Task 12 Step 10. Nó thay đúng số lời gọi đã ghi cho mỗi file (khoảng trắng, xuống dòng và dấu phẩy cuối không quan trọng), dừng nếu số lần gặp khác, rồi nối 85 key vào `zh.ts`, `vi.ts` và `en.ts`.
```bash
mkdir -p "${TMPDIR:-/tmp}/wb-keys"
cat > "${TMPDIR:-/tmp}/wb-keys/relabel.cjs" <<'EOF'
// usage: node relabel.cjs <relabel-table.cjs> <renderer src dir> <workbench shard dir>
// Replaces every label(<a>, <b>) call the table lists with its t() call (exact count per
// file, any whitespace, optional trailing comma), then appends the table's keys to the
// zh, vi and en Workbench shards (the 18 other shards spread en).
const fs = require('node:fs')
const path = require('node:path')
const [tablePath, srcDir, shardDir] = process.argv.slice(2)
const { calls, keys } = require(path.resolve(tablePath))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const known = new Set(keys.map((k) => k.key))
const files = new Map()
for (const c of calls) {
  for (const [, key] of c.call.matchAll(/'(wb[A-Za-z]+)'/g)) {
    if (!known.has(key)) throw new Error(`no shard text for ${key}`)
  }
  const file = path.join(srcDir, c.file)
  const src = files.get(file) ?? fs.readFileSync(file, 'utf8')
  const re = new RegExp(`\\blabel\\(\\s*${esc(c.a)}\\s*,\\s*${esc(c.b)}\\s*,?\\s*\\)`, 'g')
  const hits = (src.match(re) ?? []).length
  if (hits !== c.count) throw new Error(`${c.file}: expected ${c.count} × label(${c.a}, …), found ${hits}`)
  files.set(file, src.replace(re, () => c.call))
}
for (const [file, src] of files) fs.writeFileSync(file, src)
for (const lang of ['zh', 'vi', 'en']) {
  const file = path.join(shardDir, `${lang}.ts`)
  const src = fs.readFileSync(file, 'utf8')
  const end = src.lastIndexOf('\n}')
  if (end < 0) throw new Error(`no object end in ${file}`)
  const block = keys.map((k) => `  ${k.key}: ${JSON.stringify(k[lang])},`).join('\n')
  fs.writeFileSync(file, `${src.slice(0, end)}\n${block}${src.slice(end)}`)
}
const total = calls.reduce((n, c) => n + c.count, 0)
console.log(`replaced ${total} label() calls in ${files.size} files; added ${keys.length} keys`)
EOF
cat > "${TMPDIR:-/tmp}/wb-keys/relabel-table.cjs" <<'EOF'
// Workbench label(vi, en) calls → t('wb…') keys of the Workbench shard (spec 6.8).
const P = 'PracticeHome.tsx'
const T = 'WorkbenchTabs.tsx'
const S = 'SkillDomainTabs.tsx'
const M = 'WorkbenchModulePanes.tsx'

/** key → [zh, vi, en] as the shard stores them (vi rewritten where the code mixed in English) */
const TEXT = {
  wbCommonOpen: ['打开', 'Mở', 'Open'],
  wbCommonDelete: ['删除', 'Xóa', 'Delete'],
  wbCommonSave: ['保存', 'Lưu', 'Save'],
  wbCommonCancel: ['取消', 'Hủy', 'Cancel'],
  wbCommonTags: ['标签', 'Thẻ', 'Tags'],
  wbCommonNotes: ['备注', 'Ghi chú', 'Notes'],
  wbCommonDragToReorder: ['拖动以排序', 'Kéo để sắp xếp', 'Drag to reorder'],
  wbCommonUnpin: ['取消固定', 'Bỏ ghim', 'Unpin tab'],
  wbCommonSkills: ['技能', 'Kỹ năng', 'Skills'],
  wbCommonMaterials: ['资料', 'Tài liệu', 'Materials'],
  wbCommonRun: ['运行', 'Chạy', 'Run'],
  wbCommonUsesTokens: ['消耗 Token', 'Tốn Token', 'Uses Tokens'],
  wbAgentApplied: ['已在本机应用 AI 指令。', 'Đã áp dụng lệnh AI trên máy.', 'Applied AI intent on device.'],
  wbSkOpenedPick: [
    '已打开技能 — 请选择技能并确认 Token。',
    'Đã mở Kỹ năng — chọn kỹ năng và xác nhận Token.',
    'Opened Skills — pick a skill and confirm Tokens.',
  ],
  wbSkOpenedNeedPack: [
    '已打开技能 — 请先选择知识包，再运行技能。',
    'Đã mở Kỹ năng — chọn gói Tri thức rồi chạy kỹ năng.',
    'Opened Skills — select a Knowledge pack, then run a skill.',
  ],
  wbKnDeletePackConfirm: [
    '删除资料包“{title}”？\n包内文件将移回默认项目，内容不会丢失。',
    'Xóa gói “{title}”?\nTệp trong gói sẽ chuyển về dự án mặc định, không mất nội dung.',
    'Delete pack “{title}”?\nFiles move to the default project; content is not lost.',
  ],
  wbKnPackDeleted: ['已从知识库中删除资料包。', 'Đã xóa gói khỏi Tri thức.', 'Pack removed from Knowledge.'],
  wbMatDeleteFileConfirm: ['删除文件“{name}”？', 'Xóa tệp “{name}”?', 'Delete file “{name}”?'],
  wbCmpTitleRequired: ['请输入资料包标题。', 'Cần nhập tiêu đề gói.', 'Pack title is required.'],
  wbCmpMissing: ['缺少：{field}', 'Thiếu: {field}', 'Missing: {field}'],
  wbCmpCreated: ['已在知识库中创建资料包。', 'Đã tạo gói trong Tri thức.', 'Pack added to Knowledge.'],
  wbKnSaved: ['已保存。', 'Đã lưu.', 'Saved.'],
  wbMatRoleAdded: ['已添加：{role}', 'Đã thêm: {role}', 'Added: {role}'],
  wbSkRan: ['已运行技能：{skill}', 'Đã chạy kỹ năng: {skill}', 'Ran skill: {skill}'],
  wbSkRanRole: ['已运行角色技能：{skill}', 'Đã chạy kỹ năng theo vai trò: {skill}', 'Ran role skill: {skill}'],
  wbMatChainOpened: [
    '已按顺序打开免费模板链。',
    'Đã mở chuỗi mẫu miễn phí theo thứ tự.',
    'Opened the free template chain in order.',
  ],
  wbKnSearch: ['搜索', 'Tìm', 'Search'],
  wbKnSearchPlaceholder: ['包名、标签、备注…', 'Tên gói, thẻ, ghi chú…', 'Title, tags, notes…'],
  wbKnLibrary: ['资料库', 'Thư viện', 'Library'],
  wbKnEmpty: [
    '还没有资料包。请在“新建资料包”中创建。',
    'Chưa có gói. Tạo ở mục Soạn mới.',
    'No packs yet. Create in Compose.',
  ],
  wbKnFiles: ['个文件', 'tệp', 'files'],
  wbKnViewFiles: ['查看文件', 'Xem tệp', 'View files'],
  wbKnDeletePack: ['删除资料包', 'Xóa gói', 'Delete pack'],
  wbKnSelectPack: ['请选择一个资料包。', 'Chọn một gói.', 'Select a pack.'],
  wbMatSelectPackFirst: [
    '请先在知识库中选择资料包。',
    'Chọn gói ở Tri thức trước.',
    'Select a Knowledge pack first.',
  ],
  wbMatEmpty: ['还没有文件 — 请在下方添加。', 'Chưa có tệp — thêm bên dưới.', 'No files yet — add below.'],
  wbMatAdd: ['添加资料', 'Thêm tài liệu', 'Add material'],
  wbMatAddOpen: ['添加并打开', 'Thêm và mở', 'Add & open'],
  wbMatQuickCreateHint: [
    '在此资料包中快速新建 Office 文件（首次保存后显示在列表中）。已有文件：在主页 → 文件列表中移入此包。',
    'Tạo nhanh tệp Office vào gói này (lưu lần đầu sẽ hiện trong danh sách). Tệp đã có: chuyển gói từ Trang chủ → danh sách tệp.',
    'Quick-create Office into this pack (first save lists it here). Existing files: move pack from Home → file list.',
  ],
  wbMatQuickTemplates: ['快速模板（免费）', 'Mẫu nhanh (miễn phí)', 'Quick templates (free)'],
  wbMatOpenChain: ['打开免费模板链', 'Mở chuỗi mẫu miễn phí', 'Open free template chain'],
  wbSkNeedPack: [
    '运行前请先在知识库中选择资料包作为上下文。',
    'Chọn gói ở Tri thức để gắn ngữ cảnh trước khi chạy.',
    'Select a Knowledge pack for context before running.',
  ],
  wbSkContext: ['上下文：', 'Ngữ cảnh:', 'Context:'],
  wbSkRoleSkills: ['角色技能', 'Kỹ năng theo vai trò', 'Role skills'],
  wbSkRoleHint: [
    '与当前角色相关的技能。每次运行都会请求确认 Token。',
    'Kỹ năng gắn với vai trò hiện tại. Mỗi lần chạy hỏi xác nhận Token.',
    'Skills for this practice role. Each run asks to confirm Tokens.',
  ],
  wbSkDomainSkills: ['领域技能', 'Kỹ năng lĩnh vực', 'Domain skills'],
  wbSkDomainHint: [
    '用 + 添加领域。每次运行都会请求确认 Token。',
    'Thêm lĩnh vực bằng nút +. Mỗi lần chạy hỏi xác nhận Token.',
    'Add domain tabs with +. Each run asks to confirm Tokens.',
  ],
  wbCmpTitle: ['新建资料包', 'Soạn gói mới', 'New pack'],
  wbCmpCreating: ['正在创建…', 'Đang tạo…', 'Creating…'],
  wbCmpCreate: ['在知识库中创建资料包', 'Tạo gói vào Tri thức', 'Create pack in Knowledge'],
  wbSkConfirmTitle: ['使用 AI Token？', 'Dùng Token AI?', 'Use AI Tokens?'],
  wbSkConfirmBody: [
    '此操作会调用 AI Hub，可能消耗 Token。',
    'Thao tác này gọi Hub AI và có thể trừ Token.',
    'This calls your AI Hub and may spend tokens.',
  ],
  wbSkConfirmRun: ['运行 AI', 'Chạy AI', 'Run AI'],
  wbTabsAreas: ['工作台区域', 'Khu vực làm việc', 'Workbench areas'],
  wbTabsDrag: ['拖动', 'Kéo', 'Drag'],
  wbTabsAdd: ['添加区域', 'Thêm khu vực', 'Add tab'],
  wbTabsMenuTitle: ['添加到工作台', 'Thêm vào Bàn làm việc', 'Add to Workbench'],
  wbTabsAllPinned: ['所有区域均已添加。', 'Đã thêm đủ khu vực.', 'All areas are pinned.'],
  wbTabsCore: ['核心区域', 'Khu vực chính', 'Core areas'],
  wbTabsModules: ['模块', 'Mô-đun', 'Modules'],
  wbSkTabsNav: ['专业技能领域', 'Lĩnh vực kỹ năng chuyên môn', 'Skill domain tabs'],
  wbSkTabsAdd: ['添加技能领域', 'Thêm lĩnh vực', 'Add Skill tab'],
  wbSkTabsMenuTitle: ['添加技能领域', 'Thêm lĩnh vực kỹ năng', 'Add Skill domain'],
  wbSkTabsAllPinned: ['所有领域均已添加。', 'Đã thêm đủ lĩnh vực.', 'All domains are pinned.'],
  wbModuleUnknown: ['未知模块。', 'Không tìm thấy khu vực này.', 'Unknown module.'],
  wbFormsNoSupportedFile: ['未选择受支持的文件。', 'Không chọn được tệp được hỗ trợ.', 'No supported file selected.'],
  wbFormsHint: [
    '把模板文件（Word/PDF/Excel…）上传到资料库 — 我的 AI 可以按真实表单填写。“起草”会在所选资料包中生成文档；“打开文件”会打开原始模板。',
    'Tải tệp mẫu (Word/PDF/Excel…) vào thư viện — Trợ lý của bạn có thể điền theo mẫu thật. “Soạn” tạo văn bản trong gói đang chọn; “Mở tệp” mở mẫu gốc.',
    'Upload a template file (Word/PDF/Excel…) — My AI can fill from the real form. “Draft” seeds Docs into the selected pack; “Open file” opens the source template.',
  ],
  wbFormsDraftNeedsPackHint: [
    '起草前请先在知识库中选择资料包。',
    'Chọn gói ở Tri thức trước khi soạn.',
    'Select a Knowledge pack before drafting.',
  ],
  wbFormsTitle: ['表单名称', 'Tên biểu mẫu', 'Form title'],
  wbFormsTitlePlaceholder: ['例如：请假申请', 'Ví dụ: Đơn xin nghỉ phép', 'e.g. Leave request'],
  wbFormsNote: ['备注（可选）', 'Ghi chú (tùy chọn)', 'Note (optional)'],
  wbFormsReplaceFile: ['更换模板文件…', 'Đổi tệp mẫu…', 'Replace template file…'],
  wbFormsUploadFile: ['上传模板文件…', 'Tải tệp mẫu lên…', 'Upload template file…'],
  wbFormsClearFile: ['移除文件', 'Bỏ tệp', 'Clear file'],
  wbFormsTemplateFile: ['模板文件：', 'Tệp mẫu:', 'Template file:'],
  wbFormsSave: ['保存表单', 'Lưu biểu mẫu', 'Save form'],
  wbFormsAdd: ['添加到资料库', 'Thêm vào thư viện', 'Add to library'],
  wbFormsCancelEdit: ['取消编辑', 'Hủy sửa', 'Cancel edit'],
  wbFormsEmpty: ['还没有表单。', 'Chưa có biểu mẫu.', 'No forms yet.'],
  wbFormsFile: ['文件：', 'Tệp:', 'File:'],
  wbFormsLinked: ['已关联资料包', 'Đã gắn gói Tài liệu', 'Linked to Materials pack'],
  wbFormsEdit: ['编辑', 'Sửa', 'Edit'],
  wbFormsOpenFile: ['打开文件', 'Mở tệp', 'Open file'],
  wbFormsDraft: ['起草', 'Soạn', 'Draft'],
  wbFormsDraftNeedsPack: [
    '请先在知识库中选择资料包',
    'Chọn gói ở Tri thức trước',
    'Select a Knowledge pack first',
  ],
}

/** [file, key, vi as in the code, en as in the code, calls in that file] */
const PLAIN = [
  [P, 'wbSkOpenedPick', 'Mở Skills — chọn kỹ năng và xác nhận Token.', 'Opened Skills — pick a skill and confirm Tokens.', 1],
  [P, 'wbAgentApplied', 'Đã áp dụng lệnh AI trên máy.', 'Applied AI intent on device.', 1],
  [P, 'wbKnPackDeleted', 'Đã xóa gói khỏi Tri thức.', 'Pack removed from Knowledge.', 1],
  [P, 'wbCmpTitleRequired', 'Cần nhập tiêu đề gói.', 'Pack title is required.', 1],
  [P, 'wbCmpCreated', 'Đã tạo gói trong Tri thức.', 'Pack added to Knowledge.', 1],
  [P, 'wbKnSaved', 'Đã lưu.', 'Saved.', 1],
  [P, 'wbMatChainOpened', 'Đã mở chuỗi mẫu miễn phí theo thứ tự.', 'Opened the free template chain in order.', 1],
  [P, 'wbKnSearch', 'Tìm', 'Search', 1],
  [P, 'wbKnSearchPlaceholder', 'Tên gói, thẻ, ghi chú…', 'Title, tags, notes…', 1],
  [P, 'wbKnLibrary', 'Thư viện', 'Library', 1],
  [P, 'wbKnEmpty', 'Chưa có gói. Tạo ở tab Soạn mới.', 'No packs yet. Create in Compose.', 1],
  [P, 'wbKnFiles', 'tệp', 'files', 1],
  [P, 'wbCommonMaterials', 'Tài liệu', 'Materials', 2],
  [P, 'wbKnViewFiles', 'Xem file', 'View files', 1],
  [P, 'wbKnDeletePack', 'Xóa gói', 'Delete pack', 1],
  [P, 'wbCommonTags', 'Thẻ', 'Tags', 2],
  [P, 'wbCommonNotes', 'Ghi chú', 'Notes', 1],
  [P, 'wbCommonSave', 'Lưu', 'Save', 1],
  [P, 'wbKnSelectPack', 'Chọn một gói.', 'Select a pack.', 1],
  [P, 'wbMatSelectPackFirst', 'Chọn gói ở Tri thức trước.', 'Select a Knowledge pack first.', 1],
  [P, 'wbMatEmpty', 'Chưa có file — thêm bên dưới.', 'No files yet — add below.', 1],
  [P, 'wbCommonOpen', 'Mở', 'Open', 1],
  [P, 'wbCommonDelete', 'Xóa', 'Delete', 1],
  [P, 'wbMatAdd', 'Thêm tài liệu', 'Add material', 1],
  [P, 'wbMatAddOpen', 'Thêm & mở', 'Add & open', 1],
  [
    P,
    'wbMatQuickCreateHint',
    'Tạo nhanh Office vào gói này (lưu lần đầu = hiện trong danh sách). File đã có: chuyển gói từ Home → danh sách file.',
    'Quick-create Office into this pack (first save lists it here). Existing files: move pack from Home → file list.',
    1,
  ],
  [P, 'wbMatQuickTemplates', 'Mẫu nhanh (miễn phí)', 'Quick templates (free)', 1],
  [P, 'wbMatOpenChain', 'Mở chuỗi mẫu miễn phí', 'Open free template chain', 1],
  [P, 'wbCommonSkills', 'Kỹ năng', 'Skills', 2],
  [P, 'wbSkNeedPack', 'Chọn gói ở Tri thức để gắn ngữ cảnh trước khi chạy.', 'Select a Knowledge pack for context before running.', 1],
  [P, 'wbSkContext', 'Ngữ cảnh:', 'Context:', 1],
  [P, 'wbSkRoleSkills', 'Kỹ năng theo vai', 'Role skills', 1],
  [P, 'wbSkRoleHint', 'Kỹ năng gắn với vai trò hiện tại. Mỗi lần chạy hỏi xác nhận Token.', 'Skills for this practice role. Each run asks to confirm Tokens.', 1],
  [P, 'wbCommonUsesTokens', 'Tốn Token', 'Uses Tokens', 2],
  [P, 'wbCommonRun', 'Chạy', 'Run', 2],
  [P, 'wbSkDomainSkills', 'Kỹ năng lĩnh vực', 'Domain skills', 1],
  [P, 'wbSkDomainHint', 'Thêm tab lĩnh vực bằng +. Mỗi lần chạy hỏi xác nhận Token.', 'Add domain tabs with +. Each run asks to confirm Tokens.', 1],
  [P, 'wbCmpTitle', 'Soạn gói mới', 'New pack', 1],
  [P, 'wbCmpCreating', 'Đang tạo…', 'Creating…', 1],
  [P, 'wbCmpCreate', 'Tạo gói vào Tri thức', 'Create pack in Knowledge', 1],
  [P, 'wbSkConfirmTitle', 'Dùng Token AI?', 'Use AI Tokens?', 1],
  [P, 'wbSkConfirmBody', 'Thao tác này gọi Hub AI và có thể trừ token.', 'This calls your AI Hub and may spend tokens.', 1],
  [P, 'wbCommonCancel', 'Huỷ', 'Cancel', 1],
  [P, 'wbSkConfirmRun', 'Chạy AI', 'Run AI', 1],
  [T, 'wbTabsAreas', 'Khu vực làm việc', 'Workbench areas', 1],
  [T, 'wbCommonDragToReorder', 'Kéo để sắp xếp', 'Drag to reorder', 1],
  [T, 'wbTabsDrag', 'Kéo', 'Drag', 1],
  [T, 'wbCommonUnpin', 'Bỏ tab', 'Unpin tab', 2],
  [T, 'wbTabsAdd', 'Thêm tab', 'Add tab', 1],
  [T, 'wbTabsMenuTitle', 'Thêm vào bàn làm việc', 'Add to Workbench', 1],
  [T, 'wbTabsAllPinned', 'Đã thêm đủ khu vực.', 'All areas are pinned.', 1],
  [T, 'wbTabsCore', 'Khu vực chính', 'Core areas', 1],
  [T, 'wbTabsModules', 'Module', 'Modules', 1],
  [S, 'wbSkTabsNav', 'Tab kỹ năng chuyên môn', 'Skill domain tabs', 1],
  [S, 'wbCommonDragToReorder', 'Kéo để sắp xếp', 'Drag to reorder', 1],
  [S, 'wbCommonUnpin', 'Bỏ tab', 'Unpin tab', 1],
  [S, 'wbSkTabsAdd', 'Thêm tab kỹ năng', 'Add Skill tab', 1],
  [S, 'wbSkTabsMenuTitle', 'Thêm lĩnh vực kỹ năng', 'Add Skill domain', 1],
  [S, 'wbSkTabsAllPinned', 'Đã thêm đủ lĩnh vực.', 'All domains are pinned.', 1],
  [M, 'wbModuleUnknown', 'Module không tồn tại.', 'Unknown module.', 1],
  [M, 'wbFormsNoSupportedFile', 'Không chọn được file hỗ trợ.', 'No supported file selected.', 1],
  [
    M,
    'wbFormsHint',
    'Tải file mẫu (Word/PDF/Excel…) vào thư viện — My AI có thể điền theo mẫu thật. “Soạn” seed Docs vào gói đang chọn; “Mở file” mở mẫu gốc.',
    'Upload a template file (Word/PDF/Excel…) — My AI can fill from the real form. “Draft” seeds Docs into the selected pack; “Open file” opens the source template.',
    1,
  ],
  [M, 'wbFormsDraftNeedsPackHint', 'Chọn gói ở Tri thức trước khi Soạn.', 'Select a Knowledge pack before drafting.', 1],
  [M, 'wbFormsTitle', 'Tên biểu mẫu', 'Form title', 1],
  [M, 'wbFormsTitlePlaceholder', 'VD: Đơn xin nghỉ phép', 'e.g. Leave request', 1],
  [M, 'wbFormsNote', 'Ghi chú (tuỳ chọn)', 'Note (optional)', 1],
  [M, 'wbFormsReplaceFile', 'Đổi file mẫu…', 'Replace template file…', 1],
  [M, 'wbFormsUploadFile', 'Tải file mẫu…', 'Upload template file…', 1],
  [M, 'wbFormsClearFile', 'Bỏ file', 'Clear file', 1],
  [M, 'wbFormsTemplateFile', 'File mẫu:', 'Template file:', 1],
  [M, 'wbFormsSave', 'Lưu biểu mẫu', 'Save form', 1],
  [M, 'wbFormsAdd', 'Thêm vào thư viện', 'Add to library', 1],
  [M, 'wbFormsCancelEdit', 'Huỷ sửa', 'Cancel edit', 1],
  [M, 'wbFormsEmpty', 'Chưa có biểu mẫu.', 'No forms yet.', 1],
  [M, 'wbFormsFile', 'File:', 'File:', 1],
  [M, 'wbFormsLinked', 'Đã gắn gói Tài liệu', 'Linked to Materials pack', 1],
  [M, 'wbFormsEdit', 'Sửa', 'Edit', 1],
  [M, 'wbFormsOpenFile', 'Mở file', 'Open file', 1],
  [M, 'wbFormsDraft', 'Soạn', 'Draft', 2],
  [M, 'wbFormsDraftNeedsPack', 'Chọn gói ở Tri thức trước', 'Select a Knowledge pack first', 1],
  [M, 'wbCommonDelete', 'Xóa', 'Delete', 1],
]

/** calls whose arguments are not two plain strings: [file, a, b, replacement] (one call each) */
const SPECIAL = [
  [
    P,
    "hasSelectedPack ? 'Mở Skills — chọn kỹ năng và xác nhận Token.' : 'Mở Skills — chọn gói Tri thức rồi chạy kỹ năng.'",
    "hasSelectedPack ? 'Opened Skills — pick a skill and confirm Tokens.' : 'Opened Skills — select a Knowledge pack, then run a skill.'",
    "t(hasSelectedPack ? 'wbSkOpenedPick' : 'wbSkOpenedNeedPack')",
  ],
  [
    P,
    '`Xóa gói “${meta?.title ?? selected.name}”?\\nFile trong gói sẽ về dự án mặc định, không mất nội dung.`',
    '`Delete pack “${meta?.title ?? selected.name}”?\\nFiles move to the default project; content is not lost.`',
    "t('wbKnDeletePackConfirm', { title: meta?.title ?? selected.name })",
  ],
  [P, '`Xóa tệp “${base}”?`', '`Delete file “${base}”?`', "t('wbMatDeleteFileConfirm', { name: base })"],
  [P, '`Thiếu: ${f.labelVi}`', '`Missing: ${f.labelEn}`', "t('wbCmpMissing', { field: vi ? f.labelVi : f.labelEn })"],
  [
    P,
    '`Đã thêm: ${roleDef.labelVi}`',
    '`Added: ${roleDef.labelEn}`',
    "t('wbMatRoleAdded', { role: vi ? roleDef.labelVi : roleDef.labelEn })",
  ],
  [
    P,
    '`Đã chạy kỹ năng: ${skill.labelVi}`',
    '`Ran skill: ${skill.labelEn}`',
    "t('wbSkRan', { skill: vi ? skill.labelVi : skill.labelEn })",
  ],
  [
    P,
    '`Đã chạy kỹ năng vai: ${skill.labelVi}`',
    '`Ran role skill: ${skill.labelEn}`',
    "t('wbSkRanRole', { skill: vi ? skill.labelVi : skill.labelEn })",
  ],
]

const q = (s) => `'${s}'`
module.exports = {
  calls: [
    ...PLAIN.map(([file, key, vi, en, count]) => ({ file, a: q(vi), b: q(en), call: `t('${key}')`, count })),
    ...SPECIAL.map(([file, a, b, call]) => ({ file, a, b, call, count: 1 })),
  ],
  keys: Object.entries(TEXT).map(([key, [zh, vi, en]]) => ({ key, zh, vi, en })),
}
EOF
```

- [ ] **Step 4: Chạy script**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
K="${TMPDIR:-/tmp}/wb-keys"
node "$K/relabel.cjs" "$K/relabel-table.cjs" apps/shell/src/renderer/src apps/shell/src/renderer/src/i18n/workbench
npx prettier --write apps/shell/src/renderer/src/i18n/workbench
```
Kết quả mong đợi: `replaced 95 label() calls in 4 files; added 85 keys`. Nếu script dừng với `expected N × label(…), found M`, một task trước đã đổi chuỗi đó: sửa `count` hoặc chuỗi trong bảng cho khớp file rồi chạy lại từ `git checkout` bốn file và ba shard.

- [ ] **Step 5: Khai báo `t` ở bốn file và gỡ helper `label`**

`apps/shell/src/renderer/src/PracticeHome.tsx`:
- trước: `  const { lang } = useI18n()`; sau: `  const { lang, t } = useI18n()`
- xóa dòng `  const label = (a: string, b: string) => (vi ? a : b)`.

`apps/shell/src/renderer/src/WorkbenchTabs.tsx`:
- dưới `import { WorkbenchIcon } from './WorkbenchIcons'`, thêm `import { useI18n } from './locale'`;
- trước: `  const label = (a: string, b: string) => (vi ? a : b)`; sau: `  const { t } = useI18n()`.

`apps/shell/src/renderer/src/SkillDomainTabs.tsx`:
- dưới `import { MODULE_TONES, tintStyle } from './module-tones'` (Task 17 Step 4), thêm `import { useI18n } from './locale'`;
- trước: `  const label = (a: string, b: string) => (vi ? a : b)`; sau: `  const { t } = useI18n()`.

`apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`:
- dưới `import { LocalTag } from './LocalTag'` (Task 17 Step 3), thêm `import { useI18n } from './locale'`;
- thay cả hai dòng `  const label = (a: string, b: string) => (vi ? a : b)` (trong `WorkbenchModulePane`, trước `if (!mod)`, và trong `FormsPane`) bằng `  const { t } = useI18n()` (replace_all). Hook vẫn được gọi trước lệnh `return` sớm.

`vi` vẫn được dùng ở cả bốn file (nhãn module, vai trò, kỹ năng và nội dung văn bản nháp), nên không prop nào bị bỏ.

Tên `t` bị che ở vài phạm vi con: `const t = title.trim() || …` trong `save` của `FormsPane`, và các callback `(t) => …` trên `practice.templates` / `split(',')` trong `PracticeHome`. Đã kiểm trên bản chạy thử: không lời gọi `t('wb…')` nào nằm trong các phạm vi đó (nút "Mở chuỗi mẫu miễn phí" nằm ngoài `practice.templates.map((t) => …)`), nên không cần đổi tên. Nếu sau này có, `tsc` báo lỗi gọi một `string`.

- [ ] **Step 6: Typecheck, lint, test và theme check**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck -w @genoffice/shell
npx eslint apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/WorkbenchTabs.tsx apps/shell/src/renderer/src/SkillDomainTabs.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/tests/workbench-copy.test.ts
cd apps/shell && npx vitest run tests/workbench-copy.test.ts tests/strings-workbench.test.ts && npx vitest run && cd ../..
npm run check:theme-colors -- --base origin/main
npm run format
```
Kết quả mong đợi: typecheck exit 0 (key thiếu trong shard là lỗi `StringKey`); eslint exit 0 (có thể còn cảnh báo `react-hooks/exhaustive-deps` sẵn có về hàm dịch trong effect, vốn đã có với `label`; không thêm `t` vào mảng phụ thuộc); `workbench-copy` 5 test và `strings-workbench` pass, kể cả `formal vi copy does not mix in English UI words` và kiểm placeholder của 21 locale; mọi test shell pass; theme check sạch (task không đổi CSS).

Kiểm trong app (chỉ đổi renderer): Cài đặt → Tài khoản → Ngôn ngữ, đổi lần lượt Tiếng Việt, English và 中文. Mở Bàn làm việc → Tri thức, Tài liệu, Kỹ năng, Soạn mới, Biểu mẫu và menu "+" của thanh tab: mọi chữ đổi theo ngôn ngữ, tiếng Việt không còn "tab", "file", "Skills".

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
git add apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/WorkbenchTabs.tsx apps/shell/src/renderer/src/SkillDomainTabs.tsx apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/i18n/workbench apps/shell/tests/workbench-copy.test.ts
git commit -m "$(cat <<'EOF'
refactor(shell): move the remaining Workbench label(vi, en) copy into the i18n shard

Knowledge, Materials, Skills, Compose, Forms and the tab menus now read
their copy from i18n/workbench (zh, vi and en written by hand, the other
locales start from English). Vietnamese copy no longer mixes in English UI
words.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 19: E2E smoke với stub UniWork, và kiểm tra cuối

**Files:**
- Create: `e2e/fixtures/uniwork-work-stub.ts`, `e2e/workbench-overview.spec.ts`
- Modify: `e2e/fixtures/uniwork-documents-stub.ts` (comment đầu file l.1-19, import l.22-30, lời gọi `startUniworkAuthStub` l.532)

**Interfaces:**
- Consumes: `StubRouteContext { req, res, route, url, readBody(), send(status, body), deviceSessionId() }`, `STUB_ACCOUNT` và `STUB_ORG` (`e2e/fixtures/uniwork-auth-stub.ts`). `startUniworkDocumentsStub()` và `addDocument({ filename, bytes })` (`uniwork-documents-stub.ts`, có slug từ Task 7). `launchShell`, `closeAndSaveVideo` và `waitForPageWithUrl` (`e2e/helpers.ts`). `shellEnv`, `signIn`, `hasOsKeyring`, `accountButton` và `NO_KEYRING_SKIP` (`uniwork-signin-steps.ts`). Selector Tổng quan của Task 13: `.wb-ov-stat` (5 ô theo thứ tự Đang mở, Quá hạn, Đến hạn hôm nay, Họp hôm nay, Chưa đọc) và `.wb-ov-recent`; mục nav tiếng Anh `.nav-item` có chữ "Workbench" (Task 11).
- Produces: `workRoute(ctx: StubRouteContext): boolean`, trả lời `GET /workspaces/{ws}/home`, và `STUB_HOME_COUNTS`.

- [ ] **Step 1: Viết spec E2E sẽ fail**

`e2e/workbench-overview.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'
import {
  startUniworkDocumentsStub,
  type UniworkDocumentsStub,
} from './fixtures/uniwork-documents-stub'
import { STUB_HOME_COUNTS } from './fixtures/uniwork-work-stub'
import {
  NO_KEYRING_SKIP,
  accountButton,
  hasOsKeyring,
  shellEnv,
  signIn,
} from './fixtures/uniwork-signin-steps'

/**
 * Workbench smoke against the local UniWork stub: signed in, the Overview
 * shows the five stat tiles from GET /home and a recent UniWork document
 * opens in its editor.
 */

const ROOT = resolve(__dirname, '..')

test.describe.serial('Workbench Overview', () => {
  let stub: UniworkDocumentsStub
  let userDataDir = ''
  let keyring = true

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    stub = await startUniworkDocumentsStub()
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'workbench-overview-setup',
      env: shellEnv(stub),
    })
    userDataDir = first.userDataDir
    try {
      keyring = await hasOsKeyring(first)
      if (keyring) await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'workbench-overview-setup')
    }
  })

  test.afterAll(async () => {
    await stub?.close()
  })

  test.beforeEach(() => {
    test.skip(!keyring, NO_KEYRING_SKIP)
  })

  test('Overview shows the five stat tiles and opens a recent document', async () => {
    test.setTimeout(150_000)
    stub.addDocument({
      filename: 'weekly-plan.docx',
      bytes: await readFile(join(ROOT, 'fixtures/generated/simple.docx')),
    })
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: 'workbench-overview',
      env: shellEnv(stub),
    })
    try {
      const shell = launched.page
      await expect(accountButton(shell)).toHaveAttribute('data-state', 'signed-in', {
        timeout: 45_000,
      })
      await shell.locator('.nav-item', { hasText: 'Workbench' }).click()

      const tiles = shell.locator('.wb-ov-stat')
      await expect(tiles).toHaveCount(5, { timeout: 30_000 })
      const expected = [
        STUB_HOME_COUNTS.open,
        STUB_HOME_COUNTS.overdue,
        STUB_HOME_COUNTS.due_today,
        STUB_HOME_COUNTS.meetings_today,
        STUB_HOME_COUNTS.unread,
      ]
      for (const [i, count] of expected.entries()) {
        await expect(tiles.nth(i)).toContainText(String(count))
      }

      await shell.locator('.wb-ov-recent', { hasText: 'weekly-plan.docx' }).click()
      const editor = await waitForPageWithUrl(launched.app, '://docs/')
      await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
    } finally {
      await closeAndSaveVideo(launched, 'workbench-overview')
    }
  })
})
```
Tạo luôn `e2e/fixtures/uniwork-work-stub.ts` chỉ với số đếm để spec biên dịch được:
```ts
export const STUB_HOME_COUNTS = { open: 7, overdue: 1, due_today: 2, meetings_today: 3, unread: 5 }
```

- [ ] **Step 2: Build và chạy; xác nhận fail**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run build:all
npx playwright test --config e2e/playwright.config.ts e2e/workbench-overview.spec.ts
```
Kết quả mong đợi: FAIL. Stub trả 404 cho `GET /home`, nên Tổng quan hiện trạng thái lỗi thay vì ô số, và lỗi là `expect(locator).toHaveCount(5)` hoặc `toContainText("7")`. Trên runner Linux không có keyring, test bị `1 skipped` (`NO_KEYRING_SKIP`); chạy trên macOS hoặc Windows.

- [ ] **Step 3: Cho stub trả lời `/home`**

Thay `e2e/fixtures/uniwork-work-stub.ts` bằng:
```ts
/**
 * Work routes the Workbench Overview reads, on the documents stub's origin
 * (chained after its documents routes):
 *
 *   GET /workspaces/{ws}/home
 *
 * Shapes follow the server SDO (`uniwork:server/internal/handler/dto/sdo/home.go`).
 * The counts are distinct numbers so a spec can tell the five tiles apart.
 */
import { STUB_ACCOUNT, STUB_ORG, type StubRouteContext } from './uniwork-auth-stub'

export const STUB_HOME_COUNTS = { open: 7, overdue: 1, due_today: 2, meetings_today: 3, unread: 5 }

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function taskDto(workspaceId: string, n: number, title: string, due: string) {
  return {
    id: `task_e2e_${n}`,
    organization_id: STUB_ORG.id,
    workspace_id: workspaceId,
    number: n,
    identifier: `ENG-${n}`,
    revision: 1,
    title,
    description: '',
    status: 'todo',
    priority: 'medium',
    due_date: due,
    position: n,
    created_by: STUB_ACCOUNT.id,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-08T09:00:00Z',
  }
}

/** Answers the work routes; false for anything else (the auth stub then answers 404). */
export function workRoute(ctx: StubRouteContext): boolean {
  const m = /^\/workspaces\/([^/]+)\/home$/.exec(ctx.route)
  if (!m || ctx.req.method !== 'GET') return false
  const workspaceId = m[1]!
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const meetingStart = new Date(now.getTime() + 60 * 60_000)
  ctx.send(200, {
    today: localDay(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    counts: STUB_HOME_COUNTS,
    my_work: [
      taskDto(workspaceId, 1, 'Reconcile the September invoices', localDay(yesterday)),
      taskDto(workspaceId, 2, 'Send the weekly plan', localDay(now)),
    ],
    upcoming_meetings: [
      {
        id: 'meet_e2e_1',
        workspace_id: workspaceId,
        title: 'Weekly sync',
        description: '',
        starts_at: meetingStart.toISOString(),
        ends_at: new Date(meetingStart.getTime() + 30 * 60_000).toISOString(),
        room_name: 'weekly-sync',
        created_by: STUB_ACCOUNT.id,
        status: 'SCHEDULED',
      },
    ],
    inbox: [
      {
        id: 'ntf_e2e_1',
        kind: 'task_assigned',
        workspace_id: workspaceId,
        organization_id: STUB_ORG.id,
        resource_type: 'task',
        resource_id: 'task_e2e_2',
        actor_kind: 'human',
        actor_id: STUB_ACCOUNT.id,
        title_key: 'notifications.kind.task_assigned',
        params: { actor: 'E2E', task: 'Send the weekly plan' },
        created_at: now.toISOString(),
      },
    ],
    partial: [],
    generated_at: now.toISOString(),
  })
  return true
}
```
Trong `e2e/fixtures/uniwork-documents-stub.ts`:
- Trong comment đầu file, sau dòng `*   POST /office/sessions/exchange                 (single-use ticket, device match)`, thêm ` *   GET  /workspaces/{ws}/home                     (uniwork-work-stub.ts)`.
- Dưới import `./uniwork-auth-stub`, thêm `import { workRoute } from './uniwork-work-stub'`.
- trước: `  const base = await startUniworkAuthStub({ extend: documentsRoute })`
- sau:
```ts
  const base = await startUniworkAuthStub({
    extend: async (ctx) => (await documentsRoute(ctx)) || workRoute(ctx),
  })
```

- [ ] **Step 4: Chạy và xác nhận pass**

Chạy: `cd /Users/ducquang/UNICOM/uniwork-office && npx playwright test --config e2e/playwright.config.ts e2e/workbench-overview.spec.ts`
Kết quả mong đợi: `1 passed` trên macOS/Windows, hoặc `1 skipped` trên runner Linux không có keyring. Rồi chạy `npx playwright test --config e2e/playwright.config.ts e2e/uniwork-documents.spec.ts e2e/uniwork-signin.spec.ts`. Kết quả mong đợi: các spec này vẫn pass với stub đã mở rộng.

- [ ] **Step 5: Commit E2E**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run format
git add e2e/workbench-overview.spec.ts e2e/fixtures/uniwork-work-stub.ts e2e/fixtures/uniwork-documents-stub.ts
git commit -m "$(cat <<'EOF'
test(e2e): Workbench Overview smoke against the UniWork stub

Signed in, the Overview shows the five stat tiles from GET /home and a
recent UniWork document opens in Docs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Kiểm cuối: không còn sót trong toàn repo**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
grep -rnw -e readTasks -e readCalendar -e readPersonal -e TasksPane -e CalendarPane -e PersonalPane -e workbench-reminders -e wb-sticky -e wb-board -e DESK_CHART -e TeacherHome apps packages e2e --include='*.ts' --include='*.tsx' --include='*.css' | grep -v node_modules | grep -v '/out/'
grep -rn "0f7fff\|15 127 255" apps/shell/src/renderer/src --include='*.css'
```
Kết quả mong đợi: cả hai lệnh không in gì. Lệnh thứ hai chứng minh accent cũ đã rời CSS của shell.

- [ ] **Step 7: Kiểm cuối: chạy mọi cổng CI ở máy**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run typecheck
npm test
npm run lint
npm run format:check -- --base origin/main
npm run check:theme-colors -- --base origin/main
npm run check:english-comments
npm run check:brand
```
Kết quả mong đợi: mọi lệnh exit 0. `npm test` chạy mọi suite workspace, không còn `@uniwork/edu-core` (C7).

- [ ] **Step 8: Kiểm cuối: rebuild shell và khởi chạy**

```bash
cd /Users/ducquang/UNICOM/uniwork-office
npm run build:all
npx electron apps/shell
```
Kết quả mong đợi: app khởi động, renderer không trắng. Bắt buộc rebuild vì code main và preload của các task trước chỉ chạy từ build shell.

- [ ] **Step 9: Kiểm cuối: rà ảnh chụp light và dark (đổi accent, spec §9.3)**

Đổi theme ở Cài đặt → Theme (Light, rồi Dark). Ở mỗi màn dưới, chụp một ảnh cho mỗi theme và tick từng ô:
- [ ] Home → File gần đây: hero, thẻ tạo nhanh, mục nav đang chọn. Accent là `#0a52e6` ở light và `#5a96ff` ở dark.
- [ ] Chat My AI: nút gửi và chip gợi ý. Chữ trên accent là trắng ở light và `#0d1220` ở dark, đọc được ở cả hai.
- [ ] Bàn làm việc → Tổng quan: ô số, câu đầu trang, dải tài liệu gần đây, nhãn "Trên máy này" ở file cục bộ.
- [ ] Bàn làm việc → Việc: tiêu đề nhóm, pill quá hạn (token danger), pill hôm nay (token warning), checkbox, ô thêm nhanh, và thanh Thử lại (tạm ngắt mạng).
- [ ] Bàn làm việc → Lịch: icon việc màu xanh lá, icon họp màu tím; tint đọc được ở dark.
- [ ] Bàn làm việc → Hồ sơ, Ghi chú (thẻ, viền focus màu accent), Biểu mẫu (nhãn Trên máy này), Kỹ năng (badge chữ cái của domain theo tint xanh dương).
- [ ] Thanh tab khi đang mở tài liệu, chip trạng thái UniWork, và hộp thoại mở UniWork (dòng chọn, nút chính).
- [ ] Hộp thoại Cài đặt: pane Tài khoản và AI (nút chính, công tắc, vòng focus).
- [ ] Không còn gradient, hero glow hay chuyển động `wb-ms-breathe` ở đâu. Khi bật "Reduce motion" của hệ điều hành, không có gì chuyển động quá các transition 150–250 ms.

**Chưa làm ở Task 14–19:**
- Backup media IndexedDB còn một slot `tasks` mà không còn ai ghi. Dọn nó đụng tới code backup ở main và kiểu dùng chung, nên để lại.
- `SkillDomainDef.color` trong practice-core giờ là dữ liệu không dùng.

**Chưa kiểm:**
- Liệu `my-tasks` (relation=all) của server có trả cả việc người dùng chỉ tạo mà không được giao.
- `my-tasks` lấy tối đa 200 việc (`limit=200`); người có hơn 200 việc mở sẽ thấy danh sách thiếu mà không có báo hiệu.

**Rủi ro:**
- `applyAgentIntent` giờ là async.
- 18 locale còn lại hiện tiếng Anh cho tới khi được dịch.
