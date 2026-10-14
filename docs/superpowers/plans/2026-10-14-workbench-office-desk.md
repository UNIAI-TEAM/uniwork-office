# Workbench Office Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab `desk` của Bàn làm việc đổi từ dashboard công việc thành mặt bàn giấy tờ, gồm năm phần:

- Dụng cụ (PDF→Word/Excel/PowerPoint, Xuất PDF, Ghép PDF, Tách PDF), có thêm vùng thả tệp.
- Cần bạn xử lý.
- Đang làm dở.
- Ngăn kéo biểu mẫu.
- Cột Hôm nay.

**Architecture:**

- **Main-process:** thêm 3 lệnh mới.
  - `listDrafts`: gom các tab chưa lưu và các bản tự lưu mới hơn tệp gốc.
  - `runDeskTool`: một handler kiểm tra đầu vào rồi gọi lại các hàm chuyển đổi đã có. Lõi PDF→Office được tách khỏi menu tab PDF để hai nơi dùng chung.
  - `markNotificationsRead`: gọi route server có sẵn.
- **Renderer:**
  - `WorkOverview.tsx` thay bằng `DeskView` cùng 5 component con, mỗi component một file.
  - Logic thuần nằm ở `desk-model.ts`.
  - Lấy dữ liệu bằng các hook có sẵn (`useWorkLoad`, `useRecentDocuments`).

**Tech Stack:** Electron (main + preload + renderer), React 19, TypeScript strict, vitest (jsdom cho component), CSS token trong `home.css`.

**Spec:** `docs/superpowers/specs/2026-10-14-workbench-office-desk-design.md`

## Global Constraints

- **Màu:** chỉ dùng token (`var(--…)`) trong CSS và style inline. Không viết `#hex`/`rgb()` mới (`tools/check-theme-colors.mjs`).
- **Token mới:** thêm đủ 3 khối trong `packages/ui/src/tokens.css`. Plan này không thêm token nào.
- **Chuỗi UI:** khóa mới thêm vào `i18n/workbench/zh.ts` và đủ 20 shard còn lại. Mỗi shard có `satisfies Record<keyof typeof zh, string>`.
- **Hook:** không đưa `t` của `useI18n()` vào mảng phụ thuộc. State lưu key, dịch lúc render.
- **Build:** code `apps/*/src/main` được build vào shell, nên sửa main thì phải rebuild shell. Sửa preload cũng phải rebuild.
- **Comment:** viết bằng tiếng Anh (`npm run check:english-comments`).
- **Kiểm tra lại ở main:** mọi đường dẫn và tham số từ renderer đều được kiểm tra lại ở main (biên tin cậy).
- **Lệnh:** chạy test từ `apps/shell`: `npx vitest run <file>`. Typecheck: `npm run typecheck -w @genoffice/shell` từ gốc repo.

## Spec deviations (simplifications, mỗi điểm một dòng)

1. **`inboxTarget` không mở rộng.** Thông báo tài liệu mở thẳng từ khay bằng `openUniworkDocument`, còn dòng "Thông báo khác" mở trang inbox web. `inboxTarget` thành code chết và bị xóa ở Task 12.
2. **Dòng "Đang làm dở" không có chip đồng bộ.** Sự cố đồng bộ đã hiện ở khay Cần bạn xử lý.
3. **Xuất PDF và Ghép PDF từ chối với `target-open`** khi tệp đích đang mở trong tab PDF, thay vì tự đóng tab. PDF→Office giữ nguyên luồng đóng tab cũ.
4. **Lỗi PDF→Office hiện hộp thoại lỗi native có sẵn.** IPC khi đó trả `canceled` để renderer không báo trùng.
5. **Thả tệp hoạt động theo hai bước:** thả vào mặt bàn trước, rồi chọn dụng cụ trong bảng hiện ra. Lý do: lúc đang kéo, trình duyệt chưa cho đọc đường dẫn tệp.
6. **Tách PDF ghi vào thư mục mới `<tên>-parts`.** Nếu tên đã có thì thêm ` 2`, ` 3`…, để không bao giờ ghi đè. Các phần tách ra không được đẩy vào danh sách tệp gần đây (thường có nhiều tệp); toast có nút Hiện trong thư mục.
7. **Ô rỗng "Đang làm dở" chỉ có nút "Mở tệp…".** Nút "+ Tạo mới" đã nằm sẵn trên thanh trên.

## Review Focus

1. **Thả một thư mục, ảnh, hay hỗn hợp PDF với docx.** Không dụng cụ nào được chạy. Bảng thả hiện "Không có dụng cụ cho loại tệp này" và nút Mở. Kiểm thử ở `applicableTools` (Task 5).
2. **Bấm Ghép PDF hai lần thật nhanh, hoặc bấm khi menu tab PDF đang chuyển đổi.** Lần sau phải nhận `busy` và không mở hộp thoại thứ hai. Kiểm thử ở `runDeskTool` (Task 4).
3. **Chọn tệp đích trùng một tệp nguồn khi ghép.** Phải từ chối với `same-path`, không ghi đè nguồn. Kiểm thử ở Task 4.
4. **Đang tách PDF mà thư mục `<tên>-parts` đã có từ lần trước.** Phải ghi vào `<tên>-parts 2`. Kiểm thử ở Task 4.
5. **Mở thông báo tài liệu khi server từ chối đánh dấu đã đọc.** Tài liệu vẫn mở và không có lỗi nào hiện ra. Dòng thông báo vẫn còn cho tới lần tải sau. Kiểm thử ở `DeskInTray` (Task 9).

---

## File Structure

| File                                                                                    | Trách nhiệm                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/shell/src/shared/uniwork-work-api.ts` (sửa)                                       | kênh + kiểu `markNotificationsRead`                             |
| `apps/shell/src/main/uniwork-work/client.ts`, `wiring.ts` (sửa)                         | gọi `POST /me/notifications/read`                               |
| `apps/shell/src/shared/home-api.ts` (sửa)                                               | `DeskDraft`, `DeskTool*`, `listDrafts`, `runDeskTool`, kênh     |
| `apps/shell/src/preload/index.ts` (sửa)                                                 | expose 3 lệnh mới                                               |
| `apps/{docs,sheets,slides}/src/main/*-main.ts` (sửa)                                    | `recoveryCopyMtime(path)` đọc-only                              |
| `apps/shell/src/main/desk-drafts.ts` (mới)                                              | gom tab chưa lưu + bản khôi phục (thuần, test được)             |
| `apps/shell/src/main/desk-tools.ts` (mới)                                               | `runDeskTool` + `checkDeskInputs` (thuần với deps)              |
| `apps/shell/src/main/index.ts` (sửa)                                                    | tách `convertPdfToOffice`, đăng ký 2 IPC, tab activate detached |
| `apps/shell/src/renderer/src/desk-model.ts` (mới)                                       | hàm thuần cho khay, đang làm dở, dụng cụ hợp lệ                 |
| `apps/shell/src/renderer/src/form-draft.ts` (mới)                                       | "Soạn" từ biểu mẫu, dùng chung Biểu mẫu và Ngăn kéo             |
| `apps/shell/src/renderer/src/Desk{View,Tools,InTray,InProgress,Drawer,Today}.tsx` (mới) | mặt bàn                                                         |
| `apps/shell/src/renderer/src/work-home.ts` (sửa)                                        | `useRecentDocuments` trả thêm `local`, nhận `limit`             |
| `apps/shell/src/renderer/src/PracticeHome.tsx` (sửa)                                    | render `DeskView`                                               |
| `apps/shell/src/renderer/src/home.css` (sửa)                                            | `.wb-desk*`                                                     |
| `apps/shell/src/renderer/src/i18n/workbench/*.ts` (sửa, 21 file)                        | khóa `wbDesk*`                                                  |
| `packages/practice-core/src/modules.ts` (sửa)                                           | nhãn `desk` → Mặt bàn / Desk                                    |
| `apps/shell/src/renderer/src/WorkOverview.tsx`, `tests/work-overview.test.ts` (xóa)     | thay bằng Desk                                                  |

---

### Task 1: `markNotificationsRead` từ renderer tới server

**Files:**

- Modify: `apps/shell/src/shared/uniwork-work-api.ts` (kênh ~dòng 176, interface ~dòng 194)
- Modify: `apps/shell/src/main/uniwork-work/client.ts`
- Modify: `apps/shell/src/main/uniwork-work/wiring.ts:97`
- Modify: `apps/shell/src/preload/index.ts` (object `workApi`, ~dòng 1199)
- Test: `apps/shell/tests/uniwork-work-client.test.ts`

**Interfaces:**

- Produces: `window.uniworkWork.markNotificationsRead(ids: string[]): Promise<UniworkWorkResult<null>>`

- [ ] **Step 1: Write the failing test.** Thêm vào cuối `tests/uniwork-work-client.test.ts`:

```ts
describe('uniwork work client: notifications', () => {
  it('POST /me/notifications/read sends only the ids', async () => {
    const fetch = server({ '/me/notifications/read': () => json(200, { status: 'ok', ids: [] }) })
    expect(await client(fetch).markNotificationsRead(['n_1', 'n_2'])).toBeNull()
    const [url, init] = fetch.mock.calls[0]!
    expect(`${init.method} ${url}`).toBe(`POST ${ORIGIN}/api/v1/me/notifications/read`)
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['n_1', 'n_2'] })
  })

  it('refuses an empty or oversized id list without calling the server', async () => {
    const fetch = server()
    expect(await codeOf(client(fetch).markNotificationsRead([]))).toBe('server_error')
    const many = Array.from({ length: 101 }, (_, i) => `n_${i}`)
    expect(await codeOf(client(fetch).markNotificationsRead(many))).toBe('server_error')
    expect(fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/uniwork-work-client.test.ts`
Expected: FAIL. Lỗi là `markNotificationsRead is not a function` (hoặc lỗi type).

- [ ] **Step 3: Implement.**

Trong `shared/uniwork-work-api.ts`, thêm vào `UNIWORK_WORK_CHANNELS` ngay trước `openWeb`:

```ts
  markNotificationsRead: 'uniwork-work:mark-notifications-read',
```

Thêm vào `interface UniworkWorkApi`, ngay trước `openWeb`:

```ts
  /** POST /me/notifications/read: the caller's own ids (1-100); someone else's id is a 404 */
  markNotificationsRead(ids: string[]): Promise<UniworkWorkResult<null>>
```

Trong `main/uniwork-work/client.ts`, thêm vào `interface UniworkWorkClient` sau `person(...)`:

```ts
  /** POST /me/notifications/read: the caller's own ids (1-100); someone else's id is a 404 */
  markNotificationsRead(ids: string[]): Promise<null>
```

Thêm vào object trả về, sau `person`:

```ts
    async markNotificationsRead(ids) {
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) refuse()
      // uniworkId checks each id; the JSON body carries them as they are
      for (const id of ids) uniworkId(id)
      await send({ method: 'POST', route: '/me/notifications/read', json: { ids }, timeoutMs, read })
      return null
    },
```

Trong `main/uniwork-work/wiring.ts`, thêm sau dòng `handle(C.setTaskStatus, …)`:

```ts
handle(C.markNotificationsRead, (ids) =>
  api().markNotificationsRead(Array.isArray(ids) ? ids.map(str) : []),
)
```

Trong `preload/index.ts`, thêm vào `workApi` trước `openWeb`:

```ts
  async markNotificationsRead(ids) {
    return asWorkResult<null>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.markNotificationsRead, ids),
    )
  },
```

- [ ] **Step 4: Run tests.**

Run: `cd apps/shell && npx vitest run tests/uniwork-work-client.test.ts tests/uniwork-work-wiring.test.ts`
Expected: PASS. Test wiring tự kiểm tra rằng mọi kênh trong `UNIWORK_WORK_CHANNELS` đều có handler.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/src/shared/uniwork-work-api.ts apps/shell/src/main/uniwork-work apps/shell/src/preload/index.ts apps/shell/tests/uniwork-work-client.test.ts
git commit -m "feat(shell): mark UniWork notifications read from the desktop"
```

---

### Task 2: `listDrafts`: tab chưa lưu và bản khôi phục

**Files:**

- Create: `apps/shell/src/main/desk-drafts.ts`
- Modify: `apps/docs/src/main/docs-main.ts` (sau `recoveryPathFor`, ~dòng 3448)
- Modify: `apps/sheets/src/main/sheets-main.ts` (sau `recoveryPathFor`, ~dòng 1909)
- Modify: `apps/slides/src/main/slides-main.ts` (sau `autosavePathFor`, ~dòng 387; import `statSync` ở dòng 33)
- Modify: `apps/shell/src/shared/home-api.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/main/index.ts`
- Test: `apps/shell/tests/desk-drafts.test.ts`

**Interfaces:**

- Produces (shared):

```ts
export interface DeskDraft {
  kind: 'unsaved' | 'recovery'
  title: string
  app: DocumentTabKind
  filePath?: string
  tabId?: string
  modifiedMs?: number
}
```

- Produces: `window.aiOffice.listDrafts(): Promise<DeskDraft[]>`. Ngoài ra `aiOfficeTabs.activate(id)` giờ chấp nhận cả id `detached:<n>`.

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-drafts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { OpenDocumentTab } from '../src/shared/tabs-api'
import { listDeskDrafts, type RecoveryProbe } from '../src/main/desk-drafts'

const tab = (over: Partial<OpenDocumentTab> = {}): OpenDocumentTab => ({
  id: 't1',
  kind: 'docs',
  title: 'Report',
  filePath: '/w/report.docx',
  active: false,
  dirty: false,
  ...over,
})
const untitled = (over: Partial<OpenDocumentTab>): OpenDocumentTab => {
  const t = tab(over)
  delete t.filePath
  return t
}
const probes = (copies: Record<string, number>): RecoveryProbe[] => [
  { app: 'docs', ext: /\.docx$/i, mtime: (p) => copies[p] ?? null },
  { app: 'slides', ext: /\.pptx$/i, mtime: (p) => copies[p] ?? null },
]

