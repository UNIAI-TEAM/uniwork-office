# Thiết kế lại giao diện Bàn làm việc — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm lại phần trình bày của Bàn làm việc theo hướng B (breadcrumb, số đếm trên tab, dải số liệu liền, danh sách chia nhóm, tab phẳng một tiêu đề, trạng thái rỗng/lỗi thống nhất) mà không đổi dữ liệu, cache, IPC hay thứ tự gọi API.

**Architecture:** Task 1 thêm 3 token và các primitive `.wb-*` (nút, khối, dòng, checkbox tự vẽ, skeleton). Task 2 thêm hai component dùng chung `WorkPaneHeader` và `WorkStatePanel` cùng hàm thuần `greetingName`. Task 3–8 chuyển từng màn sang các primitive đó. Task 9 quét toàn vùng CSS Bàn làm việc bằng một test kiểm toán cố định. Task 10 chụp ảnh trước/sau ngoài repo. Mọi màu đi qua token; logic mới chỉ là các hàm thuần (`greetingName`, `tabCounts`, `myWorkGroups`) và ba prop chỉ phục vụ trình bày (`counts`, `onSummary`, `head`).

**Tech Stack:** Electron, React 19 + TypeScript, CSS thuần (`apps/shell/src/renderer/src/home.css`, `packages/ui/src/tokens.css`), vitest (mặc định `node`, test component bật `@vitest-environment jsdom`), Playwright cho e2e và ảnh chụp.

**Spec:** docs/superpowers/specs/2026-10-13-workbench-redesign-design.md

Đường dẫn trong các task là tương đối theo gốc repo `/Users/ducquang/UNICOM/uniwork-office`, trừ khi ghi rõ. Mọi số dòng là số dòng ở commit `2ed35881`; task trước có thể đã làm lệch chúng, nên luôn tìm theo đoạn văn bản neo được trích.

## Global Constraints

- **R1:** giữ ngôn ngữ UniWork: tint để nhận diện, signal để báo trạng thái; không gradient trang trí, không glassmorphism, không texture. Không đặt font mới: body của shell là `-apple-system, var(--ui-cjk), 'Segoe UI'…` (`home.css:90`), Inter chỉ có trong `--gs-font-sans`.
- **R2:** phạm vi chỉ Bàn làm việc (thanh trên, thanh tab, Tổng quan, Công việc, Lịch, Hồ sơ, Biểu mẫu, Ghi chú, 4 trụ cột và các trạng thái). Sidebar, Tệp, Settings, My AI không đổi; hộp thoại `.modal` xác nhận kỹ năng (`PracticeHome.tsx:978-1006`) giữ `.btn`.
- **R3:** hướng B: breadcrumb, số đếm trên tab, dải số liệu liền, danh sách chia nhóm có hover, tab phẳng một dòng tiêu đề.
- **R4:** màu brand cho nút chính chỉ qua `.wb-btn-primary` bên trong `.wb-home`; `.btn` và `.btn-primary` dùng chung (`--color-btn-primary`) không đổi.
- **R5:** không gợi ý phím tắt trên "+ Tạo mới" (`CmdOrCtrl+N` đã thuộc tài liệu mới).
- **R6:** chỉ làm lại phần trình bày. Hook dữ liệu, cache, IPC và thứ tự gọi API giữ nguyên. Thứ được phép thêm: hàm thuần `greetingName`, `tabCounts`, `myWorkGroups`; prop `WorkbenchTabs.counts`, `WorkOverview.onSummary`, `WorkTasksPane.head`.
- **Token mới (đủ 3 khối, nối vào cuối từng khối, không thêm khối thứ tư):** light `--wb-shadow: 0 1px 2px rgb(16 24 40 / 5%), 0 1px 3px rgb(16 24 40 / 4%)`, `--wb-row-hover: #f7f8fa`, `--wb-check-border: #858b94`; dark và system-dark `--wb-shadow: none`, `--wb-row-hover: #26282c`, `--wb-check-border: #72777f`.
- **Nút `.wb-btn`:** cao 32px (`.wb-btn-sm` 28px, padding `0 10px`, chữ 12.5px), padding `0 12px`, bo `var(--radius-8)`, chữ 13/500, transition `background-color, border-color, color` 150ms, nhấn `scale(0.98)`, focus `outline: 2px solid var(--accent); outline-offset: 2px`, disabled `opacity: 0.5; cursor: not-allowed` không có nhấn, không box-shadow. Primary `--accent`/`--on-accent`, hover `--accent-hover`; secondary `--surface` + viền `--border`, hover `--hover`; ghost trong suốt chữ `--text-secondary`, hover `--hover`/`--text`; icon 32×32 padding 0. Dưới `prefers-reduced-motion: reduce`: không transition, không transform.
- **Thang chữ:** ngày 11.5/500 `--text-secondary` (không uppercase); lời chào 22/600/−0.02em; tiêu đề tab 16/600/−0.01em; tiêu đề mục 13/600; body 13/400; caption/meta 12 `--text-secondary`; số trên dải 24/600/−0.03em, `line-height: 1`. Số, giờ, ngày, số đếm dùng `.wb-num` (`tabular-nums`). Mã việc và giờ dùng `.wb-mono` (stack `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, 11.5px, `--text-secondary`).
- **Bề mặt:** khối `.wb-block` = `--surface`, viền 1px `--border`, bo `--radius-12`, bóng `--wb-shadow`, `overflow: hidden`. Dòng `.wb-row` = cao tối thiểu 36px, padding `7px 12px`, hover `--wb-row-hover`, giữa hai dòng `border-top: 1px solid var(--border-subtle)`. Thao tác dòng dùng lại `.wb-row-actions` (ẩn `opacity: 0`, hiện khi `:hover`/`:focus-within`, luôn hiện khi `hover: none`).
- **Bố cục:** cột nội dung `max-width: 1180px`, căn trái, lề ngang 24px, khoảng cách giữa các mục 18px.
- **Viền đứt:** chỉ còn ô dấu + của "Thêm việc…" (`.wb-work-quick-plus`). Không pill (`999px`, `--radius-16`, `--radius-30`), không `--shadow-btn*`/`--shadow-pill`, không `translateY` khi hover trong vùng Bàn làm việc.
- **Tương phản:** chữ ≥ 4.5:1, viền checkbox ≥ 3:1, ở cả light, dark và system-dark. Không dùng `--text-tertiary` hay `--danger` trần cho chữ (dùng `--text-secondary` / `--danger-text`).
- **Kiểm tra mỗi task (từ gốc repo):** `cd apps/shell && npx vitest run`; `npm run typecheck`; `npm run check:theme-colors -- --base 2ed35881`; `npm run check:english-comments`; `npx prettier --check <các file đã sửa>`. Test packages/ui chạy với tiền tố `NODE_OPTIONS=--no-experimental-webstorage` nếu `localStorage` của Node che jsdom.
- **i18n:** khóa mới thêm vào `i18n/workbench/zh.ts` (định nghĩa bộ khóa), `en.ts`, `vi.ts`; 18 locale còn lại là `{ ...en }`. Dạng "Nhãn: {count}" để tránh số nhiều. Chuỗi vi không dùng từ tiếng Anh bị cấm trong `strings-workbench.test.ts`. Không thêm `label(` hay `const label = ` vào `PracticeHome.tsx`, `WorkbenchTabs.tsx`, `WorkbenchModulePanes.tsx`, `SkillDomainTabs.tsx` (`workbench-copy.test.ts`).
- **Hook:** không đưa `t` của `useI18n()` hay callback từ prop vào mảng phụ thuộc; callback gọi qua ref.
- **Comment trong code:** tiếng Anh (`check:english-comments`).
- **Git:** chỉ `git add` từng đường dẫn cụ thể. Không bao giờ stage `package-lock.json` hay `.codegraph/`. Mỗi commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Năm điều kiện dễ hỏng mà test hiện có chưa chạm tới. Mỗi điều đã có một test ghim được thêm vào task sở hữu nó.

1. **Tên workspace và tiêu đề việc rất dài.** Chip breadcrumb, tiêu đề dòng Tổng quan, tiêu đề dòng Công việc và meta của tiêu đề tab phải cắt bằng dấu "…" trên một dòng, không đẩy nút thao tác hay pill ra ngoài. Test ghim: Task 6 Step 2b (`workbench-foundation.test.ts`, "long titles truncate…").
2. **Workspace không có việc nhưng có cuộc họp.** `isQuiet` trả `false`, nên Tổng quan không được hiện panel "yên"; khu Việc của tôi hiện câu rỗng, không có tiêu đề nhóm, và cuộc họp vẫn liệt kê. Test ghim: Task 5 Step 5(e).
3. **Số đếm trên tab khi Tổng quan chưa tải xong.** Trước khi summary về thì không có số; khi summary về thì thanh tab phải vẽ lại ngay mà không cần đổi tab (đường `onSummary` → `useState` trong `PracticeHome`). Không có test nào mount `PracticeHome` cho việc này. Test ghim: Task 4 Step 3b (`workbench-tab-counts.test.ts`).
4. **Chỉ dùng bàn phím.** Hai `<select>` phủ trong suốt phải là điểm dừng Tab duy nhất của mỗi chip (phần chữ của chip là `aria-hidden`, không có nút thừa); thao tác ẩn theo hover phải hiện khi dòng có `:focus-within`; lối tắt "Mở ↗" ở Tổng quan nằm ngoài thứ tự Tab vì tiêu đề đã là đường bàn phím. Test ghim: Task 3 Step 1 ("keyboard reaches each chip…") và assertion trong Task 5 Step 5(d).
5. **Tương phản dark của pill, chip, ô chữ cái và checkbox mới.** Bảng cặp token chỉ đo token; test ghim đọc chính các rule `.wb-pill.is-status`, `.wb-pill.is-danger`, `.wb-pill.is-warning`, `.wb-crumb-role`, `.wb-ov-avatar` và checkbox đã tick, rồi đo cặp màu chữ/nền của từng rule ở cả 3 khối theme. Test ghim: Task 9 Step 1 ("the pills, chips, avatar and ticked box…").

Ngoài ra reviewer nên nhìn: `field-sizing: content` (Ghi chú) cần Chromium ≥ 123; dải 5 ô ở Tổng quan chưa có breakpoint cho cửa sổ rất hẹp; số đếm tab chỉ cập nhật khi Tổng quan tải lại (tick ở tab Công việc không đổi số ngay, đúng R6).

## Interface Contract

Đã đối chiếu với code ở `2ed35881`. Đây là bản đã hòa giải giữa contract chung và các bản nháp; khi task và mục này khác nhau thì mục này đúng.

### Token (`packages/ui/src/tokens.css`)

Như Global Constraints. `tests/module-tones.test.ts` cắt file thành đúng 3 khối, nên chỉ nối thêm dòng vào khối có sẵn.

### Lớp CSS (`apps/shell/src/renderer/src/home.css`)

| Task | Thêm / đổi                                                                                                                                                                                                                                                                                                                                                                                 | Xóa                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `.wb-home` (gap 18, `padding-inline: 24px`), `.wb-home > :not(.modal-overlay)` (max 1180), `.wb-btn`, `-primary`, `-secondary`, `-ghost`, `-icon`, `-sm`, `.wb-num`, `.wb-mono`, `.wb-block`, `.wb-row`, `.wb-group-head` (+`.is-overdue`), `.wb-check`, `.wb-check-box`, `.wb-skel`, `.wb-skel-strip`, `.wb-skel-row`, `@keyframes wb-skel-shimmer`; `.wb-row-actions` thành `opacity: 0` | `.wb-subtabs`, `.wb-subtab*`                                                                                                                    |
| 2    | `.wb-state`, `-icon`, `-title`, `-body`; `.wb-pane`, `-head`, `-text`, `-title`, `-meta`, `-aside`; `.wb-work-skeleton` thành cột flex                                                                                                                                                                                                                                                     | `.wb-work-state*`                                                                                                                               |
| 3    | `.wb-crumb`, `-ws`, `-role`, `-mark`, `-name`, `-caret` (+`.is-muted`), `-sep`, `.wb-crumb:has(select:focus-visible)`; `.wb-new-item` cao 32                                                                                                                                                                                                                                               | `.wb-topbar-picker*`, `.wb-topbar-sep`                                                                                                          |
| 4    | `.wb-tab-count` (+`.is-danger`, `.is-muted`), `.wb-tab.active::after`; unpin/grip hiện khi hover, focus, active                                                                                                                                                                                                                                                                            | `border-bottom` của `.wb-tab`                                                                                                                   |
| 5    | `.wb-ov-strip`, `.wb-ov-stat-top`, `.wb-ov-time`, `.wb-ov-meet`, `.wb-ov-meet-sub`, `.wb-ov-avatar`                                                                                                                                                                                                                                                                                        | `.wb-ov-stats`, `.wb-ov-row*` (trừ `.wb-ov-row-title`), `.wb-ov-row-meta`, `.wb-ov-quiet`                                                       |
| 6    | `.wb-work-quick-plus`, `.wb-work-group`, `.wb-pill.is-status`, `.wb-notes-add`, glyph checkbox                                                                                                                                                                                                                                                                                             | `.wb-work-table*`, `.wb-work-group th`, `.wb-work-check`                                                                                        |
| 7    | `.wb-agenda-head` (+`.is-today`), `.wb-agenda-dot`, `.wb-profile-card`, `-id`, `-avatar`, `-title`                                                                                                                                                                                                                                                                                         | `.wb-agenda-day h3`                                                                                                                             |
| 8    | `.wb-forms-hint`, `-add`, `-title`, `-note`, `-list`, `-text`, `-locked`, `.wb-notes-text`, `.wb-notes-edited`, `.wb-kn-search`, `.wb-cmp`; làm phẳng `.skill-domain-*`, `.wb-pack-item`, danh sách material/skill                                                                                                                                                                         | `.wb-panel`, `.wb-chip` (+`:hover`, `:disabled`; giữ `.wb-chip-row` vì PracticeHome còn dùng), `.wb-module-*`, `.wb-create`, `.wb-notes-delete` |
| 9    | sửa màu AA còn sót, reduced-motion cho `.wb-icon-btn`                                                                                                                                                                                                                                                                                                                                      | mọi lớp không còn TSX nào dùng                                                                                                                  |

Giữ nguyên tên vì test hoặc e2e chọn theo: `.wb-ov-greeting`, `.wb-ov-stat` (×5), `.wb-ov-stat-value`, `data-testid="wb-stat-*"`, `.wb-ov-recents`, `.wb-ov-recent`, `.wb-work-row`, `.wb-work-quick`, `.wb-work-skeleton`, `.wb-agenda-row`, `.wb-agenda-icon`, `.wb-profile-name`, `.wb-profile`, `.wb-new-item`, `.wb-tab`, `.wb-tab-add`, `.wb-detail` (aside Tri thức). Văn bản rule `\n.wb-new-item:focus-visible {\n  outline: 2px solid var(--accent);` và `.wb-tab-menu-item` tương tự phải giữ nguyên.

### Component và hàm

```ts
// module-tones.ts (Task 2)
export type SignalTone = 'danger' | 'warning' | 'info'
export const signalStyle = (s: SignalTone) => ({
  background: `var(--${s}-bg)`,
  color: s === 'info' ? 'var(--info)' : `var(--${s}-text)`,
})

// WorkPaneHeader.tsx (Task 2, file mới)
export interface WorkPaneHeaderProps {
  module: WorkbenchModuleId | PracticePillarId
  title: string
  meta?: ReactNode
  aside?: ReactNode
}
export function WorkPaneHeader(p: WorkPaneHeaderProps): ReactElement
// <header.wb-pane-head><WorkbenchIcon size=20/><div.wb-pane-text><h2.wb-pane-title/>[<p.wb-pane-meta/>]</div>[<div.wb-pane-aside/>]</header>

// WorkErrorState.tsx (Task 2)
export function WorkStatePanel(p: {
  tone: Tint | SignalTone
  icon: ReactNode
  title: string
  body?: string
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' } // mặc định 'primary'
  role?: 'status' | 'alert'
}): ReactElement // <div.wb-state role>, <span.wb-state-icon aria-hidden>, <h3.wb-state-title>, <p.wb-state-body>, một <button.wb-btn>
export function WorkSkeleton(): ReactElement // <div.wb-work-skeleton aria-busy> + 3 × span.wb-skel.wb-skel-row
// server → danger/alert; offline, forbidden → warning/alert; signed-out → info/status; chưa có workspace → info/status;
// rỗng → MODULE_TONES[module]; Tổng quan yên → 'gray' + icon desk.
// WorkErrorState, WorkNoWorkspace, WorkStaleNote, WorkToast, WorkPaneProps, workLoadState: giữ tên và chữ ký.

// work-home.ts
export function greetingName(displayName: string): string // Task 2: port nguyên uniwork packages/core/home/greeting.ts
export type TabCount = { n: number; key: StringKey; tone: 'danger' | 'muted' } // Task 4
export function tabCounts(s: WorkHomeSummary | null): Partial<Record<'tasks' | 'calendar', TabCount>> // Task 4
export type MyWorkGroup = 'overdue' | 'today' | 'upcoming' // Task 5
export function myWorkGroups(tasks: readonly WorkTask[], today: string): { key: MyWorkGroup; tasks: WorkTask[] }[] // Task 5

// WorkbenchIcons.tsx (Task 5)
type IconId = PracticePillarId | WorkbenchModuleId | 'add' | 'inbox'
export function WorkbenchIcon(p: { id: IconId; size?: number; tint?: Tint }): ReactElement // tint ghi đè MODULE_TONES[id]

// Prop mới chỉ phục vụ trình bày
WorkbenchTabs:  counts?: ReturnType<typeof tabCounts>                         // Task 4
WorkOverview:   onSummary?: (summary: WorkHomeSummary | null) => void          // Task 4, gọi qua ref trong useEffect([home.value])
WorkTasksPane:  head?: Omit<WorkPaneHeaderProps, 'aside'>                       // Task 6, aside = "Đang mở: n" khi list đã tải
```

Nối dây: `PracticeHome` truyền `counts={tabCounts(workspace ? cachedWork<WorkHomeSummary>(\`home:${workspace.id}\`)?.value ?? null : null)}`mỗi lần render và giữ`const [, setHomeSummary] = useState<WorkHomeSummary | null>(null)`chỉ để vẽ lại khi`WorkOverview`báo summary.`WorkbenchModulePane`render`<section className="wb-pane" aria-label={title}>`+`WorkPaneHeader`(meta = hint + " · " + contextTitle; aside =`<LocalTag/>`cho forms/notes); riêng Tasks thì`WorkTasksPane`tự vẽ header. Bốn trụ cột dùng`WorkPaneHeader`với`module = pillar.id`, aside `<LocalTag/>`.

Checkbox tự vẽ (Task 1 định nghĩa, Task 5 và 6 dùng):

```tsx
<label className="wb-check">
  <input type="checkbox" className="uw-sr-only" checked={…} onChange={…} aria-label={…} />
  <span className="wb-check-box" aria-hidden="true">{/* svg glyph, stroke="currentColor" */}</span>
</label>
```

### Khóa i18n mới

| Khóa                 | Task | zh                            | en                       | vi                            |
| -------------------- | ---- | ----------------------------- | ------------------------ | ----------------------------- |
| `wbTabCountOverdue`  | 4    | (giá trị trong zh.ts)         | Overdue tasks: {count}   | Việc quá hạn: {count}         |
| `wbTabCountDueToday` | 4    | (giá trị trong zh.ts)         | Tasks due today: {count} | Việc đến hạn hôm nay: {count} |
| `wbTabCountMeetings` | 4    | (giá trị trong zh.ts)         | Meetings today: {count}  | Cuộc họp hôm nay: {count}     |
| `wbOvGroupUpcoming`  | 5    | (giá trị trong zh.ts)         | Upcoming                 | Sắp tới                       |
| `wbOvMinutes`        | 5    | {count} (giá trị trong zh.ts) | {count} min              | {count} phút                  |
| `wbTasksOpenCount`   | 6    | (giá trị trong zh.ts)         | Open: {count}            | Đang mở: {count}              |

Dùng lại: `wbTasksGroupOverdue`, `wbTasksGroupToday`, `wbCommonOpen` + " ↗", `wbKnSearch` (aria-label), `wbKnSearchPlaceholder`, các chuỗi `wb*Empty` và `wbOv*Title/Body`.

### Test sẽ vỡ hoặc phải sửa

| Test                                                                                                                                                               | Task | Thay đổi                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------- |
| `workbench-topbar.test.ts:110` `button('Refresh')` theo chữ                                                                                                        | 3    | Viết lại: chọn `button[aria-label="Refresh"]`. Giữ h1 'Workbench', `select[aria-label=…]`, chữ `+ New`. |
| `workbench-tabs-focus.test.ts:43-54` mục `.wb-topbar-picker select`                                                                                                | 3    | Thay bằng assertion `.wb-crumb:has(select:focus-visible)`.                                              |
| `work-overview.test.ts:286` `.wb-ov-stats` toBeNull                                                                                                                | 5    | Đổi sang `.wb-ov-strip` (nếu không sẽ luôn qua một cách vô nghĩa).                                      |
| e2e `workbench-overview.spec.ts:75,88` cần 5 `.wb-ov-stat` và `.wb-ov-recent`                                                                                      | 5    | Không sửa; giữ tên lớp. Chạy lại ở Task 10.                                                             |
| `work-tasks-pane.test.ts` (`.wb-work-row input`, `.is-done`, `.wb-work-quick input`, `form`, `.wb-work-skeleton` null, `.wb-toast`, chữ 'Today', `[role="alert"]`) | 2, 6 | Giữ đủ các lớp; thêm test mới.                                                                          |
| `work-calendar-pane.test.ts` (`.wb-agenda-icon[aria-label]`, nút `.wb-agenda-row`, 'All day', 'Today')                                                             | 7    | Giữ; thêm test.                                                                                         |
| `work-profile-pane.test.ts` (không có input/textarea, chữ đúng 'Edit on the web', 'Couldn’t load' + Retry)                                                         | 7    | Giữ; thêm test.                                                                                         |
| `workbench-forms-notice.test.ts` (chữ 'Upload template file…', câu báo)                                                                                            | 8    | Giữ chữ; câu báo nằm trong `p.wb-hint`.                                                                 |
| `strings-workbench.test.ts`, `workbench-copy.test.ts`, `module-tones.test.ts`, `workbench-icons.test.ts`                                                           | 1–8  | Phải luôn xanh.                                                                                         |

Spec §7 nêu tên test không tồn tại: không có test Ghi chú (Task 8 tạo `workbench-local-panes.test.ts`), test Biểu mẫu duy nhất là `workbench-forms-notice.test.ts`, `workbench-tabs*` chỉ có `workbench-tabs-focus.test.ts` (Task 4 tạo `workbench-tabs.test.ts`).

### Sửa so với spec (đã chốt trong contract)

1. Giá trị token của §2.1 không đạt: `#c4c8ce`/`#5b6068` chỉ 1.68/2.63:1, `#22252a` gần như không thấy (1.08:1). Dùng `#858b94`/`#72777f` và `#26282c`.
2. `greetingName` không có tham số `lang`: port nguyên bản upstream (họ Việt ở đầu → lấy từ cuối, ngược lại lấy từ đầu).
3. Số đếm tab cần `onSummary` để vẽ lại; ẩn số khi `summary.partial` chứa nguồn của nó; ẩn số Công việc khi `overdue` là `null`.
4. `--text-tertiary` và `--danger` trần không đạt AA cho chữ 11.5–13px: dùng `--text-secondary` và `--danger-text`. Chip "Vào họp" dùng `.wb-btn-primary.wb-btn-sm` (chữ `--accent` trên `--accent-soft` chỉ 4.28:1 ở dark).
5. Việc đã tick ở Tổng quan giữ nguyên nhóm: nhóm theo `dueState({ ...task, status: 'todo' }, today)`; `later` và `none` vào "Sắp tới".
6. Không có token font mono: `.wb-mono` dùng stack của `settings.css:298`.
7. `.wb-row-act` của spec chính là `.wb-row-actions` / `WbRowActions` có sẵn.
8. Biểu mẫu có 4 thao tác dòng (Sửa, Mở tệp, Soạn, Xóa); giữ Sửa.
9. Skeleton dùng `var(--bg-hover-strong)` → `var(--bg-hover-subtle)` thay cho `--surface-subtle` → `--hover` (hai màu sau gần như không thấy trên nền light `#fafafa`).
10. Câu "Chọn gói ở Tri thức trước khi soạn" đặt ngay trước nhóm thao tác dòng, không nằm trong `.wb-row-actions`, để nó luôn hiện khi nút Soạn bị khóa.
11. Số đếm trên tab (spec §3.2) không mang `aria-label` trên `<span>`: số là `<span class="wb-tab-count wb-num" aria-hidden="true">` và câu đầy đủ (`wbTabCount*`) nằm trong `<span class="uw-sr-only">` kế bên, vì `aria-label` trên một `<span>` không có role không được trình đọc màn hình đọc ổn định.
12. Lề ngang 24px của §2.4 thay `padding-inline: 36px` của `.content` (cùng phần tử `main.content.wb-home`; `.wb-home` đứng sau trong file nên thắng), không cộng thêm vào nó.

### Bảng phủ spec

| Spec                                                   | Task / Step                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| §2.1 token                                             | 1 (Step 3; giá trị theo sửa đổi 1)                                                                                  |
| §2.2 nút                                               | 1 (Step 4a); áp ở 3, 5, 6, 7, 8; khóa pill/bóng ở 8 (`workbench-surfaces`)                                          |
| §2.3 chữ, `.wb-num`, `.wb-mono`                        | 1 (Step 4a); lời chào, ngày, số dải ở 5; tiêu đề tab ở 2                                                            |
| §2.4 khối, dòng, `.wb-row-actions`, cột 1180/24/18     | 1 (Step 4a, 4b)                                                                                                     |
| §3.1 breadcrumb, chip select, Refresh, + Tạo mới, menu | 3                                                                                                                   |
| §3.2 số đếm, unpin/grip, vạch dưới                     | 4                                                                                                                   |
| §4.1 Tổng quan                                         | 2 (`greetingName`), 4 (`onSummary`), 5                                                                              |
| §4.2 `WorkPaneHeader`, bỏ card lồng                    | 2 (component), 6 (module), 8 (trụ cột)                                                                              |
| §4.3 Công việc                                         | 6                                                                                                                   |
| §4.4 Lịch, §4.5 Hồ sơ                                  | 7                                                                                                                   |
| §4.6 Biểu mẫu, §4.7 Ghi chú, §4.8 Tri thức             | 8 (form Ghi chú tạm chuyển lớp ở 6)                                                                                 |
| §5 `WorkStatePanel`, skeleton, bỏ viền đứt             | 2 (panel, lỗi, rỗng Công việc/Lịch/Ghi chú), 5 (yên, skeleton Tổng quan), 8 (rỗng Biểu mẫu/Thư viện, test viền đứt) |
| §6 chế độ tối, AA                                      | 1 (test viền checkbox), 9                                                                                           |
| §7 test, kiểm tra tự động, ảnh chụp                    | mọi task (Step kiểm tra); 10 (ảnh)                                                                                  |

---

### Task 1: Token nền tảng và các primitive CSS

**Files:**

- Modify: `packages/ui/src/tokens.css`
- Modify: `apps/shell/src/renderer/src/home.css`
- Create (test): `apps/shell/tests/workbench-foundation.test.ts`

**Interfaces:**

- Consumes: token có sẵn `--accent`, `--accent-hover`, `--on-accent`, `--surface`, `--border`, `--border-subtle`, `--hover`, `--text`, `--text-secondary`, `--danger-text`, `--bg-hover-strong`, `--bg-hover-subtle`, `--radius-6/8/12`; lớp `.uw-sr-only` (home.css:4949).
- Produces:
  - Token: `--wb-shadow`, `--wb-row-hover`, `--wb-check-border`.
  - Bố cục: `.wb-home` (gap 18, `padding-inline: 24px`), `.wb-home > :not(.modal-overlay)` (`max-width: 1180px`).
  - Nút: `.wb-btn`, `.wb-btn-primary`, `.wb-btn-secondary`, `.wb-btn-ghost`, `.wb-btn-icon`, `.wb-btn-sm`.
  - Chữ: `.wb-num`, `.wb-mono`.
  - Danh sách: `.wb-block`, `.wb-row`, `.wb-group-head`, `.wb-group-head.is-overdue`.
  - Checkbox: `.wb-check`, `.wb-check-box` (markup ở Interface Contract).
  - Skeleton: `.wb-skel`, `.wb-skel-strip`, `.wb-skel-row`, `@keyframes wb-skel-shimmer`.
  - `.wb-row-actions` ẩn cho tới khi dòng được hover hoặc có focus.
  - Không tạo `.wb-row-title`: mỗi màn đã có lớp tiêu đề riêng có ellipsis (`.wb-ov-row-title`, `.wb-work-title`), nên một lớp chung sẽ không ai dùng và bị Task 9 bắt.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/shell/tests/workbench-foundation.test.ts`:

```ts
// Workbench redesign foundation (spec 2): three tokens in every tokens.css theme block, and
// the shared .wb-* primitives in home.css, painted from tokens only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'), 'utf8')
const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
)
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

const hexIn = (block: string, name: string) =>
  new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1]
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
/** the body of the rule whose selector line is exactly `selector` */
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {\n`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start + 1))
}

describe('workbench tokens', () => {
  it('defines --wb-shadow, --wb-row-hover and --wb-check-border in all three theme blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      expect(block).toMatch(/\n\s*--wb-shadow: [^;]+;/)
      expect(hexIn(block, '--wb-row-hover')).toBeDefined()
      expect(hexIn(block, '--wb-check-border')).toBeDefined()
    }
    // dark blocks separate by their border, not a shadow
    expect(blocks[1]).toMatch(/\n {2}--wb-shadow: none;/)
    expect(blocks[2]).toMatch(/\n {4}--wb-shadow: none;/)
  })

  it.each([
    ['light', 0],
    ['dark', 1],
    ['system-dark', 2],
  ] as const)(
    '%s: the checkbox outline reaches 3:1 on the surface and on a hovered row, and the hover shows',
    (_name, i) => {
      const block = blocks[i]!
      const surface = hexIn(block, '--surface')!
      const hover = hexIn(block, '--wb-row-hover')!
      const border = hexIn(block, '--wb-check-border')!
      expect(contrast(border, surface)).toBeGreaterThanOrEqual(3)
      expect(contrast(border, hover)).toBeGreaterThanOrEqual(3)
      expect(contrast(hover, surface)).toBeGreaterThanOrEqual(1.05)
    },
  )
})

describe('workbench primitives (home.css)', () => {
  it('the Workbench column: 24px side gutters, 18px between sections, capped at 1180px', () => {
    expect(rule('.wb-home')).toMatch(/gap: 18px;/)
    expect(rule('.wb-home')).toMatch(/padding-inline: 24px;/)
    // the fixed skill-confirm overlay must keep the full window
    expect(rule('.wb-home > :not(.modal-overlay)')).toMatch(/max-width: 1180px;/)
  })

  it('the primary button is the app accent, not the shared black --color-btn-primary', () => {
    expect(rule('.wb-btn-primary')).toMatch(
      /background: var\(--accent\);\n {2}color: var\(--on-accent\);/,
    )
    expect(rule('.wb-btn-primary:hover:not(:disabled)')).toMatch(
      /background: var\(--accent-hover\);/,
    )
  })

  it('buttons are 32px (28px small), radius 8, flat, press to 0.98, accent focus ring', () => {
    const btn = rule('.wb-btn')
    expect(btn).toMatch(/height: 32px;/)
    expect(btn).toMatch(/border-radius: var\(--radius-8\);/)
    expect(btn).not.toMatch(/box-shadow/)
    expect(rule('.wb-btn-sm')).toMatch(/height: 28px;/)
    expect(rule('.wb-btn:active:not(:disabled)')).toMatch(/transform: scale\(0\.98\);/)
    expect(css).toMatch(
      /\n\.wb-btn:focus-visible \{\n {2}outline: 2px solid var\(--accent\);\n {2}outline-offset: 2px;/,
    )
    expect(rule('.wb-btn:disabled')).toMatch(/opacity: 0\.5;\n {2}cursor: not-allowed;/)
  })

  it('reduced motion stops the button transition, the press scale and the shimmer', () => {
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) {\n  .wb-btn {\n    transition: none;\n  }\n\n' +
        '  .wb-btn:active:not(:disabled) {\n    transform: none;\n  }\n\n' +
        '  .wb-skel {\n    animation: none;\n  }\n}',
    )
    expect(rule('.wb-skel')).toMatch(/animation: wb-skel-shimmer 1\.2s/)
    // the UniWork open picker keeps its own pulse
    expect(rule('.uw-skel')).toMatch(/animation: uw-skel-pulse/)
  })

  it('numbers, mono ids, blocks and rows read from tokens', () => {
    expect(rule('.wb-num')).toMatch(/font-variant-numeric: tabular-nums;/)
    expect(rule('.wb-mono')).toMatch(/color: var\(--text-secondary\);/)
    expect(rule('.wb-block')).toMatch(/box-shadow: var\(--wb-shadow\);/)
    expect(rule('.wb-row:hover')).toMatch(/background: var\(--wb-row-hover\);/)
    expect(rule('.wb-row + .wb-row')).toMatch(/border-top: 1px solid var\(--border-subtle\);/)
    expect(rule('.wb-group-head.is-overdue')).toMatch(/color: var\(--danger-text\);/)
  })

  it('row actions hide until the row is hovered or holds focus (always shown on touch)', () => {
    expect(rule('.wb-row-actions')).toMatch(/opacity: 0;/)
    expect(css).toContain(
      '\n.wb-row:hover .wb-row-actions,\n.wb-row:focus-within .wb-row-actions,\n',
    )
    expect(css).toContain('@media (hover: none) {\n  .wb-row-actions {\n    opacity: 1;\n  }\n}')
  })

  it('the drawn checkbox keeps a focus ring and fills with the accent when ticked', () => {
    expect(rule('.wb-check')).toMatch(/position: relative;/)
    expect(rule('.wb-check-box')).toMatch(/border: 1\.5px solid var\(--wb-check-border\);/)
    expect(rule('.wb-check input:checked + .wb-check-box')).toMatch(/background: var\(--accent\);/)
    expect(rule('.wb-check input:focus-visible + .wb-check-box')).toMatch(
      /outline: 2px solid var\(--accent\);/,
    )
  })

  it('the unused pill sub-tabs are gone', () => {
    expect(css).not.toMatch(/\.wb-subtab/)
  })
})
```

- [ ] **Step 2: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/workbench-foundation.test.ts`
Expected: FAIL. Test token báo `--wb-row-hover` chưa có; test bố cục báo `gap: 18px` không khớp; các test primitive báo `.wb-btn-primary: expected -1 to be greater than or equal to 0`; test sub-tab thất bại vì `.wb-subtab` vẫn còn.

- [ ] **Step 3: Thêm token vào cả 3 khối của `packages/ui/src/tokens.css`**

Trong `:root`, thay:

```css
--text-caption: 12px;

color-scheme: light;
```

bằng:

```css
--text-caption: 12px;

/* Workbench redesign: list blocks, row hover, the drawn checkbox outline (3:1 on both) */
--wb-shadow: 0 1px 2px rgb(16 24 40 / 5%), 0 1px 3px rgb(16 24 40 / 4%);
--wb-row-hover: #f7f8fa;
--wb-check-border: #858b94;

color-scheme: light;
```

Trong `[data-theme='dark']` (thụt 2 dấu cách), thay:

```css
  --color-dialog-primary-text: #0d1220;

  color-scheme: dark;
}
```

bằng:

```css
  --color-dialog-primary-text: #0d1220;

  /* Workbench redesign: no shadow in dark, blocks separate by their border */
  --wb-shadow: none;
  --wb-row-hover: #26282c;
  --wb-check-border: #72777f;

  color-scheme: dark;
}
```

Trong `@media (prefers-color-scheme: dark)` (thụt 4 dấu cách), thay:

```css
    --color-dialog-primary-text: #0d1220;

    color-scheme: dark;
  }
```

bằng:

```css
    --color-dialog-primary-text: #0d1220;

    /* Workbench redesign: no shadow in dark, blocks separate by their border */
    --wb-shadow: none;
    --wb-row-hover: #26282c;
    --wb-check-border: #72777f;

    color-scheme: dark;
  }
```

- [ ] **Step 4: Thêm primitive vào `apps/shell/src/renderer/src/home.css`**

**4a.** Thay rule `.wb-home { … }` (home.css:3341-3346):

```css
.wb-home {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 32px;
}
```

bằng khối dưới đây (giữ một dòng trống trước `.wb-topbar {`):

```css
.wb-home {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-inline: 24px;
  padding-bottom: 32px;
}

/* the content column (redesign spec 2.4): left-aligned and capped; the fixed modal overlay is not */
.wb-home > :not(.modal-overlay) {
  max-width: 1180px;
}

/* Workbench foundation (redesign spec 2): brand buttons, tabular numbers, list blocks and
 * rows, the drawn checkbox and the shimmer skeleton. Colors come from tokens only. */

.wb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-8);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.wb-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.wb-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.wb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wb-btn-primary {
  background: var(--accent);
  color: var(--on-accent);
}

.wb-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.wb-btn-secondary {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}

.wb-btn-secondary:hover:not(:disabled) {
  background: var(--hover);
}

.wb-btn-ghost {
  color: var(--text-secondary);
}

.wb-btn-ghost:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.wb-btn-icon {
  width: 32px;
  padding: 0;
}

.wb-btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12.5px;
}

