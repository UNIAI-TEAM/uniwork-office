# Bàn làm việc thành bàn giấy tờ văn phòng (hướng A + dụng cụ)

- Ngày: 2026-10-14
- Trạng thái: chờ duyệt bản viết
- Tiếp nối:
  - `docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md` (tính năng, dữ liệu)
  - `docs/superpowers/specs/2026-10-13-workbench-redesign-design.md` (ngôn ngữ hình ảnh: `.wb-btn`, `WorkStatePanel`, token `--wb-*`)
- Đường dẫn tương đối theo repo `uniwork-office`. Mặc định file nằm trong `apps/shell/src/renderer/src/`. `main/` là `apps/shell/src/main/`, `shared/` là `apps/shell/src/shared/`. `uniwork:` là repo `/Users/ducquang/UNICOM/uniwork`.

## 1. Vấn đề và mục tiêu

Tab Tổng quan hiện là bản sao màn Home của web, chỉ hiển thị dữ liệu server: lời chào, dải 5 số liệu, dải tài liệu gần đây, việc, họp và thông báo. Nó là một dashboard công việc, không phải bàn làm việc của một bộ office. Tài liệu, thế mạnh của bản desktop, chỉ chiếm một dải phụ.

Giấy tờ văn phòng chạy theo vòng **nhận → xử lý → soạn → gửi đi**. Bàn mới bày theo đúng vòng đó:

- **Khay cần xử lý:** những gì đang chờ mình.
- **Xấp tài liệu đang làm dở.**
- **Ngăn kéo biểu mẫu.**
- **Dụng cụ** (chuyển đổi, ghép, tách, xuất PDF).
- **Lịch để bàn:** đứng bên cạnh, không còn là trung tâm.

Màn Gần đây ở sidebar là lịch sử mọi tệp. Bàn chỉ giữ những gì **đang cần làm**.

| #   | Quyết định                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Thay quyết định D7 của spec enterprise ("Tổng quan giống web Home"). Tab `desk` trở thành mặt bàn tài liệu.                                                                                         |
| Q2  | Làm dụng cụ ngay đợt này: PDF→Word/Excel/PowerPoint, Xuất PDF, Ghép PDF, Tách PDF. Hai lối vào: bấm nút và thả tệp.                                                                                 |
| Q3  | Bàn chạy được khi chưa đăng nhập và khi offline. Chỉ phần dữ liệu server (thông báo, chia sẻ, Hôm nay) cần đăng nhập.                                                                               |
| Q4  | Ký, đóng dấu, OCR riêng lẻ và nén PDF không làm đợt này. Ký, đóng dấu và OCR cần màn tương tác của app PDF; nén chưa có engine.                                                                     |
| Q5  | Giữ nguyên thanh trên, tab Công việc, Lịch, Hồ sơ, Ghi chú, 4 trụ cột, sidebar, màn Gần đây và Settings. Ngôn ngữ hình ảnh theo spec redesign 13/10.                                                |
| Q6  | Logic dụng cụ ở main-process dùng lại hàm có sẵn, không chép code. Lõi "PDF → Office" đang nằm trong 3 hàm gắn tab PDF được tách thành một hàm nhận `pdfPath`. Menu tab PDF và Bàn cùng gọi hàm đó. |

Các quy tắc bắt buộc của `CLAUDE.md` vẫn áp dụng:

- Chỉ dùng token, không viết màu thô.
- Token mới phải có đủ 3 khối.
- Chuỗi đi qua shard `i18n/workbench/<lang>.ts`.
- Không đưa `t` vào mảng phụ thuộc.
- Code main-process của app được build vào shell.
- Package workspace mới phải thêm vào `externalizeDepsPlugin.exclude`.

## 2. Khung

### 2.1 Tab

- Module `desk` (`packages/practice-core/src/modules.ts`) đổi nhãn: vi `Tổng quan` → `Mặt bàn`, en `Overview` → `Desk`.
  - Gợi ý đổi thành vi "Tài liệu cần xử lý, đang làm dở và dụng cụ", en "Documents to handle, work in progress and tools".
  - `id` giữ nguyên `desk` nên ghim, cache và test không phải đổi khóa.
- Tab Biểu mẫu giữ nguyên để thêm và sửa mẫu. Ngăn kéo trên bàn chỉ là lối tắt.

### 2.2 Bố cục mặt bàn (`DeskView`, thay `WorkOverview`)