describe('listDeskDrafts', () => {
  it('lists dirty tabs (main and detached, untitled too) before recovery copies', async () => {
    const drafts = await listDeskDrafts({
      openTabs: async () => [
        tab({ dirty: true }),
        tab({ id: 't2', title: 'Clean', filePath: '/w/clean.docx' }),
        untitled({ id: 'detached:9', kind: 'sheets', title: 'Untitled', dirty: true }),
      ],
      recents: () => ['/w/old.docx'],
      probes: probes({ '/w/old.docx': 500 }),
    })
    expect(drafts).toEqual([
      { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/report.docx' },
      { kind: 'unsaved', title: 'Untitled', app: 'sheets', tabId: 'detached:9' },
      {
        kind: 'recovery',
        title: 'old.docx',
        app: 'docs',
        filePath: '/w/old.docx',
        modifiedMs: 500,
      },
    ])
  })

  it('skips a recent file that is open, has no probe, or has no newer copy', async () => {
    const drafts = await listDeskDrafts({
      openTabs: async () => [tab({ filePath: '/w/open.docx' })],
      recents: () => ['/w/open.docx', '/w/notes.md', '/w/clean.pptx'],
      probes: probes({ '/w/open.docx': 900 }),
    })
    expect(drafts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-drafts.test.ts`
Expected: FAIL. Lỗi là `Cannot find module '../src/main/desk-drafts'`.

- [ ] **Step 3: Implement `desk-drafts.ts`.** Tạo file `apps/shell/src/main/desk-drafts.ts`:

```ts
import { basename } from 'node:path'
import type { DeskDraft } from '../shared/home-api'
import type { DocumentTabKind, OpenDocumentTab } from '../shared/tabs-api'

/** One editor's crash-copy probe: which recents it owns and the copy's mtime (null = none newer). */
export interface RecoveryProbe {
  app: DocumentTabKind
  ext: RegExp
  mtime(path: string): number | null
}

/**
 * The Desk's "In progress" drafts: every open tab (main window and detached)
 * with unsaved changes, then each recent file that is not open but has a
 * crash copy newer than itself. Only stats, never reads a document.
 */
export async function listDeskDrafts(deps: {
  openTabs(): Promise<OpenDocumentTab[]>
  recents(): string[]
  probes: readonly RecoveryProbe[]
}): Promise<DeskDraft[]> {
  const tabs = await deps.openTabs()
  const open = new Set(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])))
  const unsaved = tabs
    .filter((t) => t.dirty)
    .map((t): DeskDraft => ({
      kind: 'unsaved',
      title: t.title,
      app: t.kind,
      tabId: t.id,
      ...(t.filePath ? { filePath: t.filePath } : {}),
    }))
  const recovery: DeskDraft[] = []
  for (const path of deps.recents()) {
    if (open.has(path)) continue
    const probe = deps.probes.find((p) => p.ext.test(path))
    const at = probe ? probe.mtime(path) : null
    if (probe && at !== null) {
      recovery.push({
        kind: 'recovery',
        title: basename(path),
        app: probe.app,
        filePath: path,
        modifiedMs: at,
      })
    }
  }
  return [...unsaved, ...recovery]
}
```

- [ ] **Step 4: Add the shared type, channel and API.** Trong `shared/home-api.ts`:

Thêm ở đầu file, cạnh các import khác:

```ts
import type { DocumentTabKind } from './tabs-api'
```

Thêm gần các kiểu Home khác (ví dụ ngay trên `export interface HomeApi`):

```ts
/** Desk "In progress": an open tab with unsaved changes, or a crash copy newer than its recent file */
export interface DeskDraft {
  kind: 'unsaved' | 'recovery'
  title: string
  app: DocumentTabKind
  /** absent for an untitled unsaved tab */
  filePath?: string
  /** the tab to switch to ('unsaved' only; 'detached:<n>' for a detached window) */
  tabId?: string
  /** when the crash copy was written ('recovery' only) */
  modifiedMs?: number
}
```

Thêm vào `interface HomeApi`, ngay sau `revealPath(path: string): Promise<void>`:

```ts
  /** Desk: open tabs with unsaved changes, then crash copies newer than a recent file that is not open */
  listDrafts(): Promise<DeskDraft[]>
```

Thêm vào `HOME_CHANNELS`, sau `revealPath: 'home:reveal-path',`:

```ts
  listDrafts: 'home:list-drafts',
```

- [ ] **Step 5: Add the editor probes.** Thêm hàm sau ngay dưới `recoveryPathFor` trong `apps/docs/src/main/docs-main.ts`, và cũng ngay dưới `recoveryPathFor` trong `apps/sheets/src/main/sheets-main.ts`:

```ts
/** mtime of a crash copy newer than `filePath`, or null; read-only (the shell's Desk lists it, opening offers the restore) */
export function recoveryCopyMtime(filePath: string): number | null {
  try {
    const copy = recoveryPathFor(filePath)
    if (!existsSync(copy)) return null
    const at = statSync(copy).mtimeMs
    return at > statSync(filePath).mtimeMs ? at : null
  } catch {
    return null
  }
}
```

Trong `apps/slides/src/main/slides-main.ts`:

1. Sửa dòng 33 thành `import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'`.
2. Thêm hàm sau ngay dưới `autosavePathFor`:

```ts
/** mtime of a crash copy newer than `filePath`, or null; read-only (the shell's Desk lists it, opening offers the restore) */
export function recoveryCopyMtime(filePath: string): number | null {
  try {
    const copy = autosavePathFor(filePath)
    if (!existsSync(copy)) return null
    const at = statSync(copy).mtimeMs
    return at > statSync(filePath).mtimeMs ? at : null
  } catch {
    return null
  }
}
```

- [ ] **Step 6: Wire main.** Trong `apps/shell/src/main/index.ts`:

1. Thêm `recoveryCopyMtime as docsRecoveryCopyMtime,` vào block import kết thúc bằng `} from '../../../docs/src/main/docs-main'` (~dòng 165).
2. Thêm `recoveryCopyMtime as sheetsRecoveryCopyMtime,` vào block import `sheets-main` (~dòng 208).
3. Thêm `recoveryCopyMtime as slidesRecoveryCopyMtime,` vào block import `slides-main` (~dòng 223).
4. Thêm `import { listDeskDrafts } from './desk-drafts'` cạnh các import `./…` khác.
5. Thêm ngay sau handler `ipcMain.handle(HOME_CHANNELS.revealPath, …)` (~dòng 4642):

```ts
ipcMain.handle(HOME_CHANNELS.listDrafts, () =>
  listDeskDrafts({
    openTabs: async () => [
      ...(tabManager ? await tabManager.openDocuments() : []),
      ...(await detachedOpenDocuments()),
    ],
    recents: readRecentFiles,
    probes: [
      { app: 'docs', ext: /\.docx$/i, mtime: docsRecoveryCopyMtime },
      { app: 'sheets', ext: /\.(xlsx|xlsm|xls|csv)$/i, mtime: sheetsRecoveryCopyMtime },
      { app: 'slides', ext: /\.pptx$/i, mtime: slidesRecoveryCopyMtime },
    ],
  }),
)
```

6. Trong `registerTabsIpc()`, sửa handler `TABS_CHANNELS.activate` thành như dưới đây. Đây là cách MCP `open_documents` đang làm ở ~dòng 6526.

```ts
ipcMain.handle(TABS_CHANNELS.activate, (_event, id: unknown) => {
  if (typeof id !== 'string' || !id) return
  if (!activateDetached(id)) tabManager?.activateTab(id)
})
```

Trong `preload/index.ts`:

1. Thêm `DeskDraft` vào import type từ `'../shared/home-api'`.
2. Thêm vào object `api` (aiOffice), ngay sau `revealPath`:

```ts
  async listDrafts() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listDrafts)) as DeskDraft[]
  },
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd apps/shell && npx vitest run tests/desk-drafts.test.ts && cd ../.. && npm run typecheck -w @genoffice/shell`
Expected: PASS, không có lỗi type.

- [ ] **Step 8: Commit**

```bash
git add apps/shell/src/main/desk-drafts.ts apps/shell/tests/desk-drafts.test.ts apps/shell/src/shared/home-api.ts apps/shell/src/preload/index.ts apps/shell/src/main/index.ts apps/docs/src/main/docs-main.ts apps/sheets/src/main/sheets-main.ts apps/slides/src/main/slides-main.ts
git commit -m "feat(shell): list unsaved tabs and recovery copies for the Desk"
```

---

### Task 3: Tách lõi PDF→Office khỏi menu tab PDF (không đổi hành vi)

**Files:**

- Modify: `apps/shell/src/main/index.ts:5741-6105`. Vùng này gồm `exportingPdfDocx`, `exportPdfAsDocxLocal`, `exportPdfAsPptxLocal`, `exportPdfAsXlsxLocal`.

**Interfaces:**

- Produces (trong `index.ts`, Task 4 sẽ dùng):
  - `type PdfOfficeKind = 'docx' | 'pptx' | 'xlsx'`
  - `convertPdfToOffice(kind: PdfOfficeKind, pdfPath: string, host: BrowserWindow, returnTo?: string): Promise<string | null>`
  - Biến `exportingPdfDocx` giữ nguyên tên.
- `exportPdfAsDocxLocal` / `exportPdfAsPptxLocal` / `exportPdfAsXlsxLocal` giữ nguyên tên và chữ ký, nên handler `PDF_CHANNELS.convertOffice` và menu không phải sửa.

- [ ] **Step 1: Replace the three functions.** Xóa từ comment `In-flight guard: covers the whole flow…` phía trên `let exportingPdfDocx = false` cho tới hết hàm `exportPdfAsXlsxLocal`. Dừng ngay trước comment `// The pdf renderer's converter dropdown funnels…`. Dán đoạn sau vào chỗ đó:

```ts
/**
 * In-flight guard: covers the whole flow (dialogs included) so re-triggering
 * from the menu or the Desk can never start a second conversion
 */
let exportingPdfDocx = false

type PdfOfficeKind = 'docx' | 'pptx' | 'xlsx'
type MainKey = Parameters<typeof tm>[0]

/** per-format copy for the shared PDF → Office flow */
const PDF_OFFICE_COPY: Record<PdfOfficeKind, { filter: MainKey; busy: MainKey; failed: MainKey }> =
  {
    docx: { filter: 'filterWord', busy: 'pdfDocxBusyMsg', failed: 'pdfDocxFailedMsg' },
    pptx: { filter: 'filterPpt', busy: 'pdfPptxBusyMsg', failed: 'pdfPptxFailedMsg' },
    xlsx: { filter: 'filterExcel', busy: 'pdfXlsxBusyMsg', failed: 'pdfXlsxFailedMsg' },
  }

/** the editor tab already showing `path` in the format a conversion writes */
function officeTabByPath(kind: PdfOfficeKind, path: string): string | undefined {
  if (kind === 'docx') return tabManager?.findDocsTabByPath(path)
  if (kind === 'pptx') return tabManager?.findSlidesTabByPath(path)
  return tabManager?.findSheetsTabByPath(path)
}

/**
 * Local PDF → Word / PowerPoint / Excel (pdf2docx P4, pdf2pptx P25, pdf2xlsx
 * P26), shared by the PDF tab's File menu and the Desk tools: pick the
 * destination, close a stale tab on it, convert in-process via PDFium wasm
 * (password prompt included), write, and explain degraded pages. Resolves
 * the written path, or null when the user cancelled or the failure was
 * already shown. `returnTo` re-activates that tab after a stale-tab close.
 * No login, no credits; pdfium never runs two conversions at once.
 */
async function convertPdfToOffice(
  kind: PdfOfficeKind,
  pdfPath: string,
  host: BrowserWindow,
  returnTo?: string,
): Promise<string | null> {
  const copy = PDF_OFFICE_COPY[kind]
  if (exportingPdfDocx) {
    void dialog.showMessageBox(host, { type: 'info', message: tm(copy.busy) })
    return null
  }
  exportingPdfDocx = true
  try {
    const picked = await showSaveDialogWithMemory(dialog, host, {
      defaultPath: pdfPath.replace(/\.pdf$/i, `.${kind}`),
      filters: [{ name: tm(copy.filter), extensions: [kind] }],
    })
    if (picked.canceled || !picked.filePath) return null
    const target = picked.filePath
    // If the destination is already open in an editor tab, close it first (its
    // normal unsaved-changes guard applies) so the converted file opens fresh
    // instead of leaving a stale tab whose next save would clobber the result.
    const staleTabId = officeTabByPath(kind, target)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      if (returnTo) tabManager?.activateTab(returnTo)
      if (officeTabByPath(kind, target)) return null
    }
    host.setProgressBar(2)
    // encrypted PDFs prompt for the password (P23), looping on wrong entries;
    // null result = user cancelled the prompt → abort silently
    const promptPassword = (retry: boolean) =>
      promptPdfPassword(host, {
        fileName: basename(pdfPath),
        retry,
        busy: false,
        lang: currentLang(),
        strings: {
          title: tm('pdfPwdTitle'),
          prompt: tm('pdfPwdPrompt'),
          retryPrompt: tm('pdfPwdRetryPrompt'),
          ok: tm('pdfPwdOk'),
          cancel: tm('btnCancel'),
          verifying: tm('pdfPwdVerifying'),
          label: tm('pdfPwdLabel'),
          placeholder: tm('pdfPwdPlaceholder'),
          show: tm('pdfPwdShow'),
          hide: tm('pdfPwdHide'),
        },
      })
    const onProgress = (page: number, total: number) => {
      if (!host.isDestroyed() && total > 0) host.setProgressBar(page / total)
    }

    if (kind === 'docx') {
      const result = await convertPdfFileToDocxLocalWithPrompt(pdfPath, promptPassword, onProgress)
      if (result === null) return null
      await atomicWriteFile(target, result.docx)
      // degrade transparency (plan §7.6 dual-track split): whole scan → say so
      // once; individual image-fallback pages → name them;
      // OCR-recovered scans ('ocr') are SUCCESSES — announce the recovery (the
      // user should proofread machine-read text), never the image-export notice
      const ocrPages = result.pageResults.filter((r) => r.status === 'ocr').map((r) => r.page)
      const imagePages = result.pageResults
        .filter((r) => r.status !== 'ok' && r.status !== 'ocr')
        .map((r) => r.page)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfDocxLocalScannedDetail'),
        })
      } else if (imagePages.length > 0 && ocrPages.length > 0) {
        // mixed documents surface BOTH facts in one dialog: which pages shipped
        // as images and which carry machine-read text the user should proofread
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail:
            tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }) +
            '\n\n' +
            tm('pdfDocxLocalOcrDetail', { pages: ocrPages.join(', ') }),
        })
      } else if (imagePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail: tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }),
        })
      } else if (ocrPages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalOcrMsg'),
          detail: tm('pdfDocxLocalOcrDetail', { pages: ocrPages.join(', ') }),
        })
      }
    } else if (kind === 'pptx') {
      const result = await convertPdfFileToPptxLocalWithPrompt(pdfPath, promptPassword, onProgress)
      if (result === null) return null
      await atomicWriteFile(target, result.pptx)
      // degrade transparency (same split as the Word export): whole scan vs
      // individual image-fallback pages
      const imagePages = result.pageResults.filter((r) => r.status !== 'ok').map((r) => r.page)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfPptxLocalScannedDetail'),
        })
      } else if (imagePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail: tm('pdfDocxLocalDegradedDetail', { pages: imagePages.join(', ') }),
        })
      }
    } else {
      const result = await convertPdfFileToXlsxLocalWithPrompt(pdfPath, promptPassword, onProgress)
      if (result === null) return null
      await atomicWriteFile(target, result.xlsx)
      // degrade transparency: pages that could not become cells got a notice
      // row on their worksheet instead of an image (a spreadsheet has none)
      const noticePages = result.pageResults.filter((r) => r.status !== 'ok').map((r) => r.page)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfXlsxLocalScannedDetail'),
        })
      } else if (noticePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfXlsxLocalSkippedMsg'),
          detail: tm('pdfXlsxLocalSkippedDetail', { pages: noticePages.join(', ') }),
        })
      }
    }
    return target
  } catch (err) {
    if (!host.isDestroyed()) {
      // structured load failures (P22): password-protected / damaged PDFs get
      // a human-readable explanation instead of the raw PDFium error string
      const detail =
        err instanceof PdfLoadError
          ? err.code === 'password-required'
            ? tm('pdfDocxLocalEncryptedDetail')
            : err.code === 'unsupported'
              ? // certificate-based or otherwise unsupported security (FPDF
                // error 5): a hard PDFium boundary — no password can open it
                // locally, so the message must NOT suggest one (P24 C)
                tm('pdfDocxLocalUnsupportedEncDetail')
              : tm('pdfDocxLocalCorruptDetail')
          : err instanceof Error
            ? err.message
            : String(err)
      void dialog.showMessageBox(host, { type: 'error', message: tm(copy.failed), detail })
    }
    return null
  } finally {
    // the prompt window may still be open when the loop exits through cancel
    // or a non-password error thrown mid-retry
    closePdfPasswordDialog()
    exportingPdfDocx = false
    if (!host.isDestroyed()) host.setProgressBar(-1)
  }
}

/**
 * Export as Word / PowerPoint / Excel for pdf tabs: flush pending edits, run
 * the shared local conversion, then open the result in its editor tab.
 */
async function exportActivePdfAsOffice(kind: PdfOfficeKind): Promise<void> {
  const tab = activePdfTarget()
  const host = pdfHostWindow(tab)
  if (!tab?.filePath || !host) return
  if (exportingPdfDocx) {
    void dialog.showMessageBox(host, { type: 'info', message: tm(PDF_OFFICE_COPY[kind].busy) })
    return
  }
  if (!(await flushPdfForExport(flushPdfSave, tab.webContents))) return
  const out = await convertPdfToOffice(kind, tab.filePath, host, tab.id)
  if (out) openDocumentPath(out)
}

function exportPdfAsDocxLocal(): Promise<void> {
  return exportActivePdfAsOffice('docx')
}

function exportPdfAsPptxLocal(): Promise<void> {
  return exportActivePdfAsOffice('pptx')
}

function exportPdfAsXlsxLocal(): Promise<void> {
  return exportActivePdfAsOffice('xlsx')
}
```

- [ ] **Step 2: Typecheck + full shell suite**

Run: `npm run typecheck -w @genoffice/shell && cd apps/shell && npx vitest run`
Expected: PASS. Nếu có test đọc source `index.ts` để tìm tên hàm hoặc chuỗi, chúng vẫn xanh vì 3 tên hàm cũ còn nguyên.

- [ ] **Step 3: Commit**

```bash
git add apps/shell/src/main/index.ts
git commit -m "refactor(shell): one PDF to Office conversion flow shared by menu and Desk"
```

---

### Task 4: `runDeskTool`: 6 dụng cụ ở main

**Files:**

- Create: `apps/shell/src/main/desk-tools.ts`
- Modify: `apps/shell/src/shared/home-api.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/main/index.ts`
- Test: `apps/shell/tests/desk-tools.test.ts`

**Interfaces:**

- Consumes: `convertPdfToOffice`, `exportingPdfDocx` (Task 3); `headlessExporters` (`index.ts:6315`); `runHeadlessExport` (`main/headless-export.ts:121`); `mergePdfBytes` / `splitPdfBytes` (`apps/pdf/src/main/save-pdf.ts`); `recordRecentFile` (đã import trong `index.ts`).
- Produces (shared):

```ts
export type DeskToolId =
  'pdf-to-docx' | 'pdf-to-xlsx' | 'pdf-to-pptx' | 'export-pdf' | 'merge-pdf' | 'split-pdf'
export interface DeskToolRequest {
  tool: DeskToolId
  inputs?: string[]
  splitEvery?: number
}
export type DeskToolResult =
  | { ok: true; outputs: string[] }
  | { ok: false; canceled: true }
  | {
      ok: false
      error: 'busy' | 'bad-input' | 'not-found' | 'same-path' | 'target-open' | 'failed'
    }
```

- Produces: `window.aiOffice.runDeskTool(req: DeskToolRequest): Promise<DeskToolResult>`

- [ ] **Step 1: Add the shared types and channel.** Trong `shared/home-api.ts`, thêm khối sau cạnh `DeskDraft`:

```ts
export type DeskToolId =
  'pdf-to-docx' | 'pdf-to-xlsx' | 'pdf-to-pptx' | 'export-pdf' | 'merge-pdf' | 'split-pdf'

export interface DeskToolRequest {
  tool: DeskToolId
  /** absolute paths (a drop); absent = main asks with a file picker */
  inputs?: string[]
  /** split-pdf: pages per part, 1-999 (default 1) */
  splitEvery?: number
}

export type DeskToolResult =
  | { ok: true; outputs: string[] }
  | { ok: false; canceled: true }
  | {
      ok: false
      error: 'busy' | 'bad-input' | 'not-found' | 'same-path' | 'target-open' | 'failed'
    }
```

Thêm vào `interface HomeApi`, sau `listDrafts`:

```ts
  /** Desk tools: one conversion; pickers and save dialogs happen in main */
  runDeskTool(req: DeskToolRequest): Promise<DeskToolResult>
```

Thêm vào `HOME_CHANNELS`, sau `listDrafts`: `runDeskTool: 'home:run-desk-tool',`

- [ ] **Step 2: Write the failing test.** Tạo file `apps/shell/tests/desk-tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { checkDeskInputs, runDeskTool, type DeskToolDeps } from '../src/main/desk-tools'

function deps(over: Partial<DeskToolDeps> = {}) {
  const files = new Map<string, Uint8Array>([
    ['/w/a.pdf', new Uint8Array([1])],
    ['/w/b.pdf', new Uint8Array([2])],
    ['/w/report.docx', new Uint8Array([3])],
  ])
  const dirs = new Set<string>()
  let busy = false
  const d: DeskToolDeps = {
    busy: () => busy,
    setBusy: (on) => {
      busy = on
    },
    pickFiles: vi.fn<DeskToolDeps['pickFiles']>(async () => []),
    pickSavePath: vi.fn<DeskToolDeps['pickSavePath']>(async (p) => p),
    pickFolder: vi.fn<DeskToolDeps['pickFolder']>(async () => '/out'),
    convertPdf: vi.fn<DeskToolDeps['convertPdf']>(async (kind, p) =>
      p.replace(/\.pdf$/, `.${kind}`),
    ),
    exportPdf: vi.fn<DeskToolDeps['exportPdf']>(async (_input, out) => {
      files.set(out, new Uint8Array([9]))
    }),
    mergePdf: vi.fn<DeskToolDeps['mergePdf']>(async (first, others) => ({
      merged: new Uint8Array([...first, ...others.flatMap((o) => [...o])]),
    })),
    splitPdf: vi.fn<DeskToolDeps['splitPdf']>(async () => [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]),
    isOpenInTab: () => false,
    isFile: (p) => files.has(p),
    exists: (p) => files.has(p) || dirs.has(p),
    readFile: async (p) => files.get(p)!,
    writeFile: vi.fn<DeskToolDeps['writeFile']>(async (p, b) => {
      files.set(p, b)
    }),
    mkdir: vi.fn<DeskToolDeps['mkdir']>(async (p) => {
      dirs.add(p)
    }),
    recordRecent: vi.fn<DeskToolDeps['recordRecent']>(),
    ...over,
  }
  return { d, files, dirs }
}

describe('desk tools: input checks', () => {
  it('refuses bad requests at the boundary', async () => {
    const { d } = deps()
    const bad = { ok: false, error: 'bad-input' }
    expect(await runDeskTool({ tool: 'format-disk' }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 0 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 1000 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 1.5 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'merge-pdf', inputs: '/w/a.pdf' }, d)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/report.docx'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/a.pdf', '/w/b.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('merge-pdf', ['/w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('export-pdf', ['/w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/gone.pdf'], d.isFile)).toEqual({
      ok: false,
      error: 'not-found',
    })
    expect(checkDeskInputs('export-pdf', ['/w/report.docx'], d.isFile)).toBeNull()
  })

  it('answers busy while another run is going, before any dialog', async () => {
    const { d } = deps({ busy: () => true })
    expect(await runDeskTool({ tool: 'merge-pdf' }, d)).toEqual({ ok: false, error: 'busy' })
    expect(d.pickFiles).not.toHaveBeenCalled()
  })

  it('asks for files when none were dropped; a cancelled picker is quiet', async () => {
    const { d } = deps()
    expect(await runDeskTool({ tool: 'merge-pdf' }, d)).toEqual({ ok: false, canceled: true })
    expect(d.pickFiles).toHaveBeenCalledWith({ exportable: false, multi: true })
  })
})

describe('desk tools: runs', () => {
  it('PDF to Office goes through the shared flow and records the output', async () => {
    const { d } = deps()
    expect(await runDeskTool({ tool: 'pdf-to-docx', inputs: ['/w/a.pdf'] }, d)).toEqual({
      ok: true,
      outputs: ['/w/a.docx'],
    })
    expect(d.convertPdf).toHaveBeenCalledWith('docx', '/w/a.pdf')
    expect(d.recordRecent).toHaveBeenCalledWith('/w/a.docx')

    const cancelled = deps({ convertPdf: async () => null })
    expect(await runDeskTool({ tool: 'pdf-to-xlsx', inputs: ['/w/a.pdf'] }, cancelled.d)).toEqual({
      ok: false,
      canceled: true,
    })
    expect(cancelled.d.recordRecent).not.toHaveBeenCalled()
  })

  it('merges in the given order into the picked file and frees the tool', async () => {
    const { d, files } = deps()
    const result = await runDeskTool({ tool: 'merge-pdf', inputs: ['/w/b.pdf', '/w/a.pdf'] }, d)
    expect(d.pickSavePath).toHaveBeenCalledWith('/w/b-merged.pdf')
    expect(result).toEqual({ ok: true, outputs: ['/w/b-merged.pdf'] })
    expect([...files.get('/w/b-merged.pdf')!]).toEqual([2, 1])
    expect(d.busy()).toBe(false)
  })

  it('refuses to write over an input or over a PDF open in a tab', async () => {
    const same = deps({ pickSavePath: async () => '/w/a.pdf' })
    expect(
      await runDeskTool({ tool: 'merge-pdf', inputs: ['/w/a.pdf', '/w/b.pdf'] }, same.d),
    ).toEqual({ ok: false, error: 'same-path' })
    const open = deps({ isOpenInTab: () => true })
    expect(await runDeskTool({ tool: 'export-pdf', inputs: ['/w/report.docx'] }, open.d)).toEqual({
      ok: false,
      error: 'target-open',
    })
    expect(open.d.exportPdf).not.toHaveBeenCalled()
  })

  it('splits into a fresh folder and never overwrites earlier parts', async () => {
    const { d, dirs } = deps()
    dirs.add('/out/a-parts')
    const result = await runDeskTool({ tool: 'split-pdf', inputs: ['/w/a.pdf'], splitEvery: 3 }, d)
    expect(d.splitPdf).toHaveBeenCalledWith(new Uint8Array([1]), 3)
    expect(d.mkdir).toHaveBeenCalledWith('/out/a-parts 2')
    expect(result).toEqual({
      ok: true,
      outputs: ['/out/a-parts 2/a-1.pdf', '/out/a-parts 2/a-2.pdf'],
    })
  })

  it('an export failure comes back as failed and frees the tool', async () => {
    const { d } = deps({
      exportPdf: async () => {
        throw new Error('renderer gone')
      },
    })
    expect(await runDeskTool({ tool: 'export-pdf', inputs: ['/w/report.docx'] }, d)).toEqual({
      ok: false,
      error: 'failed',
    })
    expect(d.busy()).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-tools.test.ts`
Expected: FAIL. Lỗi là `Cannot find module '../src/main/desk-tools'`.

- [ ] **Step 4: Implement `desk-tools.ts`.** Tạo file `apps/shell/src/main/desk-tools.ts`:

```ts
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { DeskToolId, DeskToolResult } from '../shared/home-api'

export const DESK_TOOL_IDS: readonly DeskToolId[] = [
  'pdf-to-docx',
  'pdf-to-xlsx',
  'pdf-to-pptx',
  'export-pdf',
  'merge-pdf',
  'split-pdf',
]

const PDF = /\.pdf$/i
/** what Export PDF takes: the inputs headlessModuleFor (electron-utils) routes to an editor */
export const EXPORTABLE = /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|md|markdown|html|htm)$/i
const MAX_MERGE = 50

/** Everything runDeskTool touches outside itself; index.ts wires the real ones, tests pass fakes. */
export interface DeskToolDeps {
  /** a Desk tool or a PDF tab conversion is already running */
  busy(): boolean
  setBusy(on: boolean): void
  /** [] when the picker was cancelled */
  pickFiles(opts: { exportable: boolean; multi: boolean }): Promise<string[]>
  /** null when cancelled */
  pickSavePath(defaultPath: string): Promise<string | null>
  /** null when cancelled */
  pickFolder(defaultPath: string): Promise<string | null>
  /** the PDF tab's own flow (save dialog, stale tab, password, degrade notes); null = cancelled or already reported */
  convertPdf(kind: 'docx' | 'xlsx' | 'pptx', pdfPath: string): Promise<string | null>
  /** hidden-window export; throws on failure */
  exportPdf(input: string, outPath: string): Promise<void>
  mergePdf(first: Uint8Array, others: Uint8Array[]): Promise<{ merged: Uint8Array }>
  splitPdf(bytes: Uint8Array, every: number): Promise<Uint8Array[]>
  /** a main-window tab shows this PDF */
  isOpenInTab(path: string): boolean
  isFile(path: string): boolean
  exists(path: string): boolean
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  recordRecent(path: string): void
}

const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
const stem = (path: string) => basename(path, extname(path))

/** Input check at the trust boundary: absolute paths, extension, count, existence. */
export function checkDeskInputs(
  tool: DeskToolId,
  inputs: readonly unknown[],
  isFile: (path: string) => boolean,
): DeskToolResult | null {
  const bad = { ok: false, error: 'bad-input' } as const
  if (!inputs.every((p) => typeof p === 'string' && isAbsolute(p))) return bad
  const paths = inputs as string[]
  const want = tool === 'export-pdf' ? EXPORTABLE : PDF
  if (!paths.every((p) => want.test(p))) return bad
  const countOk =
    tool === 'merge-pdf' ? paths.length >= 2 && paths.length <= MAX_MERGE : paths.length === 1
  if (!countOk) return bad
  if (!paths.every(isFile)) return { ok: false, error: 'not-found' }
  return null
}

/** a folder that does not exist yet: "<base>", then "<base> 2", "<base> 3"… */
function freshDir(base: string, exists: (path: string) => boolean): string {
  let dir = base
  for (let n = 2; exists(dir); n++) dir = `${base} ${n}`
  return dir
}

/**
 * One Desk tool run (office desk spec §4-5.1): validate, pick inputs when
 * none were dropped, ask where to write, run, record the output as recent.
 * Never throws; one tool at a time.
 */
export async function runDeskTool(raw: unknown, deps: DeskToolDeps): Promise<DeskToolResult> {
  const bad = { ok: false, error: 'bad-input' } as const
  const canceled = { ok: false, canceled: true } as const
  const req = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tool = req.tool as DeskToolId
  if (!DESK_TOOL_IDS.includes(tool)) return bad
  const every = req.splitEvery ?? 1
  if (typeof every !== 'number' || !Number.isInteger(every) || every < 1 || every > 999) return bad
  if (req.inputs !== undefined && !Array.isArray(req.inputs)) return bad
  if (deps.busy()) return { ok: false, error: 'busy' }

  let inputs: unknown[] = (req.inputs as unknown[] | undefined) ?? []
  if (inputs.length === 0) {
    inputs = await deps.pickFiles({
      exportable: tool === 'export-pdf',
      multi: tool === 'merge-pdf',
    })
    if (inputs.length === 0) return canceled
  }
  const refused = checkDeskInputs(tool, inputs, deps.isFile)
  if (refused) return refused
  const paths = inputs as string[]
  const first = paths[0]!

  if (tool === 'pdf-to-docx' || tool === 'pdf-to-xlsx' || tool === 'pdf-to-pptx') {
    // the PDF tab's flow keeps its own busy flag, dialogs and error reporting
    const kind = tool.slice('pdf-to-'.length) as 'docx' | 'xlsx' | 'pptx'
    const out = await deps.convertPdf(kind, first)
    if (!out) return canceled
    deps.recordRecent(out)
    return { ok: true, outputs: [out] }
  }

  deps.setBusy(true)
  try {
    if (tool === 'split-pdf') {
      const where = await deps.pickFolder(dirname(first))
      if (!where) return canceled
      const parts = await deps.splitPdf(await deps.readFile(first), every)
      const base = stem(first).replace(/[/\\:*?"<>|]/g, '_')
      // a fresh folder, so a split never overwrites earlier parts
      const dir = freshDir(join(where, `${base}-parts`), deps.exists)
      await deps.mkdir(dir)
      const outputs: string[] = []
      for (const [i, bytes] of parts.entries()) {
        const out = join(dir, `${base}-${i + 1}.pdf`)
        await deps.writeFile(out, bytes)
        outputs.push(out)
      }
      return { ok: true, outputs }
    }

    const suggested = join(
      dirname(first),
      tool === 'merge-pdf' ? `${stem(first)}-merged.pdf` : `${stem(first)}.pdf`,
    )
    const out = await deps.pickSavePath(suggested)
    if (!out) return canceled
    if (paths.some((p) => norm(p) === norm(out))) return { ok: false, error: 'same-path' }
    if (deps.isOpenInTab(out)) return { ok: false, error: 'target-open' }
    if (tool === 'export-pdf') {
      await deps.exportPdf(first, out)
    } else {
      const [head, ...rest] = await Promise.all(paths.map((p) => deps.readFile(p)))
      const { merged } = await deps.mergePdf(head!, rest)
      await deps.writeFile(out, merged)
    }
    deps.recordRecent(out)
    return { ok: true, outputs: [out] }
  } catch (err) {
    console.error('[shell] desk tool failed:', err)
    return { ok: false, error: 'failed' }
  } finally {
    deps.setBusy(false)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/shell && npx vitest run tests/desk-tools.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire main + preload.** Trong `apps/shell/src/main/index.ts`:

1. Thêm các import cạnh nhóm import `./…`:

```ts
import { runDeskTool } from './desk-tools'
import { mergePdfBytes, splitPdfBytes } from '../../../pdf/src/main/save-pdf'
```

Kiểm tra `runHeadlessExport` đã được import ở dòng 347. Nếu block import `docs-main` chưa có `recordRecentFile` thì thêm vào (hiện có ở dòng 138).

2. Ngay trên `ipcMain.handle(HOME_CHANNELS.listDrafts, …)` (Task 2), thêm một biến ở cấp module, đặt cạnh `let exportingPdfDocx`:

```ts
/** a Desk tool (export / merge / split) is running; PDF → Office runs under exportingPdfDocx */
let deskToolRunning = false
```

3. Ngay sau handler `listDrafts`, thêm:

```ts
ipcMain.handle(HOME_CHANNELS.runDeskTool, async (event, req: unknown) => {
  const host = BrowserWindow.fromWebContents(event.sender) ?? shellWindow
  if (!host) return { ok: false, error: 'failed' }
  return runDeskTool(req, {
    busy: () => deskToolRunning || exportingPdfDocx,
    setBusy: (on) => {
      deskToolRunning = on
      if (!host.isDestroyed()) host.setProgressBar(on ? 2 : -1)
    },
    pickFiles: async ({ exportable, multi }) => {
      const office = [
        'docx',
        'xlsx',
        'xlsm',
        'xls',
        'csv',
        'tsv',
        'pptx',
        'md',
        'markdown',
        'html',
        'htm',
      ]
      const picked = await showOpenDialogWithMemory(dialog, host, {
        filters: exportable
          ? [{ name: tm('filterSupported'), extensions: office }]
          : [{ name: tm('filterPdf'), extensions: ['pdf'] }],
        properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      })
      return picked.canceled ? [] : picked.filePaths
    },
    pickSavePath: async (defaultPath) => {
      const picked = await showSaveDialogWithMemory(dialog, host, {
        defaultPath,
        filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
      })
      return picked.canceled || !picked.filePath ? null : picked.filePath
    },
    pickFolder: async (defaultPath) => {
      const picked = await showOpenDialogWithMemory(dialog, host, {
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      })
      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },
    convertPdf: (kind, pdfPath) => convertPdfToOffice(kind, pdfPath, host),
    exportPdf: async (input, outPath) => {
      const outcome = await runHeadlessExport(
        { input, outPath, targetFormat: 'pdf', json: false },
        headlessExporters,
      )
      if (!outcome.ok) throw new Error(outcome.message)
    },
    mergePdf: mergePdfBytes,
    splitPdf: splitPdfBytes,
    isOpenInTab: (path) => !!tabManager?.findPdfTabByPath(path),
    isFile: (path) => existsSync(path) && statSync(path).isFile(),
    exists: existsSync,
    readFile: async (path) => new Uint8Array(readFileSync(path)),
    writeFile: (path, bytes) => atomicWriteFile(path, bytes),
    mkdir: async (path) => {
      mkdirSync(path, { recursive: true })
    },
    recordRecent: recordRecentFile,
  })
})
```

Trong `preload/index.ts`:

1. Thêm `DeskToolResult` vào import type từ `'../shared/home-api'`.
2. Thêm vào object `api`, sau `listDrafts`:

```ts
  async runDeskTool(req) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.runDeskTool, req)) as DeskToolResult
  },