.wb-num {
  font-variant-numeric: tabular-nums;
}

/* the app has no mono token: same stack as settings.css */
.wb-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.wb-block {
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--surface);
  box-shadow: var(--wb-shadow);
  overflow: hidden;
}

.wb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--text);
  transition: background-color 150ms ease;
}

.wb-row:hover {
  background: var(--wb-row-hover);
}

.wb-row + .wb-row {
  border-top: 1px solid var(--border-subtle);
}

.wb-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 10px 12px 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.wb-group-head.is-overdue {
  color: var(--danger-text);
}

/* the native input stays (as .uw-sr-only) for keyboard and screen readers; the box is drawn */
.wb-check {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  cursor: pointer;
}

.wb-check-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--wb-check-border);
  border-radius: 4px;
  background: var(--surface);
  color: transparent;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.wb-check input:checked + .wb-check-box {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.wb-check input:focus-visible + .wb-check-box {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.wb-check input:disabled + .wb-check-box {
  opacity: 0.5;
  cursor: not-allowed;
}

/* --bg-hover-strong is the .uw-skel fill: --surface-subtle vanishes on the light page */
.wb-skel {
  display: block;
  border-radius: var(--radius-6);
  background: linear-gradient(
      90deg,
      var(--bg-hover-strong) 0%,
      var(--bg-hover-subtle) 50%,
      var(--bg-hover-strong) 100%
    )
    0 0 / 200% 100%;
  animation: wb-skel-shimmer 1.2s linear infinite;
}

.wb-skel-strip {
  height: 76px;
  border-radius: var(--radius-12);
}

.wb-skel-row {
  height: 36px;
}

@keyframes wb-skel-shimmer {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wb-btn {
    transition: none;
  }

  .wb-btn:active:not(:disabled) {
    transform: none;
  }

  .wb-skel {
    animation: none;
  }
}
```

**4b.** Trong `.wb-row-actions` (home.css:3906-3915), đổi `opacity: 0.7;` thành `opacity: 0;`. Rồi thay dòng đầu của danh sách selector hiện ra (3917):

```css
.wb-module-row: hover .wb-row-actions;
```

bằng:

```css
.wb-row:hover .wb-row-actions,
.wb-row:focus-within .wb-row-actions,
.wb-module-row:hover .wb-row-actions,
```

Giữ nguyên phần còn lại của danh sách, thân `opacity: 1` và rule `@media (hover: none)`.

**4c.** Xóa trọn 4 rule `.wb-subtabs`, `.wb-subtab`, `.wb-subtab:hover`, `.wb-subtab.active` (home.css:3975-4007, giữa `.wb-icon-btn.is-accent:hover:not(:disabled) { … }` và `/* Prefer .wb-module-meta; … */`). Không TSX nào dùng chúng.

- [ ] **Step 5: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/workbench-foundation.test.ts tests/module-tones.test.ts`
Expected: PASS. 12 test trong workbench-foundation và 3 trong module-tones (vẫn tìm thấy đúng 3 khối).

- [ ] **Step 6: Kiểm tra**

Từ gốc repo:

```bash
cd apps/shell && npx vitest run && cd ../..
cd packages/ui && npx vitest run tests/tint-tokens.test.ts tests/ai-send-off-token.test.ts && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write packages/ui/src/tokens.css apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-foundation.test.ts
npx prettier --check packages/ui/src/tokens.css apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-foundation.test.ts
```

Expected:

- Toàn bộ test shell qua; các suite đọc home.css (`workbench-tabs-focus`, `shell-accent`, `account-ui`, `uniwork-docs-ui-components`) không bị ảnh hưởng.
- Test token của packages/ui qua (thêm tiền tố `NODE_OPTIONS=--no-experimental-webstorage` nếu jsdom báo lỗi `localStorage`).
- typecheck thoát 0; theme check không báo vi phạm (giá trị thô chỉ nằm trên dòng `--x:` trong tokens.css); english-comments OK; prettier không đổi gì.
- Mở Bàn làm việc bằng mắt không bắt buộc ở task này: chưa màn nào dùng primitive mới, chỉ lề và khoảng cách đổi.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/tokens.css apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-foundation.test.ts
git commit -m "feat(shell): Workbench foundation tokens and .wb-* primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: WorkPaneHeader, WorkStatePanel và greetingName

**Files:**

- Create: `apps/shell/src/renderer/src/WorkPaneHeader.tsx`
- Modify:
  - `apps/shell/src/renderer/src/WorkErrorState.tsx` (thay cả file)
  - `apps/shell/src/renderer/src/module-tones.ts`
  - `apps/shell/src/renderer/src/work-home.ts`
  - `apps/shell/src/renderer/src/PracticeHome.tsx` (dòng 597 và import)
  - `apps/shell/src/renderer/src/WorkTasksPane.tsx` (dòng 142 và import)
  - `apps/shell/src/renderer/src/WorkCalendarPane.tsx` (dòng 106 và import)
  - `apps/shell/src/renderer/src/NotesPane.tsx` (dòng 62 và import)
  - `apps/shell/src/renderer/src/home.css`
- Create (test): `apps/shell/tests/work-pane-header.test.ts`, `apps/shell/tests/work-state-panel.test.ts`
- Modify (test): `apps/shell/tests/module-tones.test.ts`, `apps/shell/tests/work-home.test.ts`, `apps/shell/tests/work-tasks-pane.test.ts`, `apps/shell/tests/workbench-foundation.test.ts`

**Interfaces:**

- Consumes: từ Task 1 `.wb-btn*`, `.wb-skel`, `.wb-skel-row`; có sẵn `WorkbenchIcon({ id, size })`, `MODULE_TONES`, `tintStyle`, `Tint`, các khóa `wbOvSignedOut*`, `wbOvForbidden*`, `wbOvOffline*`, `wbOvLoadFailed`, `wbOvNoWorkspace*`, `acctSignInUniwork`, `acctRetry`, `wbTasksEmpty`, `wbCalEmpty`, `wbNotesEmpty`.
- Produces:
  - `module-tones.ts`: `SignalTone`, `signalStyle(s)`.
  - `WorkPaneHeader.tsx`: `WorkPaneHeaderProps`, `WorkPaneHeader(p)`.
  - `WorkErrorState.tsx`: `WorkStatePanel(...)`, `WorkSkeleton()`; `WorkErrorState`, `WorkNoWorkspace`, `WorkStaleNote`, `WorkToast`, `WorkPaneProps`, `workLoadState` giữ tên và chữ ký.
  - `work-home.ts`: `greetingName(displayName: string): string` (Task 5 nối vào lời chào, Task 7 dùng cho ô chữ cái).
  - CSS: `.wb-state*`, `.wb-pane`, `.wb-pane-head`, `.wb-pane-text`, `.wb-pane-title`, `.wb-pane-meta`, `.wb-pane-aside`. Xóa `.wb-work-state*`.
- Mẫu trạng thái rỗng cho các task sau: `<WorkStatePanel tone={MODULE_TONES.x} icon={<WorkbenchIcon id="x" size={20} />} title={t('…Empty')} />`. Ô 20px bên trong có cùng tint với ô 36px nên chỉ thấy glyph.
- Ba trạng thái rỗng còn dùng `.wb-work-state` (Công việc, Lịch, Ghi chú) được chuyển ngay trong task này để không mất style; Task 6, 7, 8 bắt đầu từ markup đó. `PracticeHome.tsx:597` chuyển sang `<WorkSkeleton />` tại đây; Task 8 không làm lại dòng này.

- [ ] **Step 1: Viết test thất bại cho `signalStyle`**

Trong `apps/shell/tests/module-tones.test.ts`, đổi import thành:

```ts
import {
  MEETING_TINT,
  MODULE_TONES,
  signalStyle,
  tintStyle,
} from '../src/renderer/src/module-tones'
```

và thêm test này vào trong `describe('module tones', …)`, sau test `tintStyle`:

```ts
it('signalStyle paints a status tile from the signal tokens (info has no -text twin)', () => {
  expect(signalStyle('danger')).toEqual({
    background: 'var(--danger-bg)',
    color: 'var(--danger-text)',
  })
  expect(signalStyle('warning')).toEqual({
    background: 'var(--warning-bg)',
    color: 'var(--warning-text)',
  })
  expect(signalStyle('info')).toEqual({ background: 'var(--info-bg)', color: 'var(--info)' })
})
```

- [ ] **Step 2: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/module-tones.test.ts`
Expected: FAIL với `signalStyle is not a function`.

- [ ] **Step 3: Viết `signalStyle`**

Nối vào cuối `apps/shell/src/renderer/src/module-tones.ts`:

```ts
/** status hues for error / offline / sign-in tiles; the glyph is the AA text token of each pair */
export type SignalTone = 'danger' | 'warning' | 'info'

export const signalStyle = (s: SignalTone) => ({
  background: `var(--${s}-bg)`,
  color: s === 'info' ? 'var(--info)' : `var(--${s}-text)`,
})
```

Run: `cd apps/shell && npx vitest run tests/module-tones.test.ts`. Expected: PASS (4 test).

- [ ] **Step 4: Viết test thất bại cho `greetingName`**

Trong `apps/shell/tests/work-home.test.ts`, thêm `greetingName,` vào danh sách import ngay sau `greetingKey,`. Thêm khối này sau `describe('greetingKey', …)`:

```ts
describe('greetingName', () => {
  it.each([
    ['Phan Đức Quang', 'Quang'],
    ['Nguyễn Văn An', 'An'],
    ['Nguyen Van An', 'An'],
    ['  Trần   Thị Bích  ', 'Bích'],
    ['Đỗ Minh', 'Minh'],
    ['Ada Lovelace', 'Ada'],
    ['Lan Nguyen', 'Lan'],
    ['Linh', 'Linh'],
    ['  Linh ', 'Linh'],
    ['', ''],
  ])('splits Vietnamese and Western names correctly: %j -> %j', (full, short) => {
    expect(greetingName(full)).toBe(short)
  })
})
```

- [ ] **Step 5: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts`
Expected: FAIL với `greetingName is not a function`.

- [ ] **Step 6: Viết `greetingName`**

Đây là bản port của `uniwork:packages/core/home/greeting.ts`, cùng 41 họ. Chèn vào `apps/shell/src/renderer/src/work-home.ts` ngay sau `greetingKey` (kết thúc ở dòng 97):

```ts
/**
 * Common Vietnamese family names without diacritics (port of uniwork
 * packages/core/home/greeting.ts). A name that starts with one is written family-first, so a
 * person is called by the last word ("Phan Đức Quang" -> "Quang"); any other name is
 * given-first ("Ada Lovelace" -> "Ada").
 */
const VI_FAMILY_NAMES = new Set(
  (
    'nguyen tran le pham hoang huynh phan vu vo dang bui do ho ngo duong ly dinh doan trinh ' +
    'truong lam mai cao ta ha luu luong to chau quach tong thai kieu trieu khuc la van vuong ' +
    'lai ton tang'
  ).split(' '),
)

const plainWord = (word: string) =>
  word.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/** The name the greeting calls a person by; the whole (trimmed) name when it is one word. */
export function greetingName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return displayName.trim()
  return VI_FAMILY_NAMES.has(plainWord(words[0]!)) ? words[words.length - 1]! : words[0]!
}
```

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts`. Expected: PASS. Hàm chưa được nối vào UI (Task 5 làm).

- [ ] **Step 7: Viết test thất bại cho `WorkPaneHeader`**

Tạo `apps/shell/tests/work-pane-header.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { WorkPaneHeader, type WorkPaneHeaderProps } from '../src/renderer/src/WorkPaneHeader'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function render(props: WorkPaneHeaderProps): HTMLElement {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(WorkPaneHeader, props)))
  return host.querySelector<HTMLElement>('header.wb-pane-head')!
}

describe('WorkPaneHeader', () => {
  it('leads with the 20px module tile, then the title, the meta line and the aside', () => {
    const head = render({
      module: 'tasks',
      title: 'Tasks',
      meta: 'Your UniWork tasks',
      aside: 'Open: 3',
    })
    const tile = head.firstElementChild as HTMLElement
    expect(tile.className).toBe('wb-icon-tile')
    expect(tile.style.background).toBe('var(--tint-green)')
    expect(tile.style.width).toBe('20px')
    expect(head.querySelector('h2.wb-pane-title')?.textContent).toBe('Tasks')
    expect(head.querySelector('.wb-pane-text > p.wb-pane-meta')?.textContent).toBe(
      'Your UniWork tasks',
    )
    expect(head.lastElementChild?.className).toBe('wb-pane-aside')
    expect(head.lastElementChild?.textContent).toBe('Open: 3')
  })

  it('a pillar takes its own tint; no meta or aside renders nothing for them', () => {
    const head = render({ module: 'skills', title: 'Skills' })
    expect((head.firstElementChild as HTMLElement).style.background).toBe('var(--tint-blue)')
    expect(head.querySelector('.wb-pane-meta')).toBeNull()
    expect(head.querySelector('.wb-pane-aside')).toBeNull()
    expect(head.children).toHaveLength(2)
  })
})
```

Run: `cd apps/shell && npx vitest run tests/work-pane-header.test.ts`
Expected: FAIL với `Failed to resolve import "../src/renderer/src/WorkPaneHeader"`.

- [ ] **Step 8: Tạo `WorkPaneHeader.tsx`**

Tạo `apps/shell/src/renderer/src/WorkPaneHeader.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
import { WorkbenchIcon } from './WorkbenchIcons'

export interface WorkPaneHeaderProps {
  /** the module or pillar whose tinted tile leads the title */
  module: WorkbenchModuleId | PracticePillarId
  title: string
  /** one caption line under the title (the module hint, the open context) */
  meta?: ReactNode
  /** the right-hand slot: a summary count or the pane's own actions */
  aside?: ReactNode
}

/** The title every Workbench tab shares (redesign spec 4.2): tile, title, meta, no card around it. */
export function WorkPaneHeader({ module, title, meta, aside }: WorkPaneHeaderProps): ReactElement {
  return (
    <header className="wb-pane-head">
      <WorkbenchIcon id={module} size={20} />
      <div className="wb-pane-text">
        <h2 className="wb-pane-title">{title}</h2>
        {meta ? <p className="wb-pane-meta">{meta}</p> : null}
      </div>
      {aside ? <div className="wb-pane-aside">{aside}</div> : null}
    </header>
  )
}
```

Run: `cd apps/shell && npx vitest run tests/work-pane-header.test.ts`. Expected: PASS (2 test).

- [ ] **Step 9: Viết test thất bại cho `WorkStatePanel`, các trạng thái lỗi và skeleton**

Tạo `apps/shell/tests/work-state-panel.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  WorkErrorState,
  WorkNoWorkspace,
  WorkStatePanel,
  workLoadState,
} from '../src/renderer/src/WorkErrorState'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

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

async function render(node: ReactElement): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, node))
  })
}

const panel = () => host.querySelector<HTMLElement>('.wb-state')!
const tile = () => host.querySelector<HTMLElement>('.wb-state-icon')!
const button = () => host.querySelector<HTMLButtonElement>('.wb-state button')