```
┌──────────────────────────────────────────┬────────────────┐
│ Dụng cụ + vùng thả                        │ T4, 14/10      │
│ CẦN BẠN XỬ LÝ (n)                         │ HÔM NAY        │
│ ĐANG LÀM DỞ                               │  việc · họp    │
│ NGĂN KÉO · biểu mẫu            Quản lý → │  + thông báo   │
└──────────────────────────────────────────┴────────────────┘
```

- **Lưới:** `grid-template-columns: minmax(0, 1fr) 300px`, khoảng cách 24px. Dưới 1000px chuyển thành một cột, cột Hôm nay xuống cuối.
- **Mỗi vùng là một khối** theo spec 13/10 §2.4. Tiêu đề mục 13/600 viết hoa nhỏ, có số đếm `.wb-num`.
- **Bỏ:** dải 5 số liệu, câu headline dài và lời chào cỡ 22. Tên tab đã đủ ngữ cảnh. Cột phải chỉ còn dòng ngày (overline).
- **Mỗi vùng tải độc lập:** một vùng lỗi chỉ hiện `WorkStatePanel` nhỏ có nút Thử lại trong khối của nó. Thay cho trạng thái lỗi toàn trang của `WorkOverview` hiện nay.
- **Component mới, mỗi cái một file:** `DeskView.tsx` (khung + lưới), `DeskTools.tsx`, `DeskInTray.tsx`, `DeskInProgress.tsx`, `DeskDrawer.tsx`, `DeskToday.tsx`. Logic thuần đặt trong `desk-model.ts`.
- **Code cũ:** phần còn dùng được của `WorkOverview.tsx` chuyển vào `DeskToday`: nhóm việc, đánh dấu xong, toast hoàn tác, họp và nút Vào họp. File `WorkOverview.tsx` bị xóa.

## 3. Các vùng

### 3.1 Cần bạn xử lý (`DeskInTray`)

Mỗi dòng gồm: icon lý do, tên tài liệu, lý do (caption), thời gian mono và hành động chính `.wb-row-act`. Thứ tự: sự cố đồng bộ, rồi bình luận/nhắc tên, rồi tài liệu được chia sẻ. Trong mỗi nhóm, mới nhất lên trước. Tối đa 8 dòng; nếu nhiều hơn thì có dòng "Xem thêm `n`" để mở rộng tại chỗ.

| Lý do                   | Nguồn                                                                                                                                                                                                                                               | Hành động                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bình luận / nhắc tên    | `WorkHomeSummary.inbox`, chỉ lấy kind `document_commented` / `document_mentioned` chưa có `read_at`. `resource_id` là id tài liệu, `params.document` là tên, `params.actor` là người gửi (`uniwork:server/internal/notification/rules.go:409-420`). | **Mở**: gọi `openUniworkDocument({ documentId: resource_id, title: params.document })` (`uniwork-open.ts`), rồi `markNotificationsRead([id])` (§5.3). Nếu đánh dấu đã đọc thất bại thì không báo lỗi; lần tải sau dòng sẽ hiện lại. |
| Được chia sẻ            | `aiOffice.uniworkListSharedWithMe({ limit: 20 })`, lấy `updatedAt` trong 7 ngày và `id` chưa có trong recents (so với `RecentEntry.uniwork.documentId`).                                                                                            | **Mở**: gọi `openUniworkDocument`. Sau khi mở, tài liệu vào recents nên tự rời khay.                                                                                                                                                |
| Chưa đồng bộ / xung đột | Các recents có trường `uniwork` (tối đa 20 dòng đầu), gọi `aiOffice.uniworkDocStatus(path)` cho từng dòng. Lấy `state` ∈ `conflict`, `failed`, `paused_*`. Nghe `onUniworkDocStatus` để cập nhật.                                                   | **Mở**: mở bản làm việc. Hộp xử lý xung đột hoặc lỗi đã có trong editor.                                                                                                                                                            |

- **Hàm thuần trong `desk-model.ts`:**
  - `docNotifications(inbox)`
  - `freshShared(shared, recents, now)`
  - `syncProblems(statuses)`
  - `inTrayRows(...)`: gộp, sắp thứ tự, cắt 8.
- **Sửa `inboxTarget`** (`work-home.ts:278`) để thông báo tài liệu mở tài liệu thay vì rơi về trang inbox web. Như vậy chỗ khác dùng `inboxTarget` cũng được lợi.
- **Chưa đăng nhập:** hai nguồn server không chạy. Khay chỉ còn sự cố đồng bộ, trường hợp này thường rỗng. Khi đó hiện một dòng mời đăng nhập, dùng chuỗi `wbOvSignedOutTitle` có sẵn.
- **Rỗng:** `WorkStatePanel` tone gray, tiêu đề "Không có gì đang chờ bạn".