```

- [ ] **Step 7: Typecheck + tests**

Run: `npm run typecheck -w @genoffice/shell && cd apps/shell && npx vitest run tests/desk-tools.test.ts tests/desk-drafts.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/shell/src/main/desk-tools.ts apps/shell/tests/desk-tools.test.ts apps/shell/src/shared/home-api.ts apps/shell/src/preload/index.ts apps/shell/src/main/index.ts
git commit -m "feat(shell): Desk tools convert, export, merge and split PDFs from the shell"
```

---

### Task 5: `desk-model.ts` + `useRecentDocuments` trả thêm danh sách local

**Files:**

- Create: `apps/shell/src/renderer/src/desk-model.ts`
- Modify: `apps/shell/src/renderer/src/work-home.ts` (hàm `useRecentDocuments`, ~dòng 322-359)
- Test: `apps/shell/tests/desk-model.test.ts`

**Interfaces:**

- Produces:
  - `applicableTools(paths: readonly string[]): DeskToolId[]`
  - `docNotifications(inbox: readonly WorkNotification[]): WorkNotification[]`
  - `freshShared(shared: readonly UniworkDocSummary[], recents: readonly RecentEntry[], now: number): UniworkDocSummary[]`
  - `syncProblems(statuses: readonly UniworkDocStatus[]): UniworkDocStatus[]`
  - `type InTrayRow = { kind: 'sync'; status: UniworkDocStatus } | { kind: 'note'; note: WorkNotification } | { kind: 'shared'; doc: UniworkDocSummary }`
  - `inTrayRows(i: { notes; shared; sync }): InTrayRow[]`
  - `type InProgressRow = { kind: 'draft'; draft: DeskDraft } | { kind: 'recent'; doc: WorkRecentDocument }`
  - `inProgressRows(drafts, recent, limit = 10): InProgressRow[]`
  - `useRecentDocuments(workspaceId, refreshTick, limit = 6): { docs; local: RecentEntry[]; cloudFailed; reload }`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type {
  DeskDraft,
  RecentEntry,
  UniworkDocStatus,
  UniworkDocSummary,
} from '../src/shared/home-api'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  applicableTools,
  docNotifications,
  freshShared,
  inProgressRows,
  inTrayRows,
  syncProblems,
} from '../src/renderer/src/desk-model'

const note = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'n1',
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'notifications.kind.document_commented',
  params: { actor: 'Lan', document: 'Contract' },
  created_at: '2026-10-14T01:00:00Z',
  ...over,
})
const doc = (over: Partial<UniworkDocSummary> = {}): UniworkDocSummary => ({
  id: 'd1',
  workspaceId: 'w',
  title: 'KPI.xlsx',
  format: 'xlsx',
  updatedAt: '2026-10-13T00:00:00Z',
  ...over,
})
const status = (over: Partial<UniworkDocStatus> = {}): UniworkDocStatus => ({
  path: '/c/a.docx',
  documentId: 'd9',
  workspaceId: 'w',
  title: 'Proposal',
  format: 'docx',
  access: 'edit',
  state: 'conflict',
  ...over,
})
const NOW = Date.parse('2026-10-14T00:00:00Z')

describe('applicableTools', () => {
  it('offers the PDF tools for one PDF, merge for several, export for an office file', () => {
    expect(applicableTools(['/a.pdf'])).toEqual([
      'pdf-to-docx',
      'pdf-to-xlsx',
      'pdf-to-pptx',
      'split-pdf',
    ])
    expect(applicableTools(['/a.pdf', '/b.PDF'])).toEqual(['merge-pdf'])
    expect(applicableTools(['/a.docx'])).toEqual(['export-pdf'])
    expect(applicableTools(['/n.md'])).toEqual(['export-pdf'])
  })

  it('offers nothing for folders, images, mixes or nothing', () => {
    expect(applicableTools([])).toEqual([])
    expect(applicableTools(['/folder'])).toEqual([])
    expect(applicableTools(['/p.png'])).toEqual([])
    expect(applicableTools(['/a.pdf', '/b.docx'])).toEqual([])
    expect(applicableTools(['/a.docx', '/b.docx'])).toEqual([])
  })
})

describe('in-tray sources', () => {
  it('keeps unread document comments and mentions only', () => {
    const inbox = [
      note(),
      note({ id: 'n2', kind: 'document_mentioned' }),
      note({ id: 'n3', read_at: '2026-10-14T02:00:00Z' }),
      note({ id: 'n4', kind: 'task_assigned', resource_type: 'task' }),
    ]
    expect(docNotifications(inbox).map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('keeps shared documents from the last 7 days that were never opened here', () => {
    const recents = [{ path: '/c/k.xlsx', uniwork: { documentId: 'd2' } } as RecentEntry]
    const shared = [
      doc(),
      doc({ id: 'd2' }),
      doc({ id: 'd3', updatedAt: '2026-10-06T00:00:00Z' }),
      doc({ id: 'd4', archived: true }),
    ]
    expect(freshShared(shared, recents, NOW).map((d) => d.id)).toEqual(['d1'])
  })

  it('treats conflicts, failures and pauses as problems, not saving or offline', () => {
    const list = ['conflict', 'failed', 'paused_user', 'saving', 'paused_offline', 'saved'].map(
      (state) => status({ path: state, state: state as UniworkDocStatus['state'] }),
    )
    expect(syncProblems(list).map((s) => s.path)).toEqual(['conflict', 'failed', 'paused_user'])
  })

  it('orders rows: sync problems, then notes, then shares, newest first in each', () => {
    const rows = inTrayRows({
      notes: [note({ id: 'old', created_at: '2026-10-13T00:00:00Z' }), note({ id: 'new' })],
      shared: [doc()],
      sync: [status()],
    })
    expect(rows.map((r) => (r.kind === 'note' ? r.note.id : r.kind))).toEqual([
      'sync',
      'new',
      'old',
      'shared',
    ])
  })
})

describe('inProgressRows', () => {
  it('puts drafts first, drops a recent row a draft already shows, and caps the list', () => {
    const drafts: DeskDraft[] = [
      { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/r.docx' },
    ]
    const local = (path: string) => ({ source: 'local' as const, entry: { path } as RecentEntry })
    const rows = inProgressRows(
      drafts,
      [local('/w/r.docx'), local('/w/x.xlsx'), local('/w/y.pptx')],
      2,
    )
    expect(
      rows.map((r) =>
        r.kind === 'draft' ? r.draft.title : r.doc.source === 'local' ? r.doc.entry.path : '',
      ),
    ).toEqual(['Report', '/w/x.xlsx'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-model.test.ts`