describe('WorkStatePanel', () => {
  it('shows a tinted tile, the title, one line and one primary action', async () => {
    const onClick = vi.fn()
    await render(
      createElement(WorkStatePanel, {
        tone: 'green',
        icon: createElement('svg'),
        title: 'No open tasks.',
        body: 'Add one above.',
        action: { label: 'Add task', onClick },
        role: 'status',
      }),
    )
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--tint-green)')
    expect(tile().getAttribute('aria-hidden')).toBe('true')
    expect(tile().querySelector('svg')).not.toBeNull()
    expect(panel().querySelector('h3.wb-state-title')?.textContent).toBe('No open tasks.')
    expect(panel().querySelector('p.wb-state-body')?.textContent).toBe('Add one above.')
    expect(panel().querySelectorAll('button')).toHaveLength(1)
    expect(button()!.className).toBe('wb-btn wb-btn-primary')
    await act(async () => button()!.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('paints a signal tone from the signal tokens and leaves out what it is not given', async () => {
    await render(
      createElement(WorkStatePanel, { tone: 'danger', icon: null, title: 'Couldn’t load' }),
    )
    expect(tile().style.background).toBe('var(--danger-bg)')
    expect(tile().style.color).toBe('var(--danger-text)')
    expect(panel().hasAttribute('role')).toBe(false)
    expect(host.querySelector('.wb-state-body')).toBeNull()
    expect(button()).toBeNull()
  })

  it('a secondary action gets the secondary button', async () => {
    await render(
      createElement(WorkStatePanel, {
        tone: 'gray',
        icon: null,
        title: 'All clear',
        action: { label: 'Compose', onClick: () => undefined, variant: 'secondary' },
      }),
    )
    expect(button()!.className).toBe('wb-btn wb-btn-secondary')
  })
})

describe('WorkErrorState and WorkNoWorkspace render through the panel', () => {
  it('server: an alert with a danger tile and a Retry that calls back', async () => {
    const onRetry = vi.fn()
    await render(createElement(WorkErrorState, { state: 'server', onRetry }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--danger-bg)')
    expect(panel().textContent).toContain('Couldn’t load')
    expect(button()!.textContent).toBe('Retry')
    await act(async () => button()!.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.wb-work-state')).toBeNull()
  })

  it('offline warns with Retry; lost access warns with no action', async () => {
    await render(createElement(WorkErrorState, { state: 'offline', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--warning-bg)')
    expect(panel().textContent).toContain('Couldn’t reach UniWork')
    expect(button()!.textContent).toBe('Retry')
    await render(createElement(WorkErrorState, { state: 'forbidden', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--warning-bg)')
    expect(panel().textContent).toContain('You no longer have access to this workspace')
    expect(button()).toBeNull()
  })

  it('signed out: a status with an info tile whose button signs in', async () => {
    const accountLogin = vi.fn(async () => true)
    ;(window as unknown as { aiOffice: unknown }).aiOffice = { accountLogin }
    await render(createElement(WorkErrorState, { state: 'signed-out', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--info-bg)')
    expect(button()!.textContent).toBe('Sign in to UniWork')
    await act(async () => button()!.click())
    expect(accountLogin).toHaveBeenCalledTimes(1)
  })

  it('no workspace: a status that opens web onboarding; with an error it shows that error', async () => {
    const openWeb = vi.fn(async () => true)
    ;(window as unknown as { uniworkWork: unknown }).uniworkWork = { openWeb }
    await render(createElement(WorkNoWorkspace, { error: null, onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--info-bg)')
    expect(panel().textContent).toContain('You are not in a workspace yet')
    expect(button()!.textContent).toBe('Set up on the web')
    await act(async () => button()!.click())
    expect(openWeb).toHaveBeenCalledWith({ kind: 'onboarding' })
    await render(createElement(WorkNoWorkspace, { error: 'offline', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
  })
})

describe('workLoadState', () => {
  it('loading: three shimmer rows inside the kept .wb-work-skeleton wrapper', async () => {
    await render(workLoadState({ value: null, error: null, reload: () => undefined })!)
    const skeleton = host.querySelector('.wb-work-skeleton')!
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(skeleton.querySelectorAll('.wb-skel.wb-skel-row')).toHaveLength(3)
  })

  it('with data: nothing in the way', () => {
    expect(workLoadState({ value: [], error: null, reload: () => undefined })).toBeNull()
  })
})
```

Run: `cd apps/shell && npx vitest run tests/work-state-panel.test.ts`
Expected: FAIL. `WorkStatePanel` chưa được export nên `createElement` nhận `undefined` ("Element type is invalid"); test skeleton báo `expected 0 to have length 3`.

- [ ] **Step 10: Viết lại `WorkErrorState.tsx` quanh `WorkStatePanel`**

Thay toàn bộ `apps/shell/src/renderer/src/WorkErrorState.tsx` bằng đoạn dưới. `WorkStaleNote`, `WorkToast`, `WorkPaneProps` và logic `workLoadState` không đổi.

```tsx
import type { ReactElement, ReactNode } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { signalStyle, tintStyle, type SignalTone, type Tint } from './module-tones'
import { clock } from './work-home'

/** Line glyphs for the state tiles, on the 24-unit box WorkbenchIcons uses, in currentColor. */
const GLYPH = {
  alert: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5M12 15.8v.2" />
    </>
  ),
  offline: (
    <>
      <path d="M8 17.5h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.6 9.8 3.9 3.9 0 0 0 8 17.5z" />
      <path d="M5 5l14 14" />
    </>
  ),
  lock: (
    <>
      <rect x="6.5" y="11" width="11" height="8" rx="1.5" />
      <path d="M9 11V8.5a3 3 0 0 1 6 0V11" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="9" r="3" />
      <path d="M6.5 18.5c.9-2.8 2.9-4 5.5-4s4.6 1.2 5.5 4" />
    </>
  ),
  workspace: (
    <>
      <rect x="6" y="5" width="12" height="14" rx="1.5" />
      <path d="M9.5 9h1M13.5 9h1M9.5 12.5h1M13.5 12.5h1M11 19v-3h2v3" />
    </>
  ),
} satisfies Record<string, ReactElement>

function StateGlyph({ id }: { id: keyof typeof GLYPH }): ReactElement {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH[id]}
    </svg>
  )
}

const isSignal = (tone: Tint | SignalTone): tone is SignalTone =>
  tone === 'danger' || tone === 'warning' || tone === 'info'

/** Every Workbench empty / error / sign-in state (redesign spec 5): tile, title, one line, one action. */
export function WorkStatePanel({
  tone,
  icon,
  title,
  body,
  action,
  role,
}: {
  /** a module tint for empty states, a signal for errors */
  tone: Tint | SignalTone
  icon: ReactNode
  title: string
  body?: string
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }
  role?: 'status' | 'alert'
}): ReactElement {
  return (
    <div className="wb-state" role={role}>
      <span
        className="wb-state-icon"
        style={isSignal(tone) ? signalStyle(tone) : tintStyle(tone)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h3 className="wb-state-title">{title}</h3>
      {body ? <p className="wb-state-body">{body}</p> : null}
      {action ? (
        <button
          type="button"
          className={`wb-btn wb-btn-${action.variant ?? 'primary'}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

const COPY: Record<
  UniworkWorkError,
  {
    title: StringKey
    body?: StringKey
    action?: StringKey
    tone: SignalTone
    glyph: keyof typeof GLYPH
  }
> = {
  'signed-out': {
    title: 'wbOvSignedOutTitle',
    body: 'wbOvSignedOutBody',
    action: 'acctSignInUniwork',
    tone: 'info',
    glyph: 'person',
  },
  forbidden: {
    title: 'wbOvForbiddenTitle',
    body: 'wbOvForbiddenBody',
    tone: 'warning',
    glyph: 'lock',
  },
  offline: {
    title: 'wbOvOfflineTitle',
    body: 'wbOvOfflineBody',
    action: 'acctRetry',
    tone: 'warning',
    glyph: 'offline',
  },
  server: { title: 'wbOvLoadFailed', action: 'acctRetry', tone: 'danger', glyph: 'alert' },
}

/** A server tab with nothing to show (spec §7): sign in, lost access, or an error with Retry. */
export function WorkErrorState({
  state,
  onRetry,
}: {
  state: UniworkWorkError
  onRetry: () => void
}): ReactElement {
  const { t } = useI18n()
  const copy = COPY[state]
  const run =
    state === 'signed-out' ? () => void window.aiOffice.accountLogin().catch(() => false) : onRetry
  return (
    <WorkStatePanel
      tone={copy.tone}
      icon={<StateGlyph id={copy.glyph} />}
      title={t(copy.title)}
      body={copy.body ? t(copy.body) : undefined}
      action={copy.action ? { label: t(copy.action), onClick: run } : undefined}
      role={state === 'signed-out' ? 'status' : 'alert'}
    />
  )
}

/** No workspace on screen: why the list failed, else the web onboarding link (a member of none). */
export function WorkNoWorkspace({
  error,
  onRetry,
}: {
  error: UniworkWorkError | null
  onRetry: () => void
}): ReactElement {
  const { t } = useI18n()
  if (error) return <WorkErrorState state={error} onRetry={onRetry} />
  return (
    <WorkStatePanel
      tone="info"
      icon={<StateGlyph id="workspace" />}
      title={t('wbOvNoWorkspaceTitle')}
      action={{
        label: t('wbOvNoWorkspaceAction'),
        onClick: () => void window.uniworkWork.openWeb({ kind: 'onboarding' }).catch(() => false),
      }}
      role="status"
    />
  )
}

/** The loading placeholder of a server tab: three shimmer rows (reduced motion stops them). */
export function WorkSkeleton(): ReactElement {
  return (
    <div className="wb-work-skeleton" aria-busy="true">
      <span className="wb-skel wb-skel-row" />
      <span className="wb-skel wb-skel-row" />
      <span className="wb-skel wb-skel-row" />
    </div>
  )
}

/** A kept answer after a failed reload: when it was loaded, and Retry. */
export function WorkStaleNote({ at, onRetry }: { at: number; onRetry: () => void }): ReactElement {
  const { t, dateLocale } = useI18n()
  return (
    <p className="wb-work-stale" role="status">
      {t('wbOvUpdatedAt', { time: clock(new Date(at).toISOString(), dateLocale) })} ·{' '}
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
    </p>
  )
}

/** A write the server refused: the change was undone; Retry repeats the same request. */
export function WorkToast({
  message,
  onRetry,
  onDismiss,
}: {
  message: StringKey
  onRetry: () => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <div className="wb-toast" role="alert">
      <span>{t(message)}</span>
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
      <button type="button" className="wb-link" onClick={onDismiss}>
        {t('wbOvDismiss')}
      </button>
    </div>
  )
}

/** What PracticeHome hands every server tab (Tasks, Calendar, Profile). */
export interface WorkPaneProps {
  /** the active workspace; null = signed out, in none, or the first list failed (workspaceError says why) */
  workspace: UniworkWorkspaceRef | null
  /** why the last workspace list failed; the last good list and pick stay, so this can come with a workspace */
  workspaceError: UniworkWorkError | null
  /** the top bar's Refresh: re-lists workspaces and reloads every server tab */
  onReload: () => void
}

/** What a server tab shows instead of its data (lost access, sign in, an error, the skeleton); null when it has data. */
export function workLoadState(load: {
  value: unknown
  error: UniworkWorkError | null
  reload: () => void
}): ReactElement | null {
  if (load.error === 'signed-out' || load.error === 'forbidden') {
    return <WorkErrorState state={load.error} onRetry={load.reload} />
  }
  if (load.value !== null) return null
  if (load.error) return <WorkErrorState state={load.error} onRetry={load.reload} />
  return <WorkSkeleton />
}
```

Trước khi thay, so file mới với file cũ: nếu bản cũ có export nào khác ngoài các tên trên, giữ lại nó.

Trong `apps/shell/src/renderer/src/PracticeHome.tsx`:

- Thêm `import { WorkSkeleton } from './WorkErrorState'` ngay trên `import { WorkOverview } from './WorkOverview'` (dòng 36).
- Thay dòng 597 `        <div className="wb-work-skeleton" aria-busy="true" />` bằng `        <WorkSkeleton />`.

Run: `cd apps/shell && npx vitest run tests/work-state-panel.test.ts tests/work-tasks-pane.test.ts tests/work-calendar-pane.test.ts tests/work-profile-pane.test.ts tests/work-overview.test.ts`
Expected: PASS. Các suite này chọn theo `[role="alert"]`, chữ 'Couldn’t reach UniWork' / 'Couldn’t load', `buttonByText('Sign in to UniWork')` và `.wb-work-skeleton` là null trong ca lỗi; tất cả vẫn đúng.

- [ ] **Step 11: Viết test thất bại cho các trạng thái rỗng mất `.wb-work-state`**

Trong `apps/shell/tests/work-tasks-pane.test.ts`, thêm test này làm test cuối trong `describe('Tasks tab', …)`:

```ts
it('an empty list keeps quick add and shows the tasks empty state, tinted like the tab', async () => {
  api.myTasks.mockResolvedValue({ ok: true, value: [] })
  await mount({ ...WS, id: 'w-empty' })
  expect(host.querySelector('.wb-work-quick input')).not.toBeNull()
  const panel = host.querySelector('.wb-state')!
  expect(panel.querySelector('.wb-state-title')?.textContent).toBe('No open tasks.')
  expect(panel.querySelector<HTMLElement>('.wb-state-icon')!.style.background).toBe(
    'var(--tint-green)',
  )
  expect(host.querySelector('.wb-work-state')).toBeNull()
})
```

Run: `cd apps/shell && npx vitest run tests/work-tasks-pane.test.ts`
Expected: FAIL với `Cannot read properties of null (reading 'querySelector')`, vì danh sách rỗng vẫn là `<p class="wb-work-state">`.

- [ ] **Step 12: Chuyển ba trạng thái rỗng**

`apps/shell/src/renderer/src/WorkTasksPane.tsx`:

- Thêm `WorkStatePanel,` vào danh sách import từ `./WorkErrorState`, sau `WorkStaleNote,`.
- Thêm `import { MODULE_TONES } from './module-tones'` sau import `./locale`.
- Thêm `import { WorkbenchIcon } from './WorkbenchIcons'` sau import `./WorkErrorState`.
- Thay dòng 142 `        <p className="wb-work-state">{t('wbTasksEmpty')}</p>` bằng:

```tsx
<WorkStatePanel
  tone={MODULE_TONES.tasks}
  icon={<WorkbenchIcon id="tasks" size={20} />}
  title={t('wbTasksEmpty')}
/>
```

`apps/shell/src/renderer/src/WorkCalendarPane.tsx`:

- Thay dòng 10 (import từ `./WorkErrorState`) bằng đoạn dưới. `MODULE_TONES` đã được import ở dòng 5.

```ts
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WorkbenchIcon } from './WorkbenchIcons'
```

- Thay dòng 106 `        <p className="wb-work-state">{t('wbCalEmpty')}</p>` bằng:

```tsx
<WorkStatePanel
  tone={MODULE_TONES.calendar}
  icon={<WorkbenchIcon id="calendar" size={20} />}
  title={t('wbCalEmpty')}
/>
```

`apps/shell/src/renderer/src/NotesPane.tsx`:

- Sau `import { useI18n } from './locale'` (dòng 4), thêm:

```ts
import { MODULE_TONES } from './module-tones'
import { WorkStatePanel } from './WorkErrorState'
import { WorkbenchIcon } from './WorkbenchIcons'
```

- Thay dòng 62 `        <p className="wb-work-state">{t('wbNotesEmpty')}</p>` bằng:

```tsx
<WorkStatePanel
  tone={MODULE_TONES.notes}
  icon={<WorkbenchIcon id="notes" size={20} />}
  title={t('wbNotesEmpty')}
/>
```

Kiểm: `grep -rn "wb-work-state" apps/shell/src/renderer/src --include='*.tsx'` không in gì.

Run: `cd apps/shell && npx vitest run tests/work-tasks-pane.test.ts tests/work-calendar-pane.test.ts`. Expected: PASS.

- [ ] **Step 13: Viết test CSS thất bại cho panel trạng thái và tiêu đề tab**

Nối vào cuối `apps/shell/tests/workbench-foundation.test.ts`:

```ts
describe('workbench states and pane title (home.css)', () => {
  it('state panels draw no box: the dashed .wb-work-state is gone', () => {
    expect(rule('.wb-state')).not.toMatch(/border/)
    expect(css).not.toMatch(/\.wb-work-state\b/)
    expect(rule('.wb-state-icon')).toMatch(
      /width: 36px;\n {2}height: 36px;\n {2}border-radius: 10px;/,
    )
    expect(rule('.wb-state-title')).toMatch(/font-size: 14px;\n {2}font-weight: 600;/)
    expect(rule('.wb-state-body')).toMatch(/max-width: 52ch;/)
  })

  it('the skeleton wrapper is a column of shimmer rows, no fixed grey block', () => {
    expect(rule('.wb-work-skeleton')).not.toMatch(/height|background/)
  })

  it('the pane title is 16/600 with a one-line meta and a right-hand aside', () => {
    expect(rule('.wb-pane-title')).toMatch(
      /font-size: 16px;\n {2}font-weight: 600;\n {2}letter-spacing: -0\.01em;/,
    )
    expect(rule('.wb-pane-meta')).toMatch(/text-overflow: ellipsis;\n {2}white-space: nowrap;/)
    expect(rule('.wb-pane-text')).toMatch(/min-width: 0;/)
    expect(rule('.wb-pane-aside')).toMatch(/margin-left: auto;/)
  })
})
```

Run: `cd apps/shell && npx vitest run tests/workbench-foundation.test.ts`
Expected: FAIL với `.wb-state: expected -1 to be greater than or equal to 0`.

- [ ] **Step 14: Thay CSS trạng thái viền đứt và thêm tiêu đề tab**

Trong `apps/shell/src/renderer/src/home.css`:

**14a.** Xóa ba rule `.wb-work-state { … }`, `.wb-work-state h3 { … }`, `.wb-work-state p { … }` (home.css:4337-4359, ngay sau `.wb-ov-recent-meta`). Đặt vào chỗ đó:

```css
/* empty / error / sign-in states (WorkStatePanel): no box around them, the tile carries the tone */
.wb-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 24px;
}

.wb-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.wb-state-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.wb-state-body {
  max-width: 52ch;
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  text-wrap: pretty;
}

.wb-state .wb-btn {
  margin-top: 4px;
}

/* the shared tab title (WorkPaneHeader) */
.wb-pane {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.wb-pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.wb-pane-text {
  min-width: 0;
}

.wb-pane-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.wb-pane-meta {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-pane-aside {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
```

**14b.** Thay thân của `.wb-work-skeleton` (home.css:4367-4371):

```css
.wb-work-skeleton {
  height: 120px;
  border-radius: var(--radius-8);
  background: var(--surface-subtle);
}
```

bằng:

```css
.wb-work-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

Run: `cd apps/shell && npx vitest run tests/workbench-foundation.test.ts`. Expected: PASS (15 test).

- [ ] **Step 15: Kiểm tra**

Từ gốc repo:

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkPaneHeader.tsx apps/shell/src/renderer/src/WorkErrorState.tsx apps/shell/src/renderer/src/module-tones.ts apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-pane-header.test.ts apps/shell/tests/work-state-panel.test.ts apps/shell/tests/module-tones.test.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkPaneHeader.tsx apps/shell/src/renderer/src/WorkErrorState.tsx apps/shell/src/renderer/src/module-tones.ts apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-pane-header.test.ts apps/shell/tests/work-state-panel.test.ts apps/shell/tests/module-tones.test.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
```

Expected: toàn bộ test shell qua, kể cả `workbench-copy.test.ts` (PracticeHome không có thêm `label(`); typecheck thoát 0; theme check sạch (glyph SVG dùng `currentColor`, ô dùng `var(--tint-*)` / `var(--*-bg)`); english-comments OK; prettier không đổi gì.

- [ ] **Step 16: Commit**

```bash
git add apps/shell/src/renderer/src/WorkPaneHeader.tsx apps/shell/src/renderer/src/WorkErrorState.tsx apps/shell/src/renderer/src/module-tones.ts apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-pane-header.test.ts apps/shell/tests/work-state-panel.test.ts apps/shell/tests/module-tones.test.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
git commit -m "feat(shell): Workbench pane header, state panel and greeting name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Thanh trên thành breadcrumb với chip chọn

**Files:**

- Modify: `apps/shell/src/renderer/src/WorkbenchTopBar.tsx`
- Modify: `apps/shell/src/renderer/src/home.css` (vùng `.wb-topbar` … `.wb-new-item:focus-visible`, dòng 3348-3449)
- Test: `apps/shell/tests/workbench-topbar.test.ts` (viết lại: Refresh chọn theo `button[aria-label="Refresh"]`, thêm test breadcrumb và bàn phím)
- Test: `apps/shell/tests/workbench-tabs-focus.test.ts` (mục `.wb-topbar-picker select` thay bằng assertion `.wb-crumb:has(select:focus-visible)`)

**Interfaces:**

- Consumes: từ Task 1 `.wb-btn`, `.wb-btn-primary`, `.wb-btn-ghost`, `.wb-btn-icon`, `--wb-row-hover`; có sẵn `--accent`, `--on-accent`, `--surface-subtle`, `--border`, `--hover`, `--text*`, `--radius-8`, khóa `wbTopTitle`, `wbTopWorkspace`, `wbTopRole`, `wbTopRefresh`, `wbTopNew`.
- Produces: `.wb-crumb`, `.wb-crumb-ws`, `.wb-crumb-role`, `.wb-crumb-mark`, `.wb-crumb-name` (ellipsis cho tên dài, không có trong contract gốc), `.wb-crumb-caret` (+`.is-muted`), `.wb-crumb-sep`, rule `.wb-crumb:has(select:focus-visible)`. Prop của `WorkbenchTopBar` không đổi.
- `.wb-crumb-sep` dùng `--text-secondary`, không dùng `--text-tertiary` (Task 9 cấm `--text-tertiary` cho chữ).

- [ ] **Step 1: Viết test thất bại**

Thay toàn bộ `apps/shell/tests/workbench-topbar.test.ts` bằng:

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
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!.value).toBe(
      'w2',
    )
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!.value).toBe(
      'entrepreneur',
    )
  })

  it('breadcrumb: workspace chip with its initial, "/", the title, then the role chip', async () => {
    const p = props()
    await mount(p)
    const ws = host.querySelector('.wb-crumb-ws')!
    expect(ws.querySelector('.wb-crumb-mark')?.textContent).toBe('S')
    expect(ws.querySelector('.wb-crumb-name')?.textContent).toBe('Sales')
    expect(ws.querySelector('.wb-crumb-caret')?.classList.contains('is-muted')).toBe(false)
    expect(ws.querySelector(':scope > select[aria-label="Workspace"]')).not.toBeNull()
    expect(host.querySelector('.wb-crumb-sep')?.textContent).toBe('/')
    const role = host.querySelector('.wb-crumb-role')!
    expect(role.querySelector('.wb-crumb-name')?.textContent).toBe(p.practice.labelEn)
    expect(role.querySelector(':scope > select[aria-label="Role"]')).not.toBeNull()
    // the chips' visible text is decorative: the select carries the name and value
    expect(ws.querySelector('.wb-crumb-name')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keyboard reaches each chip through its select; the chip text is not a second stop', async () => {
    await mount(props())
    const selects = Array.from(host.querySelectorAll<HTMLSelectElement>('.wb-crumb > select'))
    expect(selects).toHaveLength(2)
    for (const s of selects) {
      expect(s.tabIndex).toBe(0)
      expect(s.disabled).toBe(false)
    }
    expect(
      host.querySelectorAll('.wb-crumb button, .wb-crumb a, .wb-crumb [tabindex]'),
    ).toHaveLength(0)
    for (const span of Array.from(host.querySelectorAll('.wb-crumb > span'))) {
      expect(span.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('mutes the workspace caret when there is only one workspace', async () => {
    await mount(props({ workspaces: [WORKSPACES[0]!], workspaceId: 'w1' }))
    expect(host.querySelector('.wb-crumb-ws .wb-crumb-caret')?.classList.contains('is-muted')).toBe(
      true,
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

  it('signed out: no workspace chip and no separator, only the role chip', async () => {
    await mount(props({ workspaces: [], workspaceId: null }))
    expect(host.querySelector('select[aria-label="Workspace"]')).toBeNull()
    expect(host.querySelector('.wb-crumb-ws')).toBeNull()
    expect(host.querySelector('.wb-crumb-sep')).toBeNull()
    expect(host.querySelector('.wb-crumb-role select[aria-label="Role"]')).not.toBeNull()
  })

  it('+ New lists New task and the file types, and runs the chosen one', async () => {
    const p = props()
    await mount(p)
    expect(button('+ New')!.className).toBe('wb-btn wb-btn-primary')
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

  it('Refresh is an icon button named for screen readers and asks the page to reload', async () => {
    const p = props()
    await mount(p)
    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
    expect(refresh.title).toBe('Refresh')
    expect(refresh.className).toBe('wb-btn wb-btn-ghost wb-btn-icon')
    expect(refresh.textContent).toBe('')
    act(() => refresh.click())
    expect(p.onRefresh).toHaveBeenCalledTimes(1)
  })
})
```

Trong `apps/shell/tests/workbench-tabs-focus.test.ts`, thay dòng 43-54 (comment và khối `it.each([...])`) bằng:

```ts
// WCAG 2.4.7: the hover background alone is near-invisible on the light surface
it.each(['.wb-new-item', '.wb-tab-menu-item'])(
  '%s shows an accent outline on keyboard focus',
  (sel) => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(css).toMatch(
      new RegExp(`\\n${escaped}:focus-visible \\{\\n  outline: 2px solid var\\(--accent\\);`),
    )
    expect(css).not.toMatch(new RegExp(`${escaped}:focus-visible \\{[^}]*outline: none`))
  },
)

// the select inside a breadcrumb chip is transparent, so the chip draws its focus ring
it('a breadcrumb chip shows an accent outline while its select has keyboard focus', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
  expect(css).toContain(
    '\n.wb-crumb:has(select:focus-visible) {\n  outline: 2px solid var(--accent);',
  )
  expect(css).toContain('\n.wb-crumb > select {\n  position: absolute;\n  inset: 0;')
  expect(css).not.toContain('.wb-topbar-picker')
})
```

- [ ] **Step 2: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/workbench-topbar.test.ts tests/workbench-tabs-focus.test.ts`
Expected: FAIL. Các test breadcrumb, bàn phím, caret, chưa đăng nhập, + New và Refresh thất bại (chưa có `.wb-crumb-ws`, className còn `btn btn-primary`, chưa có `button[aria-label="Refresh"]`); test CSS mới thất bại vì chưa có rule `.wb-crumb:has(...)`.

- [ ] **Step 3: Viết lại TSX**

Thay toàn bộ `apps/shell/src/renderer/src/WorkbenchTopBar.tsx` bằng:

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
  /** empty while signed out or still loading: the workspace chip is hidden */
  workspaces: readonly UniworkWorkspaceRef[]
  workspaceId: string | null
  onSelectWorkspace: (id: string) => void
  newItems: readonly WorkbenchNewItem[]
  onNewTask: () => void
  onRefresh: () => void
}

/**
 * Workbench breadcrumb (workspace / title, role), Refresh and + New. Each chip
 * lays a transparent native select over itself, so keyboard and screen readers
 * keep the platform picker.
 */
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
  // a select whose value is not listed shows its first option, so the chip does too
  const ws = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0]

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
      {ws ? (
        <>
          <span className="wb-crumb wb-crumb-ws">
            <span className="wb-crumb-mark" aria-hidden="true">
              {Array.from(ws.name.trim())[0]?.toUpperCase()}
            </span>
            <span className="wb-crumb-name" aria-hidden="true">
              {ws.name}
            </span>
            <span
              className={`wb-crumb-caret${workspaces.length === 1 ? ' is-muted' : ''}`}
              aria-hidden="true"
            >
              ▾
            </span>
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
          </span>
          <span className="wb-crumb-sep" aria-hidden="true">
            /
          </span>
        </>
      ) : null}
      <h1 className="wb-topbar-title">{t('wbTopTitle')}</h1>
      <span className="wb-crumb wb-crumb-role">
        <span className="wb-crumb-name" aria-hidden="true">
          {vi ? practice.labelVi : practice.labelEn}
        </span>
        <span className="wb-crumb-caret" aria-hidden="true">
          ▾
        </span>
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
      </span>
      <div className="wb-topbar-actions">
        <button
          type="button"
          className="wb-btn wb-btn-ghost wb-btn-icon"
          aria-label={t('wbTopRefresh')}
          title={t('wbTopRefresh')}
          onClick={onRefresh}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="wb-new-wrap" ref={wrapRef}>
          <button
            type="button"
            className="wb-btn wb-btn-primary"
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

Trước khi thay, đối chiếu file cũ: nếu nó có hành vi nào không có ở trên (ví dụ thêm handler bàn phím trong menu), giữ lại hành vi đó.

- [ ] **Step 4: Cập nhật CSS**

Trong `apps/shell/src/renderer/src/home.css`, xóa các khối rule sau (dòng 3348-3397): `.wb-topbar`, `.wb-topbar-title`, `.wb-topbar-picker`, `.wb-topbar-picker select`, `.wb-topbar-picker select:hover, .wb-topbar-picker select:focus-visible`, `.wb-topbar-picker select:focus-visible`, `.wb-topbar-sep`. Đặt vào chỗ đó, ngay trên khối `.wb-topbar-actions` (không đổi):

```css
.wb-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 40px;
}

.wb-topbar-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.wb-crumb {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-8);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.wb-crumb:hover {
  background: var(--hover);
}

.wb-crumb > select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.wb-crumb:has(select:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.wb-crumb-ws {
  padding-left: 4px;
}

.wb-crumb-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.wb-crumb-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-crumb-role {
  height: 24px;
  border: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-crumb-role:hover {
  background: var(--hover);
  color: var(--text);
}

.wb-crumb-caret {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1;
}

.wb-crumb-caret.is-muted {
  opacity: 0.4;
}

/* decorative: aria-hidden, the selects carry the structure */
.wb-crumb-sep {
  color: var(--text-secondary);
  font-size: 14px;
}
```

Sau đó sửa hai chỗ trong các rule `.wb-new-item`:

- Trong khối `.wb-new-item {`, thay dòng `  padding: 6px 8px;` bằng hai dòng:

```css
min-height: 32px;
padding: 0 8px;
```

- Trong khối `.wb-new-item:hover,\n.wb-new-item:focus-visible {`, thay `  background: var(--hover);` bằng `  background: var(--wb-row-hover);`.

Giữ nguyên khối `.wb-new-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }` (test khớp đúng văn bản này), cùng `.wb-topbar-actions`, `.wb-new-wrap`, `.wb-new-menu` (đã có bo 10 và `--shadow-menu`).

- [ ] **Step 5: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/workbench-topbar.test.ts tests/workbench-tabs-focus.test.ts`
Expected: PASS: 8 test topbar và 4 test tabs-focus.

- [ ] **Step 6: Kiểm tra**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkbenchTopBar.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-topbar.test.ts apps/shell/tests/workbench-tabs-focus.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkbenchTopBar.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-topbar.test.ts apps/shell/tests/workbench-tabs-focus.test.ts
grep -n "wb-topbar-picker\|wb-topbar-sep" apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/*.tsx
```

Expected: suite shell xanh; typecheck thoát 0; theme check không báo màu thô; english-comments qua; prettier "All matched files use Prettier code style!"; lệnh grep cuối không in gì.

- [ ] **Step 7: Commit**

```bash
git add apps/shell/src/renderer/src/WorkbenchTopBar.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-topbar.test.ts apps/shell/tests/workbench-tabs-focus.test.ts
git commit -m "feat(shell): Workbench top bar is a breadcrumb with chip pickers

The workspace and role chips lay a transparent native select over
themselves, so keyboard and screen-reader behaviour stays the platform's.
Refresh becomes an icon button named by aria-label and title; + New uses
the brand primary button; the New menu rows are 32px with the row hover.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Số đếm trên tab, nút bỏ ghim và tay kéo chỉ hiện khi cần, vạch dưới bo tròn

Số đếm luôn mới nhờ: `PracticeHome` tính `tabCounts(cachedWork('home:<workspace.id>'))` mỗi lần render (không gọi API mới); `WorkOverview` báo mỗi summary nó hiển thị qua prop `onSummary`, và `PracticeHome` giữ summary đó trong một `useState` chỉ để kích hoạt render lại. Cách này phủ: lần tải đầu từ cache, lần tải từ server, Refresh (`refreshTick`), cửa sổ lấy lại focus, vòng 60 giây, và tick lạc quan (`update()` ghi cache trước khi set state). Không cần `WB_REFRESH_EVENT`. Đổi workspace thì `PracticeHome` vốn đã render lại.

**Files:**

- Modify: `apps/shell/src/renderer/src/work-home.ts`, `WorkbenchTabs.tsx`, `WorkOverview.tsx`, `PracticeHome.tsx`, `home.css`, `i18n/workbench/zh.ts`, `en.ts`, `vi.ts` (tất cả dưới `apps/shell/src/renderer/src/`)
- Create (test): `apps/shell/tests/workbench-tabs.test.ts`, `apps/shell/tests/workbench-tab-counts.test.ts`
- Test (thêm ca): `apps/shell/tests/work-home.test.ts`, `apps/shell/tests/work-overview.test.ts`

**Interfaces:**

- Consumes: từ Task 1 `.wb-num`; có sẵn `.uw-sr-only`, `cachedWork` (`work-cache.ts`), `WorkHomeSummary`, token `--danger-text`, `--text-secondary`, `--accent`.
- Produces:
  - `export type TabCount = { n: number; key: StringKey; tone: 'danger' | 'muted' }` và `export function tabCounts(s: WorkHomeSummary | null): Partial<Record<'tasks' | 'calendar', TabCount>>` trong `work-home.ts`. Nguồn nằm trong `summary.partial` hoặc `overdue === null` thì không có số Công việc (một số lỗi định dạng không được để số "đến hạn hôm nay" che mất).
  - Prop `WorkbenchTabs.counts?: ReturnType<typeof tabCounts>`; prop `WorkOverview.onSummary?: (summary: WorkHomeSummary | null) => void`.
  - Khóa i18n `wbTabCountOverdue`, `wbTabCountDueToday`, `wbTabCountMeetings` (chỉ 3 khóa này; các khóa khác thuộc Task 5 và 6).
  - CSS `.wb-tab-count` (+`.is-danger`, `.is-muted`), `.wb-tab.active::after`; unpin và grip hiện khi hover, `:focus-within`, `.active`, và luôn hiện trên màn cảm ứng (`@media (hover: none)`).
- Số đếm trên tab render là `<span class="wb-tab-count wb-num is-<tone>" aria-hidden="true">n</span><span class="uw-sr-only">câu đầy đủ</span>` (một `aria-label` trên `<span>` trần không được đọc ổn định).
- Số dòng `WorkbenchTabs.tsx` thật ở `2ed35881`: tab module 176-223, tab trụ cột 226-256.

- [ ] **Step 1: Thêm test thất bại cho `tabCounts`**

Trong `apps/shell/tests/work-home.test.ts`, thêm `tabCounts,` vào danh sách import từ `'../src/renderer/src/work-home'` (sau `overviewView,`). Nối vào cuối file:

```ts
describe('tabCounts (Tasks and Calendar tab counts from the cached summary)', () => {
  it('shows nothing without a summary or when every count is zero', () => {
    expect(tabCounts(null)).toEqual({})
    expect(tabCounts(summary())).toEqual({})
  })

  it('Tasks shows overdue in danger first, else what is due today, muted', () => {
    expect(tabCounts(summary({ counts: { ...ZERO, overdue: 2, due_today: 5 } })).tasks).toEqual({
      n: 2,
      key: 'wbTabCountOverdue',
      tone: 'danger',
    })
    expect(tabCounts(summary({ counts: { ...ZERO, due_today: 5 } })).tasks).toEqual({
      n: 5,
      key: 'wbTabCountDueToday',
      tone: 'muted',
    })
  })

  it('Calendar shows the meetings today', () => {
    expect(tabCounts(summary({ counts: { ...ZERO, meetings_today: 1 } }))).toEqual({
      calendar: { n: 1, key: 'wbTabCountMeetings', tone: 'muted' },
    })
  })

  it('a failed source or a malformed count shows no count, never a guess', () => {
    const counts = { ...ZERO, overdue: 2, meetings_today: 1 }
    expect(tabCounts(summary({ counts, partial: ['tasks'] }))).toEqual({
      calendar: { n: 1, key: 'wbTabCountMeetings', tone: 'muted' },
    })
    expect(tabCounts(summary({ counts, partial: ['meetings'] }))).toEqual({
      tasks: { n: 2, key: 'wbTabCountOverdue', tone: 'danger' },
    })
    expect(tabCounts(summary({ counts: { ...ZERO, overdue: null, due_today: 3 } }))).toEqual({})
  })
})
```

- [ ] **Step 2: Thêm test thất bại cho `onSummary`**

Trong `apps/shell/tests/work-overview.test.ts`, chèn test này vào trong `describe('WorkOverview', …)` ngay sau test `it('full: …')` đầu tiên:

```ts
it('reports each summary it shows to the page, which redraws the tab counts', async () => {
  const onSummary = vi.fn()
  await mount({ onSummary })
  expect(onSummary).toHaveBeenNthCalledWith(1, null)
  expect(onSummary).toHaveBeenLastCalledWith(expect.objectContaining({ counts: summary().counts }))
})
```

- [ ] **Step 3: Tạo test thanh tab thất bại**

Tạo `apps/shell/tests/workbench-tabs.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'

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

import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchTabs } from '../src/renderer/src/WorkbenchTabs'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Props = Parameters<typeof WorkbenchTabs>[0]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(over: Partial<Props> = {}): Promise<void> {
  const props: Props = {
    practiceId: 'sales',
    pillars: requirePractice('sales').pillars,
    active: 'desk',
    onSelect: () => {},
    vi: false,
    ...over,
  }
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkbenchTabs, props)),
    )
  })
}

// pinned module tabs first (core order desk, tasks, calendar), then pinned pillars
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-module'))

describe('Workbench tab counts', () => {
  it('shows each count after the label, with a sentence for screen readers', async () => {
    await mount({
      counts: {
        tasks: { n: 3, key: 'wbTabCountOverdue', tone: 'danger' },
        calendar: { n: 2, key: 'wbTabCountMeetings', tone: 'muted' },
      },
    })
    const [desk, tasks, calendar] = tabs()
    expect(desk!.querySelector('.wb-tab-count')).toBeNull()
    const badge = tasks!.querySelector('.wb-tab-count')!
    expect(badge.textContent).toBe('3')
    expect(badge.className).toBe('wb-tab-count wb-num is-danger')
    expect(badge.getAttribute('aria-hidden')).toBe('true')
    expect(tasks!.querySelector('.uw-sr-only')?.textContent).toBe('Overdue tasks: 3')
    expect(calendar!.querySelector('.wb-tab-count')?.className).toBe('wb-tab-count wb-num is-muted')
    expect(calendar!.querySelector('.uw-sr-only')?.textContent).toBe('Meetings today: 2')
  })

  it('shows no count when it is given none', async () => {
    await mount()
    expect(host.querySelector('.wb-tab-count')).toBeNull()
    expect(host.querySelector('.wb-tab .uw-sr-only')).toBeNull()
  })
})

describe('Workbench tab unpin', () => {
  it('core tabs have no unpin button; a pinned module and a pinned pillar do', async () => {
    store.set('uniwork.wb.pins.sales', JSON.stringify(['desk', 'tasks', 'calendar', 'personal']))
    store.set('uniwork.wb.pillarPins.sales', JSON.stringify(['knowledge']))
    await mount()
    const all = tabs()
    expect(all).toHaveLength(5)
    expect(all.slice(0, 3).map((b) => b.querySelector('.wb-tab-unpin'))).toEqual([null, null, null])
    expect(all[3]!.querySelector('.wb-tab-unpin[aria-label="Unpin tab"]')).not.toBeNull()
    expect(all[4]!.querySelector('.wb-tab-unpin[aria-label="Unpin tab"]')).not.toBeNull()
  })

  it('CSS hides unpin and the grip until hover, focus or selection, and rounds the underline', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    expect(css).toMatch(/\n\.wb-tab-unpin \{[^}]*\n  opacity: 0;/)
    expect(css).toContain(
      '\n.wb-tab:hover .wb-tab-unpin,\n.wb-tab:focus-within .wb-tab-unpin,\n.wb-tab.active .wb-tab-unpin {\n  opacity: 1;\n}',
    )
    expect(css).toContain(
      '\n.wb-tab-module:hover .wb-tab-grip,\n.wb-tab-module:focus-within .wb-tab-grip,\n.wb-tab-module.active .wb-tab-grip {\n  opacity: 1;\n}',
    )
    expect(css).toMatch(
      /\n\.wb-tab\.active::after \{[^}]*border-radius: 2px;[^}]*background: var\(--accent\);/,
    )
    expect(css).not.toMatch(/\n\.wb-tab \{[^}]*border-bottom:/)
  })
})
```

Khóa store là `uniwork.wb.pins.<practice>` và `uniwork.wb.pillarPins.<practice>` (`workbench-pins.ts:14-15`); id module Hồ sơ là `personal`. Ý của test: 3 tab lõi + 1 module ghim + 1 trụ cột ghim.

- [ ] **Step 3b: Tạo test ghim việc nối dây số đếm (Review Focus 3)**

Tạo `apps/shell/tests/workbench-tab-counts.test.ts`. Test mount cả `PracticeHome`, giữ summary ở trạng thái chờ, rồi cho nó về và kiểm thanh tab vẽ lại mà không đổi tab:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { HomeApi, UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi, WorkHomeSummary } from '../src/shared/uniwork-work-api'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
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

import { LocaleProvider } from '../src/renderer/src/locale'
import { PracticeHome } from '../src/renderer/src/PracticeHome'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = {
  id: 'w-counts',
  name: 'Ops',
  orgId: 'o1',
  slug: 'ops',
  orgSlug: 'acme',
}
const SUMMARY: WorkHomeSummary = {
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 4, overdue: 2, due_today: 1, meetings_today: 1, unread: 0 },
  my_work: [],
  upcoming_meetings: [],
  inbox: [],
  partial: [],
  generated_at: '2026-10-13T03:00:00Z',
}

let host: HTMLDivElement
let root: Root
let land: (value: unknown) => void

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    uniworkListWorkspaces: vi.fn(async () => ({ ok: true, value: [WS] })),
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(() => new Promise((resolve) => (land = resolve))),
    setTaskStatus: vi.fn(),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Workbench tab counts follow the Overview summary', () => {
  it('no count before the summary lands; the counts appear when it does, without a tab switch', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(PracticeHome, {
            practice: requirePractice('entrepreneur'),
            projects: [],
            selectedId: null,
            onSelectPack: vi.fn(),
            onOpenPackFiles: vi.fn(),
            onRefresh: vi.fn(),
            onSwitchPractice: vi.fn(),
            newItems: [],
          }),
        ),
      )
    })
    await flush()
    expect(window.uniworkWork.homeSummary).toHaveBeenCalled()
    expect(host.querySelector('.wb-tab-count')).toBeNull()
    await act(async () => land({ ok: true, value: SUMMARY }))
    await flush()
    const counts = Array.from(host.querySelectorAll('.wb-tab-count')).map((c) => [
      c.textContent,
      c.classList.contains('is-danger'),
    ])
    expect(counts).toEqual([
      ['2', true],
      ['1', false],
    ])
  })
})
```

Nếu `PracticeHome` gọi thêm một hàm bridge lúc mount mà mock trên chưa có, thêm hàm đó vào mock (trả giá trị rỗng); không đổi assertion.

- [ ] **Step 4: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts tests/work-overview.test.ts tests/workbench-tabs.test.ts tests/workbench-tab-counts.test.ts`
Expected: FAIL.

- `work-home`: `tabCounts is not a function`.
- `work-overview`: `onSummary` không bao giờ được gọi.
- `workbench-tabs`: chưa có `.wb-tab-count`, các assertion CSS thất bại. Test cấu trúc unpin đã qua sẵn.
- `workbench-tab-counts`: không có `.wb-tab-count` sau khi summary về (`expected [] to equal [...]`).

- [ ] **Step 5: Thêm khóa i18n**

Chèn ngay sau dòng `wbTabsModules: …,` trong mỗi shard.

`apps/shell/src/renderer/src/i18n/workbench/zh.ts`, sau `  wbTabsModules: '(giá trị trong zh.ts)',`:

```ts
  wbTabCountOverdue: '逾期任务：{count}',
  wbTabCountDueToday: '今天到期的任务：{count}',
  wbTabCountMeetings: '今日会议：{count}',
```

`apps/shell/src/renderer/src/i18n/workbench/en.ts`, sau `  wbTabsModules: 'Modules',`:

```ts
  wbTabCountOverdue: 'Overdue tasks: {count}',
  wbTabCountDueToday: 'Tasks due today: {count}',
  wbTabCountMeetings: 'Meetings today: {count}',
```

`apps/shell/src/renderer/src/i18n/workbench/vi.ts`, sau `  wbTabsModules: 'Mô-đun',`:

```ts
  wbTabCountOverdue: 'Việc quá hạn: {count}',
  wbTabCountDueToday: 'Việc đến hạn hôm nay: {count}',
  wbTabCountMeetings: 'Cuộc họp hôm nay: {count}',
```

18 locale còn lại là `{ ...en }` nên tự có khóa.

- [ ] **Step 6: Viết `tabCounts`**

Trong `apps/shell/src/renderer/src/work-home.ts`, chèn ngay sau dấu `}` đóng của `export function isQuiet(…)`:

```ts
export type TabCount = { n: number; key: StringKey; tone: 'danger' | 'muted' }

/**
 * The Tasks and Calendar tab counts from the Overview summary. A failed source
 * or a malformed (null) count shows nothing: its zeros are not true.
 */
export function tabCounts(
  s: WorkHomeSummary | null,
): Partial<Record<'tasks' | 'calendar', TabCount>> {
  const out: Partial<Record<'tasks' | 'calendar', TabCount>> = {}
  if (!s) return out
  const { overdue, due_today, meetings_today } = s.counts
  if (!s.partial.includes('tasks') && overdue !== null) {
    if (overdue > 0) out.tasks = { n: overdue, key: 'wbTabCountOverdue', tone: 'danger' }
    else if ((due_today ?? 0) > 0)
      out.tasks = { n: due_today!, key: 'wbTabCountDueToday', tone: 'muted' }
  }
  if (!s.partial.includes('meetings') && (meetings_today ?? 0) > 0)
    out.calendar = { n: meetings_today!, key: 'wbTabCountMeetings', tone: 'muted' }
  return out
}
```

`work-home.ts` đã import `StringKey` (dòng 12).

- [ ] **Step 7: Vẽ số đếm trong `WorkbenchTabs`**

Sửa `apps/shell/src/renderer/src/WorkbenchTabs.tsx`:

- Sau `import { useI18n } from './locale'`, thêm:

```ts
import type { tabCounts } from './work-home'
```

- Trong `interface WorkbenchTabsProps`, sau thành viên `onPinsChange?: …`, thêm:

```ts
  /** Tasks and Calendar counts from the cached Overview summary (tabCounts) */
  counts?: ReturnType<typeof tabCounts>
```

- Trong tham số destructure, thay `  onPinsChange,\n}: WorkbenchTabsProps)` bằng `  onPinsChange,\n  counts,\n}: WorkbenchTabsProps)`.
- Trong callback `pins.map((id) => {`, sau `const over = overId === id && dragId !== id`, thêm:

```ts
const count = id === 'tasks' || id === 'calendar' ? counts?.[id] : undefined
```

- Trong cùng tab module, thay `            <span>{vi ? mod.labelVi : mod.labelEn}</span>` bằng:

```tsx
;<span>{vi ? mod.labelVi : mod.labelEn}</span>
{
  count ? (
    <>
      <span className={`wb-tab-count wb-num is-${count.tone}`} aria-hidden="true">
        {count.n}
      </span>
      <span className="uw-sr-only">{t(count.key, { count: count.n })}</span>
    </>
  ) : null
}
```

Tab lõi vẫn không có ×: nhánh `isCorePinnedModule(id) ? null : …` giữ nguyên.

- [ ] **Step 8: Thêm `onSummary` vào `WorkOverview`**

Sửa `apps/shell/src/renderer/src/WorkOverview.tsx`:

- Dòng 1: `import { useEffect, useState } from 'react'` thành `import { useEffect, useRef, useState } from 'react'`.
- Trong `interface Props`, sau `  onCompose: () => void`, thêm:

```ts
  /** each summary on screen (null before one exists): the page redraws the tab counts on it */
  onSummary?: (summary: WorkHomeSummary | null) => void
```

- Trong tham số destructure, thay `  onCompose,\n}: Props): ReactElement {` bằng `  onCompose,\n  onSummary,\n}: Props): ReactElement {`.
- Ngay sau khối `useEffect(() => { void window.aiOffice.accountStatus()… }, [])`, thêm:

```ts
// a ref, so an inline callback never re-fires the effect
const onSummaryRef = useRef(onSummary)
onSummaryRef.current = onSummary
useEffect(() => {
  onSummaryRef.current?.(home.value)
}, [home.value])
```

- [ ] **Step 9: Nối số đếm trong `PracticeHome`**

Sửa `apps/shell/src/renderer/src/PracticeHome.tsx`:

- Sau `import type { ProjectSummaryEntry, UniworkResult, UniworkWorkspaceRef } from '../../shared/home-api'`, thêm:

```ts
import type { WorkHomeSummary } from '../../shared/uniwork-work-api'
```

- Thay `import { WB_REFRESH_EVENT, cacheWork, cachedWorkspaceListState, workCacheSlot } from './work-cache'` bằng:

```ts
import {
  WB_REFRESH_EVENT,
  cacheWork,
  cachedWork,
  cachedWorkspaceListState,
  workCacheSlot,
} from './work-cache'
import { tabCounts } from './work-home'
```

- Sau `  const [refreshTick, setRefreshTick] = useState(0)`, thêm:

```ts
// set by the Overview when its summary changes, only to redraw the tab counts (they read the cache)
const [, setHomeSummary] = useState<WorkHomeSummary | null>(null)
```

- Trong `<WorkbenchTabs … />`, sau `        vi={vi}`, thêm:

```tsx
        counts={tabCounts(
          workspace ? (cachedWork<WorkHomeSummary>(`home:${workspace.id}`)?.value ?? null) : null,
        )}
```

- Trong `<WorkOverview … />`, sau `          onCompose={openCompose}`, thêm:

```tsx
onSummary = { setHomeSummary }
```

- [ ] **Step 10: Cập nhật CSS tab**

Mọi sửa trong `apps/shell/src/renderer/src/home.css`.

Trước hết, thay trọn khối `.wb-tab {` và khối `.wb-tab.active {` (dòng 3636-3665; khối `.wb-tab:hover` nằm giữa chúng và giữ nguyên nội dung) bằng:

```css
.wb-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  border: none;
  border-radius: var(--radius-6) var(--radius-6) 0 0;
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 10px 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 150ms ease,
    background 150ms ease;
}

.wb-tab:hover {
  background: var(--hover);
  color: var(--text);
}

.wb-tab.active {
  color: var(--text);
}

.wb-tab.active::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.wb-tab-count {
  min-width: 14px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
}

.wb-tab-count.is-danger {
  color: var(--danger-text);
}

.wb-tab-count.is-muted {
  color: var(--text-secondary);
}
```

Tiếp theo, thay `.wb-tab-module:hover .wb-tab-grip {\n  opacity: 1;\n}` bằng:

```css
.wb-tab-module:hover .wb-tab-grip,
.wb-tab-module:focus-within .wb-tab-grip,
.wb-tab-module.active .wb-tab-grip {
  opacity: 1;
}
```

Rồi thay trọn khối `.wb-tab-unpin {` bằng (chữ `--text-secondary` vì `--text-tertiary` trên tab đang hover chỉ 2.80:1):

```css
.wb-tab-unpin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-6);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1;
  opacity: 0;
  transition:
    opacity 150ms ease,
    background 150ms ease,
    color 150ms ease;
}
```

Cuối cùng, ngay sau khối `.wb-tab-unpin:hover { … }` (không đổi), thêm:

```css
.wb-tab:hover .wb-tab-unpin,
.wb-tab:focus-within .wb-tab-unpin,
.wb-tab.active .wb-tab-unpin {
  opacity: 1;
}

/* touch screens cannot hover: keep unpin and the grip reachable */
@media (hover: none) {
  .wb-tab-unpin,
  .wb-tab-grip {
    opacity: 1;
  }
}
```

- [ ] **Step 11: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts tests/work-overview.test.ts tests/workbench-tabs.test.ts tests/workbench-tab-counts.test.ts tests/workbench-tabs-focus.test.ts tests/strings-workbench.test.ts tests/workbench-copy.test.ts`
Expected: PASS. `strings-workbench` vẫn thấy cùng bộ khóa và placeholder ở mọi locale, không có từ Anh bị cấm trong vi; `workbench-copy` không thấy `label(` trong `WorkbenchTabs.tsx` hay `PracticeHome.tsx`; `tabs-focus` vẫn có đúng một `.wb-tab.active`.

- [ ] **Step 12: Kiểm tra**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkbenchTabs.tsx apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts apps/shell/tests/workbench-tabs.test.ts apps/shell/tests/workbench-tab-counts.test.ts
npx prettier --check apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkbenchTabs.tsx apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts apps/shell/tests/workbench-tabs.test.ts apps/shell/tests/workbench-tab-counts.test.ts
```

Expected: suite shell xanh; typecheck thoát 0 (union `StringKey` có `wbTabCount*`, `PracticeHome` truyền `counts` và `onSummary` đúng kiểu); theme check sạch; english-comments qua; prettier sạch.

- [ ] **Step 13: Commit**

```bash
git add apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkbenchTabs.tsx apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts apps/shell/tests/workbench-tabs.test.ts apps/shell/tests/workbench-tab-counts.test.ts
git commit -m "feat(shell): Workbench tabs show overdue, due-today and meeting counts

Counts come from the cached Overview summary (no new call); a failed
source or a null count shows none. The Overview reports each summary it
shows so the tab bar redraws when one lands. Unpin and the drag grip show
on hover, keyboard focus or selection (always on touch screens), and the
selected tab gets a rounded 2px accent underline.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tổng quan (lời chào theo tên gọi, dải số liệu một khối, Việc của tôi chia nhóm, họp, thông báo, trạng thái yên, skeleton)

**Files:**

- Modify: `apps/shell/src/renderer/src/WorkbenchIcons.tsx`
- Modify: `apps/shell/src/renderer/src/work-home.ts`
- Modify: `apps/shell/src/renderer/src/WorkOverview.tsx`
- Modify: `apps/shell/src/renderer/src/home.css` (vùng `/* ── Workbench Overview (desk tab) ── */`)
- Modify: `apps/shell/src/renderer/src/i18n/workbench/zh.ts`, `en.ts`, `vi.ts`
- Test: `apps/shell/tests/work-home.test.ts`, `apps/shell/tests/work-overview.test.ts`, `apps/shell/tests/workbench-icons.test.ts` (chỉ chạy, phải xanh)

**Interfaces:**

- Consumes: `WorkStatePanel` (Task 2), `greetingName` (Task 2), `onSummary` đã có trong `WorkOverview` (Task 4, không đụng tới), `MEETING_TINT`, `Tint`, `WbRowActions`, `dueState`, các lớp nền tảng của Task 1 (`.wb-btn*`, `.wb-block`, `.wb-row`, `.wb-row-actions`, `.wb-group-head`, `.wb-num`, `.wb-mono`, `.wb-skel*`, `.wb-check*`), khóa có sẵn `wbTasksGroupOverdue`, `wbTasksGroupToday`, `wbCommonOpen`, `wbOvLive`, `wbOvTomorrow`, `wbOvJoin`, `wbOvQuiet`, `wbOvQuietAction`.
- Produces:
  - `WorkbenchIcon({ id, size, tint })` với `IconId` có thêm `'inbox'` (glyph chuông, mặc định tint `gray`).
  - `export type MyWorkGroup = 'overdue' | 'today' | 'upcoming'` và `export function myWorkGroups(tasks, today)` trong `work-home.ts` (thực thi sửa đổi số 5: việc đã tick giữ nhóm; `later`/`none` vào "Sắp tới").
  - Khóa `wbOvGroupUpcoming`, `wbOvMinutes`.
  - CSS `.wb-ov-strip`, `.wb-ov-stat-top`, `.wb-ov-time`, `.wb-ov-meet`, `.wb-ov-meet-sub`, `.wb-ov-avatar`.
- Giữ cho test và e2e: `.wb-ov-greeting`, `.wb-ov-stat` (×5), `.wb-ov-stat-value`, `data-testid="wb-stat-*"`, `.wb-ov-recents`, `.wb-ov-recent`, và `input[type="checkbox"]` đầu tiên vẫn thuộc Việc của tôi.
- Xóa: `.wb-ov-stats`, `.wb-ov-row`, `.wb-ov-row-meta`, `.wb-ov-quiet` (không có gì ngoài `WorkOverview.tsx`/`home.css` dùng). Giữ `.wb-ov-row-title` (đã có ellipsis một dòng).

- [ ] **Step 1: Thêm `tint` và glyph `'inbox'` cho `WorkbenchIcon`**

Trong `apps/shell/src/renderer/src/WorkbenchIcons.tsx`:

- Đổi import `import { MODULE_TONES, tintStyle } from './module-tones'` thành `import { MODULE_TONES, tintStyle, type Tint } from './module-tones'`.
- Đổi `type IconId = PracticePillarId | WorkbenchModuleId | 'add'` thành `type IconId = PracticePillarId | WorkbenchModuleId | 'add' | 'inbox'`.
- Trong `GLYPH`, ngay trước dòng `  add: …`, thêm:

```tsx
  inbox: (
    <>
      <path
        d="M8 16.5V11a4 4 0 0 1 8 0v5.5l1.5 1.5h-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10.5 19.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
```

- Thay hàm `WorkbenchIcon` bằng:

```tsx
/** `tint` overrides the module tone (the Overview strip paints Meetings violet, Unread blue) */
export function WorkbenchIcon({
  id,
  size = 18,
  tint,
}: {
  id: IconId
  size?: number
  tint?: Tint
}): ReactElement {
  const tone = tint ?? (id === 'add' || id === 'inbox' ? 'gray' : MODULE_TONES[id])
  return (
    <span
      className="wb-icon-tile"
      style={{ ...tintStyle(tone), width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {GLYPH[id]}
      </svg>
    </span>
  )
}
```

Run: `cd apps/shell && npx vitest run tests/workbench-icons.test.ts`. Expected: PASS (không có hex trong glyph mới; tint mặc định của module không đổi).

- [ ] **Step 2: Viết test thất bại cho `myWorkGroups`**

Trong `apps/shell/tests/work-home.test.ts`, thêm `myWorkGroups,` vào danh sách import từ `'../src/renderer/src/work-home'` ngay sau `mergeRecentDocuments,` (`greetingName` đã có từ Task 2, `tabCounts` từ Task 4). Nối vào cuối file:

```ts
describe('myWorkGroups', () => {
  it('Overdue, Today, then Upcoming (later and no due date), each in list order', () => {
    const groups = myWorkGroups(
      [
        task({ id: 'a', due_date: '2026-10-20' }),
        task({ id: 'b' }),
        task({ id: 'c', due_date: TODAY }),
        task({ id: 'd', due_date: undefined }),
      ],
      TODAY,
    )
    expect(groups.map((g) => [g.key, g.tasks.map((x) => x.id)])).toEqual([
      ['overdue', ['b']],
      ['today', ['c']],
      ['upcoming', ['a', 'd']],
    ])
  })

  it('a ticked task keeps its due group instead of jumping to Upcoming', () => {
    const done = task({ status: 'done' })
    expect(myWorkGroups([done], TODAY)).toEqual([{ key: 'overdue', tasks: [done] }])
  })

  it('no tasks, no groups', () => {
    expect(myWorkGroups([], TODAY)).toEqual([])
  })
})
```

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts`
Expected: FAIL với `myWorkGroups is not a function`.

- [ ] **Step 3: Viết `myWorkGroups`**

Trong `apps/shell/src/renderer/src/work-home.ts`, chèn ngay sau dấu `}` đóng của `dueState`:

```ts
export type MyWorkGroup = 'overdue' | 'today' | 'upcoming'

/** Overview "My work" groups in display order; a ticked task keeps its due group (not 'none'). */
export function myWorkGroups(
  tasks: readonly WorkTask[],
  today: string,
): { key: MyWorkGroup; tasks: WorkTask[] }[] {
  const groups: Record<MyWorkGroup, WorkTask[]> = { overdue: [], today: [], upcoming: [] }
  for (const task of tasks) {
    const due = dueState({ ...task, status: 'todo' }, today)
    groups[due === 'overdue' || due === 'today' ? due : 'upcoming'].push(task)
  }
  return (['overdue', 'today', 'upcoming'] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, tasks: groups[key] }))
}
```

Run: `cd apps/shell && npx vitest run tests/work-home.test.ts`. Expected: PASS.

- [ ] **Step 4: Thêm hai khóa i18n của Tổng quan**

Mỗi shard có một dòng bắt đầu bằng `  wbOvDueOn:`. Chèn hai dòng ngay sau nó.

`zh.ts`:

```ts
  wbOvGroupUpcoming: '即将到期',
  wbOvMinutes: '{count} 分钟',
```

`en.ts`:

```ts
  wbOvGroupUpcoming: 'Upcoming',
  wbOvMinutes: '{count} min',
```

`vi.ts`:

```ts
  wbOvGroupUpcoming: 'Sắp tới',
  wbOvMinutes: '{count} phút',
```

Run: `cd apps/shell && npx vitest run tests/strings-workbench.test.ts`. Expected: PASS.

- [ ] **Step 5: Sửa test Tổng quan hiện có và thêm test thất bại**

Trong `apps/shell/tests/work-overview.test.ts`:

(a) Trong `'full: greeting, headline, five counts, …'`, chèn sau câu lệnh `expect([...].map(stat)).toEqual([...])`:

```ts
expect(host.querySelectorAll('.wb-ov-strip.wb-block > .wb-ov-stat')).toHaveLength(5)
// Open, Overdue, Due today in the Tasks tint; Meetings violet; Unread blue
expect(
  Array.from(host.querySelectorAll<HTMLElement>('.wb-ov-stat .wb-icon-tile')).map(
    (tile) => tile.style.background,
  ),
).toEqual([
  'var(--tint-green)',
  'var(--tint-green)',
  'var(--tint-green)',
  'var(--tint-violet)',
  'var(--tint-blue)',
])
```

(b) Trong `'quiet: one line and a shortcut to Compose …'`, thay

```ts
expect(host.querySelector('.wb-ov-stats')).toBeNull()
```

bằng

```ts
expect(host.querySelector('.wb-ov-strip')).toBeNull()
expect(host.querySelector('.wb-state[role="status"]')?.textContent).toContain(
  'Nothing is waiting for you',
)
```

(c) Trong `'done checkbox: stays checked and reloads the summary when the server accepts'`, chèn sau `expect(stat('open')).toBe('3')`:

```ts
// the ticked row keeps its due group; it does not jump to Upcoming
expect(host.querySelector('.wb-group-head.is-overdue')?.textContent).toBe('Overdue 1')
expect(host.querySelector('.wb-row.is-done')?.textContent).toContain('Send the contract')
```

(d) Nối vào trong `describe('WorkOverview', …)`, trước dấu `})` đóng:

```ts
it('greets a person by the name they are called by', async () => {
  api.accountStatus.mockResolvedValue({
    loggedIn: true,
    state: 'signed-in',
    profile: { accountId: 'u1', email: 'quang@acme.vn', displayName: 'Phan Đức Quang' },
  })
  await mount()
  const greeting = host.querySelector('.wb-ov-greeting')?.textContent ?? ''
  expect(greeting).toContain('Quang')
  expect(greeting).not.toContain('Phan')
})

it('my work under Overdue / Today / Upcoming with counts; meeting length; inbox initial', async () => {
  work.homeSummary.mockResolvedValue({
    ok: true,
    value: summary({
      my_work: [
        task(),
        task({ id: 't2', identifier: 'OPS-8', title: 'Call the bank', due_date: TODAY }),
        task({ id: 't3', identifier: 'OPS-9', title: 'Plan Q4', due_date: '2026-10-20' }),
        task({ id: 't4', identifier: 'OPS-10', title: 'Read the memo', due_date: undefined }),
      ],
      upcoming_meetings: [
        {
          id: 'm2',
          workspace_id: 'w',
          title: 'Budget review',
          starts_at: '2026-10-14T03:00:00Z',
          ends_at: '2026-10-14T03:30:00Z',
          status: 'SCHEDULED',
        },
      ],
    }),
  })
  await mount()
  const heads = Array.from(host.querySelectorAll('#wb-ov-mywork .wb-group-head')).map(
    (h) => h.textContent,
  )
  expect(heads).toEqual(['Overdue 1', 'Today 1', 'Upcoming 2'])
  expect(
    host.querySelector('#wb-ov-mywork .wb-row .wb-check input.uw-sr-only[type="checkbox"]'),
  ).not.toBeNull()
  expect(host.querySelector('#wb-ov-mywork .wb-mono')?.textContent).toBe('OPS-7')
  // keyboard: the title is the way in; the hover-only "Open ↗" shortcut stays out of the tab order
  const row = host.querySelector('#wb-ov-mywork .wb-row')!
  expect(row.querySelector('button.wb-ov-row-title')).not.toBeNull()
  const shortcut = row.querySelector<HTMLButtonElement>('.wb-row-actions button')!
  expect(shortcut.tabIndex).toBe(-1)
  expect(shortcut.getAttribute('aria-hidden')).toBe('true')
  const meeting = host.querySelector('#wb-ov-meetings .wb-row')!
  expect(meeting.querySelector('.wb-ov-time.wb-mono')?.textContent).toBe('10:00')
  expect(meeting.textContent).toContain('Tomorrow · 30 min')
  expect(host.querySelector('#wb-ov-inbox .wb-ov-avatar')?.textContent).toBe('L')
})

it('loading: a skeleton shaped like the strip and three rows', async () => {
  work.homeSummary.mockReturnValue(new Promise<never>(() => undefined))
  await mount()
  const skel = host.querySelector('.wb-ov-skel[aria-hidden="true"]')!
  expect(skel.querySelectorAll('.wb-skel.wb-skel-strip')).toHaveLength(1)
  expect(skel.querySelectorAll('.wb-skel.wb-skel-row')).toHaveLength(3)
})
```

(e) Test ghim cho Review Focus 2, nối ngay sau các test ở (d):

```ts
it('no tasks but a meeting: not the quiet panel; My work says so and the meeting still lists', async () => {
  work.homeSummary.mockResolvedValue({
    ok: true,
    value: summary({
      my_work: [],
      inbox: [],
      counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 1, unread: 0 },
    }),
  })
  await mount()
  expect(host.querySelector('.wb-state')).toBeNull()
  expect(host.querySelectorAll('.wb-ov-strip > .wb-ov-stat')).toHaveLength(5)
  expect(host.querySelector('#wb-ov-mywork .wb-group-head')).toBeNull()
  expect(host.querySelector('#wb-ov-mywork .wb-ov-note')).not.toBeNull()
  expect(host.querySelectorAll('#wb-ov-meetings .wb-row')).toHaveLength(1)
})
```

- [ ] **Step 6: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/work-overview.test.ts`
Expected: FAIL ở `full` (chưa có `.wb-ov-strip`), `quiet` (chưa có `.wb-state`), `done checkbox: stays checked` (chưa có `.wb-group-head`), `greets a person…` (lời chào còn "Phan Đức Quang"), `my work under…`, `loading…`, `no tasks but a meeting…`. Các test khác vẫn qua.

- [ ] **Step 7: Tái cấu trúc `WorkOverview.tsx`**

Sửa import, các dòng import khác giữ nguyên:

- `import { useEffect, useRef, useState } from 'react'` (sau Task 4) thành `import { Fragment, useEffect, useRef, useState } from 'react'`.
- Sau `import { useI18n, type StringKey } from './locale'` thêm:
  ```ts
  import { MEETING_TINT, type Tint } from './module-tones'
  ```
- Sau `import { openRecentEntry, openUniworkDocument } from './uniwork-open'` thêm:
  ```ts
  import { WbRowActions } from './WbRowActions'
  import { WorkbenchIcon } from './WorkbenchIcons'
  ```
- Trong danh sách import từ `'./work-home'`: thêm `greetingName,` sau `greetingKey,`, `myWorkGroups,` sau `localDay,`, và `type MyWorkGroup,` làm mục cuối.
- `import { WorkErrorState, WorkNoWorkspace, WorkStaleNote, WorkToast } from './WorkErrorState'` thành:
  ```ts
  import {
    WorkErrorState,
    WorkNoWorkspace,
    WorkStaleNote,
    WorkStatePanel,
    WorkToast,
  } from './WorkErrorState'
  ```

Thay trọn khai báo `const STATS … = [ … ]` bằng:

```tsx
const STATS: readonly {
  key: keyof WorkHomeCounts
  source: WorkHomeSource
  label: StringKey
  tone?: 'danger' | 'warning'
  section: string
  icon: 'tasks' | 'calendar' | 'inbox'
  tint?: Tint
}[] = [
  { key: 'open', source: 'tasks', label: 'wbOvStatOpen', section: 'wb-ov-mywork', icon: 'tasks' },
  {
    key: 'overdue',
    source: 'tasks',
    label: 'wbOvStatOverdue',
    tone: 'danger',
    section: 'wb-ov-mywork',
    icon: 'tasks',
  },
  {
    key: 'due_today',
    source: 'tasks',
    label: 'wbOvStatDueToday',
    tone: 'warning',
    section: 'wb-ov-mywork',
    icon: 'tasks',
  },
  {
    key: 'meetings_today',
    source: 'meetings',
    label: 'wbOvStatMeetingsToday',
    section: 'wb-ov-meetings',
    icon: 'calendar',
    tint: MEETING_TINT,
  },
  {
    key: 'unread',
    source: 'notifications',
    label: 'wbOvStatUnread',
    section: 'wb-ov-inbox',
    icon: 'inbox',
    tint: 'blue',
  },
]

const GROUP_LABEL: Record<MyWorkGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  upcoming: 'wbOvGroupUpcoming',
}

const CHECK_GLYPH = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M2 5.2 4.1 7.2 8 3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
```

Trong `header`, thay dòng lời chào

```tsx
<h2 className="wb-ov-greeting">{t(greetingKey(hourIn(s.timezone)), { name })}</h2>
```

bằng

```tsx
<h2 className="wb-ov-greeting">
  {t(greetingKey(hourIn(s.timezone)), { name: greetingName(name) })}
</h2>
```

và trong cùng hàm đổi `className="btn btn-primary"` của nút Join thành `className="wb-btn wb-btn-primary wb-btn-sm"`.

Thay trọn `const stats = …` bằng:

```tsx
const stats = (s: WorkHomeSummary) => (
  <ul className="wb-ov-strip wb-block" aria-label={t('wbOvStatsLabel')}>
    {STATS.map((item) => {
      const value = s.counts[item.key]
      const top = (
        <span className="wb-ov-stat-top">
          <WorkbenchIcon id={item.icon} size={20} tint={item.tint} />
          <span className="wb-ov-stat-label">{t(item.label)}</span>
        </span>
      )
      return (
        <li key={item.key} className="wb-ov-stat">
          {value === null || s.partial.includes(item.source) ? (
            <div className="wb-ov-stat-body">
              {top}
              <span className="wb-ov-stat-value wb-num is-muted">—</span>
              <button type="button" className="wb-link" onClick={home.reload}>
                {t('acctRetry')}
              </button>
            </div>
          ) : (
            <button type="button" className="wb-ov-stat-body" onClick={() => jump(item.section)}>
              {top}
              <span
                className={`wb-ov-stat-value wb-num${value > 0 && item.tone ? ` is-${item.tone}` : ''}`}
                data-testid={`wb-stat-${item.key}`}
              >
                {value}
              </span>
            </button>
          )}
        </li>
      )
    })}
  </ul>
)
```

Thay trọn `const myWork = …` bằng:

```tsx
const myWork = (s: WorkHomeSummary) => (
  <section id="wb-ov-mywork" className="wb-ov-card">
    <h3 className="wb-ov-card-title">{t('wbOvMyWork')}</h3>
    {s.partial.includes('tasks') ? (
      retryLine()
    ) : s.my_work.length === 0 ? (
      <p className="wb-ov-note">{t('wbOvMyWorkEmpty')}</p>
    ) : (
      <div className="wb-block">
        {myWorkGroups(s.my_work, s.today).map((group) => (
          <Fragment key={group.key}>
            <h4 className={`wb-group-head${group.key === 'overdue' ? ' is-overdue' : ''}`}>
              {t(GROUP_LABEL[group.key])} <span className="wb-num">{group.tasks.length}</span>
            </h4>
            <ul className="wb-ov-list">
              {group.tasks.map((task) => {
                const done = task.status === 'done'
                const due = dueState(task, s.today)
                const open = () => base && openWeb({ kind: 'task', ...base, id: task.id })
                return (
                  <li key={task.id} className={`wb-row${done ? ' is-done' : ''}`}>
                    <label className="wb-check">
                      <input
                        type="checkbox"
                        className="uw-sr-only"
                        checked={done}
                        aria-label={t('wbOvMarkDone', { title: task.title })}
                        onChange={() => void setStatus(task, done ? 'todo' : 'done')}
                      />
                      <span className="wb-check-box" aria-hidden="true">
                        {CHECK_GLYPH}
                      </span>
                    </label>
                    <button type="button" className="wb-ov-row-title" onClick={open}>
                      {task.title}
                    </button>
                    {task.identifier ? <span className="wb-mono">{task.identifier}</span> : null}
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
                    <WbRowActions>
                      {/* pointer shortcut only: the title button is the keyboard and reader path */}
                      <button
                        type="button"
                        className="wb-btn wb-btn-ghost wb-btn-sm"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={open}
                      >
                        {t('wbCommonOpen')} ↗
                      </button>
                    </WbRowActions>
                  </li>
                )
              })}
            </ul>
          </Fragment>
        ))}
      </div>
    )}
  </section>
)
```

Thay trọn `const meetings = …` bằng:

```tsx
const meetings = (s: WorkHomeSummary) => (
  <section id="wb-ov-meetings" className="wb-ov-card">
    <h3 className="wb-ov-card-title">{t('wbOvMeetings')}</h3>
    {s.partial.includes('meetings') ? (
      retryLine()
    ) : s.upcoming_meetings.length === 0 ? (
      <p className="wb-ov-note">{t('wbOvMeetingsEmpty')}</p>
    ) : (
      <ul className="wb-ov-list wb-block">
        {s.upcoming_meetings.map((m) => {
          const live = m.status === 'IN_PROGRESS'
          const tomorrow = localDay(m.starts_at, s.timezone || 'UTC') !== s.today
          const minutes = Math.round((Date.parse(m.ends_at) - Date.parse(m.starts_at)) / 60_000)
          const sub = [
            live ? t('wbOvLive') : null,
            tomorrow ? t('wbOvTomorrow') : null,
            minutes > 0 ? t('wbOvMinutes', { count: minutes }) : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={m.id} className="wb-row">
              <span className="wb-mono wb-num wb-ov-time">
                {clock(m.starts_at, dateLocale, s.timezone)}
              </span>
              <div className="wb-ov-meet">
                <button
                  type="button"
                  className="wb-ov-row-title"
                  onClick={() => base && openWeb({ kind: 'meeting', ...base, id: m.id })}
                >
                  {m.title}
                </button>
                {sub ? <span className="wb-ov-meet-sub">{sub}</span> : null}
              </div>
              {live ? (
                <button
                  type="button"
                  className="wb-btn wb-btn-primary wb-btn-sm"
                  onClick={() => base && openWeb({ kind: 'room', ...base, id: m.id })}
                >
                  {t('wbOvJoin')}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    )}
  </section>
)
```

Thay trọn `const inbox = …` bằng:

```tsx
const inbox = (s: WorkHomeSummary) => (
  <section id="wb-ov-inbox" className="wb-ov-card">
    <h3 className="wb-ov-card-title">{t('wbOvInbox')}</h3>
    {s.partial.includes('notifications') ? (
      retryLine()
    ) : s.inbox.length === 0 ? (
      <p className="wb-ov-note">{t('wbOvInboxEmpty')}</p>
    ) : (
      <ul className="wb-ov-list wb-block">
        {s.inbox.map((n) => (
          <li key={n.id} className="wb-row">
            <span className="wb-ov-avatar" aria-hidden="true">
              {(n.params.actor ?? '').trim().charAt(0).toUpperCase()}
            </span>
            <button
              type="button"
              className="wb-ov-row-title"
              onClick={() => base && openWeb(inboxTarget(n, base))}
            >
              {t(notificationKey(n.kind), n.params)}
            </button>
            <span className="wb-mono wb-num">{formatWhen(n.created_at, dateLocale)}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
)
```

Trong JSX trả về, thay khối skeleton

```tsx
<div className="wb-ov-skel" aria-hidden="true">
  <span className="uw-skel uw-skel-line short" />
  <span className="uw-skel uw-skel-line" />
  <span className="uw-skel uw-skel-line" />
</div>
```

bằng

```tsx
<div className="wb-ov-skel" aria-hidden="true">
  <span className="wb-skel wb-skel-strip" />
  <span className="wb-skel wb-skel-row" />
  <span className="wb-skel wb-skel-row" />
  <span className="wb-skel wb-skel-row" />
</div>
```

và thay nhánh yên

```tsx
<div className="wb-ov-quiet" role="status">
  <span>{t('wbOvQuiet')}</span>
  <button type="button" className="btn btn-secondary" onClick={onCompose}>
    {t('wbOvQuietAction')}
  </button>
</div>
```

bằng

```tsx
<WorkStatePanel
  tone="gray"
  icon={<WorkbenchIcon id="desk" size={20} />}
  title={t('wbOvQuiet')}
  action={{ label: t('wbOvQuietAction'), onClick: onCompose, variant: 'secondary' }}
  role="status"
/>
```

`recentStrip` giữ nguyên markup; giao diện mới của nó chỉ đến từ CSS. Kiểm lần cuối: `grep -n "btn btn-" apps/shell/src/renderer/src/WorkOverview.tsx` không in gì (nếu còn nút `btn` nào, ví dụ ở dòng báo lỗi cloud, đổi sang `wb-btn wb-btn-secondary`).

- [ ] **Step 8: Đổi style vùng Tổng quan trong `home.css`**

Mọi sửa nằm trong `/* ── Workbench Overview (desk tab) ── */`.

1. Trong `.wb-ov`, đổi `gap: 16px;` thành `gap: 18px;`.
2. Thay rule `.wb-ov-date` và `.wb-ov-greeting` bằng:

```css
.wb-ov-date {
  margin: 0;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
}

.wb-ov-greeting {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
}
```

3. Thay sáu rule `.wb-ov-stats`, `.wb-ov-stat`, `.wb-ov-stat-body`, `button.wb-ov-stat-body`, `button.wb-ov-stat-body:hover`, `.wb-ov-stat-value` bằng khối dưới. Giữ nguyên `.wb-ov-stat-value.is-danger`, `.is-warning`, `.is-muted` và `.wb-ov-stat-label` (Task 9 sửa màu của chúng).

```css
.wb-ov-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-ov-stat {
  min-width: 0;
}

.wb-ov-stat + .wb-ov-stat {
  border-left: 1px solid var(--border);
}

.wb-ov-stat-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

button.wb-ov-stat-body {
  cursor: pointer;
  transition: background-color 150ms ease;
}

button.wb-ov-stat-body:hover {
  background: var(--wb-row-hover);
}

button.wb-ov-stat-body:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.wb-ov-stat-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wb-ov-stat-value {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--text);
}
```

4. Thay rule `.wb-ov-card` (hiện có viền, nền và padding: đó là thẻ bọc từng mục) bằng:

```css
.wb-ov-card {
  min-width: 0;
}
```

5. Xóa các rule `.wb-ov-row`, `.wb-ov-row:hover`, `.wb-ov-row input[type='checkbox']`, `.wb-ov-row.is-done`, `.wb-ov-row.is-done .wb-ov-row-title`, `.wb-ov-row-meta`. Giữ `.wb-ov-row-title` và `.wb-ov-row-title:hover`. Chèn khối này ngay sau `.wb-ov-row-title:hover`:

```css
.wb-ov-card .wb-group-head {
  margin: 0;
}

.wb-ov-list + .wb-group-head {
  border-top: 1px solid var(--border-subtle);
}

.wb-row.is-done .wb-ov-row-title {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.wb-ov-time {
  flex: 0 0 auto;
  min-width: 40px;
  font-weight: 600;
  color: var(--text);
}

.wb-ov-meet {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.wb-ov-meet-sub {
  font-size: 12px;
  color: var(--text-secondary);
}

.wb-ov-avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-6);
  background: var(--tint-blue);
  color: var(--tint-blue-fg);
  font-size: 11px;
  font-weight: 600;
}
```

6. Thay `.wb-ov-recent-grid` bằng khối dưới, và chèn media query ngay sau nó:

```css
.wb-ov-recent-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 900px) {
  .wb-ov-recent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

7. Trong `.wb-ov-recent`, thay khai báo `transition:` bằng:

```css
transition:
  border-color 150ms ease,
  box-shadow 150ms ease;
```

và thay rule `.wb-ov-recent:hover` bằng:

```css
.wb-ov-recent:hover {
  border-color: var(--border-hover);
  box-shadow: var(--wb-shadow);
}
```

8. Xóa rule `.wb-ov-quiet`. Giữ `.wb-ov-skel`.

- [ ] **Step 9: Chạy test và mọi kiểm tra**

```bash
cd apps/shell && npx vitest run tests/work-overview.test.ts tests/work-home.test.ts tests/strings-workbench.test.ts tests/workbench-icons.test.ts && cd ../..
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkbenchIcons.tsx apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkbenchIcons.tsx apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts
```

Expected: mọi lệnh thoát 0; toàn bộ test Tổng quan qua; theme check không thấy màu thô trong dòng đã đổi.

- [ ] **Step 10: Commit**

```bash
git add apps/shell/src/renderer/src/WorkbenchIcons.tsx apps/shell/src/renderer/src/work-home.ts apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/work-home.test.ts apps/shell/tests/work-overview.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Overview redesign: greeting name, one-block strip, grouped My work

Greet by the name a person is called by; the five counts sit in one
block with tinted tiles; My work groups as Overdue / Today / Upcoming (a
ticked row keeps its group); meetings show a mono time, length and a Join
button; inbox rows get an initial tile; the quiet state uses
WorkStatePanel and the skeleton matches the strip and three rows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Khung tab (WorkbenchModulePane + WorkPaneHeader) và danh sách Công việc

**Files:**

- Modify:
  - `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (hàm `WorkbenchModulePane` và import)
  - `apps/shell/src/renderer/src/WorkTasksPane.tsx` (thay cả file)
  - `apps/shell/src/renderer/src/NotesPane.tsx` (chỉ class của form)
  - `apps/shell/src/renderer/src/home.css` (mục "Workbench server tabs" và mục Notes)
  - `apps/shell/src/renderer/src/i18n/workbench/{zh,en,vi}.ts`
- Create (test): `apps/shell/tests/workbench-module-pane.test.ts`
- Modify (test): `apps/shell/tests/work-tasks-pane.test.ts`, `apps/shell/tests/workbench-foundation.test.ts`. Các assertion cũ của tasks vẫn đúng: `.wb-work-row input[type="checkbox"]` và `.is-done` trên `<li>`; `.wb-work-quick input`; `form` đầu tiên; `.wb-toast`; `[role="alert"]` và `.wb-work-skeleton` null; chữ 'Today'.

**Interfaces:**

- Consumes: `WorkPaneHeader`, `WorkPaneHeaderProps`, `WorkStatePanel` (Task 2), `WorkbenchIcon`, `MODULE_TONES.tasks`, các lớp nền tảng của Task 1.
- Produces:
  - Prop mới của `WorkTasksPane`: `head?: Omit<WorkPaneHeaderProps, 'aside'>`. Khi có `head`, mọi nhánh trả về (kể cả `WorkNoWorkspace` và `workLoadState`) vẽ `<WorkPaneHeader {...head} aside={list.value ? <span className="wb-num">{t('wbTasksOpenCount', { count })}</span> : undefined} />` trước. Test cũ không truyền `head` nên không bị ảnh hưởng.
  - `WorkbenchModulePane` render `<section className="wb-pane" aria-label={title}>`, bỏ `wb-panel wb-detail`, `<h2>` và `<p className="wb-hint">`.
  - Khóa `wbTasksOpenCount`.
  - CSS `.wb-work-quick-plus` (viền đứt duy nhất được phép), `.wb-work-group`, `.wb-pill.is-status`, `.wb-notes-add`, quy tắc hiện glyph checkbox.
- Ghi chú dùng chung form Notes: Notes đang dùng `.wb-work-quick`; task này đổi `.wb-work-quick` thành dòng không viền trong khối, nên form Notes chuyển sang lớp mới `.wb-notes-add` ngay ở đây để không bị mất style trước Task 8.

- [ ] **Step 1: Thêm khóa `wbTasksOpenCount`**

Thêm dòng này ngay sau dòng `wbTasksEmpty:` của mỗi shard:

- `zh.ts`: `  wbTasksOpenCount: '(giá trị trong zh.ts)',`
- `en.ts`: `  wbTasksOpenCount: 'Open: {count}',`
- `vi.ts`: `  wbTasksOpenCount: 'Đang mở: {count}',`

Run: `cd apps/shell && npx vitest run tests/strings-workbench.test.ts`. Expected: PASS.

- [ ] **Step 2: Viết test thất bại cho khung tab**

Tạo `apps/shell/tests/workbench-module-pane.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchModuleId } from '@uniwork/practice-core'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
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

import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchModulePane } from '../src/renderer/src/WorkbenchModulePanes'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(moduleId: WorkbenchModuleId, contextTitle?: string) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkbenchModulePane, {
          moduleId,
          practiceId: 'sales',
          vi: false,
          contextTitle,
          workspace: null,
          workspaceError: null,
          onReload: () => undefined,
        }),
      ),
    )
  })
}

describe('Workbench module pane frame (redesign spec 4.2)', () => {
  it('a local tab: one header with the module name, its hint as meta and the device tag', async () => {
    await mount('notes', 'Acme deal')
    expect(host.querySelector('section.wb-pane')?.getAttribute('aria-label')).toBe('Notes')
    expect(host.querySelector('.wb-panel, .wb-detail')).toBeNull()
    expect(Array.from(host.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Notes'])
    expect(host.querySelector('.wb-pane-meta')?.textContent).toBe(
      'Quick notes, stored on this device · Acme deal',
    )
    expect(host.querySelector('.wb-pane-aside .wb-local-tag')?.textContent).toBe('On this device')
  })

  it('a server tab gets the header without the device tag', async () => {
    await mount('calendar')
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-meta')?.textContent).toBe(
      'Due tasks and meetings in the next 14 days',
    )
    expect(host.querySelector('.wb-local-tag')).toBeNull()
  })

  it('Tasks gets exactly one header, drawn by the Tasks pane (no count before a list)', async () => {
    await mount('tasks')
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-title')?.textContent).toBe('Tasks')
    expect(host.querySelector('.wb-pane-aside')).toBeNull()
  })
})
```

Nếu nhãn `LocalTag` tiếng Anh khác 'On this device', dùng đúng chuỗi trong `en.ts`; ý của test là tag nằm trong `.wb-pane-aside`.

- [ ] **Step 2b: Test ghim cắt chữ dài (Review Focus 1)**

Nối vào cuối `apps/shell/tests/workbench-foundation.test.ts`:

```ts
describe('long titles (review focus: very long workspace and task names)', () => {
  it.each(['.wb-ov-row-title', '.wb-work-title', '.wb-crumb-name', '.wb-pane-meta'])(
    '%s truncates to one line with an ellipsis instead of pushing its row apart',
    (selector) => {
      const body = rule(selector)
      expect(body).toMatch(/overflow: hidden;/)
      expect(body).toMatch(/text-overflow: ellipsis;/)
      expect(body).toMatch(/white-space: nowrap;/)
    },
  )

  it('the flexible title cells can shrink below their text width', () => {
    for (const selector of ['.wb-ov-row-title', '.wb-work-title', '.wb-pane-text', '.wb-ov-meet']) {
      expect(rule(selector), selector).toMatch(/min-width: 0;/)
    }
  })
})
```

- [ ] **Step 3: Thêm test cấu trúc Công việc thất bại**

Nối vào `apps/shell/tests/work-tasks-pane.test.ts` (file đã import `UniworkWorkError`, `UniworkWorkResult`, `WorkTask`; trạng thái rỗng đã được test ở Task 2):

```ts
async function mountWithHead(
  workspace: UniworkWorkspaceRef | null,
  workspaceError: UniworkWorkError | null = null,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkTasksPane, {
          workspace,
          workspaceError,
          onReload,
          head: { module: 'tasks', title: 'Tasks' },
        }),
      ),
    )
  })
  await flush()
}