### 3.2 Đang làm dở (`DeskInProgress`)

Gồm hai phần nối tiếp, tối đa 10 dòng:

1. **Bản nháp** từ IPC mới `aiOffice.listDrafts()` (§5.2):
   - `unsaved`: tab đang mở có thay đổi chưa lưu. Chip "Chưa lưu", hành động **Chuyển tới**: gọi `aiOfficeTabs.activate(tabId)`, hoặc focus cửa sổ tách rời.
   - `recovery`: có bản tự lưu mới hơn tệp gốc nhưng tệp không đang mở. Chip "Có bản khôi phục", hành động **Mở**: gọi `openPath`. Hộp hỏi khôi phục sẵn có của editor sẽ xử lý tiếp.
2. **Sửa gần đây** từ `useRecentDocuments` / `mergeRecentDocuments` có sẵn (`work-home.ts:258, 322`):
   - Đã khử trùng lặp local/cloud và loại các tệp đã nằm ở phần 1.
   - Mỗi dòng có `FileBadge`, tên, thời gian tương đối mono và chip đồng bộ nếu là bản cloud (`Đã đồng bộ` / `Đang lưu` / `Offline`), lấy từ cùng các trạng thái ở §3.1.

- **Hành động phụ** (`.wb-row-act`, hiện khi rê chuột): Mở, Hiện trong thư mục (IPC `revealPath` có sẵn, `main/index.ts:4642`). Chỉ áp cho tệp local.
- **Rỗng:** "Chưa có tài liệu đang làm" kèm hai hành động: "+ Tạo mới" (mở menu `NEW_ITEMS` có sẵn) và "Mở tệp…".

### 3.3 Ngăn kéo (`DeskDrawer`)

- **Nguồn:** `readForms()` (`workbench-pins.ts:264`), lấy tối đa 8 mục theo thứ tự đã lưu. Hiển thị dạng chip có icon loại tệp mẫu.
- **Bấm chip:** chạy đúng hành động "Soạn" của `FormsPane` (`WorkbenchModulePanes.tsx:~220-247`). Hàm đó được tách ra `form-draft.ts` để Bàn và tab Biểu mẫu dùng chung.
  - Gói đích là gói đang chọn (`selectedId`). Không có gói đang chọn thì dùng gói mặc định (`ProjectSummaryEntry.isDefault`), nên không bao giờ bị khóa.
- **"Quản lý →":** gọi `pinModule(practiceId, 'forms')` rồi chọn tab `forms`.
- **Rỗng:** một dòng "Lưu mẫu giấy tờ hay dùng để soạn nhanh" kèm hành động "Thêm biểu mẫu", mở tab Biểu mẫu.

### 3.4 Hôm nay (`DeskToday`, cột phải)

- **Dòng ngày:** overline, dùng `formatDay` có sẵn.
- **Việc:** nhóm Quá hạn và Hôm nay từ `groupTasksByDue`, tối đa 6 dòng. Checkbox đánh dấu xong cùng toast hoàn tác `wbOvTaskUpdateFailed` giữ nguyên logic của `WorkOverview`. Có link "Tất cả việc →" mở tab Công việc.
- **Họp hôm nay:** giờ mono, tên cuộc họp, chip "Vào họp" khi đang diễn ra (logic có sẵn).
- **Thông báo khác:** các thông báo chưa đọc không thuộc tài liệu được gom thành một dòng "Thông báo khác (`n`) →". Bấm vào đi theo `inboxTarget` (web inbox).
- **Chưa đăng nhập, offline, mất quyền, chưa có workspace:** dùng `WorkErrorState` / `WorkNoWorkspace` có sẵn nhưng thu nhỏ trong khối cột phải, không chiếm toàn trang.

## 4. Dụng cụ và vùng thả (`DeskTools`)

### 4.1 Dụng cụ