Expected: FAIL. Lỗi là `Cannot find module '../src/renderer/src/desk-model'`.

- [ ] **Step 3: Implement `desk-model.ts`.** Tạo file `apps/shell/src/renderer/src/desk-model.ts`:

```ts
import type {
  DeskDraft,
  DeskToolId,
  RecentEntry,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkSaveState,
} from '../../shared/home-api'
import type { WorkNotification, WorkRecentDocument } from '../../shared/uniwork-work-api'

const PDF = /\.pdf$/i
/** what Export PDF takes; mirrors desk-tools.ts EXPORTABLE (main checks again) */
const EXPORTABLE = /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|md|markdown|html|htm)$/i

/** the tools that fit a set of dropped files (office desk spec §4.2) */
export function applicableTools(paths: readonly string[]): DeskToolId[] {
  if (paths.length === 0) return []
  if (paths.every((p) => PDF.test(p))) {
    return paths.length === 1
      ? ['pdf-to-docx', 'pdf-to-xlsx', 'pdf-to-pptx', 'split-pdf']
      : ['merge-pdf']
  }
  return paths.length === 1 && EXPORTABLE.test(paths[0]!) ? ['export-pdf'] : []
}

const DOC_KINDS = new Set(['document_commented', 'document_mentioned'])

/** unread comments and mentions on a document */
export function docNotifications(inbox: readonly WorkNotification[]): WorkNotification[] {
  return inbox.filter((n) => !n.read_at && n.resource_type === 'document' && DOC_KINDS.has(n.kind))
}

const WEEK_MS = 7 * 86_400_000

/** shared with me in the last 7 days and never opened on this device */
export function freshShared(
  shared: readonly UniworkDocSummary[],
  recents: readonly RecentEntry[],
  now: number,
): UniworkDocSummary[] {
  const opened = new Set(recents.flatMap((r) => (r.uniwork ? [r.uniwork.documentId] : [])))
  return shared.filter(
    (d) => !d.archived && !opened.has(d.id) && now - (Date.parse(d.updatedAt) || 0) <= WEEK_MS,
  )
}

/** save states the person has to act on (not saving, queued or simply offline) */
const PROBLEMS: ReadonlySet<UniworkSaveState> = new Set<UniworkSaveState>([
  'conflict',
  'failed',
  'error',
  'blocked',
  'paused_user',
  'paused_admin',
  'reconciling-stuck',
])

export function syncProblems(statuses: readonly UniworkDocStatus[]): UniworkDocStatus[] {
  return statuses.filter((s) => PROBLEMS.has(s.state))
}

export type InTrayRow =
  | { kind: 'sync'; status: UniworkDocStatus }
  | { kind: 'note'; note: WorkNotification }
  | { kind: 'shared'; doc: UniworkDocSummary }

const newestBy =
  <T>(at: (x: T) => string | undefined) =>
  (a: T, b: T) =>
    (Date.parse(at(b) ?? '') || 0) - (Date.parse(at(a) ?? '') || 0)

/** "Needs you": sync problems, then comments and mentions, then shares; newest first in each */
export function inTrayRows(i: {
  notes: readonly WorkNotification[]
  shared: readonly UniworkDocSummary[]
  sync: readonly UniworkDocStatus[]
}): InTrayRow[] {
  return [
    ...[...i.sync]
      .sort(newestBy((s) => s.lastSavedAt))
      .map((status) => ({ kind: 'sync' as const, status })),
    ...[...i.notes]
      .sort(newestBy((n) => n.created_at))
      .map((note) => ({ kind: 'note' as const, note })),
    ...[...i.shared]
      .sort(newestBy((d) => d.updatedAt))
      .map((doc) => ({ kind: 'shared' as const, doc })),
  ]
}

export type InProgressRow =
  { kind: 'draft'; draft: DeskDraft } | { kind: 'recent'; doc: WorkRecentDocument }

/** "In progress": drafts first, then recent documents a draft does not already show */
export function inProgressRows(
  drafts: readonly DeskDraft[],
  recent: readonly WorkRecentDocument[],
  limit = 10,
): InProgressRow[] {
  const shown = new Set(drafts.flatMap((d) => (d.filePath ? [d.filePath] : [])))
  return [
    ...drafts.map((draft) => ({ kind: 'draft' as const, draft })),
    ...recent
      .filter((r) => r.source !== 'local' || !shown.has(r.entry.path))
      .map((doc) => ({ kind: 'recent' as const, doc })),
  ].slice(0, limit)
}
```

- [ ] **Step 4: Extend `useRecentDocuments`.** Trong `work-home.ts`, thay toàn bộ hàm `useRecentDocuments` bằng:

```ts
export function useRecentDocuments(
  workspaceId: string | null,
  refreshTick: number,
  limit = 6,
): {
  docs: WorkRecentDocument[]
  /** this device's recents as listed (working copies included), for the Desk's tray */
  local: RecentEntry[]
  cloudFailed: boolean
  reload: () => void
} {
  const [state, setState] = useState({
    docs: [] as WorkRecentDocument[],
    local: [] as RecentEntry[],
    cloudFailed: false,
  })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, HOME_REFRESH_MS)
    window.addEventListener('focus', reload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
    }
  }, [reload])
  useEffect(() => {
    let live = true
    const local = window.aiOffice.recents({ limit: 20 }).then(
      (page) => page.entries,
      () => [] as RecentEntry[],
    )
    const cloud: Promise<UniworkDocSummary[] | null> = workspaceId
      ? window.aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }).then(
          (r) => (r.ok ? r.value.documents : null),
          () => null,
        )
      : Promise.resolve([])
    void Promise.all([cloud, local]).then(([c, l]) => {
      if (live) {
        setState({
          docs: mergeRecentDocuments(c ?? [], l, limit),
          local: l,
          cloudFailed: c === null,
        })
      }
    })
    return () => {
      live = false
    }
  }, [workspaceId, refreshTick, tick, limit])
  return { ...state, reload }
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/shell && npx vitest run tests/desk-model.test.ts tests/work-home.test.ts tests/work-overview.test.ts`
Expected: PASS. `work-overview` vẫn xanh vì `WorkOverview` dùng giá trị mặc định 6. Nếu nó kiểm tra `recents({ limit: 12 })` thì sửa thành 20.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/src/renderer/src/desk-model.ts apps/shell/src/renderer/src/work-home.ts apps/shell/tests/desk-model.test.ts
git commit -m "feat(shell): Desk model for the tray, work in progress and tool choice"
```

---

### Task 6: Chuỗi `wbDesk*` cho 21 ngôn ngữ

**Files:**

- Modify: `apps/shell/src/renderer/src/i18n/workbench/{zh,en,vi,ar,cs,de,es,fr,he,hi,id,it,ja,ko,ms,nl,pl,pt,ru,th,zh-TW}.ts`
- Test: `apps/shell/tests/strings-workbench.test.ts` (có sẵn)

**Interfaces:**

- Produces: các khóa `StringKey` liệt kê dưới đây. Task 8 đến 11 dùng đúng các tên này.

- [ ] **Step 1: Add the keys to `zh.ts`, `en.ts`, `vi.ts`** (ngay trước dấu `}` cuối object), theo đúng bảng sau:

| key                     | zh                                  | en                                                      | vi                                     |
| ----------------------- | ----------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `wbDeskTools`           | 工具                                | Tools                                                   | Dụng cụ                                |
| `wbDeskDropHint`        | 将文件拖到这里，或选择一个工具      | Drop files here or pick a tool                          | Thả tệp vào đây hoặc chọn một dụng cụ  |
| `wbDeskToolPdfToDocx`   | PDF → Word                          | PDF → Word                                              | PDF → Word                             |
| `wbDeskToolPdfToXlsx`   | PDF → Excel                         | PDF → Excel                                             | PDF → Excel                            |
| `wbDeskToolPdfToPptx`   | PDF → PowerPoint                    | PDF → PowerPoint                                        | PDF → PowerPoint                       |
| `wbDeskToolExportPdf`   | 导出 PDF                            | Export PDF                                              | Xuất PDF                               |
| `wbDeskToolMergePdf`    | 合并 PDF                            | Merge PDFs                                              | Ghép PDF                               |
| `wbDeskToolSplitPdf`    | 拆分 PDF                            | Split PDF                                               | Tách PDF                               |
| `wbDeskSplitEvery`      | 每份页数                            | Pages per part                                          | Số trang mỗi phần                      |
| `wbDeskSplitRun`        | 拆分                                | Split                                                   | Tách                                   |
| `wbDeskDropNone`        | 没有适用于此类文件的工具。          | No tool takes this kind of file.                        | Không có dụng cụ cho loại tệp này.     |
| `wbDeskFromSaved`       | 将导出已保存的版本                  | Exports the saved version                               | Xuất từ bản đã lưu                     |
| `wbDeskToolDone`        | 已创建 {name}                       | Created {name}                                          | Đã tạo {name}                          |
| `wbDeskToolDoneMany`    | 已在 {folder} 中创建 {count} 个文件 | Created {count} files in {folder}                       | Đã tạo {count} tệp trong {folder}      |
| `wbDeskShowInFolder`    | 在文件夹中显示                      | Show in folder                                          | Hiện trong thư mục                     |
| `wbDeskToolBusy`        | 另一个工具仍在运行。                | Another tool is still running.                          | Một dụng cụ khác đang chạy.            |
| `wbDeskToolFailed`      | 操作未完成，请重试。                | That did not work. Try again.                           | Không thực hiện được. Hãy thử lại.     |
| `wbDeskToolSamePath`    | 请选择与源文件不同的文件名。        | Pick a file name different from the source.             | Hãy chọn tên tệp khác tệp nguồn.       |
| `wbDeskToolTargetOpen`  | 该文件已打开，请关闭后重试。        | That file is open. Close it and try again.              | Tệp đó đang mở. Đóng nó rồi thử lại.   |
| `wbDeskToolNotFound`    | 找不到该文件。                      | The file is no longer there.                            | Không còn tìm thấy tệp.                |
| `wbDeskToolBadInput`    | 此工具不支持该文件。                | This tool does not take that file.                      | Dụng cụ này không nhận tệp đó.         |
| `wbDeskInTray`          | 待你处理                            | Needs you                                               | Cần bạn xử lý                          |
| `wbDeskInTrayEmpty`     | 没有待你处理的事项                  | Nothing is waiting on you                               | Không có gì đang chờ bạn               |
| `wbDeskReasonShared`    | 已与你共享                          | Shared with you                                         | Được chia sẻ với bạn                   |
| `wbDeskReasonConflict`  | 版本冲突                            | Version conflict                                        | Có xung đột phiên bản                  |
| `wbDeskReasonSync`      | 未能同步                            | Not synced                                              | Chưa đồng bộ được                      |
| `wbDeskMore`            | 再显示 {count} 项                   | Show {count} more                                       | Xem thêm {count}                       |
| `wbDeskInProgress`      | 进行中                              | In progress                                             | Đang làm dở                            |
| `wbDeskInProgressEmpty` | 暂无进行中的文档                    | No documents in progress                                | Chưa có tài liệu đang làm              |
| `wbDeskUnsaved`         | 未保存                              | Unsaved                                                 | Chưa lưu                               |
| `wbDeskRecovery`        | 有恢复版本                          | Recovered copy                                          | Có bản khôi phục                       |
| `wbDeskSwitchTo`        | 切换到                              | Switch to                                               | Chuyển tới                             |
| `wbDeskOpenFile`        | 打开文件…                           | Open file…                                              | Mở tệp…                                |
| `wbDeskDrawer`          | 常用表单                            | Forms drawer                                            | Ngăn kéo · biểu mẫu                    |
| `wbDeskDrawerManage`    | 管理                                | Manage                                                  | Quản lý                                |
| `wbDeskDrawerEmpty`     | 保存常用表单，一键起草              | Save the forms you use often to draft them in one click | Lưu mẫu giấy tờ hay dùng để soạn nhanh |
| `wbDeskDrawerAdd`       | 添加表单                            | Add a form                                              | Thêm biểu mẫu                          |
| `wbDeskToday`           | 今天                                | Today                                                   | Hôm nay                                |
| `wbDeskTodayNoTasks`    | 今天没有到期的任务。                | Nothing due today.                                      | Không có việc đến hạn hôm nay.         |
| `wbDeskAllTasks`        | 全部任务                            | All tasks                                               | Tất cả việc                            |
| `wbDeskOtherNotifs`     | 其他通知（{count}）                 | Other notifications ({count})                           | Thông báo khác ({count})               |

- [ ] **Step 2: Add the same 41 keys to the other 18 shards.** Các shard là: `ar, cs, de, es, fr, he, hi, id, it, ja, ko, ms, nl, pl, pt, ru, th, zh-TW`.
  - Dịch từ cột **en** sang đúng ngôn ngữ của file, giữ giọng văn giống các khóa `wbTasks*` / `wbFormsDraft*` ngay trong file đó.
  - Giữ nguyên `{name}`, `{count}`, `{folder}`, dấu `→` và ký tự `…`. Tên sản phẩm `PDF`, `Word`, `Excel`, `PowerPoint` không dịch.
  - `zh-TW` viết bằng chữ phồn thể, lấy cột zh làm gốc.

- [ ] **Step 3: Run tests + typecheck**

Run: `cd apps/shell && npx vitest run tests/strings-workbench.test.ts && cd ../.. && npm run typecheck -w @genoffice/shell`
Expected: PASS. Mỗi shard có đúng bộ khóa của zh và không có giá trị rỗng.

- [ ] **Step 4: Commit**

```bash
git add apps/shell/src/renderer/src/i18n/workbench
git commit -m "feat(shell): Desk strings in every UI language"
```

---

### Task 7: `form-draft.ts`: "Soạn" dùng chung cho tab Biểu mẫu và Ngăn kéo

**Files:**

- Create: `apps/shell/src/renderer/src/form-draft.ts`
- Modify: `apps/shell/src/renderer/src/WorkbenchModulePanes.tsx` (hàm `openForm` trong `FormsPane`, ~dòng 223-247)
- Test: `apps/shell/tests/form-draft.test.ts`

**Interfaces:**

- Produces: `draftFromForm(item: WbFormItem, packId: string, orgId: string | null, vi: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/form-draft.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { draftFromForm } from '../src/renderer/src/form-draft'

let newDoc: ReturnType<typeof vi.fn>

beforeEach(() => {
  newDoc = vi.fn(async () => undefined)
  window.aiOffice = { newDoc } as unknown as HomeApi
})

describe('draftFromForm', () => {
  it('creates a Docs file in the pack with the form title, note and template name', async () => {
    await draftFromForm(
      { id: 'f1', title: 'Leave <request>', note: 'HR', fileName: 'leave.docx' },
      'pack-1',
      null,
      false,
    )
    expect(newDoc).toHaveBeenCalledTimes(1)
    const opts = newDoc.mock.calls[0]![0] as {
      projectId: string
      aiContent: { title: string; html: string }
    }
    expect(opts.projectId).toBe('pack-1')
    expect(opts.aiContent.title).toBe('Leave <request>')
    expect(opts.aiContent.html).toContain('<h1>Leave &lt;request&gt;</h1>')
    expect(opts.aiContent.html).toContain('Source template')
    expect(opts.aiContent.html).toContain('leave.docx')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/form-draft.test.ts`
Expected: FAIL. Lỗi là `Cannot find module '../src/renderer/src/form-draft'`.

- [ ] **Step 3: Implement.** Tạo file `apps/shell/src/renderer/src/form-draft.ts`:

```ts
import { escapeHtml, profileForDraft, profileMergeHtml } from './form-merge'
import type { WbFormItem } from './workbench-pins'

/** "Soạn" from a saved form: a new Docs file in `packId`, the UniWork profile fields merged in. */
export async function draftFromForm(
  item: WbFormItem,
  packId: string,
  orgId: string | null,
  vi: boolean,
): Promise<void> {
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
  await window.aiOffice.newDoc({ projectId: packId, aiContent: { title: item.title, html } })
}
```

Trong `WorkbenchModulePanes.tsx`, thay thân `openForm` bằng:

```ts
const openForm = async (item: WbFormItem) => {
  const targetPack = packId ?? item.linkedProjectId
  if (!targetPack) return
  await draftFromForm(item, targetPack, orgId, vi)
  if (!item.linkedProjectId || item.linkedProjectId !== targetPack) {
    persist(items.map((x) => (x.id === item.id ? { ...x, linkedProjectId: targetPack } : x)))
  }
  onPackLinked?.()
}
```

- Thêm `import { draftFromForm } from './form-draft'`.
- Nếu `escapeHtml`, `profileForDraft`, `profileMergeHtml` không còn được dùng ở đâu khác trong file thì bỏ chúng khỏi import `./form-merge`. Kiểm tra bằng `grep -n "escapeHtml\|profileForDraft\|profileMergeHtml" WorkbenchModulePanes.tsx`.

- [ ] **Step 4: Run tests**

Run: `cd apps/shell && npx vitest run tests/form-draft.test.ts tests/workbench-local-panes.test.ts tests/workbench-forms-notice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/src/renderer/src/form-draft.ts apps/shell/src/renderer/src/WorkbenchModulePanes.tsx apps/shell/tests/form-draft.test.ts
git commit -m "refactor(shell): one form draft action for the Forms tab and the Desk drawer"
```

---

### Task 8: `DeskToday`: cột phải

**Files:**

- Create: `apps/shell/src/renderer/src/DeskToday.tsx`
- Test: `apps/shell/tests/desk-today.test.ts`

**Interfaces:**

- Consumes: `docNotifications` (Task 5), các khóa `wbDeskToday`, `wbDeskTodayNoTasks`, `wbDeskAllTasks`, `wbDeskOtherNotifs` (Task 6).
- Produces: `DeskToday(props: { home: WorkLoad<WorkHomeSummary>; view: OverviewView; workspace: UniworkWorkspaceRef | null; workspaceError: UniworkWorkError | null; onReload: () => void; onOpenTasks: () => void })`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-today.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkApi, WorkHomeSummary, WorkTask } from '../src/shared/uniwork-work-api'
import { DeskToday } from '../src/renderer/src/DeskToday'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { WorkLoad } from '../src/renderer/src/work-cache'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = {
  id: 'w',
  name: 'Team',
  orgId: 'o1',
  slug: 'team',
  orgSlug: 'acme',
} as UniworkWorkspaceRef
const task = (over: Partial<WorkTask> = {}): WorkTask => ({
  id: 't1',
  workspace_id: 'w',
  identifier: 'OPS-7',
  title: 'Send the contract',
  status: 'todo',
  priority: 'high',
  due_date: '2026-10-10',
  updated_at: '2026-10-10T08:00:00Z',
  ...over,
})
const summary = (over: Partial<WorkHomeSummary> = {}): WorkHomeSummary => ({
  today: '2026-10-13',
  timezone: 'Asia/Ho_Chi_Minh',
  counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
  my_work: [
    task(),
    task({ id: 't2', title: 'Approve leave', due_date: '2026-10-13' }),
    task({ id: 't3', title: 'Later', due_date: '2026-10-20' }),
  ],
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
      title_key: 'x',
      params: {},
      created_at: '2026-10-13T01:00:00Z',
    },
    {
      id: 'n2',
      kind: 'document_commented',
      workspace_id: 'w',
      resource_type: 'document',
      resource_id: 'd1',
      actor_kind: 'user',
      title_key: 'x',
      params: {},
      created_at: '2026-10-13T01:00:00Z',
    },
  ],
  partial: [],
  generated_at: '2026-10-13T03:00:00Z',
  ...over,
})

let host: HTMLDivElement
let root: Root
let work: { setTaskStatus: ReturnType<typeof vi.fn>; openWeb: ReturnType<typeof vi.fn> }

function load(value: WorkHomeSummary | null): WorkLoad<WorkHomeSummary> {
  return { value, updatedAt: 1, error: null, stale: false, reload: vi.fn(), update: vi.fn() }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  work = {
    setTaskStatus: vi.fn(async () => ({ ok: true, value: task({ status: 'done' }) })),
    openWeb: vi.fn(async () => true),
  }
  window.uniworkWork = work as unknown as UniworkWorkApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: Parameters<typeof DeskToday>[0]) {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(DeskToday, props)))
  })
}
const base = (home: WorkLoad<WorkHomeSummary>) => ({
  home,
  view: 'ready' as const,
  workspace: WS,
  workspaceError: null,
  onReload: vi.fn(),
  onOpenTasks: vi.fn(),
})
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))

describe('DeskToday', () => {
  it('lists overdue and today tasks only, the live meeting and the other notifications', async () => {
    await render(base(load(summary())))
    const text = host.textContent ?? ''
    expect(text).toContain('Send the contract')
    expect(text).toContain('Approve leave')
    expect(text).not.toContain('Later')
    expect(text).toContain('Weekly sync')
    // the document comment belongs to the tray; one other notification is left
    expect(text).toContain('Other notifications (1)')
    await act(async () => button('Other notifications')!.click())
    expect(work.openWeb).toHaveBeenCalledWith({ kind: 'inbox', orgSlug: 'acme', wsSlug: 'team' })
  })

  it('ticks a task through the server and reloads; a refusal puts it back and offers Retry', async () => {
    const home = load(summary())
    await render(base(home))
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => box.click())
    expect(work.setTaskStatus).toHaveBeenCalledWith('t1', 'done')
    expect(home.reload).toHaveBeenCalled()

    work.setTaskStatus.mockResolvedValueOnce({ ok: false, error: 'server' })
    await act(async () => box.click())
    expect(home.update).toHaveBeenCalledTimes(3)
    expect(host.querySelector('.wb-toast')).not.toBeNull()
  })

  it('says when nothing is due, and opens the Tasks tab from "All tasks"', async () => {
    const props = base(load(summary({ my_work: [] })))
    await render(props)
    expect(host.textContent).toContain('Nothing due today.')
    await act(async () => button('All tasks')!.click())
    expect(props.onOpenTasks).toHaveBeenCalled()
  })

  it('shows the sign-in panel in its column when signed out', async () => {
    await render({
      ...base(load(null)),
      view: 'signed-out',
      workspace: null,
      workspaceError: 'signed-out',
    })
    expect(host.querySelector('.wb-state')).not.toBeNull()
    expect(host.textContent).toContain('Today')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-today.test.ts`
Expected: FAIL. Lỗi là `Cannot find module '../src/renderer/src/DeskToday'`.

- [ ] **Step 3: Implement `DeskToday.tsx`.** Phần lớn được port từ `WorkOverview.tsx` (myWork, meetings, toast):

```tsx
import { Fragment, useState } from 'react'
import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type {
  UniworkWorkError,
  WorkHomeSummary,
  WorkTask,
  WorkWebTarget,
} from '../../shared/uniwork-work-api'
import { docNotifications } from './desk-model'
import { useI18n, type StringKey } from './locale'
import { CHECK_GLYPH } from './WorkbenchIcons'
import {
  clock,
  dueState,
  formatDay,
  localDay,
  myWorkGroups,
  overdueDays,
  withTaskStatus,
  type OverviewView,
} from './work-home'
import { settleWork, type WorkLoad } from './work-cache'
import { WorkErrorState, WorkNoWorkspace, WorkStaleNote, WorkToast } from './WorkErrorState'

interface Props {
  home: WorkLoad<WorkHomeSummary>
  view: OverviewView
  workspace: UniworkWorkspaceRef | null
  workspaceError: UniworkWorkError | null
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  onOpenTasks: () => void
}

const TODAY_TASKS = 6
const GROUP_LABEL: Record<'overdue' | 'today', StringKey> = {
  overdue: 'wbTasksGroupOverdue',
  today: 'wbTasksGroupToday',
}

/** The Desk's right column (office desk spec §3.4): the date, due tasks, meetings, other notifications. */
export function DeskToday({
  home,
  view,
  workspace,
  workspaceError,
  onReload,
  onOpenTasks,
}: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const [failedWrite, setFailedWrite] = useState<{ task: WorkTask; status: string } | null>(null)
  const shown = view === 'ready' || view === 'stale' ? home.value : null
  const base = workspace ? { orgSlug: workspace.orgSlug, wsSlug: workspace.slug } : null
  const today =
    shown?.today ??
    localDay(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)

  const openWeb = (target: WorkWebTarget) => {
    void window.uniworkWork.openWeb(target).catch(() => false)
  }

  const setStatus = async (task: WorkTask, status: string) => {
    setFailedWrite(null)
    home.update((s) => withTaskStatus(s, task.id, status))
    const result = await settleWork(window.uniworkWork.setTaskStatus(task.id, status))
    if (result.ok) {
      home.reload() // counts and the cache follow the server
      return
    }
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

  const tasks = (s: WorkHomeSummary) => {
    if (s.partial.includes('tasks')) return retryLine
    let left = TODAY_TASKS
    const groups = myWorkGroups(s.my_work, s.today)
      .filter((g): g is { key: 'overdue' | 'today'; tasks: WorkTask[] } => g.key !== 'upcoming')
      .map((g) => {
        const listed = g.tasks.slice(0, left)
        left -= listed.length
        return { ...g, tasks: listed }
      })
      .filter((g) => g.tasks.length > 0)
    if (groups.length === 0) return <p className="wb-ov-note">{t('wbDeskTodayNoTasks')}</p>
    return (
      <div className="wb-block">
        {groups.map((group) => (
          <Fragment key={group.key}>
            <h4 className={`wb-group-head${group.key === 'overdue' ? ' is-overdue' : ''}`}>
              {t(GROUP_LABEL[group.key])} <span className="wb-num">{group.tasks.length}</span>
            </h4>
            <ul className="wb-ov-list">
              {group.tasks.map((task) => {
                const done = task.status === 'done'
                const due = dueState(task, s.today)
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
                    <button
                      type="button"
                      className="wb-ov-row-title"
                      onClick={() => base && openWeb({ kind: 'task', ...base, id: task.id })}
                    >
                      {task.title}
                    </button>
                    {due === 'overdue' ? (
                      <span className="wb-pill wb-num is-danger">
                        {t('wbOvDueOverdue', { count: overdueDays(s.today, task.due_date) })}
                      </span>
                    ) : due === 'today' ? (
                      <span className="wb-pill is-warning">{t('wbOvDueToday')}</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Fragment>
        ))}
      </div>
    )
  }

  const meetings = (s: WorkHomeSummary) => (
    <section className="wb-ov-card">
      <h3 className="wb-ov-card-title">{t('wbOvMeetings')}</h3>
      {s.partial.includes('meetings') ? (
        retryLine
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
                  {sub ? <span className="wb-ov-meet-sub wb-num">{sub}</span> : null}
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

  const others = (s: WorkHomeSummary) => {
    // document comments and mentions sit in the tray; the rest live on the web inbox
    const n = s.inbox.filter((x) => !x.read_at).length - docNotifications(s.inbox).length
    return n > 0 && base ? (
      <button type="button" className="wb-link" onClick={() => openWeb({ kind: 'inbox', ...base })}>
        {t('wbDeskOtherNotifs', { count: n })} →
      </button>
    ) : null
  }

  return (
    <aside className="wb-desk-side" aria-label={t('wbDeskToday')}>
      <header>
        <p className="wb-ov-date wb-num">{formatDay(today, dateLocale, true)}</p>
        <div className="wb-desk-head">
          <h3>{t('wbDeskToday')}</h3>
          {shown ? (
            <button type="button" className="wb-link" onClick={onOpenTasks}>
              {t('wbDeskAllTasks')} →
            </button>
          ) : null}
        </div>
        {view === 'stale' && home.updatedAt !== null ? (
          <WorkStaleNote at={home.updatedAt} onRetry={onReload} />
        ) : null}
      </header>
      {view === 'loading' ? (
        <div className="wb-ov-skel" aria-hidden="true">
          <span className="wb-skel wb-skel-row" />
          <span className="wb-skel wb-skel-row" />
        </div>
      ) : null}
      {view === 'signed-out' || view === 'forbidden' || view === 'unreachable' ? (
        <WorkErrorState state={workspaceError ?? home.error ?? 'offline'} onRetry={onReload} />
      ) : null}
      {view === 'no-workspace' ? <WorkNoWorkspace error={null} onRetry={onReload} /> : null}
      {shown ? (
        <>
          {tasks(shown)}
          {meetings(shown)}
          {others(shown)}
        </>
      ) : null}
      {failedWrite ? (
        <WorkToast
          message="wbOvTaskUpdateFailed"
          onRetry={() => void setStatus(failedWrite.task, failedWrite.status)}
          onDismiss={() => setFailedWrite(null)}
        />
      ) : null}
    </aside>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/shell && npx vitest run tests/desk-today.test.ts`
Expected: PASS. Nếu số lần gọi `home.update` trong test thứ hai khác 3 thì đếm lại theo luồng: lần 1 là optimistic (ok), lần 2 là optimistic, lần 3 là revert. Sửa expect cho khớp, nhưng không được sửa logic.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/src/renderer/src/DeskToday.tsx apps/shell/tests/desk-today.test.ts
git commit -m "feat(shell): Desk Today column with due tasks, meetings and other notifications"
```

---

### Task 9: `DeskInTray`, `DeskInProgress`, `DeskDrawer`

**Files:**

- Create: `apps/shell/src/renderer/src/DeskInTray.tsx`, `DeskInProgress.tsx`, `DeskDrawer.tsx`
- Test: `apps/shell/tests/desk-sections.test.ts`

**Interfaces:**

- Consumes: `docNotifications`, `freshShared`, `syncProblems`, `inTrayRows`, `inProgressRows` (Task 5); `draftFromForm` (Task 7); `markNotificationsRead` (Task 1); `listDrafts` (Task 2); các khóa `wbDesk*` (Task 6).
- Produces:
  - `DeskInTray({ home, signedIn, local })`
  - `DeskInProgress({ drafts, recent })`
  - `DeskDrawer({ practiceId, packId, orgId, vi, onManage })`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-sections.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, RecentEntry } from '../src/shared/home-api'
import type { TabsApi } from '../src/shared/tabs-api'
import type { UniworkWorkApi, WorkHomeSummary } from '../src/shared/uniwork-work-api'
import { DeskDrawer } from '../src/renderer/src/DeskDrawer'
import { DeskInProgress } from '../src/renderer/src/DeskInProgress'
import { DeskInTray } from '../src/renderer/src/DeskInTray'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { WorkLoad } from '../src/renderer/src/work-cache'
import { writeForms } from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let work: { markNotificationsRead: ReturnType<typeof vi.fn> }

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    uniworkOpenDocument: vi.fn(async () => ({ ok: true, value: { path: '/c/x.docx' } })),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    browse: vi.fn(async () => undefined),
    accountLogin: vi.fn(async () => true),
    newDoc: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
  work = { markNotificationsRead: vi.fn(async () => ({ ok: true, value: null })) }
  window.uniworkWork = work as unknown as UniworkWorkApi
  window.aiOfficeTabs = { activate: vi.fn(async () => undefined) } as unknown as TabsApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(el: ReactElement) {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, el))
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label))

function home(inbox: WorkHomeSummary['inbox']): WorkLoad<WorkHomeSummary> {
  const value = {
    today: '2026-10-14',
    timezone: '',
    counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
    my_work: [],
    upcoming_meetings: [],
    inbox,
    partial: [],
    generated_at: '',
  } as WorkHomeSummary
  return { value, updatedAt: 1, error: null, stale: false, reload: vi.fn(), update: vi.fn() }
}
const comment = {
  id: 'n1',
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'x',
  params: { actor: 'Lan', document: 'Contract-012' },
  created_at: '2026-10-14T01:00:00Z',
}

describe('DeskInTray', () => {
  it('opens a commented document, then marks the notification read and drops it', async () => {
    const h = home([comment])
    await render(createElement(DeskInTray, { home: h, signedIn: true, local: [] }))
    expect(host.textContent).toContain('Contract-012')
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(work.markNotificationsRead).toHaveBeenCalledWith(['n1'])
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('keeps the row quietly when marking read fails', async () => {
    work.markNotificationsRead.mockResolvedValueOnce({ ok: false, error: 'offline' })
    const h = home([comment])
    await render(createElement(DeskInTray, { home: h, signedIn: true, local: [] }))
    await act(async () => button('Contract-012')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.uniworkOpenDocument).toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a sync problem from a working copy', async () => {
    api.uniworkDocStatus.mockResolvedValue({
      path: '/c/p.docx',
      documentId: 'd9',
      workspaceId: 'w',
      title: 'Proposal',
      format: 'docx',
      access: 'edit',
      state: 'conflict',
    })
    const local = [
      {
        path: '/c/p.docx',
        name: 'p.docx',
        ext: 'docx',
        mtimeMs: 1,
        sizeBytes: 1,
        starred: false,
        uniwork: { documentId: 'd9' },
      } as RecentEntry,
    ]
    await render(createElement(DeskInTray, { home: home([]), signedIn: true, local }))
    expect(host.textContent).toContain('Proposal')
    expect(host.textContent).toContain('Version conflict')
  })

  it('invites sign-in when signed out and the tray is empty', async () => {
    await render(
      createElement(DeskInTray, { home: { ...home([]), value: null }, signedIn: false, local: [] }),
    )
    expect(api.uniworkListSharedWithMe).not.toHaveBeenCalled()
    await act(async () => host.querySelector<HTMLButtonElement>('.wb-ov-note .wb-link')!.click())
    expect(api.accountLogin).toHaveBeenCalled()
  })
})

describe('DeskInProgress', () => {
  it('switches to an unsaved tab and opens a recovery copy', async () => {
    await render(
      createElement(DeskInProgress, {
        drafts: [
          { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/r.docx' },
          {
            kind: 'recovery',
            title: 'old.xlsx',
            app: 'sheets',
            filePath: '/w/old.xlsx',
            modifiedMs: 1,
          },
        ],
        recent: [],
      }),
    )
    expect(host.textContent).toContain('Unsaved')
    expect(host.textContent).toContain('Recovered copy')
    await act(async () => button('Report')!.click())
    expect(window.aiOfficeTabs.activate).toHaveBeenCalledWith('t1')
    await act(async () => button('old.xlsx')!.click())
    expect(api.openPath).toHaveBeenCalledWith('/w/old.xlsx')
  })

  it('offers Open file when nothing is in progress', async () => {
    await render(createElement(DeskInProgress, { drafts: [], recent: [] }))
    await act(async () => button('Open file')!.click())
    expect(api.browse).toHaveBeenCalled()
  })
})

describe('DeskDrawer', () => {
  it('drafts a form into the pack, and sends Manage to the Forms tab', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    const onManage = vi.fn()
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: 'p1',
        orgId: null,
        vi: false,
        onManage,
      }),
    )
    await act(async () => button('Quote')!.click())
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(api.newDoc).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
    await act(async () => button('Manage')!.click())
    expect(onManage).toHaveBeenCalled()
  })

  it('locks a form chip when there is no pack to draft into', async () => {
    writeForms('legal', [{ id: 'f1', title: 'Quote' }])
    await render(
      createElement(DeskDrawer, {
        practiceId: 'legal',
        packId: null,
        orgId: null,
        vi: false,
        onManage: vi.fn(),
      }),
    )
    expect(button('Quote')!.disabled).toBe(true)
  })
})
```

> `writeForms` ghi vào `localStorage` của jsdom khi `window.aiOffice.wb` không có (`workbench-store-client.ts:38,68`), nên không cần setup gì thêm.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-sections.test.ts`
Expected: FAIL. Lỗi là cannot find module `DeskInTray`.

- [ ] **Step 3: Implement `DeskInTray.tsx`**

```tsx
import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { RecentEntry, UniworkDocStatus, UniworkDocSummary } from '../../shared/home-api'
import type { WorkHomeSummary } from '../../shared/uniwork-work-api'
import {
  docNotifications,
  freshShared,
  inTrayRows,
  syncProblems,
  type InTrayRow,
} from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openUniworkDocument } from './uniwork-open'
import { WorkbenchIcon } from './WorkbenchIcons'
import { notificationKey } from './work-home'
import type { WorkLoad } from './work-cache'
import { WorkStatePanel } from './WorkErrorState'

const TRAY_ROWS = 8
/** working copies whose sync state is asked for (one stat each in main) */
const SYNC_PROBES = 20

interface Props {
  home: WorkLoad<WorkHomeSummary>
  /** a workspace is selected: the server sources can load */
  signedIn: boolean
  /** this device's recents as listed (working copies included) */
  local: readonly RecentEntry[]
}

/** "Cần bạn xử lý" (office desk spec §3.1): sync problems, comments and mentions, new shares. */
export function DeskInTray({ home, signedIn, local }: Props): ReactElement {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const [shared, setShared] = useState<UniworkDocSummary[]>([])
  const [statuses, setStatuses] = useState<Record<string, UniworkDocStatus>>({})
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!signedIn) {
      setShared([])
      return
    }
    let live = true
    void window.aiOffice.uniworkListSharedWithMe({ limit: 20 }).then(
      (r) => {
        if (live) setShared(r.ok ? r.value.documents : [])
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [signedIn])

  const bound = useMemo(
    () =>
      local
        .filter((e) => e.uniwork)
        .slice(0, SYNC_PROBES)
        .map((e) => e.path),
    [local],
  )
  const boundKey = bound.join('\n')
  useEffect(() => {
    let live = true
    void Promise.all(bound.map((p) => window.aiOffice.uniworkDocStatus(p).catch(() => null))).then(
      (list) => {
        if (live) setStatuses(Object.fromEntries(list.flatMap((s) => (s ? [[s.path, s]] : []))))
      },
    )
    const off = window.aiOffice.onUniworkDocStatus((s) => {
      if (bound.includes(s.path)) setStatuses((m) => ({ ...m, [s.path]: s }))
    })
    return () => {
      live = false
      off()
    }
    // boundKey stands for `bound`: same paths, same subscription
  }, [boundKey])

  const rows = inTrayRows({
    notes: home.value ? docNotifications(home.value.inbox) : [],
    shared: freshShared(shared, local, Date.now()),
    sync: syncProblems(Object.values(statuses)),
  })
  const visible = expanded ? rows : rows.slice(0, TRAY_ROWS)

  const openNote = async (id: string, documentId: string, title: string) => {
    await openUniworkDocument({ documentId, title }, window.aiOffice)
    const r = await window.uniworkWork.markNotificationsRead([id]).catch(() => null)
    // a refusal is quiet: the row comes back with the next summary
    if (r?.ok) home.update((s) => ({ ...s, inbox: s.inbox.filter((n) => n.id !== id) }))
  }

  const describe = (
    r: InTrayRow,
  ): {
    key: string
    icon: ReactNode
    title: string
    reason: string
    at: string
    open: () => void
  } => {
    if (r.kind === 'note') {
      const n = r.note
      const title = n.params.document ?? ''
      return {
        key: `n:${n.id}`,
        icon: <WorkbenchIcon id="inbox" size={20} tint="blue" />,
        title,
        reason: t(notificationKey(n.kind), n.params),
        at: n.created_at,
        open: () => void openNote(n.id, n.resource_id, title),
      }
    }
    if (r.kind === 'shared') {
      const d = r.doc
      return {
        key: `s:${d.id}`,
        icon: <FileBadge ext={docExtension(d)} size={20} />,
        title: d.title,
        reason: t('wbDeskReasonShared'),
        at: d.updatedAt,
        open: () => void openUniworkDocument({ documentId: d.id, title: d.title }, window.aiOffice),
      }
    }
    const s = r.status
    return {
      key: `y:${s.path}`,
      icon: <FileBadge ext={s.format} size={20} />,
      title: s.title,
      reason: t(s.state === 'conflict' ? 'wbDeskReasonConflict' : 'wbDeskReasonSync'),
      at: s.lastSavedAt ?? '',
      open: () =>
        void openUniworkDocument({ documentId: s.documentId, title: s.title }, window.aiOffice),
    }
  }

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInTray')}</h3>
        {rows.length > 0 ? <span className="wb-count wb-num">{rows.length}</span> : null}
      </div>
      {rows.length === 0 ? (
        signedIn ? (
          <WorkStatePanel
            tone="gray"
            icon={<WorkbenchIcon id="inbox" size={20} />}
            title={t('wbDeskInTrayEmpty')}
            role="status"
          />
        ) : (
          <p className="wb-ov-note">
            {t('wbOvSignedOutTitle')} ·{' '}
            <button
              type="button"
              className="wb-link"
              onClick={() => void window.aiOffice.accountLogin().catch(() => false)}
            >
              {t('acctSignInUniwork')}
            </button>
          </p>
        )
      ) : (
        <ul className="wb-ov-list wb-block">
          {visible.map((r) => {
            const d = describe(r)
            return (
              <li key={d.key} className="wb-row">
                {d.icon}
                <span className="wb-desk-row-main">
                  <button type="button" className="wb-desk-row-title" onClick={d.open}>
                    {d.title}
                  </button>
                  <span className="wb-desk-reason">{d.reason}</span>
                </span>
                {d.at ? (
                  <span className="wb-mono wb-num">{formatWhen(d.at, dateLocale)}</span>
                ) : null}
              </li>
            )
          })}
          {rows.length > visible.length ? (
            <li className="wb-row">
              <button type="button" className="wb-link" onClick={() => setExpanded(true)}>
                {t('wbDeskMore', { count: rows.length - visible.length })}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Implement `DeskInProgress.tsx`**

```tsx
import { useId } from 'react'
import type { ReactElement } from 'react'
import type { DeskDraft } from '../../shared/home-api'
import type { DocumentTabKind } from '../../shared/tabs-api'
import type { WorkRecentDocument } from '../../shared/uniwork-work-api'
import { inProgressRows } from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n } from './locale'
import { docExtension, formatWhen } from './uniwork-docs-model'
import { openRecentEntry, openUniworkDocument } from './uniwork-open'
import { WbRowActions } from './WbRowActions'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'

const APP_EXT: Record<DocumentTabKind, string> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'md',
  html: 'html',
}

/** "Đang làm dở" (office desk spec §3.2): unsaved tabs and recovery copies, then recent documents. */
export function DeskInProgress({
  drafts,
  recent,
}: {
  drafts: readonly DeskDraft[]
  recent: readonly WorkRecentDocument[]
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const titleId = useId()
  const rows = inProgressRows(drafts, recent)
  const when = (ms: number) => formatWhen(new Date(ms).toISOString(), dateLocale)

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInProgress')}</h3>
      </div>
      {rows.length === 0 ? (
        <WorkStatePanel
          tone="gray"
          icon={<WorkbenchIcon id="desk" size={20} />}
          title={t('wbDeskInProgressEmpty')}
          action={{
            label: t('wbDeskOpenFile'),
            onClick: () => void window.aiOffice.browse(),
            variant: 'secondary',
          }}
          role="status"
        />
      ) : (
        <ul className="wb-ov-list wb-block">
          {rows.map((r) => {
            if (r.kind === 'draft') {
              const d = r.draft
              const go = () => {
                if (d.kind === 'unsaved' && d.tabId) void window.aiOfficeTabs.activate(d.tabId)
                else if (d.filePath) void window.aiOffice.openPath(d.filePath)
              }
              return (
                <li key={`d:${d.tabId ?? d.filePath}`} className="wb-row">
                  <FileBadge ext={APP_EXT[d.app]} size={20} />
                  <button type="button" className="wb-desk-row-title" onClick={go}>
                    {d.title}
                  </button>
                  <span className="wb-pill is-warning">
                    {t(d.kind === 'unsaved' ? 'wbDeskUnsaved' : 'wbDeskRecovery')}
                  </span>
                  {d.modifiedMs ? (
                    <span className="wb-mono wb-num">{when(d.modifiedMs)}</span>
                  ) : null}
                  <WbRowActions>
                    {/* pointer shortcut only: the title button is the keyboard and reader path */}
                    <button
                      type="button"
                      className="wb-btn wb-btn-ghost wb-btn-sm"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={go}
                    >
                      {t(d.kind === 'unsaved' ? 'wbDeskSwitchTo' : 'wbCommonOpen')}
                    </button>
                  </WbRowActions>
                </li>
              )
            }
            const doc = r.doc
            if (doc.source === 'uniwork') {
              return (
                <li key={`u:${doc.doc.id}`} className="wb-row">
                  <FileBadge ext={docExtension(doc.doc)} size={20} />
                  <button
                    type="button"
                    className="wb-desk-row-title"
                    onClick={() =>
                      void openUniworkDocument(
                        { documentId: doc.doc.id, title: doc.doc.title },
                        window.aiOffice,
                      )
                    }
                  >
                    {doc.doc.title}
                  </button>
                  <span className="wb-mono wb-num">
                    {formatWhen(doc.doc.updatedAt, dateLocale)}
                  </span>
                </li>
              )
            }
            const e = doc.entry
            return (
              <li key={`l:${e.path}`} className="wb-row">
                <FileBadge ext={e.ext} size={20} />
                <button
                  type="button"
                  className="wb-desk-row-title"
                  onClick={() => void openRecentEntry(e, window.aiOffice)}
                >
                  {e.name}
                </button>
                <span className="wb-mono wb-num">
                  {when(e.mtimeMs)} · {t('wbOnThisDevice')}
                </span>
                <WbRowActions>
                  <button
                    type="button"
                    className="wb-btn wb-btn-ghost wb-btn-sm"
                    onClick={() => void window.aiOffice.revealPath(e.path)}
                  >
                    {t('wbDeskShowInFolder')}
                  </button>
                </WbRowActions>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Implement `DeskDrawer.tsx`**

```tsx
import { useId, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { FileBadge } from './FileBadge'
import { draftFromForm } from './form-draft'
import { useI18n } from './locale'
import { readForms } from './workbench-pins'
import { WorkbenchIcon } from './WorkbenchIcons'

const DRAWER_FORMS = 8

/** "Ngăn kéo" (office desk spec §3.3): the saved forms, one click to draft. */
export function DeskDrawer({
  practiceId,
  packId,
  orgId,
  vi,
  onManage,
}: {
  practiceId: PracticeId
  /** where a draft goes (selected pack, else the default one); null = none yet */
  packId: string | null
  orgId: string | null
  vi: boolean
  onManage: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  // the Desk remounts each time its tab is shown, so a read on mount sees Forms' edits
  const [forms] = useState(() => readForms(practiceId).slice(0, DRAWER_FORMS))

  return (
    <section className="wb-desk-section" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskDrawer')}</h3>
        <button type="button" className="wb-link" onClick={onManage}>
          {t('wbDeskDrawerManage')} →
        </button>
      </div>
      {forms.length === 0 ? (
        <p className="wb-ov-note">
          {t('wbDeskDrawerEmpty')} ·{' '}
          <button type="button" className="wb-link" onClick={onManage}>
            {t('wbDeskDrawerAdd')}
          </button>
        </p>
      ) : (
        <ul className="wb-desk-chips">
          {forms.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-chip"
                disabled={!packId}
                title={packId ? (f.note ?? f.title) : t('wbFormsDraftNeedsPack')}
                onClick={() => {
                  if (packId) void draftFromForm(f, packId, orgId, vi)
                }}
              >
                {f.fileExt ? (
                  <FileBadge ext={f.fileExt.replace(/^\./, '')} size={16} />
                ) : (
                  <WorkbenchIcon id="forms" size={16} />
                )}
                {f.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/shell && npx vitest run tests/desk-sections.test.ts && cd ../.. && npm run typecheck -w @genoffice/shell`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/shell/src/renderer/src/DeskInTray.tsx apps/shell/src/renderer/src/DeskInProgress.tsx apps/shell/src/renderer/src/DeskDrawer.tsx apps/shell/tests/desk-sections.test.ts
git commit -m "feat(shell): Desk tray, work in progress and forms drawer"
```

---

### Task 10: `DeskTools`: thanh dụng cụ, bảng thả tệp, popover tách, toast

**Files:**

- Create: `apps/shell/src/renderer/src/DeskTools.tsx`
- Test: `apps/shell/tests/desk-tools-ui.test.ts`

**Interfaces:**

- Consumes: `runDeskTool` (Task 4), `applicableTools` (Task 5).
- Produces: `DeskTools({ dropped: readonly string[] | null; onDropHandled: () => void; unsavedPaths: ReadonlySet<string> })`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-tools-ui.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { DeskTools } from '../src/renderer/src/DeskTools'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    runDeskTool: vi.fn(async () => ({ ok: true, outputs: ['/w/a.docx'] })),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: Parameters<typeof DeskTools>[0]) {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(DeskTools, props)))
  })
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
const click = async (label: string) => {
  await act(async () => button(label)!.click())
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}
const noDrop = { dropped: null, onDropHandled: vi.fn(), unsavedPaths: new Set<string>() }

describe('DeskTools', () => {
  it('runs a tool with no inputs (main picks) and offers Open and Show in folder', async () => {
    await render(noDrop)
    await click('PDF → Word')
    expect(api.runDeskTool).toHaveBeenCalledWith({ tool: 'pdf-to-docx' })
    expect(host.textContent).toContain('Created a.docx')
    await click('Open')
    expect(api.openPath).toHaveBeenCalledWith('/w/a.docx')
  })

  it('asks for pages per part before splitting', async () => {
    api.runDeskTool.mockResolvedValueOnce({
      ok: true,
      outputs: ['/o/a-parts/a-1.pdf', '/o/a-parts/a-2.pdf'],
    })
    await render(noDrop)
    await click('Split PDF')
    expect(api.runDeskTool).not.toHaveBeenCalled()
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Split')
    expect(api.runDeskTool).toHaveBeenCalledWith({ tool: 'split-pdf', splitEvery: 3 })
    expect(host.textContent).toContain('Created 2 files in a-parts')
  })

  it('shows only the tools that fit dropped files and runs one on them', async () => {
    const onDropHandled = vi.fn()
    await render({ dropped: ['/w/a.pdf', '/w/b.pdf'], onDropHandled, unsavedPaths: new Set() })
    const panel = host.querySelector('.wb-desk-panel')!
    expect(panel.textContent).toContain('Merge PDFs')
    expect(panel.textContent).not.toContain('PDF → Word')
    await act(async () =>
      Array.from(panel.querySelectorAll('button'))
        .find((b) => b.textContent === 'Merge PDFs')!
        .click(),
    )
    expect(api.runDeskTool).toHaveBeenCalledWith({
      tool: 'merge-pdf',
      inputs: ['/w/a.pdf', '/w/b.pdf'],
    })
    expect(onDropHandled).toHaveBeenCalled()
  })

  it('says no tool fits a dropped image, and notes an unsaved file exports as saved', async () => {
    await render({ dropped: ['/w/p.png'], onDropHandled: vi.fn(), unsavedPaths: new Set() })
    expect(host.textContent).toContain('No tool takes this kind of file.')
    await render({
      dropped: ['/w/r.docx'],
      onDropHandled: vi.fn(),
      unsavedPaths: new Set(['/w/r.docx']),
    })
    expect(host.textContent).toContain('Exports the saved version')
  })

  it('turns a refusal into a short message and stays quiet on cancel', async () => {
    api.runDeskTool.mockResolvedValueOnce({ ok: false, error: 'busy' })
    await render(noDrop)
    await click('Merge PDFs')
    expect(host.textContent).toContain('Another tool is still running.')
    api.runDeskTool.mockResolvedValueOnce({ ok: false, canceled: true })
    await click('Export PDF')
    expect(host.querySelector('.wb-toast')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-tools-ui.test.ts`
Expected: FAIL. Lỗi là cannot find module `DeskTools`.

- [ ] **Step 3: Implement `DeskTools.tsx`**

```tsx
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { DeskToolId, DeskToolResult } from '../../shared/home-api'
import { applicableTools } from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'

const TOOLS: readonly { id: DeskToolId; label: StringKey; ext: string }[] = [
  { id: 'pdf-to-docx', label: 'wbDeskToolPdfToDocx', ext: 'docx' },
  { id: 'pdf-to-xlsx', label: 'wbDeskToolPdfToXlsx', ext: 'xlsx' },
  { id: 'pdf-to-pptx', label: 'wbDeskToolPdfToPptx', ext: 'pptx' },
  { id: 'export-pdf', label: 'wbDeskToolExportPdf', ext: 'pdf' },
  { id: 'merge-pdf', label: 'wbDeskToolMergePdf', ext: 'pdf' },
  { id: 'split-pdf', label: 'wbDeskToolSplitPdf', ext: 'pdf' },
]

type ToolError = Extract<DeskToolResult, { error: string }>['error']
const ERROR_KEY: Record<ToolError, StringKey> = {
  busy: 'wbDeskToolBusy',
  'bad-input': 'wbDeskToolBadInput',
  'not-found': 'wbDeskToolNotFound',
  'same-path': 'wbDeskToolSamePath',
  'target-open': 'wbDeskToolTargetOpen',
  failed: 'wbDeskToolFailed',
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const clampEvery = (raw: string) => Math.min(999, Math.max(1, Math.floor(Number(raw)) || 1))

/** the Desk's tool strip, drop chooser, split popover and result toast (office desk spec §4) */
export function DeskTools({
  dropped,
  onDropHandled,
  unsavedPaths,
}: {
  /** files dropped on the Desk, waiting for a tool; null when none */
  dropped: readonly string[] | null
  onDropHandled: () => void
  /** files open with unsaved changes: Export PDF reads the saved version */
  unsavedPaths: ReadonlySet<string>
}): ReactElement {
  const { t } = useI18n()
  const [running, setRunning] = useState<DeskToolId | null>(null)
  const [splitFor, setSplitFor] = useState<{ inputs?: string[] } | null>(null)
  const [every, setEvery] = useState(1)
  // keys and paths only; translated at render
  const [toast, setToast] = useState<{ outputs: string[] } | { error: StringKey } | null>(null)

  const run = async (tool: DeskToolId, inputs?: string[], askedSplit = false) => {
    onDropHandled()
    if (tool === 'split-pdf' && !askedSplit) {
      setSplitFor(inputs ? { inputs } : {})
      return
    }
    setSplitFor(null)
    setToast(null)
    setRunning(tool)
    const result = await window.aiOffice
      .runDeskTool({
        tool,
        ...(inputs ? { inputs } : {}),
        ...(tool === 'split-pdf' ? { splitEvery: every } : {}),
      })
      .catch((): DeskToolResult => ({ ok: false, error: 'failed' }))
    setRunning(null)
    if (result.ok) setToast({ outputs: result.outputs })
    else if (!('canceled' in result)) setToast({ error: ERROR_KEY[result.error] })
  }

  const busy = running !== null
  const fitting = dropped ? applicableTools(dropped) : []

  return (
    <section className="wb-desk-section" aria-label={t('wbDeskTools')}>
      <div className="wb-desk-tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-tool"
            disabled={busy}
            aria-busy={running === tool.id}
            onClick={() => void run(tool.id)}
          >
            <FileBadge ext={tool.ext} size={16} />
            {t(tool.label)}
          </button>
        ))}
        <p className="wb-desk-hint">{t('wbDeskDropHint')}</p>
      </div>

      {splitFor ? (
        <div className="wb-desk-panel wb-block wb-desk-split">
          <label>
            {t('wbDeskSplitEvery')}{' '}
            <input
              type="number"
              min={1}
              max={999}
              value={every}
              onChange={(e) => setEvery(clampEvery(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="wb-btn wb-btn-primary wb-btn-sm"
            onClick={() => void run('split-pdf', splitFor.inputs, true)}
          >
            {t('wbDeskSplitRun')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-ghost wb-btn-sm"
            onClick={() => setSplitFor(null)}
          >
            {t('wbCommonCancel')}
          </button>
        </div>
      ) : null}

      {dropped ? (
        <div className="wb-desk-panel wb-block" role="group" aria-label={t('wbDeskDropHint')}>
          <p>{dropped.map(fileName).join(', ')}</p>
          {fitting.length === 0 ? <p>{t('wbDeskDropNone')}</p> : null}
          {fitting.map((id) => (
            <button
              key={id}
              type="button"
              className="wb-btn wb-btn-primary wb-btn-sm"
              disabled={busy}
              onClick={() => void run(id, [...dropped])}
            >
              {t(TOOLS.find((x) => x.id === id)!.label)}
            </button>
          ))}
          <button
            type="button"
            className="wb-btn wb-btn-secondary wb-btn-sm"
            onClick={() => {
              for (const p of dropped) void window.aiOffice.openPath(p)
              onDropHandled()
            }}
          >
            {t('wbCommonOpen')}
          </button>
          <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={onDropHandled}>
            {t('wbCommonCancel')}
          </button>
          {fitting.includes('export-pdf') && dropped.some((p) => unsavedPaths.has(p)) ? (
            <p>{t('wbDeskFromSaved')}</p>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className="wb-toast" role={'error' in toast ? 'alert' : 'status'}>
          {'error' in toast ? (
            <span>{t(toast.error)}</span>
          ) : (
            <>
              <span>
                {toast.outputs.length === 1
                  ? t('wbDeskToolDone', { name: fileName(toast.outputs[0]!) })
                  : t('wbDeskToolDoneMany', {
                      count: toast.outputs.length,
                      folder: fileName(folderOf(toast.outputs[0]!)),
                    })}
              </span>
              {toast.outputs.length === 1 ? (
                <button
                  type="button"
                  className="wb-link"
                  onClick={() => void window.aiOffice.openPath(toast.outputs[0]!)}
                >
                  {t('wbCommonOpen')}
                </button>
              ) : null}
              <button
                type="button"
                className="wb-link"
                onClick={() => void window.aiOffice.revealPath(toast.outputs[0]!)}
              >
                {t('wbDeskShowInFolder')}
              </button>
            </>
          )}
          <button type="button" className="wb-link" onClick={() => setToast(null)}>
            {t('wbOvDismiss')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/shell && npx vitest run tests/desk-tools-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/src/renderer/src/DeskTools.tsx apps/shell/tests/desk-tools-ui.test.ts
git commit -m "feat(shell): Desk tool strip with drop chooser, split prompt and result toast"
```

---

### Task 11: `DeskView` + nối vào `PracticeHome` + CSS + đổi nhãn + xóa `WorkOverview`

**Files:**

- Create: `apps/shell/src/renderer/src/DeskView.tsx`
- Modify: `apps/shell/src/renderer/src/PracticeHome.tsx` (import ~dòng 50, `openCompose` ~dòng 151, render ~dòng 628)
- Modify: `apps/shell/src/renderer/src/home.css` (thêm khối `.wb-desk*` ngay trước `.wb-ov {`, ~dòng 4395)
- Modify: `packages/practice-core/src/modules.ts:22-29`
- Modify: `apps/shell/tests/workbench-theme-audit.test.ts:39`
- Delete: `apps/shell/src/renderer/src/WorkOverview.tsx`, `apps/shell/tests/work-overview.test.ts`
- Test: `apps/shell/tests/desk-view.test.ts`

**Interfaces:**

- Consumes: tất cả component Desk ở Task 8 đến 10; `listDrafts` (Task 2); `useRecentDocuments(…, limit)` (Task 5).
- Produces: `DeskView(props: { practiceId; vi; workspaces; workspaceId; workspaceError; refreshTick; packId; onReload; onSummary?; onOpenTab: (id: 'tasks' | 'forms') => void })`

- [ ] **Step 1: Write the failing test.** Tạo file `apps/shell/tests/desk-view.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { TabsApi } from '../src/shared/tabs-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'
import { DeskView } from '../src/renderer/src/DeskView'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    listDrafts: vi.fn(async () => []),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    pathForFile: vi.fn((f: File) => `/drop/${f.name}`),
    accountLogin: vi.fn(async () => true),
  }
  window.aiOffice = api as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(async () => ({ ok: false, error: 'signed-out' })),
  } as unknown as UniworkWorkApi
  window.aiOfficeTabs = {
    onChanged: vi.fn(() => () => undefined),
    activate: vi.fn(),
  } as unknown as TabsApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount() {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(DeskView, {
          practiceId: 'legal',
          vi: false,
          workspaces: [],
          workspaceId: null,
          workspaceError: 'signed-out',
          refreshTick: 0,
          packId: null,
          onReload: vi.fn(),
          onOpenTab: vi.fn(),
        }),
      ),
    )
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

describe('DeskView', () => {
  it('lays out tools, tray, work in progress, drawer and Today, even signed out', async () => {
    await mount()
    const text = host.textContent ?? ''
    for (const s of ['PDF → Word', 'Needs you', 'In progress', 'Forms drawer', 'Today']) {
      expect(text).toContain(s)
    }
    expect(api.listDrafts).toHaveBeenCalled()
  })

  it('claims a file drop so the open-on-drop bridge leaves it alone, and offers the tools', async () => {
    await mount()
    const desk = host.querySelector('.wb-desk')!
    const file = new File(['x'], 'a.pdf')
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: unknown
    }
    drop.dataTransfer = { types: ['Files'], files: [file] }
    await act(async () => {
      desk.dispatchEvent(drop)
    })
    expect(drop.defaultPrevented).toBe(true)
    expect(host.querySelector('.wb-desk-panel')?.textContent).toContain('PDF → Word')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shell && npx vitest run tests/desk-view.test.ts`
Expected: FAIL. Lỗi là cannot find module `DeskView`.

- [ ] **Step 3: Implement `DeskView.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import type { DeskDraft, UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError, WorkHomeSummary } from '../../shared/uniwork-work-api'
import { DeskDrawer } from './DeskDrawer'
import { DeskInProgress } from './DeskInProgress'
import { DeskInTray } from './DeskInTray'
import { DeskToday } from './DeskToday'
import { DeskTools } from './DeskTools'
import { HOME_REFRESH_MS, overviewView, useRecentDocuments } from './work-home'
import { useWorkLoad } from './work-cache'

interface Props {
  practiceId: PracticeId
  vi: boolean
  /** null while the list loads */
  workspaces: readonly UniworkWorkspaceRef[] | null
  workspaceId: string | null
  workspaceError: UniworkWorkError | null
  refreshTick: number
  /** where a form draft goes: the selected pack, else the default one; null = none yet */
  packId: string | null
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  /** each summary on screen (null before one exists): the page redraws the tab counts on it */
  onSummary?: (summary: WorkHomeSummary | null) => void
  onOpenTab: (id: 'tasks' | 'forms') => void
}

const IN_PROGRESS_ROWS = 10

/** Mặt bàn (office desk spec): tools, what needs you, work in progress, the forms drawer, Today. */
export function DeskView({
  practiceId,
  vi,
  workspaces,
  workspaceId,
  workspaceError,
  refreshTick,
  packId,
  onReload,
  onSummary,
  onOpenTab,
}: Props): ReactElement {
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const wsId = workspace?.id ?? null
  const home = useWorkLoad<WorkHomeSummary>(
    wsId ? `home:${wsId}` : null,
    () => window.uniworkWork.homeSummary(wsId ?? ''),
    { refreshTick, intervalMs: HOME_REFRESH_MS },
  )
  const view = overviewView({ workspaces, workspaceError, summary: home.value, error: home.error })
  const recents = useRecentDocuments(wsId, refreshTick, IN_PROGRESS_ROWS)
  const [drafts, setDrafts] = useState<DeskDraft[]>([])
  const [dropped, setDropped] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // a ref, so an inline callback never re-fires the effect
  const onSummaryRef = useRef(onSummary)
  onSummaryRef.current = onSummary
  useEffect(() => {
    onSummaryRef.current?.(home.value)
  }, [home.value])

  // drafts follow the tabs: a save, a close or a new unsaved tab changes them
  useEffect(() => {
    let live = true
    const load = () => {
      void window.aiOffice.listDrafts().then(
        (d) => {
          if (live) setDrafts(d)
        },
        () => undefined,
      )
    }
    load()
    const off = window.aiOfficeTabs?.onChanged(load)
    window.addEventListener('focus', load)
    return () => {
      live = false
      off?.()
      window.removeEventListener('focus', load)
    }
  }, [refreshTick])

  const unsavedPaths = useMemo(
    () => new Set(drafts.flatMap((d) => (d.kind === 'unsaved' && d.filePath ? [d.filePath] : []))),
    [drafts],
  )

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDragOver = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    // claimed here: the preload's drop-to-open bridge skips a drop the page handled
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.aiOffice.pathForFile(f))
      .filter((p) => p.length > 0)
    setDropped(paths.length > 0 ? paths : null)
  }

  return (
    <div
      className={`wb-desk${dragging ? ' is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="wb-desk-main">
        <DeskTools
          dropped={dropped}
          onDropHandled={() => setDropped(null)}
          unsavedPaths={unsavedPaths}
        />
        <DeskInTray home={home} signedIn={workspace !== null} local={recents.local} />
        <DeskInProgress drafts={drafts} recent={recents.docs} />
        <DeskDrawer
          practiceId={practiceId}
          packId={packId}
          orgId={workspace?.orgId ?? null}
          vi={vi}
          onManage={() => onOpenTab('forms')}
        />
      </div>
      <DeskToday
        home={home}
        view={view}
        workspace={workspace}
        workspaceError={workspaceError}
        onReload={onReload}
        onOpenTasks={() => onOpenTab('tasks')}
      />
    </div>
  )
}
```

- [ ] **Step 4: Wire `PracticeHome.tsx`**

1. Đổi `import { WorkOverview } from './WorkOverview'` thành `import { DeskView } from './DeskView'`.
2. Đổi `import { pinPillar } from './workbench-pins'` thành `import { pinModule, pinPillar } from './workbench-pins'`.
3. Xóa hàm `openCompose` (~dòng 151-155), vì chỉ `WorkOverview` dùng nó. Chạy `grep -n openCompose PracticeHome.tsx` để chắc không còn chỗ dùng nào. Thêm vào chỗ đó:

```ts
const openDeskTab = (id: 'tasks' | 'forms') => {
  // Forms is opt-in on the tab bar; the Desk's "Manage" pins it first
  if (id === 'forms') {
    pinModule(practice.id, 'forms')
    window.dispatchEvent(new Event('uniwork:wb-pins-changed'))
  }
  setTab(id)
}
```

4. Thay khối `<WorkOverview … />` (nhánh `tab === 'desk'`) bằng:

```tsx
<DeskView
  practiceId={practice.id}
  vi={vi}
  workspaces={workspaces}
  workspaceId={workspaceId}
  workspaceError={workspaceError}
  refreshTick={refreshTick}
  packId={selectedId ?? projects.find((p) => p.isDefault)?.id ?? null}
  onReload={refresh}
  onSummary={setHomeSummary}
  onOpenTab={openDeskTab}
/>
```

- [ ] **Step 5: Add the Desk CSS.** Trong `home.css`, chèn ngay trước `.wb-ov {`:

```css
/* Desk (office desk spec 2.2): documents on the left, Today on the right */
.wb-desk {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 1000px) {
  .wb-desk {
    grid-template-columns: minmax(0, 1fr);
  }
}

.wb-desk-main,
.wb-desk-side {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

/* a file drag over the Desk: the documents column is the drop target */
.wb-desk.is-dragging .wb-desk-main {
  border-radius: var(--radius-12);
  outline: 2px solid var(--accent);
  outline-offset: 6px;
  background: var(--accent-soft);
}

.wb-desk-section {
  min-width: 0;
}

.wb-desk-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
}

.wb-desk-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.wb-desk-head .wb-link {
  margin-left: auto;
  font-size: 12px;
}

.wb-desk-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-desk-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wb-desk-hint {
  flex-basis: 100%;
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.wb-desk-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px;
}

.wb-desk-panel p {
  flex-basis: 100%;
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.wb-desk-split label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
}

.wb-desk-split input {
  width: 72px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.wb-desk-row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.wb-desk-row-title {
  overflow: hidden;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 500;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.wb-desk-row-title:hover {
  text-decoration: underline;
}

.wb-desk-reason {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-desk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wb-desk-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .wb-desk.is-dragging .wb-desk-main {
    transition: none;
  }
}
```

- [ ] **Step 6: Rename the tab, delete the old view, update the theme audit list**

Trong `packages/practice-core/src/modules.ts`, thay 4 trường nhãn của module `desk` bằng:

```ts
    labelVi: 'Mặt bàn',
    labelEn: 'Desk',
    hintVi: 'Tài liệu cần xử lý, đang làm dở và dụng cụ',
    hintEn: 'Documents to handle, work in progress and tools',
```

Đồng thời sửa comment ở đầu file: đổi `Core always-on modules: My Space / Tasks / Calendar.` thành `Core always-on modules: Desk / Tasks / Calendar.`

Sau đó chạy:

```bash
git rm apps/shell/src/renderer/src/WorkOverview.tsx apps/shell/tests/work-overview.test.ts
```

Trong `apps/shell/tests/workbench-theme-audit.test.ts`, thay dòng `'WorkOverview.tsx',` bằng:

```ts
  'DeskView.tsx',
  'DeskTools.tsx',
  'DeskInTray.tsx',
  'DeskInProgress.tsx',
  'DeskDrawer.tsx',
  'DeskToday.tsx',
```

- [ ] **Step 7: Run everything touched**

Run:

```bash
cd apps/shell && npx vitest run && cd ../.. && npm run typecheck -w @genoffice/shell && npm run typecheck -w @uniwork/practice-core && npm test -w @uniwork/practice-core && npm run check:theme-colors -- --base 7f99e562
```

Expected: tất cả PASS. Nếu test trong `packages/practice-core` hoặc `apps/shell/tests` kiểm tra nhãn `Tổng quan` / `Overview` của module `desk` thì sửa thành `Mặt bàn` / `Desk`. Tìm bằng: `grep -rn "Tổng quan\|'Overview'" apps/shell/tests packages/practice-core/tests`.

- [ ] **Step 8: Commit**

```bash
git add -A apps/shell/src/renderer/src apps/shell/tests packages/practice-core/src/modules.ts
git commit -m "feat(shell): the Workbench Overview becomes the office Desk"
```

---

### Task 12: Dọn code chết sau khi bỏ Overview

**Files:**

- Modify: `apps/shell/src/renderer/src/work-home.ts`: xóa `buildHeadline`, `greetingKey`, `hourIn`, `isQuiet`, `inboxTarget` và kiểu/hằng chỉ chúng dùng.
- Modify: `apps/shell/tests/work-home.test.ts`: xóa các `describe`/`it` chỉ test 5 hàm trên.
- Modify: `apps/shell/src/renderer/src/i18n/workbench/*.ts` (21 file): xóa khóa không còn dùng.
- Modify: `apps/shell/src/renderer/src/home.css`: xóa rule `.wb-ov-*` không còn class nào dùng.

- [ ] **Step 1: Confirm the helpers are dead.** Chạy lệnh sau. Mỗi tên chỉ được xuất hiện trong `work-home.ts` và `work-home.test.ts`:

```bash
cd apps/shell && for s in buildHeadline greetingKey hourIn isQuiet inboxTarget; do echo "$s: $(grep -rlw $s src tests | tr '\n' ' ')"; done
```

Xóa 5 hàm trong `work-home.ts` (giữ lại `greetingName` vì `WorkProfilePane` vẫn dùng), cùng các test của chúng trong `work-home.test.ts`. Sau khi xóa, typecheck sẽ chỉ ra import nào thừa (`WorkWebTarget`, `WorkNotification`…). Chỉ xóa những import đó nếu chúng không còn được dùng.

- [ ] **Step 2: Find and remove dead string keys.** Lưu đoạn sau vào scratchpad với tên `dead-keys.mjs` rồi chạy từ `apps/shell`:

```js
// usage: node dead-keys.mjs [--write]
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = 'src/renderer/src/i18n/workbench'
const zh = readFileSync(`${dir}/zh.ts`, 'utf8')
const keys = [...zh.matchAll(/^  (wbOv[A-Za-z_]*):/gm)].map((m) => m[1])
const used = (k) => {
  try {
    execSync(`grep -rqw ${k} src tests --include=*.ts --include=*.tsx --exclude-dir=i18n`)
    return true
  } catch {
    return false
  }
}
const dead = keys.filter((k) => !used(k))
console.log(dead.join('\n'))
if (process.argv.includes('--write')) {
  for (const file of readdirSync(dir)) {
    let text = readFileSync(`${dir}/${file}`, 'utf8')
    // the key line plus its 4-space continuation lines (multi-line values)
    for (const k of dead)
      text = text.replace(new RegExp(`^  ${k}:[^\\n]*\\n(?:    [^\\n]*\\n)*`, 'm'), '')
    writeFileSync(`${dir}/${file}`, text)
  }
}
```

Run: `node <scratchpad>/dead-keys.mjs`. Đọc danh sách in ra. Danh sách phải có các nhóm `wbOvGreeting*`, `wbOvHeadline*`, `wbOvStat*`, `wbOvStatsLabel`, `wbOvRecentDocs`, `wbOvMyWork*`, `wbOvInbox*`, `wbOvQuiet*`, `wbOvGroupUpcoming`, `wbOvDueOn`, và **không** được có `wbOvDismiss`, `wbOvLoadFailed`, `wbOvSignedOut*`, `wbOvMeetings`, `wbOvJoin`. Nếu đúng như vậy thì chạy lại với `--write`.

- [ ] **Step 3: Remove dead CSS.** Liệt kê các class `.wb-ov-*` không còn trong file `.tsx` nào:

```bash
cd apps/shell/src/renderer/src && for c in $(grep -o '\.wb-ov-[a-z-]*' home.css | sort -u | tr -d .); do grep -rqw "$c" --include=*.tsx . || echo "$c"; done
```

Với từng class được in ra, xóa trong `home.css` mọi rule có selector chỉ gồm class đó, kể cả rule nằm trong `@media`. Danh sách dự kiến gồm `wb-ov-greeting`, `wb-ov-headline`, `wb-ov-strip`, `wb-ov-stat*`, `wb-ov-body`, `wb-ov-aside`, `wb-ov-recent*`, `wb-ov-head`. Lệnh trên chỉ quét class có dạng `wb-ov-…`, nên không bắt được rule `.wb-ov {`. Hãy kiểm tra riêng bằng `grep -rn '"wb-ov"' --include=*.tsx .`; nếu không có kết quả thì xóa luôn rule `.wb-ov`.

- [ ] **Step 4: Run the whole check set**

```bash
cd apps/shell && npx vitest run && cd ../.. && npm run typecheck -w @genoffice/shell && npm run check:theme-colors -- --base 7f99e562 && npm run check:english-comments && npx prettier --check $(git diff --name-only 7f99e562 -- '*.ts' '*.tsx' '*.css' '*.md')
```

Expected: tất cả PASS. Nếu prettier báo file nào thì chạy `npx prettier --write` trên đúng file đó rồi chạy lại.

- [ ] **Step 5: Commit**

```bash
git add -A apps/shell
git commit -m "refactor(shell): drop the Overview's headline, stats and recent strip leftovers"
```

---

### Task 13: Kiểm tra trên app thật

**Files:** không có. Ảnh chụp lưu vào scratchpad, không commit.

- [ ] **Step 1: Build và chạy.** Unset `ELECTRON_RUN_AS_NODE` trước khi chạy.

```bash
cd apps/shell && unset ELECTRON_RUN_AS_NODE && npm run build && npx electron .
```

- [ ] **Step 2: Đi qua checklist và ghi kết quả từng dòng** (đạt / không đạt + mô tả):
  1. Mở Bàn làm việc: tab đầu tiên tên **Mặt bàn**, bố cục 2 cột. Thu cửa sổ dưới 1000px thì thành 1 cột.
  2. **PDF → Word / Excel / PowerPoint** bằng nút bấm, mỗi loại 1 lần. Tệp tạo ra mở được và có toast "Đã tạo …". Lặp lại với một PDF có mật khẩu (nhập sai 1 lần rồi nhập đúng).
  3. **Xuất PDF** từ một `.docx`, một `.xlsx`, một `.pptx`, một `.md`, một `.html`. Ghi rõ loại nào lỗi nếu có (spec §5.1, rủi ro exporter chạy trong GUI).
  4. **Ghép PDF**: chọn 3 tệp. Thứ tự trang phải đúng thứ tự chọn. Thử lưu đè lên một tệp nguồn: phải hiện "Hãy chọn tên tệp khác tệp nguồn."
  5. **Tách PDF**: tách mỗi 2 trang, chạy 2 lần liên tiếp. Lần 2 phải ghi vào `…-parts 2`.
  6. **Thả tệp**: thả 1 PDF thì bảng hiện 4 dụng cụ. Thả 2 PDF thì hiện Ghép. Thả 1 ảnh thì hiện "Không có dụng cụ…". Thả tệp ở ngoài vùng Mặt bàn (sidebar) thì tệp vẫn mở như trước.
  7. Bấm PDF→Word trong menu tab PDF rồi bấm ngay Ghép PDF trên Mặt bàn: phải hiện "Một dụng cụ khác đang chạy."
  8. **Đang làm dở**: sửa một docx mà không lưu thì có dòng "Chưa lưu", bấm vào thì chuyển đúng tab. Đóng app bằng Force Quit khi đang có thay đổi, mở lại thì có dòng "Có bản khôi phục", bấm vào thì editor hỏi khôi phục.
  9. **Cần bạn xử lý** (đã đăng nhập, workspace thật): một bình luận tài liệu hiện ra, bấm vào thì tài liệu mở và dòng biến mất. Một tài liệu mới được chia sẻ cũng hiện ra.
  10. **Ngăn kéo**: chưa chọn gói nào thì vẫn soạn được vào gói mặc định. Bấm "Quản lý →" thì tab Biểu mẫu được ghim và mở ra.
  11. **Chưa đăng nhập / offline**: dụng cụ, Đang làm dở và Ngăn kéo vẫn chạy. Cột Hôm nay hiện ô đăng nhập hoặc offline, không chiếm toàn trang.
  12. Kiểm tra light/dark × vi/en: không có chữ tràn, tương phản đọc được.
- [ ] **Step 3: Chụp 4 ảnh** Mặt bàn (light/dark × vi/en) vào scratchpad để người dùng duyệt. Báo lại mọi dòng **không đạt** cùng nguyên nhân. Không tự ý mở rộng phạm vi để sửa.