describe('Tasks tab layout (redesign spec 4.3)', () => {
  it('quick add is the first row of the list block; rows are grouped, keyed in mono, no table', async () => {
    await mount({ ...WS, id: 'w-layout' })
    expect(host.querySelector('table')).toBeNull()
    const block = host.querySelector('.wb-block')!
    expect(block.firstElementChild?.classList.contains('wb-work-quick')).toBe(true)
    expect(block.querySelector('.wb-work-quick-plus')).not.toBeNull()
    expect(host.querySelector('.wb-work-quick button[type="submit"]')?.className).toBe(
      'wb-btn wb-btn-primary wb-btn-sm',
    )
    expect(host.querySelector('.wb-group-head')?.textContent).toBe('Today 1')
    expect(host.querySelector('.wb-work-row .wb-mono')?.textContent).toBe('OPS-7')
    expect(host.querySelector('.wb-work-row .wb-pill.is-status')?.textContent).toBe('To do')
    expect(checkbox().classList.contains('uw-sr-only')).toBe(true)
    expect(checkbox().closest('label.wb-check')?.querySelector('.wb-check-box')).not.toBeNull()
  })

  it('with a head: the aside counts open tasks once the list has loaded', async () => {
    await mountWithHead({ ...WS, id: 'w-head' })
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-title')?.textContent).toBe('Tasks')
    expect(host.querySelector('.wb-pane-aside')?.textContent).toBe('Open: 1')
  })

  it('with a head: no count while loading, the header stays above the skeleton', async () => {
    api.myTasks.mockImplementationOnce(
      () => new Promise<UniworkWorkResult<WorkTask[]>>(() => undefined),
    )
    await mountWithHead({ ...WS, id: 'w-head-pending' })
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-aside')).toBeNull()
    expect(host.querySelector('.wb-work-skeleton')).not.toBeNull()
  })

  it('with a head: signed out still shows the header above the sign-in panel', async () => {
    await mountWithHead(null, 'signed-out')
    expect(host.querySelector('.wb-pane-head + *')?.textContent).toContain(
      'Sign in to see your work',
    )
  })
})
```

Các giá trị `OPS-7`, 'To do', 'Today 1' lấy từ fixture `TASK` và catalogue trạng thái của file test; nếu fixture khác, dùng giá trị của fixture.

- [ ] **Step 4: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/workbench-module-pane.test.ts tests/work-tasks-pane.test.ts tests/workbench-foundation.test.ts`
Expected: FAIL.