| id            | Nhãn (vi)        | Đầu vào                                 | Đầu ra                               | Hàm main dùng lại                                                                                          |
| ------------- | ---------------- | --------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pdf-to-docx` | PDF → Word       | 1 `.pdf`                                | `.docx`                              | `convertPdfFileToDocxLocalWithPrompt` (`main/pdf2docx-local.ts:130`)                                       |
| `pdf-to-xlsx` | PDF → Excel      | 1 `.pdf`                                | `.xlsx`                              | `convertPdfFileToXlsxLocalWithPrompt` (`main/pdf2xlsx-local.ts:36`)                                        |
| `pdf-to-pptx` | PDF → PowerPoint | 1 `.pdf`                                | `.pptx`                              | `convertPdfFileToPptxLocalWithPrompt` (`main/pdf2pptx-local.ts:36`)                                        |
| `export-pdf`  | Xuất PDF         | 1 `.docx` `.xlsx` `.pptx` `.md` `.html` | `.pdf`                               | `headlessExporters[module]` (`main/index.ts:6315`) qua `runHeadlessExport` (`main/headless-export.ts:121`) |
| `merge-pdf`   | Ghép PDF         | ≥ 2 `.pdf`, theo thứ tự chọn hoặc thả   | 1 `.pdf`                             | `mergePdfBytes` (`apps/pdf/src/main/save-pdf.ts:859`)                                                      |
| `split-pdf`   | Tách PDF         | 1 `.pdf` + "mỗi `N` trang" (mặc định 1) | thư mục `<tên>-parts/` chứa các phần | `splitPdfBytes` (`apps/pdf/src/main/save-pdf.ts:576`)                                                      |

- **Thanh dụng cụ:** một hàng `.wb-btn-secondary .wb-btn-sm`, mỗi nút có icon và nhãn. Hàng tự xuống dòng khi hẹp.
- **Bấm một dụng cụ:**
  1. Hộp chọn tệp hệ thống, lọc đúng đuôi. Ghép PDF cho chọn nhiều.
  2. Riêng Tách PDF: popover nhỏ có ô số `N` (1–999).
  3. Hộp lưu dùng `showSaveDialogWithMemory`, tên mặc định là tên gốc đổi đuôi. Tách PDF dùng hộp chọn thư mục.
  4. Chạy.
- **Đang chạy:**
  - Nút của dụng cụ hiện spinner, có `aria-busy`.
  - Các nút khác bị khóa, vì mỗi lúc chỉ chạy một dụng cụ.
  - `setProgressBar` trên cửa sổ như các bản export hiện có.
- **Xong:** toast "Đã tạo `tên`" kèm hai hành động [Mở] [Hiện trong thư mục]. Tách PDF thì báo "Đã tạo `n` tệp trong `thư mục`". Tệp đầu ra được đẩy vào recents (`recordRecentFile`, `apps/docs/src/main/docs-main.ts:3168`), nên hiện ngay ở Đang làm dở.
- **Lỗi:** toast lỗi ngắn theo mã (§5.1). Huỷ ở bất kỳ hộp thoại nào thì im lặng.

### 4.2 Vùng thả

- **Vùng nhận thả** là toàn bộ mặt bàn (`DeskView`). Khi kéo tệp vào thì hiện lớp phủ viền `var(--accent)`, nền `var(--accent-soft)`, liệt kê các dụng cụ hợp với nhóm tệp đang kéo, cùng nút "Mở".
- **Đường dẫn tệp** lấy bằng `getPathForFile` đã có trong preload (`preload/index.ts:818`).
- **Hàm thuần** `applicableTools(paths): DeskToolId[]` trong `desk-model.ts`:
  - 1 PDF → 3 chuyển đổi + Tách.
  - ≥ 2 PDF (chỉ PDF) → Ghép.
  - 1 tệp Office/MD/HTML → Xuất PDF.
  - Còn lại → rỗng, kèm câu "Không có dụng cụ cho loại tệp này".
- **Thả lên một dụng cụ** thì chạy dụng cụ đó với các tệp đã thả, bỏ qua bước chọn tệp. Thả ra ngoài lớp phủ thì huỷ.
- **Thả thư mục** thì bỏ qua thư mục.

### 4.3 Trường hợp biên

- **PDF có mật khẩu:** hỏi mật khẩu bằng `promptPdfPassword` có sẵn, lặp khi nhập sai. Huỷ thì im lặng.
- **Tệp đích đang mở trong tab:** đóng tab đó trước qua guard chưa lưu thông thường, giống `exportPdfAsDocxLocal` hiện nay. Nếu tab vẫn còn, tức người dùng giữ lại, thì dừng và không ghi đè.
- **Tệp đích trùng tệp nguồn:** từ chối, dùng lại kiểm tra của `validateHeadlessPaths`.
- **Xuất PDF từ tệp đang mở và chưa lưu:** xuất từ bản đã lưu trên đĩa. Lớp phủ và tooltip nút ghi "Xuất từ bản đã lưu" khi `listDrafts` báo tệp đó là `unsaved`.
- **Tệp nguồn biến mất giữa chừng:** lỗi `not-found`.

## 5. IPC và main-process

### 5.1 `aiOffice.runDeskTool(req)`

```ts
// shared/home-api.ts
type DeskToolId =
  'pdf-to-docx' | 'pdf-to-xlsx' | 'pdf-to-pptx' | 'export-pdf' | 'merge-pdf' | 'split-pdf'