- Khung tab: chưa có `section.wb-pane`, `<h2>` vẫn nằm trong `wb-panel wb-detail`.
- Bố cục Công việc: `table` khác null, thiếu `.wb-block` và `.wb-pane-head`.
- Cắt chữ: `.wb-work-title` chưa có đủ ba khai báo (nếu bản cũ đã có thì test này qua sẵn; nó là test khóa hồi quy).
- Các test Công việc cũ vẫn PASS.

- [ ] **Step 5: Đổi `WorkbenchModulePane`**

Trong `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`, thêm import này dưới `import { WorkTasksPane } from './WorkTasksPane'`:

```tsx
import { WorkPaneHeader } from './WorkPaneHeader'
```

Rồi thay toàn bộ thân hàm `WorkbenchModulePane`, từ `const mod = getWorkbenchModule(moduleId)` tới dấu `}` đóng hàm, bằng:

```tsx
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
```

Đối chiếu với thân cũ trước khi thay: mọi nhánh module và mọi prop truyền xuống pane con phải còn đủ.

- [ ] **Step 6: Viết lại `WorkTasksPane.tsx`**

Thay `apps/shell/src/renderer/src/WorkTasksPane.tsx` bằng đoạn dưới. Logic tải, tick lạc quan, thêm việc và Retry giữ nguyên từng dòng; chỉ phần JSX đổi. So với bản cũ trước khi thay và giữ mọi logic không có ở đây.

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { WorkCreateTaskInput, WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES } from './module-tones'
import { settleWork, useWorkLoad } from './work-cache'
import { formatDay } from './work-home'
import { closedStatusKeys, groupTasksByDue, localIsoDate, type TaskDueGroup } from './work-tasks'
import { WorkbenchIcon } from './WorkbenchIcons'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  WorkToast,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WorkPaneHeader, type WorkPaneHeaderProps } from './WorkPaneHeader'

const GROUP_LABEL: Record<TaskDueGroup, StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
  week: 'wbTasksGroupWeek',
  later: 'wbTasksGroupLater',
  none: 'wbTasksGroupNone',
}

/** A write the server refused: a toast whose Retry repeats the same request (spec §7). */
interface WriteFailure {
  message: StringKey
  retry: () => void
}

/**
 * Tasks tab: the signed-in user's UniWork tasks in the active workspace,
 * grouped by due date (device-local today) in one list block whose first row
 * is quick add. Ticking a row sets its status (optimistic, put back on
 * failure); a title opens the task on the web.
 */
export function WorkTasksPane({
  workspace,
  workspaceError,
  onReload,
  head,
}: WorkPaneProps & {
  /** the tab header, drawn here so its aside can count the loaded list (WorkbenchModulePane passes it) */
  head?: Omit<WorkPaneHeaderProps, 'aside'>
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const wsRef = useRef(wsId)
  wsRef.current = wsId
  const list = useWorkLoad<WorkTask[]>(wsId ? `tasks:${wsId}` : null, () =>
    window.uniworkWork.myTasks(wsId ?? ''),
  )
  // the catalogue only names statuses: rows still show (by key) while it is missing
  const catalogue = useWorkLoad<WorkTaskStatus[]>(wsId ? `taskStatuses:${wsId}` : null, () =>
    window.uniworkWork.taskStatuses(wsId ?? ''),
  )
  // ticked this session: stays listed (dimmed) until the next load, like the web
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [failure, setFailure] = useState<WriteFailure | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setTouched(new Set())
  }, [list.updatedAt])
  useEffect(() => {
    setFailure(null)
  }, [wsId])

  const closed = useMemo(() => closedStatusKeys(catalogue.value ?? []), [catalogue.value])
  const statusName = useMemo(
    () => new Map((catalogue.value ?? []).map((s) => [s.key, s.name])),
    [catalogue.value],
  )

  const setRowStatus = (id: string, status: string) =>
    list.update((rows) => rows.map((x) => (x.id === id ? { ...x, status } : x)))

  const setDone = async (task: WorkTask, done: boolean): Promise<void> => {
    const next = done ? 'done' : 'todo'
    setFailure(null)
    setTouched((cur) => new Set(cur).add(task.id))
    setRowStatus(task.id, next)
    const r = await settleWork(window.uniworkWork.setTaskStatus(task.id, next))
    if (r.ok) {
      list.update((rows) => rows.map((x) => (x.id === task.id ? r.value : x)))
      return
    }
    setRowStatus(task.id, task.status)
    setFailure({ message: 'wbTasksSaveFailed', retry: () => void setDone(task, done) })
  }

  const create = async (input: WorkCreateTaskInput): Promise<void> => {
    setFailure(null)
    setAdding(true)
    const r = await settleWork(window.uniworkWork.createTask(input))
    setAdding(false)
    if (input.workspaceId !== wsRef.current) return
    if (r.ok) {
      setDraft('')
      list.update((rows) => [r.value, ...rows])
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

  const openCount = (list.value ?? []).filter((x) => !closed.has(x.status)).length
  const header = head ? (
    <WorkPaneHeader
      {...head}
      aside={
        list.value ? (
          <span className="wb-num">{t('wbTasksOpenCount', { count: openCount })}</span>
        ) : undefined
      }
    />
  ) : null

  if (!workspace) {
    return (
      <>
        {header}
        <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
      </>
    )
  }
  const blocked = workLoadState(list)
  if (blocked) {
    return (
      <>
        {header}
        {blocked}
      </>
    )
  }

  const today = localIsoDate(new Date())
  const groups = groupTasksByDue(
    (list.value ?? []).filter((x) => !closed.has(x.status) || touched.has(x.id)),
    today,
  )
  const openOnWeb = (task: WorkTask) =>
    void window.uniworkWork
      .openWeb({ kind: 'task', orgSlug: workspace.orgSlug, wsSlug: workspace.slug, id: task.id })
      .catch(() => false)

  return (
    <>
      {header}
      <div className="wb-work">
        {list.stale && list.updatedAt !== null ? (
          <WorkStaleNote at={list.updatedAt} onRetry={onReload} />
        ) : null}
        <div className="wb-block">
          <form className="wb-row wb-work-quick" onSubmit={submit}>
            <span className="wb-work-quick-plus" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 1.5v7M1.5 5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('wbTasksQuickAdd')}
              aria-label={t('wbTasksQuickAdd')}
              disabled={adding}
            />
            <button
              type="submit"
              className="wb-btn wb-btn-primary wb-btn-sm"
              disabled={adding || !draft.trim()}
            >
              {t('wbTasksAdd')}
            </button>
          </form>
          {groups.map(({ group, tasks: rows }) => (
            <section key={group} className="wb-work-group">
              <h3 className={`wb-group-head${group === 'overdue' ? ' is-overdue' : ''}`}>
                {t(GROUP_LABEL[group])} <span className="wb-num">{rows.length}</span>
              </h3>
              <ul>
                {rows.map((task) => {
                  const done = closed.has(task.status)
                  const day = task.due_date?.slice(0, 10)
                  return (
                    <li key={task.id} className={`wb-row wb-work-row${done ? ' is-done' : ''}`}>
                      <label className="wb-check">
                        <input
                          type="checkbox"
                          className="uw-sr-only"
                          checked={done}
                          aria-label={t(done ? 'wbTasksReopen' : 'wbTasksMarkDone', {
                            title: task.title,
                          })}
                          onChange={(e) => void setDone(task, e.target.checked)}
                        />
                        <span className="wb-check-box" aria-hidden="true">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M3.5 8.5l3 3 6-7"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="wb-work-title"
                        title={t('wbWorkOpenOnWeb')}
                        onClick={() => openOnWeb(task)}
                      >
                        {task.title}
                      </button>
                      <span className="wb-mono">{task.identifier}</span>
                      <span className="wb-pill is-status">
                        {statusName.get(task.status) ?? task.status}
                      </span>
                      {day ? (
                        <span
                          className={`wb-pill wb-num${day < today ? ' is-danger' : day === today ? ' is-warning' : ''}`}
                        >
                          {day === today
                            ? t('wbTasksGroupToday')
                            : formatDay(day, dateLocale, false)}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        {groups.length === 0 ? (
          <WorkStatePanel
            tone={MODULE_TONES.tasks}
            icon={<WorkbenchIcon id="tasks" size={20} />}
            title={t('wbTasksEmpty')}
          />
        ) : null}
        {failure ? (
          <WorkToast
            message={failure.message}
            onRetry={failure.retry}
            onDismiss={() => setFailure(null)}
          />
        ) : null}
      </div>
    </>
  )
}
```

- [ ] **Step 7: Cho form Notes lớp riêng**

Trong `apps/shell/src/renderer/src/NotesPane.tsx`, đổi `<form className="wb-work-quick" onSubmit={add}>` thành `<form className="wb-notes-add" onSubmit={add}>`. Không đổi gì khác trong task này.

- [ ] **Step 8: Cập nhật CSS**

Trong `apps/shell/src/renderer/src/home.css`, mục `/* ── Workbench server tabs (Tasks / Calendar / Profile)…`.

**Xóa** trọn các khối: `.wb-work-quick { display: flex; gap: 8px; }`, `.wb-work-quick input { … }`, `.wb-work-quick input:focus { … }`, `.wb-work-table { … }`, `.wb-work-table th, .wb-work-table td { … }`, `.wb-work-table thead th { … }`, `.wb-work-group th { … }`, `.wb-work-group.is-overdue th { … }`, `.wb-work-check { … }`, `.wb-work-title { … }`, `.wb-work-title:hover { … }`.

**Chèn** vào chỗ đó, ngay trước `.wb-work-row.is-done .wb-work-title`:

```css
.wb-work-quick:focus-within {
  box-shadow: inset 2px 0 0 var(--accent);
}

.wb-work-quick-plus {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px dashed var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
}

.wb-work-quick input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-work-group {
  border-top: 1px solid var(--border-subtle);
}

.wb-work-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-work-row .wb-mono,
.wb-work-row .wb-pill {
  flex: none;
}

.wb-pill.is-status {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}

.wb-check-box svg {
  opacity: 0;
}

.wb-check input:checked + .wb-check-box svg {
  opacity: 1;
}

.wb-work-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.wb-work-title:hover {
  text-decoration: underline;
}

.wb-work-title:focus-visible {
  border-radius: 2px;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Trong mục Local-only tabs, chèn ngay sau khối `.wb-notes { … }`:

```css
.wb-notes-add {
  display: flex;
  gap: 8px;
}

.wb-notes-add input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-notes-add input:focus {
  border-color: var(--accent);
  outline: none;
}

.wb-notes-add .wb-btn {
  height: 36px;
}
```

- [ ] **Step 9: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/workbench-module-pane.test.ts tests/work-tasks-pane.test.ts tests/workbench-foundation.test.ts tests/workbench-forms-notice.test.ts`
Expected: PASS (3 test khung tab; 16 test Công việc: 11 có sẵn, 1 của Task 2, 4 mới; 20 test foundation; 1 test forms-notice).

- [ ] **Step 10: Kiểm tra**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/workbench-module-pane.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/workbench-module-pane.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
```

Expected: mọi lệnh thoát 0.

- [ ] **Step 11: Commit**

```bash
git add apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/WorkTasksPane.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/home.css apps/shell/src/renderer/src/i18n/workbench/zh.ts apps/shell/src/renderer/src/i18n/workbench/en.ts apps/shell/src/renderer/src/i18n/workbench/vi.ts apps/shell/tests/workbench-module-pane.test.ts apps/shell/tests/work-tasks-pane.test.ts apps/shell/tests/workbench-foundation.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Workbench tabs lose the second card; Tasks becomes a grouped list

WorkbenchModulePane renders WorkPaneHeader (module tile, title, hint as
meta, device tag on local tabs) instead of the wb-panel card and its
duplicate H2. Tasks draws the header itself so the aside can show the
open count once loaded; quick add is the first row of the list block.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Tiêu đề ngày của Lịch và thẻ Hồ sơ

**Files:**

- Modify:
  - `apps/shell/src/renderer/src/WorkCalendarPane.tsx` (câu `return` cuối)
  - `apps/shell/src/renderer/src/WorkProfilePane.tsx` (thay cả file)
  - `apps/shell/src/renderer/src/home.css` (rule agenda và profile)
- Modify (test): `apps/shell/tests/work-calendar-pane.test.ts` (giữ: `.wb-agenda-icon[aria-label]` theo thứ tự Task rồi Meeting, nút `.wb-agenda-row`, chữ 'All day' và 'Today'), `apps/shell/tests/work-profile-pane.test.ts` (giữ: không có `input`/`textarea`, chữ đúng 'Edit on the web', 'Couldn’t load' kèm Retry).

**Interfaces:**

- Consumes: `WorkStatePanel`, `WorkbenchIcon`, `MODULE_TONES.calendar`, `MODULE_TONES.personal` (`pink`), `tintStyle`, `greetingName` (Task 2), `.wb-block`, `.wb-num`, `.wb-mono`, `.wb-btn-secondary`.
- Produces:
  - Markup Lịch: `h3.wb-agenda-head` (+`.is-today`) chứa `span.wb-agenda-dot` và `span.wb-num`; các dòng nằm trong `ul.wb-block`; cột giờ đứng đầu dòng.
  - Markup Hồ sơ: `section.wb-block.wb-profile-card` chứa `.wb-profile-id`, `.wb-profile-avatar`, `.wb-profile-name`, `p.wb-profile-title`. Chức danh thành caption dưới tên nên bỏ dòng `wbProfileJobTitle` khỏi `dl` để không lặp.
- Import của `WorkCalendarPane.tsx` đã đủ sau Task 2 (`WorkStatePanel`, `WorkbenchIcon`); task này không đổi import của file đó.

- [ ] **Step 1: Viết test Lịch thất bại**

Nối vào trong `describe('Calendar tab', …)` của `apps/shell/tests/work-calendar-pane.test.ts`:

```ts
it('day heads are sticky heads; today has the dot; clock times are mono and lead the row', async () => {
  await mount()
  const head = host.querySelector('.wb-agenda-day > h3')!
  expect(head.classList.contains('wb-agenda-head')).toBe(true)
  expect(head.classList.contains('is-today')).toBe(true)
  expect(head.querySelector('.wb-agenda-dot')).not.toBeNull()
  expect(head.textContent).toContain('Today · ')
  expect(host.querySelector('.wb-agenda-day > ul')?.classList.contains('wb-block')).toBe(true)
  const rows = Array.from(host.querySelectorAll('.wb-agenda-row'))
  for (const row of rows) {
    expect(row.firstElementChild?.classList.contains('wb-agenda-time')).toBe(true)
  }
  expect(host.querySelectorAll('.wb-agenda-time.wb-mono')).toHaveLength(1)
  expect(host.querySelector('.wb-agenda-time:not(.wb-mono)')?.textContent).toBe('All day')
})

it('nothing in the next 14 days: the empty state panel', async () => {
  api.calendarEvents.mockResolvedValueOnce({ ok: true as const, value: [] })
  await mount()
  expect(host.querySelector('.wb-state')?.textContent).toContain(
    'No tasks or meetings in the next 14 days.',
  )
  expect(host.querySelector('.wb-work-state')).toBeNull()
})
```

- [ ] **Step 2: Viết test Hồ sơ thất bại**

Nối vào trong `describe('Profile tab', …)` của `apps/shell/tests/work-profile-pane.test.ts`:

```ts
it('a card: initial tile, name, job title as caption, fields in a grid, a secondary web button', async () => {
  await mount()
  expect(host.querySelector('section.wb-block.wb-profile-card')).not.toBeNull()
  expect(host.querySelector('.wb-profile-avatar')?.textContent).toBe('L')
  expect(host.querySelector('.wb-profile-name')?.textContent).toBe('Lan Nguyen')
  expect(host.querySelector('.wb-profile-title')?.textContent).toBe('Sales lead')
  expect(host.querySelector('dl.wb-profile')?.textContent).not.toContain('Job title')
  expect(buttonByText('Edit on the web')!.className).toBe('wb-btn wb-btn-secondary')
})

it('a Vietnamese name shows the given-name initial', async () => {
  api.myProfile.mockResolvedValueOnce({
    ok: true,
    value: { ...PERSON, display_name: 'Nguyễn Văn An' },
  })
  await mount({ ...WS, orgId: 'o-vi' })
  expect(host.querySelector('.wb-profile-avatar')?.textContent).toBe('A')
})
```

Tên hiển thị 'Lan Nguyen' và chức danh 'Sales lead' lấy từ fixture `PERSON` của file test; `orgId: 'o-vi'` tránh cache `profile:<orgId>` của test trước.

- [ ] **Step 3: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/work-calendar-pane.test.ts tests/work-profile-pane.test.ts`
Expected: FAIL. Lịch: `wb-agenda-head` là false (test rỗng đã qua nhờ Task 2). Hồ sơ: `.wb-profile-card` null. Các test cũ PASS.

- [ ] **Step 4: Đổi `WorkCalendarPane.tsx`**

Thay câu `return ( <div className="wb-work"> … </div> )` cuối của `WorkCalendarPane` bằng:

```tsx
  return (
    <div className="wb-work">
      {load.stale && load.updatedAt !== null ? (
        <WorkStaleNote at={load.updatedAt} onRetry={onReload} />
      ) : null}
      {days.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.calendar}
          icon={<WorkbenchIcon id="calendar" size={20} />}
          title={t('wbCalEmpty')}
        />
      ) : (
        days.map(({ day, events: rows }) => (
          <section key={day} className="wb-agenda-day">
            <h3 className={`wb-agenda-head${day === today ? ' is-today' : ''}`}>
              {day === today ? (
                <>
                  <span className="wb-agenda-dot" aria-hidden="true" />
                  {`${t('wbTasksGroupToday')} · `}
                </>
              ) : null}
              <span className="wb-num">{formatDay(day, dateLocale, true)}</span>
            </h3>
            <ul className="wb-block">
              {rows.map((e) => {
                const kind = kindOf(e)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="wb-agenda-row"
                      title={t('wbWorkOpenOnWeb')}
                      onClick={() =>
                        void window.uniworkWork.openWeb(webTarget(e, workspace)).catch(() => false)
                      }
                    >
                      {e.all_day ? (
                        <span className="wb-agenda-time">{t('wbCalAllDay')}</span>
                      ) : (
                        <span className="wb-agenda-time wb-mono">
                          {clock(rowTime(e), dateLocale)}
                        </span>
                      )}
                      <span
                        className="wb-agenda-icon"
                        style={tintStyle(KIND[kind].tint)}
                        role="img"
                        aria-label={t(KIND[kind].label)}
                      >
                        <KindIcon kind={kind} />
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

Tên biến (`days`, `today`, `kindOf`, `webTarget`, `KIND`, `KindIcon`, `load`) phải khớp với phần thân hiện có của hàm; nếu khác, dùng tên hiện có.

- [ ] **Step 5: Viết lại `WorkProfilePane.tsx`**

Thay `apps/shell/src/renderer/src/WorkProfilePane.tsx` bằng (logic tải giữ nguyên, so với bản cũ trước khi thay):

```tsx
import { Fragment } from 'react'
import type { ReactElement } from 'react'
import type { WorkPerson } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES, tintStyle } from './module-tones'
import { useWorkLoad } from './work-cache'
import { greetingName } from './work-home'
import { WorkNoWorkspace, WorkStaleNote, workLoadState, type WorkPaneProps } from './WorkErrorState'

/** Profile tab: the signed-in user's UniWork profile, read-only; edits happen on the web. */
export function WorkProfilePane({
  workspace,
  workspaceError,
  onReload,
}: WorkPaneProps): ReactElement {
  const { t } = useI18n()
  const orgId = workspace?.orgId ?? null
  // one profile per org; the Forms compose merge reads the same key (form-merge.ts)
  const load = useWorkLoad<WorkPerson>(orgId ? `profile:${orgId}` : null, () =>
    window.uniworkWork.myProfile(),
  )

  if (!workspace) return <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
  const person = load.value
  const blocked = workLoadState(load)
  // workLoadState answers whenever there is no person yet
  if (blocked || !person) return blocked ?? <></>

  // the job title is the caption under the name, so it is not repeated here
  const rows: [StringKey, string][] = [
    ['wbProfileDepartment', person.department?.name ?? ''],
    ['wbProfileManager', person.manager?.display_name ?? ''],
    ['wbProfileEmail', person.email],
    ['wbProfileTimezone', person.timezone],
  ]

  return (
    <div className="wb-work">
      {load.stale && load.updatedAt !== null ? (
        <WorkStaleNote at={load.updatedAt} onRetry={onReload} />
      ) : null}
      <section className="wb-block wb-profile-card">
        <div className="wb-profile-id">
          <span
            className="wb-profile-avatar"
            style={tintStyle(MODULE_TONES.personal)}
            aria-hidden="true"
          >
            {greetingName(person.display_name).charAt(0).toUpperCase()}
          </span>
          <div>
            <strong className="wb-profile-name">{person.display_name}</strong>
            {person.title ? <p className="wb-profile-title">{person.title}</p> : null}
          </div>
        </div>
        <dl className="wb-profile">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{t(label)}</dt>
              <dd>{value || '—'}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
      <p className="wb-work-muted">{t('wbProfileHint')}</p>
      <div>
        <button
          type="button"
          className="wb-btn wb-btn-secondary"
          onClick={() =>
            void window.uniworkWork
              .openWeb({
                kind: 'person',
                orgSlug: workspace.orgSlug,
                wsSlug: workspace.slug,
                id: person.user_id,
              })
              .catch(() => false)
          }
        >
          {t('wbProfileEditOnWeb')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Cập nhật CSS**

Trong `apps/shell/src/renderer/src/home.css`, mục server tabs:

1. **Xóa** khối `.wb-agenda-day h3 { … }` và chèn vào chỗ đó:

```css
.wb-agenda-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 6px 0;
  background: var(--bg-content);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
}

.wb-agenda-head.is-today {
  color: var(--text);
}

.wb-agenda-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
```

2. Ngay sau khối `.wb-agenda-day ul { … }`, chèn:

```css
.wb-agenda-day li + li {
  border-top: 1px solid var(--border-subtle);
}
```

3. **Thay** khối `.wb-agenda-row { … }` và `.wb-agenda-row:hover { … }` bằng:

```css
.wb-agenda-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: start;
  cursor: pointer;
}

.wb-agenda-row:hover {
  background: var(--wb-row-hover);
}

.wb-agenda-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

4. Trong `.wb-agenda-icon`, đổi `width: 18px;` thành `width: 20px;` và `height: 18px;` thành `height: 20px;`.

5. **Thay** khối `.wb-agenda-time { … }` bằng:

```css
.wb-agenda-time {
  flex: none;
  width: 64px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
```

6. **Thay** các khối `.wb-profile-name { … }`, `.wb-profile { … }`, `.wb-profile dt { … }` bằng (giữ `.wb-profile dd`):

```css
.wb-profile-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 640px;
  padding: 20px;
}

.wb-profile-id {
  display: flex;
  align-items: center;
  gap: 14px;
}

.wb-profile-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-12);
  font-size: 20px;
  font-weight: 600;
}

.wb-profile-name {
  display: block;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.wb-profile-title {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.wb-profile {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 8px 24px;
  margin: 0;
  font-size: 13px;
}

.wb-profile dt {
  color: var(--text-secondary);
  font-size: 12px;
}
```

- [ ] **Step 7: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/work-calendar-pane.test.ts tests/work-profile-pane.test.ts`
Expected: PASS.

- [ ] **Step 8: Kiểm tra**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/WorkProfilePane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-calendar-pane.test.ts apps/shell/tests/work-profile-pane.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/WorkProfilePane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-calendar-pane.test.ts apps/shell/tests/work-profile-pane.test.ts
```

Expected: mọi lệnh thoát 0.

- [ ] **Step 9: Commit**

```bash
git add apps/shell/src/renderer/src/WorkCalendarPane.tsx apps/shell/src/renderer/src/WorkProfilePane.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/work-calendar-pane.test.ts apps/shell/tests/work-profile-pane.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Calendar sticky day heads and a Profile card

Calendar days get a sticky head (accent dot and "Today" on today) over a
list block whose rows lead with a mono time or "All day". Profile becomes
one card: a 48px initial tile from the given name, the name, the job title
as caption, the fields in a two-column grid and a secondary web button.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Biểu mẫu, Ghi chú, Tri thức và các trụ cột; bỏ viền đứt và pill cuối cùng

**Files:**

- Modify:
  - `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (import và câu `return` của `FormsPane`)
  - `apps/shell/src/renderer/src/NotesPane.tsx` (thay cả file)
  - `apps/shell/src/renderer/src/PracticeHome.tsx` (các phần trụ cột)
  - `apps/shell/src/renderer/src/home.css`
- Create (test): `apps/shell/tests/workbench-local-panes.test.ts`, `apps/shell/tests/workbench-knowledge.test.ts`, `apps/shell/tests/workbench-surfaces.test.ts`
- Phải luôn xanh: `workbench-forms-notice.test.ts` (chữ nút 'Upload template file…' và câu báo, giờ nằm trong `p.wb-hint` dưới hàng thêm), `workbench-copy.test.ts` (không có `label(` hay `const label = ` trong `PracticeHome.tsx`, `WorkbenchModulePanes.tsx`).

**Interfaces:**

- Consumes: `WorkPaneHeader`, `WorkStatePanel`, `WorkbenchIcon`, `MODULE_TONES`, `WbRowActions`, `WbDeleteBtn`, `WbEditBtn`, `WbFileBtn`, `WbDraftBtn`, `LocalTag`, `.wb-block`, `.wb-row`, `.wb-row-actions`, `.wb-btn-*`, `.wb-num`.
- Produces:
  - Lớp `.wb-forms-hint`, `.wb-forms-add`, `.wb-forms-title`, `.wb-forms-note`, `.wb-forms-list`, `.wb-forms-text`, `.wb-forms-locked`, `.wb-notes-text`, `.wb-notes-edited`, `.wb-kn-search`, `.wb-cmp`.
  - Tiêu đề trụ cột: `<WorkPaneHeader module={pillar.id} … aside={<LocalTag />} />`, vẽ một lần trên trụ cột đang mở.
  - Test khóa: `.wb-work-quick-plus` là rule Bàn làm việc duy nhất có viền đứt; không rule nào có bo pill, bóng nâng hay nhấc khi hover.
- Quyết định đã chốt:
  - Hàng thêm Biểu mẫu bỏ nhãn hiển thị để vừa một hàng; `aria-label` và placeholder của mỗi ô mang chữ nhãn. `wbFormsTitlePlaceholder` không còn dùng nhưng vẫn giữ trong từ điển.
  - Câu "Chọn gói ở Tri thức trước khi soạn" (`.wb-forms-locked`) đứng ngay trước `WbRowActions`, ngoài nhóm thao tác ẩn theo hover, để luôn thấy khi nút Soạn bị khóa.
  - `.wb-subtab*` đã xóa ở Task 1, `.wb-work-state*` đã xóa ở Task 2; task này không làm lại.

- [ ] **Step 1: Viết test Biểu mẫu và Ghi chú thất bại**

Tạo `apps/shell/tests/workbench-local-panes.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchModuleId } from '@uniwork/practice-core'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
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

import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchModulePane } from '../src/renderer/src/WorkbenchModulePanes'
import { createStickyNote, writeForms } from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(moduleId: WorkbenchModuleId, packId: string | null = null) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkbenchModulePane, {
          moduleId,
          practiceId: 'sales',
          vi: false,
          packId,
          workspace: null,
          workspaceError: null,
          onReload: () => undefined,
        }),
      ),
    )
  })
}

describe('Forms tab (redesign spec 4.6)', () => {
  it('one add row, a one-line hint, the empty state panel and no pill button', async () => {
    await mount('forms')
    expect(host.querySelector('.wb-forms-hint')).not.toBeNull()
    const add = host.querySelector('.wb-forms-add')!
    expect(
      Array.from(add.querySelectorAll('input')).map((i) => i.getAttribute('aria-label')),
    ).toEqual(['Form title', 'Note (optional)'])
    expect(add.querySelector('.wb-btn-secondary')?.textContent).toBe('Upload template file…')
    expect(add.querySelector('.wb-btn-primary')?.textContent).toBe('Add to library')
    expect(host.querySelector('.btn')).toBeNull()
    expect(host.querySelector('.wb-state')?.textContent).toContain('No forms yet.')
  })

  it('a saved form is a list row; with no pack the hint shows beside the locked Draft, outside the hover-only actions', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request', note: 'HR' }])
    await mount('forms')
    const row = host.querySelector('.wb-block > li.wb-row')!
    expect(row.querySelector('.wb-forms-text')?.textContent).toBe('Leave requestHR')
    expect(row.querySelector(':scope > .wb-forms-locked')?.textContent).toBe(
      'Select a Knowledge pack before drafting.',
    )
    expect(row.querySelector('.wb-row-actions .wb-forms-locked')).toBeNull()
    expect(row.querySelector<HTMLButtonElement>('button[aria-label="Draft"]')!.disabled).toBe(true)
  })

  it('with a pack selected, Draft is enabled and the hint is gone', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request' }])
    await mount('forms', 'p1')
    expect(host.querySelector('.wb-forms-locked')).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Draft"]')!.disabled).toBe(
      false,
    )
  })
})

describe('Notes tab (redesign spec 4.7)', () => {
  it('empty: the state panel and a primary Add note button', async () => {
    await mount('notes')
    expect(host.querySelector('.wb-notes-add .wb-btn-primary')?.textContent).toBe('Add note')
    expect(host.querySelector('.wb-state')?.textContent).toContain('No notes yet.')
  })

  it('a note is a list row with an edited caption; delete is a row action', async () => {
    createStickyNote('sales', 'Call the notary')
    await mount('notes')
    const row = host.querySelector('.wb-block > li.wb-row.wb-notes-card')!
    expect(row.querySelector('textarea')?.value).toBe('Call the notary')
    expect(row.querySelector('.wb-notes-edited')?.textContent).toMatch(/^Edited /)
    await act(async () =>
      row
        .querySelector<HTMLButtonElement>('.wb-row-actions button[aria-label="Delete note"]')!
        .click(),
    )
    expect(host.querySelector('.wb-notes-card')).toBeNull()
    expect(host.querySelector('.wb-state')?.textContent).toContain('No notes yet.')
  })
})
```

Các chuỗi tiếng Anh ('Form title', 'Note (optional)', 'Add to library', 'No forms yet.', 'Select a Knowledge pack before drafting.', 'Add note', 'No notes yet.', 'Edited …', 'Delete note', 'Draft') phải khớp `i18n/workbench/en.ts`; nếu khác, dùng chuỗi trong `en.ts`.

- [ ] **Step 2: Viết test Tri thức thất bại**

Tạo `apps/shell/tests/workbench-knowledge.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { HomeApi, ProjectSummaryEntry } from '../src/shared/home-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
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

import { LocaleProvider } from '../src/renderer/src/locale'
import { PracticeHome } from '../src/renderer/src/PracticeHome'
import { pinPillar } from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PRACTICE = requirePractice('entrepreneur')
const KNOWLEDGE = PRACTICE.pillars.find((p) => p.id === 'knowledge')!
const PACK = {
  id: 'p1',
  name: 'Acme deal',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  fileCount: 2,
  lastActiveAt: '2026-10-12T00:00:00Z',
  isDefault: false,
  kind: PRACTICE.projectKind,
  practice: {
    practiceId: PRACTICE.id,
    title: 'Acme deal',
    facets: {},
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
} as unknown as ProjectSummaryEntry

let host: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  store.clear()
  pinPillar(PRACTICE.id, 'knowledge')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    uniworkListWorkspaces: vi.fn(async () => ({ ok: true, value: [] })),
    accountStatus: vi.fn(async () => ({
      loggedIn: true,
      state: 'signed-in',
      profile: { accountId: 'u1', email: 'linh@acme.vn', displayName: 'Linh' },
    })),
    accountLogin: vi.fn(async () => true),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(async () => ({ ok: false, error: 'offline' })),
    setTaskStatus: vi.fn(),
    openWeb: vi.fn(async () => true),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function openKnowledge(projects: ProjectSummaryEntry[], selectedId: string | null) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(PracticeHome, {
          practice: PRACTICE,
          projects,
          selectedId,
          onSelectPack: vi.fn(),
          onOpenPackFiles: vi.fn(),
          onRefresh: vi.fn(),
          onSwitchPractice: vi.fn(),
          newItems: [],
        }),
      ),
    )
  })
  await flush()
  const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('button.wb-tab')).find((b) =>
    b.textContent?.includes(KNOWLEDGE.labelEn),
  )
  expect(tab, 'Knowledge tab').toBeTruthy()
  await act(async () => tab!.click())
  await flush()
}

describe('Knowledge pillar (redesign spec 4.8)', () => {
  it('a pane header, a search box with a leading icon and an empty library panel', async () => {
    await openKnowledge([], null)
    expect(host.querySelector('.wb-pane-title')?.textContent).toBe(KNOWLEDGE.labelEn)
    expect(host.querySelector('.wb-pane-aside .wb-local-tag')).not.toBeNull()
    const search = host.querySelector<HTMLInputElement>('.wb-kn-search input')!
    expect(search.getAttribute('aria-label')).toBe('Search')
    expect(search.placeholder).toBe('Title, tags, notes…')
    expect(host.querySelector('.wb-kn-search svg')).not.toBeNull()
    expect(host.querySelector('.wb-packs .wb-count')?.textContent).toBe('0')
    expect(host.querySelector('.wb-packs .wb-state')?.textContent).toContain(
      'No packs yet. Create in Compose.',
    )
    expect(host.querySelector('.wb-panel')).toBeNull()
  })

  it('a selected pack: flat buttons in the detail, no pill or black button', async () => {
    await openKnowledge([PACK], 'p1')
    expect(host.querySelector('.wb-packs .wb-count')?.textContent).toBe('1')
    expect(host.querySelector('section.wb-pane .btn')).toBeNull()
    expect(host.querySelectorAll('.wb-detail .wb-btn-secondary')).toHaveLength(3)
    expect(host.querySelector('.wb-detail .wb-btn-primary')?.textContent).toBe('Save')
  })
})
```

Nếu `PracticeHome` gọi thêm hàm bridge nào lúc mount (sau Task 4–5), thêm hàm đó vào mock; nếu chuỗi `wbKnSearch`, `wbKnSearchPlaceholder`, `wbKnEmpty` trong `en.ts` khác, dùng chuỗi trong `en.ts`.

- [ ] **Step 3: Viết test dọn CSS và markup thất bại**

Tạo `apps/shell/tests/workbench-surfaces.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../src/renderer/src')
const css = readFileSync(join(SRC, 'home.css'), 'utf8')