interface DeskToolRequest {
  tool: DeskToolId
  inputs?: string[]
  splitEvery?: number
}
type DeskToolResult =
  | { ok: true; outputs: string[] }
  | { ok: false; canceled: true }
  | {
      ok: false
      error: 'busy' | 'bad-input' | 'not-found' | 'same-path' | 'target-open' | 'failed'
    }
```

- **Handler đặt trong file mới `main/desk-tools.ts`.** File này xuất `runDeskTool(req, deps)` với `deps` gồm `dialog`, `host`, `tabManager`, các converter và `exporters`, để test được bằng fake. `main/index.ts` chỉ đăng ký IPC.
- **Kiểm tra ở biên tin cậy:**
  - `tool` thuộc danh sách.
  - Mỗi `input` là đường dẫn tuyệt đối, tồn tại, là tệp và có đuôi hợp lệ.
  - Số lượng đúng theo bảng §4.1.
  - `splitEvery` là số nguyên 1–999.
  - Không có `inputs` thì main mở hộp chọn tệp.
- **Khoá bận dùng chung:** khi đang chạy thì trả `busy`. Khoá này dùng chung với các cờ `exportingPdfDocx` / `…Pptx` / `…Xlsx` hiện có, để menu tab PDF và Bàn không chạy chồng nhau.
- **Tách lõi chuyển đổi PDF → Office:** lõi của `exportPdfAsDocxLocal` / `…Pptx` / `…Xlsx` (`main/index.ts:5752, 5892, 6003`) được tách thành `convertPdfToOffice(kind, pdfPath, host)`, gồm hộp lưu, đóng tab đích, mật khẩu, progress và ghi tệp. Ba hàm cũ chỉ còn lấy `tab.filePath` sau khi flush, rồi gọi hàm chung.
- **Xuất PDF trong tiến trình GUI:** `headlessExporters` hiện chỉ chạy từ CLI `--headless-export`. Implementer phải xác nhận các cửa sổ ẩn chạy được song song với GUI đang mở (preload, session, single-instance). Nếu một exporter không chạy được trong GUI thì dụng cụ đó trả `failed` cho loại tệp ấy, ghi rõ trong PR, và không chặn các dụng cụ khác.
- **Ghép và tách PDF:** import `mergePdfBytes` / `splitPdfBytes` từ main của app PDF, vốn đã build vào shell. Nếu import chéo app vi phạm ranh giới hiện có thì chuyển hai hàm thuần này vào package dùng chung và để app PDF import lại. Không chép code.

### 5.2 `aiOffice.listDrafts()`

```ts
interface DeskDraft {
  kind: 'unsaved' | 'recovery'
  title: string
  app: DocumentTabKind
  filePath?: string // absent for an untitled unsaved tab
  tabId?: string // set for 'unsaved'
  modifiedMs?: number // autosave mtime for 'recovery'
}
```

- **`unsaved`:** gộp `tabManager.openDocuments()` (`main/tab-manager.ts:438`) với `detachedOpenDocuments()` (`main/detached-windows.ts:313`), lấy `dirty === true`.
- **`recovery`:** với mỗi đường dẫn trong recents, hỏi từng editor "có bản tự lưu mới hơn tệp không" bằng hàm của chính editor đó:
  - Docs: `docs-autosave/`
  - Sheets: `sheets-autosave/` và `unsaved-new.json`
  - Slides: `slides-autosave/`, tên là sha1 16 ký tự

  Mỗi app xuất một hàm `hasRecoveryCopy(path): number | null` cạnh code autosave của nó. Main không tự tính lại tên băm. Tệp đang mở thì không tính.

- **Hiệu năng:** gọi khi Bàn mount và khi nhận sự kiện tab đổi. Chỉ dùng `stat` (≤ 100 recents × 3 editor), không đọc nội dung.

### 5.3 `uniworkWork.markNotificationsRead(workspaceId, ids)`

- **Server đã có handler:** `uniwork:server/internal/handler/notification.go:63`, nhận body `{ ids }`, route `MarkNotificationsRead` ở `router.go:383`. Implementer lấy đường dẫn HTTP từ spec OpenAPI hoặc router của server.
- **Phía desktop:**
  - Thêm vào `main/uniwork-work/client.ts` và `shared/uniwork-work-api.ts`, rồi expose qua preload `uniworkWork`.
  - Trả `UniworkResult<void>` theo mẫu các lệnh ghi hiện có.
  - Sau khi thành công, bỏ id khỏi summary trong cache (`work-cache`) để tab đếm và khay cập nhật ngay.

## 6. Chuỗi, token, theme

- **Khóa mới** trong `i18n/workbench/zh.ts` và đủ 20 shard còn lại, tiền tố `wbDesk*`: tiêu đề các vùng, lý do khay, chip trạng thái, nhãn và trạng thái dụng cụ, toast, lớp phủ thả, câu rỗng.
- **Khóa `wbOv*`:** khóa không còn dùng sau khi xóa `WorkOverview` thì xóa khỏi mọi shard. Khóa còn dùng thì giữ nguyên tên.
- **Màu:** không thêm token nếu không cần. Lớp phủ thả dùng `--accent` / `--accent-soft` của app. Chip trạng thái dùng signal token đã có. Nếu buộc phải thêm token thì thêm đủ 3 khối trong `packages/ui/src/tokens.css`.
- **CSS:** đặt trong `home.css` dưới scope `.wb-home .wb-desk`. Không còn rule nào dùng thì xóa rule `.wb-ov*` tương ứng.

## 7. Kiểm thử

- **Test thuần mới** (`tests/desk-model.test.ts`):
  - `applicableTools` cho mọi tổ hợp đuôi tệp.
  - `docNotifications` lọc kind và `read_at`.
  - `freshShared`: biên 7 ngày, loại tệp đã có trong recents.
  - `syncProblems`.
  - `inTrayRows`: thứ tự và giới hạn 8.
- **Test main mới** (`tests/desk-tools.test.ts`), dùng fake `deps`:
  - Kiểm tra đầu vào (đuôi tệp, số lượng, `splitEvery`, đường dẫn tương đối).
  - `busy`.
  - Huỷ hộp lưu trả `canceled`.
  - `same-path`.
  - Đích đang mở mà người dùng giữ tab trả `target-open`.
  - Ghép đúng thứ tự.
  - Tách ra đúng số tệp.
- **Test `listDrafts`:** gộp tab dirty của cửa sổ chính và cửa sổ tách rời, bỏ tệp đang mở khỏi `recovery`.
- **Test client `markNotificationsRead`** (`uniwork-work-client.test.ts`): đúng route, đúng body, map lỗi.
- **Test component:**
  - `work-overview.test.ts` được thay bằng `desk-view.test.ts`. Hành vi còn giữ (đánh dấu xong, hoàn tác, Vào họp) chuyển sang test `DeskToday`.
  - Các test `workbench-tabs*` được sửa nhãn `Mặt bàn` / `Desk`.
  - `strings-workbench.test.ts` vẫn xanh.
- **Kiểm tra tự động:** `npm run typecheck`, suite shell, `npm run check:theme-colors -- --base <commit đầu đợt>`, `npm run check:english-comments`, `prettier --check` trên các file đã sửa.
- **Chạy app thật:** rebuild shell, vì có code main.
  - Chạy cả 6 dụng cụ bằng bấm nút và bằng thả tệp.
  - PDF có mật khẩu.
  - Tệp đích đang mở.
  - Xuất PDF từ tệp đang mở và chưa lưu.
  - Bàn khi chưa đăng nhập và khi offline.
  - Chụp light/dark × vi/en để người dùng duyệt.

## 8. Ngoài phạm vi

- Ký, đóng dấu, OCR riêng lẻ, nén PDF, quét tài liệu.
- Gắn tài liệu vào việc. Server có route attachment nhưng để spec sau.
- Gắn sao hoặc ghim tài liệu cloud. Danh sách "tài liệu tôi đã mở" phía server.
- Thumbnail xem trước tài liệu.
- Theo dõi thư mục Tải về và tệp đính kèm email.
- Khay "đã gửi đi".
- Đưa Ghi chú lên mặt bàn.
- Đổi sidebar, màn Gần đây, thanh trên và các tab khác.