/** every innermost `selector { body }` rule whose selector names a Workbench class */
function workbenchRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (/\.wb-|\.skill-domain-/.test(selector)) out.push({ selector, body: m[2]! })
  }
  return out
}

describe('Workbench surfaces (redesign spec 2.2, 2.4, 5)', () => {
  it('the quick-add plus box is the only dashed border left', () => {
    const dashed = workbenchRules()
      .filter((r) => /dashed/.test(r.body))
      .map((r) => r.selector)
    expect(dashed).toEqual(['.wb-work-quick-plus'])
  })

  it('no pill radius, lifted button shadow or hover lift is left', () => {
    const banned =
      /--shadow-btn\b|--shadow-btn-lift|--shadow-btn-primary|--shadow-pill|--radius-16|--radius-30|999px|translateY\(/
    const left = workbenchRules()
      .filter((r) => banned.test(r.body))
      .map((r) => r.selector)
    expect(left).toEqual([])
  })

  it.each([
    'WorkTasksPane.tsx',
    'WorkCalendarPane.tsx',
    'NotesPane.tsx',
    'WorkErrorState.tsx',
    'WorkbenchModulePanes.tsx',
    'PracticeHome.tsx',
  ])('%s no longer uses the dashed state box or the panel card', (file) => {
    const src = readFileSync(join(SRC, file), 'utf8')
    expect(src).not.toContain('wb-work-state')
    expect(src).not.toContain('wb-panel')
  })

  it('pillar and module tabs use the Workbench buttons (the skill-confirm modal keeps .btn)', () => {
    const panes = readFileSync(join(SRC, 'WorkbenchModulePanes.tsx'), 'utf8')
    const notes = readFileSync(join(SRC, 'NotesPane.tsx'), 'utf8')
    const home = readFileSync(join(SRC, 'PracticeHome.tsx'), 'utf8')
    expect(panes).not.toMatch(/className="btn /)
    expect(notes).not.toMatch(/className="btn /)
    expect(home.match(/className="btn /g)).toHaveLength(2)
    expect(home).not.toContain('wb-chip"')
  })
})
```

- [ ] **Step 4: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/workbench-local-panes.test.ts tests/workbench-knowledge.test.ts tests/workbench-surfaces.test.ts`
Expected: FAIL.

- Biểu mẫu và Ghi chú: `.wb-forms-add` null; Notes chưa có `li.wb-row.wb-notes-card`.
- Tri thức: `.wb-kn-search input` null.
- Surfaces: danh sách cấm nêu `.skill-domain-tab`, `.skill-domain-tab:hover`, `.skill-domain-menu`, `.wb-chip*`, `.wb-pack-item*`, các rule material/skill/module row, `.wb-create, .wb-packs, .wb-detail`; test `wb-panel` thất bại ở `PracticeHome.tsx`; test nút thất bại ở số lần `className="btn `.

- [ ] **Step 5: Viết lại phần `return` của Forms**

Trong `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx`, thêm import dưới `import { LocalTag } from './LocalTag'`:

```tsx
import { MODULE_TONES } from './module-tones'
import { WorkbenchIcon } from './WorkbenchIcons'
```

Đổi `import type { WorkPaneProps } from './WorkErrorState'` thành:

```tsx
import { WorkStatePanel, type WorkPaneProps } from './WorkErrorState'
```

Thay trọn `return ( <> … </> )` ở cuối `FormsPane`, từ `<p className="wb-hint">{t('wbFormsHint')}</p>` tới `</ul>`, bằng đoạn dưới. Mọi handler (`save`, `pickTemplateFile`, `clearForm`, `startEdit`, `openTemplateFile`, `openForm`, `persist`) và state giữ nguyên tên hiện có:

```tsx
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
```

Đối chiếu với bản cũ: nếu một khóa i18n trên không có trong `en.ts` (ví dụ `wbFormsDraftNeedsPackHint`), dùng khóa mà bản cũ đang dùng cho cùng câu đó.

- [ ] **Step 6: Viết lại `NotesPane.tsx`**

Thay `apps/shell/src/renderer/src/NotesPane.tsx` bằng (logic lưu giữ nguyên, so với bản cũ trước khi thay):

```tsx
import { useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import { MODULE_TONES } from './module-tones'
import { WbDeleteBtn, WbRowActions } from './WbRowActions'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  writeStickyNotes,
  type WbStickyNote,
} from './workbench-pins'

/**
 * Notes: one row per note in a list block, stored on this device. The stored paper
 * color and board position (from the old pinboard) are kept in the data, unused.
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
      <form className="wb-notes-add" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbNotesPlaceholder')}
          aria-label={t('wbNotesPlaceholder')}
        />
        <button type="submit" className="wb-btn wb-btn-primary" disabled={!draft.trim()}>
          {t('wbNotesAdd')}
        </button>
      </form>
      {items.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.notes}
          icon={<WorkbenchIcon id="notes" size={20} />}
          title={t('wbNotesEmpty')}
        />
      ) : (
        <ul className="wb-block wb-notes-list">
          {items.map((note) => (
            <li key={note.id} className="wb-row wb-notes-card">
              <div className="wb-notes-text">
                <textarea
                  value={note.body}
                  rows={2}
                  aria-label={t('wbNotesBodyLabel')}
                  onChange={(e) => edit(note.id, e.target.value)}
                />
                <span className="wb-notes-edited">
                  {t('wbNotesEdited', {
                    time: new Date(note.updatedAt).toLocaleString(dateLocale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
              </div>
              <WbRowActions>
                <WbDeleteBtn
                  label={t('wbNotesDelete')}
                  onClick={() => persist(items.filter((n) => n.id !== note.id))}
                />
              </WbRowActions>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Đổi các phần trụ cột trong `PracticeHome.tsx`**

**a. Import.** Thêm dưới `import { LocalTag } from './LocalTag'` (bỏ dòng nào đã có, ví dụ `WorkSkeleton` từ Task 2 thì gộp vào cùng import `./WorkErrorState`):

```tsx
import { MODULE_TONES } from './module-tones'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'
import { WorkPaneHeader } from './WorkPaneHeader'
```

**b. Trụ cột đang mở.** Thêm dòng này ngay sau câu lệnh `const packs = useMemo(…)` (kết thúc bằng `}, [projects, practice.id, practice.projectKind, qQuery])`):

```tsx
const pillar = practice.pillars.find((p) => p.id === tab)
```

**c. Tiêu đề trụ cột và phần Tri thức.** Thay đoạn từ `{tab === 'knowledge' && (` tới hết dòng `<p className="wb-empty">{t('wbKnEmpty')}</p>` bằng:

```tsx
      {pillar ? (
        <WorkPaneHeader
          module={pillar.id}
          title={vi ? pillar.labelVi : pillar.labelEn}
          meta={`${vi ? pillar.hintVi : pillar.hintEn}${meta?.title ? ` · ${meta.title}` : ''}`}
          aside={<LocalTag />}
        />
      ) : null}

      {tab === 'knowledge' && (
        <section className="wb-pane">
          <label className="wb-kn-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path
                d="M20 20l-3.5-3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              value={qQuery}
              onChange={(e) => setQQuery(e.target.value)}
              aria-label={t('wbKnSearch')}
              placeholder={t('wbKnSearchPlaceholder')}
            />
          </label>
          <div className="wb-layout">
            <section className="wb-packs">
              <h2>
                {t('wbKnLibrary')}
                <span className="wb-count wb-num">{packs.length}</span>
              </h2>
              {packs.length === 0 ? (
                <WorkStatePanel
                  tone={MODULE_TONES.knowledge}
                  icon={<WorkbenchIcon id="knowledge" size={20} />}
                  title={t('wbKnEmpty')}
                />
```

**d. Phần Tài liệu (materials).** Thay:

```tsx
        <section className="wb-panel wb-detail">
          <LocalTag />
          {!selected || !meta ? (
            <p className="wb-empty">{t('wbMatSelectPackFirst')}</p>
          ) : (
            <>
              <h2>
                {t('wbCommonMaterials')} · {meta.title}
              </h2>
              <ul className="wb-material-list">
```

bằng:

```tsx
        <section className="wb-pane">
          {!selected || !meta ? (
            <p className="wb-empty">{t('wbMatSelectPackFirst')}</p>
          ) : (
            <>
              <ul className="wb-material-list">
```

**e. Phần Kỹ năng.** Thay:

```tsx
        <section className="wb-panel wb-detail">
          <LocalTag />
          <h2>{t('wbCommonSkills')}</h2>
```

bằng:

```tsx
        <section className="wb-pane">
```

**f. Phần Soạn thảo (compose).** Thay:

```tsx
        <section className="wb-panel wb-create">
          <LocalTag />
          <h2>{t('wbCmpTitle')}</h2>
```

bằng:

```tsx
        <section className="wb-block wb-cmp">
```

**g. Lớp của nút.** Đổi `className` của từng nút dưới đây, nhận ra nút qua handler đi sau nó. Hai nút trong `{confirmSkill && (` (`.modal`) giữ `btn`.

| Nút (neo duy nhất)                                                                                                                    | `className` mới                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Tri thức: `pinPillar(practice.id, 'materials')` (Tài liệu)                                                                            | `"wb-btn wb-btn-secondary"`           |
| Tri thức: `onOpenPackFiles(selected.id)`                                                                                              | `"wb-btn wb-btn-secondary"`           |
| Tri thức: `void deletePack()`                                                                                                         | `"wb-btn wb-btn-secondary"`           |
| Tri thức: `void saveMeta()`                                                                                                           | `"wb-btn wb-btn-primary"`             |
| Tài liệu: `void addMaterial()`                                                                                                        | `"wb-btn wb-btn-primary"`             |
| Tài liệu: bốn nút `className="wb-chip"` tạo nhanh (Docs, Sheets, Slides, PDF) và `className="wb-chip"` trong `practice.templates.map` | `"wb-btn wb-btn-secondary wb-btn-sm"` |
| Tài liệu: `void openFreeChain()`                                                                                                      | `"wb-btn wb-btn-secondary"`           |
| Kỹ năng: hai nút Chạy `setConfirmSkill({ kind: 'practice' …` và `setConfirmSkill({ kind: 'domain' …`                                  | `"wb-btn wb-btn-primary wb-btn-sm"`   |
| Soạn thảo: `void submitCreate()`                                                                                                      | `"wb-btn wb-btn-primary"`             |

Kiểm: `grep -n 'className="btn ' apps/shell/src/renderer/src/PracticeHome.tsx` in đúng hai dòng của modal (`btn btn-secondary` Hủy và `btn btn-primary` Chạy); `grep -n 'wb-chip"' apps/shell/src/renderer/src/PracticeHome.tsx` không in gì (`wb-chip-row` vẫn còn).

- [ ] **Step 8: Cập nhật CSS**

Trong `apps/shell/src/renderer/src/home.css`:

**1. Tab và menu skill-domain (dạng pill):**

- Trong `.skill-domain-tab`: đổi `border-radius: 999px;` thành `border-radius: var(--radius-8);`; xóa dòng `box-shadow: var(--shadow-btn);`; đổi danh sách `transition:` thành `background 160ms ease, color 160ms ease, border-color 160ms ease;` (bỏ `transform`).
- Trong `.skill-domain-tab:hover`, xóa `transform: translateY(-1px);`.
- Trong `.skill-domain-menu`: đổi `border-radius: var(--radius-16);` thành `border-radius: 10px;` và `box-shadow: var(--shadow-btn-lift);` thành `box-shadow: var(--shadow-menu);` (giống `.wb-new-menu`).

**2. Xóa các rule không còn ai dùng:**

- Forms không còn dùng: `.wb-module-form`, `.wb-module-form label`, `.wb-module-form input`, `.wb-module-form select`, `.wb-module-list`, `.wb-module-row` (khối có `min-height: 48px`), `.wb-module-meta`, `.wb-module-meta strong`, `.wb-module-meta span, .wb-module-meta .wb-hint`, `.wb-module-row > div:not(.wb-row-actions):not(.wb-chip-row)`, `.wb-module-row > .wb-chip-row`, `.wb-module-row.is-done .wb-module-meta span, .wb-module-row.is-done > div:not(…) span`.
- Comment `/* Prefer .wb-module-meta; keep legacy first-child content column for unmigrated rows */` và `/* ── Sticky notes pinboard ─────────────────────────── */`.
- Trong rule hiện `.wb-row-actions` với `{ opacity: 1; }`, hai dòng selector `.wb-module-row:hover .wb-row-actions,` và `.wb-module-row:focus-within .wb-row-actions,`.
- `.wb-panel { … }`.
- Ba khối `.wb-chip`: `.wb-chip`, `.wb-chip:hover:not(:disabled)`, `.wb-chip:disabled`.

**3. Ghi chú.** Thay các khối `.wb-notes-list`, `.wb-notes-card`, `.wb-notes-card:focus-within`, `.wb-notes-card textarea`, `.wb-notes-card textarea:focus`, `.wb-notes-card footer`, `.wb-notes-delete`, `.wb-notes-delete:hover` bằng:

```css
.wb-notes-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-notes-card {
  align-items: flex-start;
}

.wb-notes-card:focus-within {
  background: var(--wb-row-hover);
  box-shadow: inset 2px 0 0 var(--accent);
}

.wb-notes-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wb-notes-text textarea {
  width: 100%;
  min-height: 20px;
  padding: 0;
  border: none;
  resize: none;
  field-sizing: content;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.wb-notes-text textarea:focus {
  outline: none;
}

.wb-notes-edited {
  color: var(--text-secondary);
  font-size: 12px;
}
```

**4. Biểu mẫu, ô tìm Tri thức và Soạn thảo.** Chèn ngay sau khối `.wb-local-tag { … }`:

```css
.wb-forms-hint {
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-forms-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-forms-add input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-forms-add input:focus {
  border-color: var(--accent);
  outline: none;
}

.wb-forms-title {
  flex: 1 1 200px;
  min-width: 0;
}

.wb-forms-note {
  flex: 0 1 220px;
  width: 220px;
  min-width: 0;
}

.wb-forms-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-forms-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.wb-forms-text strong {
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-forms-text span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-forms-locked {
  flex: none;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.wb-kn-search {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 360px;
  color: var(--text-secondary);
}

.wb-kn-search svg {
  position: absolute;
  left: 10px;
  pointer-events: none;
}

.wb-kn-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.wb-kn-search input:focus {
  border-color: var(--accent);
  outline: none;
}

.wb-cmp {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}

.wb-cmp > .wb-btn {
  align-self: flex-start;
}
```

**5. Danh sách tài liệu và kỹ năng thành một khối dòng phẳng.** Thay ba khối `.wb-material-list, .wb-skill-list { … }`, `.wb-material-row, .wb-skill-row, .wb-module-row { border-radius: var(--radius-16); … }` và `.wb-material-row, .wb-skill-row { display: flex; … min-height: 48px; }` bằng:

```css
.wb-material-list,
.wb-skill-list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--surface);
  box-shadow: var(--wb-shadow);
  list-style: none;
}

.wb-material-row,
.wb-skill-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 36px;
  padding: 7px 12px;
}

.wb-material-row + .wb-material-row,
.wb-skill-row + .wb-skill-row {
  border-top: 1px solid var(--border-subtle);
}

.wb-material-row:hover,
.wb-skill-row:hover {
  background: var(--wb-row-hover);
}

.wb-material-list > .wb-empty {
  padding: 7px 12px;
}
```

Trong `.wb-material-row strong, .wb-skill-row strong`, đổi `font-size: 14px;` thành `font-size: 13px;`.

**6. Bố cục Tri thức, thẻ và dòng gói.**

- Thay `.wb-layout { … }` (khối đầu tiên, ngoài media query) bằng:

```css
.wb-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 16px;
}
```

- Thay `.wb-create, .wb-packs, .wb-detail { … }` và `.wb-create h2, .wb-packs h2, .wb-detail h2 { … }` bằng (mọi rule `.wb-create …` khác nếu còn thì xóa: Soạn thảo giờ là `.wb-cmp`):

```css
.wb-packs,
.wb-detail {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--surface);
  box-shadow: var(--wb-shadow);
}

.wb-packs h2,
.wb-detail h2 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 10px;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
```

- Thay `.wb-count { … }` bằng:

```css
.wb-count {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}
```

- Thay `.wb-empty { … }` bằng:

```css
.wb-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}
```

- Trong `.wb-pack-list`, đổi `gap: 8px;` thành `gap: 2px;`.

- Thay `.wb-pack-item`, `.wb-pack-item:hover`, `.wb-pack-item.active` và `.wb-pack-item strong` bằng:

```css
.wb-pack-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-8);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms;
}

.wb-pack-item:hover {
  background: var(--wb-row-hover);
}

.wb-pack-item.active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}

.wb-pack-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.wb-pack-item strong {
  font-size: 13px;
  font-weight: 600;
}
```

- [ ] **Step 9: Chạy test và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/workbench-local-panes.test.ts tests/workbench-knowledge.test.ts tests/workbench-surfaces.test.ts tests/workbench-forms-notice.test.ts tests/workbench-copy.test.ts tests/workbench-module-pane.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 10: Kiểm tra**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --write apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-local-panes.test.ts apps/shell/tests/workbench-knowledge.test.ts apps/shell/tests/workbench-surfaces.test.ts
npx prettier --check apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-local-panes.test.ts apps/shell/tests/workbench-knowledge.test.ts apps/shell/tests/workbench-surfaces.test.ts
```

Expected: mọi lệnh thoát 0.

- [ ] **Step 11: Commit**

```bash
git add apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/src/renderer/src/NotesPane.tsx apps/shell/src/renderer/src/PracticeHome.tsx apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-local-panes.test.ts apps/shell/tests/workbench-knowledge.test.ts apps/shell/tests/workbench-surfaces.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): Forms, Notes and the pillars move to flat Workbench rows

Forms gets a one-row add form, a one-line hint, list rows with the
"select a pack" hint beside the locked Draft, and the shared empty panel.
Notes become rows in a list block with an icon delete. The four pillars
share WorkPaneHeader; Knowledge gets a 32px search with a leading icon, a
1fr/1.4fr layout and a caption-size library count. Every remaining pill
radius, lifted shadow, hover lift and dashed box in the Workbench area is
gone (only the quick-add plus box stays dashed).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Quét chế độ tối và độ nhất quán

Một test kiểm toán cố định khóa các luật của bản thiết kế lại cho phần Bàn làm việc của `home.css`: màu chỉ từ token; không màu chữ trượt AA; không lớp nào mà renderer không dùng; giảm chuyển động dừng cả hiệu ứng nhấn và shimmer; các cặp màu đạt WCAG ở cả 3 khối theme; và các rule pill/chip/ô chữ cái/checkbox tự tô chữ trên nền của chính nó đạt AA. Viền đứt và pill đã được `workbench-surfaces.test.ts` (Task 8) khóa nên không lặp lại ở đây. Phần Bàn làm việc là từ `/* ── Workbench ── */` tới `/* ── File search (home toolbar) ── */`, cộng từ `/* ── Workbench server tabs` tới cuối file.

Bảng cặp đã đo (hex lấy từ `tokens.css` và accent của shell trong `home.css`; dark và system-dark giống nhau; tối thiểu 4.5 cho chữ, 3 cho phần tử UI):

| Chữ trên nền                                                                                                               | Light                                    | Dark                                     | Min | Dùng cho                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | --- | ------------------------------------------------------------------------------------- |
| `--text` trên `--surface` / `--wb-row-hover` / `--hover` / `--surface-subtle` / `--accent-soft`                            | 15.52 / 14.61 / 14.24 / 14.48 / 13.59    | 13.11 / 11.61 / 9.94 / 11.29 / 9.76      | 4.5 | tiêu đề dòng, hover ghost/secondary, chip vai trò, gói đang chọn                      |
| `--text-secondary` trên `--surface` / `--wb-row-hover` / `--bg-content` / `--surface-subtle` / `--hover` / `--accent-soft` | 6.04 / 5.69 / 5.79 / 5.64 / 5.54 / 5.29  | 6.38 / 5.65 / 6.66 / 5.49 / 4.83 / 4.75  | 4.5 | meta, `.wb-mono`, dòng ngày, tiêu đề ngày sticky, nhãn tab, số mờ                     |
| `--danger-text` trên `--surface` / `--wb-row-hover` / `--bg-content` / `--danger-bg`                                       | 6.54 / 6.15 / 6.26 / 6.00                | 7.36 / 6.52 / 7.68 / 6.59                | 4.5 | nhóm quá hạn, số trên dải, số trên tab, pill và ô danger                              |
| `--warning-text` trên `--warning-bg` / `--surface` / `--wb-row-hover`                                                      | 5.81 / 6.33 / 5.96                       | 7.36 / 9.36 / 8.29                       | 4.5 | pill và ô warning, số hạn hôm nay                                                     |
| `--info` trên `--info-bg`                                                                                                  | 5.02                                     | 6.79                                     | 4.5 | ô chưa đăng nhập / chưa có workspace                                                  |
| `--success` trên `--success-bg`                                                                                            | 4.78                                     | 5.81                                     | 4.5 | pill success                                                                          |
| `--on-accent` trên `--accent` / `--accent-hover`                                                                           | 6.25 / 8.24                              | 6.44 / 8.09                              | 4.5 | nút chính, ô chữ cái workspace                                                        |
| `--accent` trên `--surface` / `--bg-content` / `--wb-row-hover`                                                            | 6.25 / 5.98 / 5.88                       | 5.75 / 6.00 / 5.09                       | 4.5 | link, vòng focus, ô đã tick, vạch tab                                                 |
| `--wb-check-border` trên `--surface` / `--wb-row-hover`                                                                    | 3.43 / 3.23                              | 3.70 / 3.28                              | 3   | viền checkbox                                                                         |
| `--tint-X-fg` trên `--tint-X` (gray, green, yellow, violet, blue, teal, pink)                                              | 5.77, 5.51, 5.70, 5.62, 5.02, 5.38, 5.64 | 5.90, 8.16, 7.89, 5.82, 6.79, 7.46, 6.47 | 4.5 | ô icon, ô chữ cái                                                                     |
| Bị thay: `--text-tertiary` trên `--surface` / `--hover` / `--wb-row-hover`                                                 | 3.05 / 2.80 / 2.87                       | —                                        | —   | trượt, chuyển sang `--text-secondary`                                                 |
| Bị thay: `--danger` trên `--wb-row-hover` / `--surface` / `--danger-bg`                                                    | —                                        | 2.99 / 3.38 / 3.03                       | —   | trượt, chuyển sang `--danger-text` (cả số 24px trên dải: khi hover ở dark chỉ 2.99:1) |

**Files:**

- Create: `apps/shell/tests/workbench-theme-audit.test.ts`
- Modify: `apps/shell/src/renderer/src/home.css`
- Modify (chỉ khi Step 6 còn thấy sót): các file TSX Bàn làm việc trong `WORKBENCH_TSX` của test

**Interfaces:**

- Consumes: token `--wb-row-hover`, `--wb-check-border`, `--wb-shadow` (Task 1); khối reduced-motion của `.wb-btn` và `.wb-skel` (Task 1); mọi lớp Task 1–8 thêm.
- Produces: không có API mới (chỉ CSS và test). Không test cũ nào vỡ: không test nào chọn `.skill-domain-tab`, `.wb-pack-item`, `.wb-error` hay `.wb-icon-btn` theo style; `workbench-tabs-focus.test.ts` chỉ khớp văn bản rule `:focus-visible`, task này không đụng tới.

- [ ] **Step 1: Viết test kiểm toán thất bại**

Tạo `apps/shell/tests/workbench-theme-audit.test.ts`:

```ts
/**
 * Workbench redesign sweep (spec §2, §5, §6): the Workbench part of home.css
 * paints with tokens only, defines no class the renderer never uses, stops the
 * press scale under reduced motion, and every text/background pair it paints
 * meets WCAG in the light, dark and system-dark blocks. Dashed borders and pill
 * shapes are locked by workbench-surfaces.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src', 'renderer', 'src')
const home = readFileSync(join(SRC, 'home.css'), 'utf8')
const tokens = readFileSync(join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'), 'utf8')

/** "Workbench" up to "File search", plus "Workbench server tabs" to the end, comments removed */
function workbenchCss(): string {
  const a = home.indexOf('/* ── Workbench ── */')
  const b = home.indexOf('/* ── File search (home toolbar) ── */')
  const c = home.indexOf('/* ── Workbench server tabs')
  if (a < 0 || b < a || c < b) throw new Error('Workbench region markers moved')
  return (home.slice(a, b) + home.slice(c)).replace(/\/\*[\s\S]*?\*\//g, '')
}
const region = workbenchCss()

/** innermost `selector { declarations }` pairs; an @media wrapper is skipped, its rules are kept */
const rules = [...region.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim().replace(/\s+/g, ' '),
  body: m[2]!,
}))
const selectorsWhere = (re: RegExp) => rules.filter((r) => re.test(r.body)).map((r) => r.selector)

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/

/** the Workbench components (chrome inline styles must not carry raw colours either) */
const WORKBENCH_TSX = [
  'WorkbenchTopBar.tsx',
  'WorkbenchTabs.tsx',
  'WorkOverview.tsx',
  'WorkTasksPane.tsx',
  'WorkCalendarPane.tsx',
  'WorkProfilePane.tsx',
  'WorkbenchModulePanes.tsx',
  'NotesPane.tsx',
  'PracticeHome.tsx',
  'WorkErrorState.tsx',
  'WorkPaneHeader.tsx',
  'WorkbenchIcons.tsx',
  'WbRowActions.tsx',
  'SkillDomainTabs.tsx',
  'LocalTag.tsx',
]
const tsx = (name: string) => readFileSync(join(SRC, name), 'utf8')

describe('Workbench CSS sweep', () => {
  it('paints with tokens only (raw colours live on custom-property lines)', () => {
    const raw = region
      .split('\n')
      .filter((line) => RAW_COLOR.test(line) && !/^\s*--[\w-]+:/.test(line))
    expect(raw).toEqual([])
    for (const name of WORKBENCH_TSX) expect(tsx(name), name).not.toMatch(RAW_COLOR)
  })

  it('paints text in AA colours: no --text-tertiary, no bare --danger', () => {
    expect(selectorsWhere(/(?:^|[\s;])color:\s*var\(--text-tertiary\)/)).toEqual([])
    expect(selectorsWhere(/(?:^|[\s;])color:\s*var\(--danger\)/)).toEqual([])
  })

  it('defines no class the renderer never uses', () => {
    const source = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(SRC, f), 'utf8'))
      .join('\n')
    const literal = new Set(source.match(/(?:wb|skill-domain)-[a-z0-9-]+/g) ?? [])
    // `wb-btn-${variant}`: a template prefix covers every class it can build
    const prefixes = [...source.matchAll(/((?:wb|skill-domain)-[a-z0-9-]*-)\$\{/g)].map(
      (m) => m[1]!,
    )
    const defined = new Set(
      [...region.matchAll(/\.((?:wb|skill-domain)-[a-z0-9-]+)/g)].map((m) => m[1]!),
    )
    const unused = [...defined].filter(
      (c) => !literal.has(c) && !prefixes.some((p) => c.startsWith(p)),
    )
    expect(unused).toEqual([])
  })

  it('stops the press scale and the shimmer under reduced motion', () => {
    const motion = [
      ...region.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ]
      .map((m) => m[1])
      .join('\n')
    expect(motion).toMatch(/\.wb-btn:active[^{]*\{[^}]*transform: none/)
    expect(motion).toMatch(/\.wb-icon-btn:active[^{]*\{[^}]*transform: none/)
    expect(motion).toMatch(/\.wb-skel[^{]*\{[^}]*animation: none/)
  })

  it('Workbench components use .wb-btn; the shared .btn stays only in the skill-confirm modal', () => {
    for (const name of WORKBENCH_TSX.filter((n) => n !== 'PracticeHome.tsx')) {
      expect(tsx(name), name).not.toMatch(/\bbtn btn-/)
    }
    const practice = tsx('PracticeHome.tsx')
    const modal = practice.indexOf('className="modal"')
    expect(modal).toBeGreaterThan(0)
    expect(practice.slice(0, modal)).not.toMatch(/\bbtn btn-/)
  })
})

const OPENERS = {
  light: '\n:root {',
  dark: "\n[data-theme='dark'] {",
  system: '\n@media (prefers-color-scheme: dark) {',
} as const
type Theme = keyof typeof OPENERS

function hexIn(source: string, theme: Theme, name: string): string | undefined {
  const start = source.indexOf(OPENERS[theme])
  if (start < 0) return undefined
  const block = source.slice(start, source.indexOf('\n}', start + 1))
  const hex = new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(block)?.[1]
  return hex?.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
}
/** the shell accent family lives in home.css, everything else in tokens.css */
function token(theme: Theme, name: string): string {
  const hex = hexIn(home, theme, name) ?? hexIn(tokens, theme, name)
  if (!hex) throw new Error(`${name} has no hex value in the ${theme} block`)
  return hex
}
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

const TEXT = 4.5
/** non-text UI parts: checkbox outline */
const UI = 3
const PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ...['--surface', '--wb-row-hover', '--hover', '--surface-subtle', '--accent-soft'].map(
    (bg) => ['--text', bg, TEXT] as const,
  ),
  ...[
    '--surface',
    '--wb-row-hover',
    '--bg-content',
    '--surface-subtle',
    '--hover',
    '--accent-soft',
  ].map((bg) => ['--text-secondary', bg, TEXT] as const),
  ...['--surface', '--wb-row-hover', '--bg-content', '--danger-bg'].map(
    (bg) => ['--danger-text', bg, TEXT] as const,
  ),
  ...['--warning-bg', '--surface', '--wb-row-hover'].map(
    (bg) => ['--warning-text', bg, TEXT] as const,
  ),
  ['--info', '--info-bg', TEXT],
  ['--success', '--success-bg', TEXT],
  ['--on-accent', '--accent', TEXT],
  ['--on-accent', '--accent-hover', TEXT],
  ...['--surface', '--bg-content', '--wb-row-hover'].map((bg) => ['--accent', bg, TEXT] as const),
  ['--wb-check-border', '--surface', UI],
  ['--wb-check-border', '--wb-row-hover', UI],
  ...['gray', 'green', 'yellow', 'violet', 'blue', 'teal', 'pink'].map(
    (t) => [`--tint-${t}-fg`, `--tint-${t}`, TEXT] as const,
  ),
]

describe('Workbench colour pairs', () => {
  it.each(Object.keys(OPENERS) as Theme[])(
    '%s: every pair the Workbench paints meets WCAG',
    (theme) => {
      const failing = PAIRS.map(([fg, bg, min]) => ({
        pair: `${fg} on ${bg}`,
        ratio: contrast(token(theme, fg), token(theme, bg)),
        min,
      }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.pair}: ${p.ratio.toFixed(2)} < ${p.min}`)
      expect(failing).toEqual([])
    },
  )
})

/** rules that paint their own text on their own fill (review focus: dark contrast of the new pills) */
const PAINTED = [
  '.wb-pill.is-status',
  '.wb-pill.is-danger',
  '.wb-pill.is-warning',
  '.wb-crumb-role',
  '.wb-ov-avatar',
  '.wb-check input:checked + .wb-check-box',
]

describe('Workbench painted pills and tiles', () => {
  it.each(Object.keys(OPENERS) as Theme[])(
    '%s: the pills, chips, avatar and ticked box paint AA text on their own fill',
    (theme) => {
      const failing = PAINTED.flatMap((selector) => {
        const body = rules.find((r) => r.selector === selector)?.body ?? ''
        const fg = /(?:^|[\s;])color:\s*var\((--[\w-]+)\)/.exec(body)?.[1]
        const bg = /(?:^|[\s;])background:\s*var\((--[\w-]+)\)/.exec(body)?.[1]
        if (!fg || !bg) return [`${selector}: no color/background pair`]
        const ratio = contrast(token(theme, fg), token(theme, bg))
        return ratio < TEXT ? [`${selector}: ${fg} on ${bg} ${ratio.toFixed(2)}`] : []
      })
      expect(failing).toEqual([])
    },
  )
})
```

- [ ] **Step 2: Chạy và xác nhận thất bại**

Run: `cd apps/shell && npx vitest run tests/workbench-theme-audit.test.ts`
Expected: FAIL. Hai nhóm test cặp màu (6 test) PASS: chúng canh token của Task 1 và các rule Task 1–8 vừa viết. Các test CSS thất bại ít nhất ở:

- `paints text in AA colours`: `.wb-tab-grip`, `.wb-tab-menu-section`, `.wb-ov-stat-value.is-muted`, `.wb-ov-stat-value.is-danger`, `.wb-icon-btn.is-danger:hover:not(:disabled)`, `.wb-error`.
- `stops the press scale…`: assertion `.wb-icon-btn:active`.
- `defines no class…`: chỉ thất bại nếu Task 1–8 bỏ sót lớp chết (xem Step 3).

- [ ] **Step 3: Xóa CSS chết**

Trong `apps/shell/src/renderer/src/home.css`:

1. Xóa trọn khối rule của mọi lớp mà test `defines no class…` in ra. Nếu một danh sách selector trộn lớp chết với lớp sống, chỉ bỏ selector chết. Nếu Task 1–8 bỏ sót, các lớp hay gặp là `.wb-topbar-picker*`, `.wb-topbar-sep`, `.wb-work-table*`, `.wb-work-check`, `.wb-ov-stats`, `.wb-ov-row` (không phải `.wb-ov-row-title`), `.wb-ov-row-meta`, `.wb-ov-quiet`, `.wb-create`, `.wb-notes-delete`.
2. Test không thấy được phần còn sót dạng selector theo thẻ con, nên kiểm bằng tay:

```bash
grep -nE "^\.wb-agenda-day h3|^\.wb-work-group th|^\.wb-work-group\.is-overdue th" apps/shell/src/renderer/src/home.css
```

Expected: không in gì. Xóa mọi khối lệnh này in ra.

- [ ] **Step 4: Sửa các dòng màu trượt AA**

Trong `home.css`, đổi đúng một dòng `color:` trong mỗi khối. Bỏ qua khối nào đã có giá trị mới.

| Khối                                          | Dòng cũ                        | Dòng mới                        |
| --------------------------------------------- | ------------------------------ | ------------------------------- |
| `.wb-tab-grip`                                | `color: var(--text-tertiary);` | `color: var(--text-secondary);` |
| `.wb-tab-menu-section`                        | `color: var(--text-tertiary);` | `color: var(--text-secondary);` |
| `.wb-ov-stat-value.is-muted`                  | `color: var(--text-tertiary);` | `color: var(--text-secondary);` |
| `.wb-ov-stat-value.is-danger`                 | `color: var(--danger);`        | `color: var(--danger-text);`    |
| `.wb-icon-btn.is-danger:hover:not(:disabled)` | `color: var(--danger);`        | `color: var(--danger-text);`    |
| `.wb-error`                                   | `color: var(--danger);`        | `color: var(--danger-text);`    |

(`.wb-tab-unpin` đã chuyển ở Task 4, `.wb-crumb-sep` dùng `--text-secondary` từ Task 3.) Nếu test in thêm selector khác, đổi nó theo cùng quy tắc.

- [ ] **Step 5: Dừng hiệu ứng nhấn của icon button khi giảm chuyển động**

Trong `home.css`, chèn khối này ngay sau khối `.wb-icon-btn:active:not(:disabled) { transform: scale(0.94); }`:

```css
@media (prefers-reduced-motion: reduce) {
  .wb-icon-btn:active:not(:disabled) {
    transform: none;
  }
}
```

Rule toàn cục ở `home.css:3329` (dòng cũ) đã cắt mọi transition và animation xuống 0.01ms; chỉ transform tĩnh của `:active` cần rule riêng.

- [ ] **Step 6: Chuyển các nút dùng chung còn sót**

```bash
grep -nE "\bbtn btn-" apps/shell/src/renderer/src/{WorkbenchTopBar,WorkbenchTabs,WorkOverview,WorkTasksPane,WorkCalendarPane,WorkProfilePane,WorkbenchModulePanes,NotesPane,WorkErrorState,WorkPaneHeader,SkillDomainTabs}.tsx; grep -nE "\bbtn btn-" apps/shell/src/renderer/src/PracticeHome.tsx
```

Expected: lệnh đầu không in gì; lệnh thứ hai chỉ in hai dòng của modal, ngay dưới `className="modal"` (Hủy và Chạy). Với dòng nào khác được in, đổi `className="btn btn-primary"` thành `className="wb-btn wb-btn-primary"` và `className="btn btn-secondary"` thành `className="wb-btn wb-btn-secondary"`, không đổi gì khác (test tìm các nút này theo chữ, chữ không đổi).

- [ ] **Step 7: Chạy test kiểm toán và xác nhận qua**

Run: `cd apps/shell && npx vitest run tests/workbench-theme-audit.test.ts tests/workbench-surfaces.test.ts`
Expected: PASS, 11 test kiểm toán và 9 test surfaces.

- [ ] **Step 8: Kiểm tra toàn bộ**

```bash
cd apps/shell && npx vitest run && cd ../..
npm run typecheck
npm run check:theme-colors -- --base 2ed35881
npm run check:english-comments
npx prettier --check apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-theme-audit.test.ts
```

Chạy thêm prettier trên mọi file TSX đã đổi ở Step 6.

Expected: suite shell xanh, kể cả `workbench-tabs-focus`, `module-tones`, `shell-accent`, `account-ui`; typecheck thoát 0; theme check không báo vi phạm; english-comments qua; prettier "All matched files use Prettier code style!".

- [ ] **Step 9: Commit**

```bash
git add apps/shell/src/renderer/src/home.css apps/shell/tests/workbench-theme-audit.test.ts
# thêm từng file TSX Step 6 đã đổi, theo đường dẫn cụ thể; không bao giờ package-lock.json
git commit -m "refactor(shell): Workbench sweep keeps tokens only and AA text

Remove dead Workbench rules, move tertiary and bare danger text to AA
tokens, stop the icon-button press scale under reduced motion, and guard
all of it with an audit test over the Workbench CSS, its colour pairs and
the pills and tiles that paint their own text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ảnh chụp trước và sau (tạm, không commit)

Task này mở rộng script Playwright trong scratchpad. Một proxy cục bộ nhỏ đứng trước stub tài liệu e2e, nên không đổi fixture nào trong repo. Proxy:

- tự trả lời các route Bàn làm việc cần bằng dữ liệu doanh nghiệp tiếng Việt thực tế: `/workspaces/{ws}/home`, `/my-tasks`, `/task-statuses`, `/calendar/events`, `/orgs/{org}/people/{id}` và `/orgs/{org}/workspaces` (route cuối trả hai workspace để caret của chip hoạt động);
- vá tên hiển thị trong `/me` và tên tổ chức trong `/orgs`;
- chuyển mọi request khác (đăng nhập, tài liệu) tới stub.

Script chụp 10 tab × light/dark × vi/en, cộng trạng thái chưa đăng nhập và hai menu, rồi chạy lại smoke e2e của Tổng quan.

Ảnh "trước" của Công việc, Lịch và Hồ sơ hiện trạng thái mất quyền vì khi đó các route này chưa có stub (xem `shots/tab1-C_ng_vi_c-light-vi.png`). Với ba màn này, so với spec thay vì so với ảnh cũ: chỉ 7 trên 10 màn có cặp trước/sau thật.

**Files:**

- Modify (scratchpad, ngoài repo): `/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots.spec.ts` (thay cả file)
- Modify (scratchpad): `/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/pw.config.ts`
- Output: `/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots/after/*.png`
- Test: `e2e/workbench-overview.spec.ts` (chỉ chạy)

**Interfaces:**

- Consumes (từ repo, không đổi): `launchShell` (`e2e/helpers.ts`); `startUniworkDocumentsStub`, `STUB_WORKSPACE`, `addDocument` (`e2e/fixtures/uniwork-documents-stub.ts`); `STUB_ACCOUNT`, `STUB_ORG` (`e2e/fixtures/uniwork-auth-stub.ts`); `accountButton`, `shellEnv`, `signIn` (`e2e/fixtures/uniwork-signin-steps.ts`); dạng DTO mà `apps/shell/src/main/uniwork-work/parse.ts` đọc.
- Dựa vào các móc UI sau Task 1–8: `.nav-item`, `.wb-tab-module`, `.wb-tab-add`, `.wb-tab-menu`, `.wb-tab-menu-item`, `.wb-tab-count`, `.uw-sr-only`, `.wb-new-wrap > button[aria-haspopup="menu"]`, `.wb-notes form input`, `window.aiOffice.setTheme`.
- Produces: không thay đổi repo, không commit.

- [ ] **Step 1: Tăng timeout của config**

Thay `pw.config.ts` bằng:

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:
    '/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad',
  testMatch: 'shots.spec.ts',
  timeout: 900_000,
  workers: 1,
  reporter: 'list',
})
```

- [ ] **Step 2: Thay script chụp**

Thay `shots.spec.ts` bằng:

```ts
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { createServer, request, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchShell } from '/Users/ducquang/UNICOM/uniwork-office/e2e/helpers'
import {
  STUB_WORKSPACE,
  startUniworkDocumentsStub,
} from '/Users/ducquang/UNICOM/uniwork-office/e2e/fixtures/uniwork-documents-stub'
import {
  STUB_ACCOUNT,
  STUB_ORG,
} from '/Users/ducquang/UNICOM/uniwork-office/e2e/fixtures/uniwork-auth-stub'
import {
  accountButton,
  shellEnv,
  signIn,
} from '/Users/ducquang/UNICOM/uniwork-office/e2e/fixtures/uniwork-signin-steps'

const OUT =
  '/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots/after/'
const API = '/api/v1'
const NAME = 'Nguyễn Minh Anh'
const WORKSPACES = [
  { id: STUB_WORKSPACE.id, name: 'Phòng Kinh doanh', slug: 'kinh-doanh' },
  { id: 'ws_shot_02', name: 'Ban Giám đốc', slug: 'ban-giam-doc' },
]
const DOCS = [
  'Hợp đồng đại lý miền Trung.pdf',
  'Đề xuất hợp tác An Phú Group.pptx',
  'Báo cáo doanh thu tháng 9.xlsx',
  'Kế hoạch kinh doanh quý 4.docx',
]
const NOTES = [
  'Gọi lại chị Hà (An Phú) trước 15h để chốt báo giá',
  'Mang bản in hợp đồng đại lý cho buổi họp thứ Năm',
]

const pad = (n: number) => String(n).padStart(2, '0')
const shifted = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d
}
const day = (offset: number) => {
  const d = shifted(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const at = (offset: number, h: number, m = 0) => {
  const d = shifted(offset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const fromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

type TaskRow = [n: number, title: string, status: string, priority: string, due: number | null]
const TASKS: TaskRow[] = [
  [14, 'Đối soát hóa đơn tháng 9 với Công ty Minh Phát', 'in_progress', 'high', -2],
  [15, 'Gửi biên bản nghiệm thu cho Thành Đạt Logistics', 'todo', 'medium', -1],
  [17, 'Gửi báo giá thiết bị cho An Phú Group', 'todo', 'urgent', 0],
  [18, 'Duyệt hợp đồng đại lý khu vực miền Trung', 'in_review', 'high', 0],
  [19, 'Chốt lịch demo với Ngân hàng Phương Nam', 'todo', 'medium', 0],
  [21, 'Chuẩn bị hồ sơ dự thầu Sơn Hà', 'todo', 'high', 3],
  [23, 'Cập nhật CRM khách hàng khu vực Đà Nẵng', 'backlog', 'low', 6],
  [25, 'Lên kế hoạch hội nghị khách hàng quý 4', 'backlog', 'medium', null],
]
const task = (ws: string, [n, title, status, priority, due]: TaskRow) => ({
  id: `task_shot_${n}`,
  organization_id: STUB_ORG.id,
  workspace_id: ws,
  number: n,
  identifier: `KD-${n}`,
  revision: 1,
  title,
  description: '',
  status,
  priority,
  ...(due === null ? {} : { due_date: day(due) }),
  position: n,
  created_by: STUB_ACCOUNT.id,
  created_at: at(-10, 9),
  updated_at: at(-1, 16, 20),
})
const meeting = (
  ws: string,
  n: number,
  title: string,
  starts_at: string,
  ends_at: string,
  status: string,
) => ({
  id: `meet_shot_${n}`,
  workspace_id: ws,
  title,
  description: '',
  starts_at,
  ends_at,
  room_name: `room-${n}`,
  created_by: STUB_ACCOUNT.id,
  status,
})
const notification = (
  ws: string,
  n: number,
  kind: string,
  resource_type: string,
  resource_id: string,
  params: Record<string, string>,
  created_at: string,
) => ({
  id: `ntf_shot_${n}`,
  kind,
  workspace_id: ws,
  organization_id: STUB_ORG.id,
  resource_type,
  resource_id,
  actor_kind: 'human',
  actor_id: `acct_shot_${n}`,
  title_key: `notifications.kind.${kind}`,
  params,
  created_at,
})
const home = (ws: string) => ({
  today: day(0),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  counts: { open: 8, overdue: 2, due_today: 3, meetings_today: 2, unread: 3 },
  my_work: TASKS.slice(0, 6).map((t) => task(ws, t)),
  upcoming_meetings: [
    meeting(ws, 1, 'Họp giao ban phòng Kinh doanh', fromNow(-10), fromNow(35), 'IN_PROGRESS'),
    meeting(
      ws,
      2,
      'Trao đổi điều khoản hợp đồng với An Phú Group',
      fromNow(120),
      fromNow(180),
      'SCHEDULED',
    ),
    meeting(
      ws,
      3,
      'Rà soát kế hoạch bán hàng tuần với Ban Giám đốc',
      at(1, 9, 30),
      at(1, 10, 30),
      'SCHEDULED',
    ),
  ],
  inbox: [
    notification(
      ws,
      1,
      'task_assigned',
      'task',
      'task_shot_17',
      { actor: 'Trần Thu Hà', task: 'Gửi báo giá thiết bị cho An Phú Group' },
      fromNow(-15),
    ),
    notification(
      ws,
      2,
      'mentioned',
      'task',
      'task_shot_21',
      { actor: 'Lê Quốc Bảo', task: 'Chuẩn bị hồ sơ dự thầu Sơn Hà' },
      fromNow(-70),
    ),
    notification(
      ws,
      3,
      'meeting_invited',
      'meeting',
      'meet_shot_3',
      { actor: 'Phạm Ngọc Lan', meeting: 'Rà soát kế hoạch bán hàng tuần với Ban Giám đốc' },
      fromNow(-180),
    ),
  ],
  partial: [],
  generated_at: new Date().toISOString(),
})
const STATUSES = (
  [
    ['backlog', 'Chờ xử lý', '#8b8f96'],
    ['todo', 'Cần làm', '#5b6b80'],
    ['in_progress', 'Đang làm', '#2f6fed'],
    ['in_review', 'Đang duyệt', '#8a5cf6'],
    ['done', 'Hoàn thành', '#1f9d55'],
    ['cancelled', 'Đã hủy', '#9aa0a6'],
  ] as const
).map(([key, name, color], position) => ({
  id: `st_${key}`,
  key,
  name,
  category: key,
  color,
  position,
}))
const event = (
  n: number,
  kind: string,
  entity_id: string,
  title: string,
  start: string,
  end: string,
  all_day: boolean,
) => ({
  id: `ev_${n}`,
  kind,
  entity_id,
  title,
  start,
  end,
  all_day,
  status: null,
  project_id: null,
})
const events = () => [
  event(1, 'task', 'task_shot_17', 'Gửi báo giá thiết bị cho An Phú Group', day(0), day(1), true),
  event(
    2,
    'meeting',
    'meet_shot_1',
    'Họp giao ban phòng Kinh doanh',
    at(0, 8, 30),
    at(0, 9, 15),
    false,
  ),
  event(
    3,
    'meeting',
    'meet_shot_2',
    'Trao đổi điều khoản hợp đồng với An Phú Group',
    at(0, 14),
    at(0, 15),
    false,
  ),
  event(4, 'external', 'gcal_1', 'Khám sức khỏe định kỳ', at(1, 7, 30), at(1, 9), false),
  event(
    5,
    'meeting',
    'meet_shot_3',
    'Rà soát kế hoạch bán hàng tuần với Ban Giám đốc',
    at(1, 9, 30),
    at(1, 10, 30),
    false,
  ),
  event(6, 'task', 'task_shot_21', 'Chuẩn bị hồ sơ dự thầu Sơn Hà', day(3), day(4), true),
  event(7, 'external', 'gcal_2', 'Hội chợ Vietnam Expo', day(5), day(8), true),
  event(8, 'task', 'task_shot_23', 'Cập nhật CRM khách hàng khu vực Đà Nẵng', day(6), day(7), true),
]
const person = (userId: string) => ({
  person: {
    user_id: userId,
    display_name: NAME,
    email: 'minhanh.nguyen@minhphat.example',
    title: 'Trưởng phòng Kinh doanh',
    department: { id: 'dep_kd', name: 'Phòng Kinh doanh' },
    manager: { id: 'acct_gd', kind: 'human', display_name: 'Trần Quốc Hùng' },
    timezone: 'Asia/Ho_Chi_Minh',
  },
  reports: [],
})

/** GET routes the proxy answers itself; undefined = forward to the stub */
function answer(route: string): unknown {
  let m = /^\/workspaces\/([^/]+)\/(home|my-tasks|task-statuses|calendar\/events)$/.exec(route)
  if (m) {
    const ws = m[1]!
    if (m[2] === 'home') return home(ws)
    if (m[2] === 'my-tasks') return { tasks: TASKS.map((t) => task(ws, t)) }
    if (m[2] === 'task-statuses') return { statuses: STATUSES }
    return { events: events() }
  }
  m = /^\/orgs\/[^/]+\/people\/([^/]+)$/.exec(route)
  if (m) return person(m[1]!)
  if (/^\/orgs\/[^/]+\/workspaces$/.test(route)) {
    return {
      workspaces: WORKSPACES.map((w) => ({
        ...w,
        organization_id: STUB_ORG.id,
        organization_slug: STUB_ORG.slug,
      })),
    }
  }
  return undefined
}
/** stub answers rewritten on the way back (display and org names) */
const PATCH: Record<string, (body: any) => unknown> = {
  '/me': (b) => ({ ...b, user: { ...b.user, display_name: NAME } }),
  '/orgs': (b) => ({
    ...b,
    organizations: b.organizations.map((o: object) => ({ ...o, name: 'Công ty TNHH Minh Phát' })),
  }),
}
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function startProxy(target: string) {
  const { hostname, port } = new URL(target)
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://proxy').pathname
    const route = path.startsWith(API) ? path.slice(API.length) : ''
    const own = req.method === 'GET' ? answer(route) : undefined
    if (own !== undefined) return json(res, 200, own)
    const patch = req.method === 'GET' ? PATCH[route] : undefined
    const upstream = request(
      { hostname, port, method: req.method, path: req.url, headers: req.headers },
      (up) => {
        if (!patch || up.statusCode !== 200) {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res)
          return
        }
        const chunks: Buffer[] = []
        up.on('data', (c: Buffer) => chunks.push(c))
        up.on('end', () =>
          json(res, 200, patch(JSON.parse(Buffer.concat(chunks).toString('utf8')))),
        )
      },
    )
    upstream.on('error', () => json(res, 502, { error: { code: 'proxy', message: 'proxy' } }))
    req.pipe(upstream)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function setTheme(p: Page, theme: string) {
  await p.evaluate(
    (t) =>
      (window as unknown as { aiOffice: { setTheme(t: string): unknown } }).aiOffice.setTheme(t),
    theme,
  )
  await expect
    .poll(() => p.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme)
  await p.waitForTimeout(500)
}
/** pins every module and pillar the + menu still offers */
async function pinEverything(p: Page) {
  for (let i = 0; i < 12; i++) {
    await p.locator('.wb-tab-add').click()
    await p.locator('.wb-tab-menu').waitFor()
    const item = p.locator('.wb-tab-menu-item').first()
    if ((await item.count()) === 0) {
      await p.locator('.wb-tab-add').click()
      return
    }
    await item.click()
  }
}
/** tab labels without the count, its screen-reader twin, the grip and the × */
const tabNames = (p: Page) =>
  p.locator('.wb-tab-module').evaluateAll((els) =>
    els.map((el) => {
      const c = el.cloneNode(true) as HTMLElement
      c.querySelectorAll('.wb-tab-count, .uw-sr-only, .wb-tab-grip, .wb-tab-unpin').forEach((x) =>
        x.remove(),
      )
      return (c.textContent ?? '').trim()
    }),
  )
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

let notesSeeded = false

test('shots after', async () => {
  test.setTimeout(840_000)
  mkdirSync(OUT, { recursive: true })
  const stub = await startUniworkDocumentsStub()
  const proxy = await startProxy(stub.origin)
  const env = { ...shellEnv(stub), UNIWORK_API_ORIGIN: proxy.origin }
  for (const filename of DOCS) stub.addDocument({ filename, bytes: Buffer.from(filename) })
  try {
    const first = await launchShell({ onboardingSeen: true, videoDir: 'shots-setup', env })
    const userDataDir = first.userDataDir
    await signIn(first, stub)
    await first.app.close()
    for (const lang of ['vi', 'en']) {
      for (const mode of ['signedout', 'in'] as const) {
        const l = await launchShell({
          userDataDir: mode === 'in' ? userDataDir : undefined,
          onboardingSeen: true,
          lang,
          videoDir: 'shots',
          env,
        })
        const p = l.page
        await p.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
        await l.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.setSize(1440, 900)),
        )
        const shot = async (name: string, theme: string) => {
          await p.waitForTimeout(600)
          await p.screenshot({ path: `${OUT}${name}-${theme}-${lang}.png` })
        }
        try {
          if (mode === 'in')
            await expect(accountButton(p)).toHaveAttribute('data-state', 'signed-in', {
              timeout: 45_000,
            })
          for (const theme of ['light', 'dark']) {
            await setTheme(p, theme)
            await p.locator('.nav-item', { hasText: /Workbench|Bàn làm việc/ }).click()
            await p.waitForTimeout(1500)
            if (mode === 'signedout') {
              await shot('00-signed-out', theme)
              continue
            }
            await pinEverything(p)
            const names = await tabNames(p)
            console.log(lang, theme, names.join(' | '))
            for (let i = 0; i < names.length; i++) {
              await p.locator('.wb-tab-module').nth(i).click()
              await p.waitForTimeout(1500)
              const noteInput = p.locator('.wb-notes form input')
              if (!notesSeeded && (await noteInput.count())) {
                for (const text of NOTES) {
                  await noteInput.fill(text)
                  await noteInput.press('Enter')
                }
                notesSeeded = true
                await p.waitForTimeout(400)
              }
              await shot(`${pad(i + 1)}-${slug(names[i]!)}`, theme)
            }
            await p.locator('.wb-tab-module').first().click()
            await p.locator('.wb-tab-add').click()
            await shot('11-menu-tab-add', theme)
            await p.locator('.wb-tab-add').click()
            await p.locator('.wb-new-wrap > button[aria-haspopup="menu"]').click()
            await shot('12-menu-new', theme)
            await p.keyboard.press('Escape')
          }
        } finally {
          await l.app.close().catch(() => {})
        }
      }
    }
  } finally {
    await proxy.close()
    await stub.close()
  }
})
```

Hex trong `STATUSES` là dữ liệu stub phía server (màu trạng thái của UniWork), không phải chrome; file này nằm ngoài repo nên không đi qua theme check.

- [ ] **Step 3: Build lại shell**

Run: `cd /Users/ducquang/UNICOM/uniwork-office && npm run build -w @genoffice/shell`
Expected: electron-vite báo main, preload và renderer đều "built in …", không lỗi. `apps/docs/out` đã có sẵn; smoke Tổng quan mở một tài liệu trong đó.

- [ ] **Step 4: Chụp ảnh sau**

Chạy nền (Bash `run_in_background: true`, vì lâu hơn giới hạn 10 phút của lệnh thường):

`cd /private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad && npx playwright test -c pw.config.ts > shots-after.log 2>&1`

Khi xong, xem cuối `shots-after.log`. Expected: `1 passed`. Log cũng in danh sách tab, ví dụ `vi light Tổng quan | Lịch | Công việc | … | Soạn thảo`, 10 tên mỗi dòng.

- [ ] **Step 5: Kiểm bộ ảnh**

```bash
ls /private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots/after | wc -l
```

Expected: `52`, gồm 4 × `00-signed-out-{light,dark}-{vi,en}.png`; 40 × `NN-<tab-slug>-{light,dark}-{vi,en}.png` với NN từ 01 tới 10; 4 × `11-menu-tab-add-*`; 4 × `12-menu-new-*`.

- [ ] **Step 6: Đối chiếu bằng mắt với spec**

Mở bằng công cụ Read: `01-*-light-vi.png` và `01-*-dark-vi.png` (Tổng quan), ảnh Công việc, Lịch, Hồ sơ ở `-dark-en` và `-light-vi`, và `00-signed-out-dark-vi.png`. Xác nhận:

- **Thanh trên:** chip breadcrumb "Phòng Kinh doanh ▾ / Bàn làm việc", chip vai trò, nút Làm mới chỉ có icon, nút "+ Tạo mới" màu brand (không đen).
- **Thanh tab:** số `2` màu đỏ trên Công việc và số `2` trên Lịch; tab đang chọn có vạch accent 2px lùi 8px hai bên.
- **Tổng quan:** lời chào "…, Anh"; dải 5 ô là một khối; Việc của tôi chia Quá hạn / Hôm nay / Sắp tới với mã mono `KD-n`; cuộc họp đang diễn ra có nút chính nhỏ "Vào họp"; 4 tài liệu gần đây trên một hàng.
- **Tab khác:** `WorkPaneHeader` có ô tint, tiêu đề và một dòng meta, không còn thẻ lồng thẻ. Công việc hiện "Đang mở: 8" ở tiêu đề. Lịch có tiêu đề ngày sticky và chấm trên Hôm nay. Hồ sơ có ô chữ cái hồng 48px và "Trưởng phòng Kinh doanh".
- **Trạng thái:** Biểu mẫu hiện `WorkStatePanel` không viền; không có hộp viền đứt nào ngoài dấu + trước "Thêm việc…". Trang chưa đăng nhập không có chip workspace, chỉ có chip vai trò.
- **Chế độ tối:** các khối tách nhau bằng viền, không bóng; mọi cặp chữ đều đọc được.
- **Bố cục:** ở cửa sổ 1440px, cột nội dung dừng ở 1180px, căn trái.

Với mỗi mục không khớp, ghi tên file và chỗ lệch vào báo cáo. Không sửa gì trong task này.

- [ ] **Step 7: Smoke e2e Tổng quan**

Run: `cd /Users/ducquang/UNICOM/uniwork-office && npx playwright test --config e2e/playwright.config.ts workbench-overview`
Expected: `1 passed`: 5 ô `.wb-ov-stat` với 7/1/2/3/5, và `weekly-plan.docx` mở trong Docs. Spec này dùng stub thường, không qua proxy.

- [ ] **Step 8: Báo cáo (không commit)**

Báo lại cho bên gọi:

- thư mục ảnh `/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots/after/` và 52 tên file;
- bộ ảnh trước `/private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork-office/eca50c35-271c-47c9-92ef-3f411ec32942/scratchpad/shots/*.png`;
- kết quả smoke và mọi chỗ lệch ở Step 6.

Task này không đổi gì trong repo; `git status` chỉ còn `package-lock.json` và `.codegraph/` như lúc bắt đầu.
