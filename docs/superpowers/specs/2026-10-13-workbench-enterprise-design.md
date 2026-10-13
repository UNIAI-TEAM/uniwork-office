# Bàn làm việc cho doanh nghiệp: cắt gọn và làm lại giao diện

- Ngày: 2026-10-13
- Trạng thái: chờ duyệt bản viết
- Phạm vi: spec 1/2. Spec 2 (tính năng công việc mở rộng) viết sau.
- Đường dẫn trong tài liệu tương đối theo repo `uniwork-office`. Đường dẫn ghi `uniwork:` là repo `/Users/ducquang/UNICOM/uniwork`.

## 1. Bối cảnh

UniWork Office (fork `uniwork-office`, đang phát installer) là ứng dụng desktop của nền tảng UniWork. Theo `uniwork:PRODUCT.md`, UniWork là "AI-native Work OS" thuần B2B.

Bàn làm việc (Workbench, nhãn `navTeacher`) hiện nay:
- Phục vụ lẫn lộn giáo viên, cá nhân và gia đình. Có 19 module, 7 trong số đó là module đời sống (tài chính, sức khỏe, phát triển bản thân, gia đình, bạn bè, thú cưng, du lịch).
- Có màn `TeacherHome` riêng và 15 vai trò.
- Giữ một bản tasks và lịch cục bộ trong SQLite, trùng với dữ liệu server UniWork. Điều này trái ADR 0016: server là nguồn sự thật duy nhất.

## 2. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Bỏ hẳn tính năng cá nhân và giáo dục khỏi sản phẩm. Không giữ edition phụ. |
| D2 | Người dùng mục tiêu là nhân viên doanh nghiệp dùng cá nhân. Chưa làm quản trị tổ chức (admin, vai trò, SSO). |
| D3 | Chưa có người dùng thật: không viết migration, xóa code và bỏ qua dữ liệu cũ. |
| D4 | Spec này gộp "cắt gọn" và "làm lại giao diện". Tính năng công việc mở rộng để spec sau. |
| D5 | Giữ 13 vai trò nghiệp vụ: legal, construction, procurement, sales, customer-care, entrepreneur, freelancer, marketing, real-estate, content-creator, it, hr, accounting. Bỏ teacher và principal. |
| D6 | Giữ module Hồ sơ (Personal). Bỏ Email giả lập, Trợ lý, Du lịch, Phát triển bản thân. |
| D7 | Bố cục Tổng quan chọn phương án A: giống web Home, thêm dải tài liệu gần đây. |
| D8 | Desktop chính thức là fork `uniwork-office`, không phải `uniwork:apps/office-desktop`. |
| D9 | Khi đã đăng nhập, dữ liệu công việc (việc, lịch, hồ sơ, Tổng quan) lấy từ server UniWork. |
| D10 | Bỏ Khách hàng, Hợp đồng, Vụ việc vì không có domain server. Giữ Biểu mẫu cục bộ. |

## 3. Mục tiêu và ngoài phạm vi

**Mục tiêu**
- Bàn làm việc là cửa sổ desktop của UniWork Home. Ngữ nghĩa (số đếm, trạng thái, hạn) giống web.
- Giao diện theo ngôn ngữ thiết kế UniWork: dày đặc, dễ quét, màu tint nhận diện module, màu signal báo trạng thái, không trang trí, không dữ liệu giả.
- Codebase không còn code giáo dục và code đời sống.

**Ngoài phạm vi đợt này**
- Tab Email: dựng hộp thư trên Email Hub. Trong lúc chờ, thông báo email vẫn hiện ở mục Thông báo của Tổng quan.
- Ô tìm kiếm trên server.
- Sửa task chi tiết, tạo họp, kết nối Google/MS. Các việc này mở sang web.
- Realtime qua WebSocket.
- Tên thương hiệu AI (UniAI hay UNI).
- Quản trị tổ chức.
- Tài liệu pitch và bảng giá.

## 4. Phạm vi gỡ bỏ

### 4.1 Giáo dục
- `apps/shell/src/renderer/src/TeacherHome.tsx` và nhánh định tuyến tới nó trong `Home.tsx`, khoảng dòng 3445–3485. Chỉ giữ nhánh `PracticeHome`.
- `packages/edu-core`:
  - Chuyển `hub.ts` (logic AI gateway dùng chung) về package đang dùng nó, sau đó mới xóa package.
  - Gỡ khỏi `package.json` của shell và practice-core, và khỏi danh sách `externalizeDepsPlugin`.
- Practice `teacher` và `principal` (`packages/practice-core/src/practices/teacher.ts` và registry).
- Playbook và template `teacher-lesson` (`my-ai-playbooks.ts`, `my-ai-templates.ts`).
- IPC:
  - `project:createEducation`, `getEduMeta`, `patchEduMeta` trong `apps/docs/src/main/docs-main.ts`.
  - `home:export-lesson-pack`, `home:probe-ai-hub` trong shell main.
  - `main/edu-commercial.ts`.
- Kiểu dữ liệu `kind: 'education'` ở 3 lớp: `practice-core/types.ts`, `project-store/types.ts`, `shared/home-api.ts`. Gỡ luôn nhánh đọc `edu/meta.json` trong `project-store/src/store.ts`.
- Mặc định và fallback `'education'` của skill domain ở 3 chỗ: `skill-domains.ts`, `skill-domain-pins.ts`, `SkillDomainTabs.tsx`. Mặc định mới lấy theo vai trò đang chọn.

### 4.2 Module
- **Xóa component, store và widget của các module:**
  - Đời sống: `personal-finance`, `health`, `self-growth`, `family`, `friends`, `pets`, `travel`.
  - Nghiệp vụ không có nguồn server: `clients`, `contracts`, `matters`.
  - Còn lại: `events`, `assistant`, `email`.
- **File bị xóa:**
  - `FinancePane.tsx`, `HealthPane.tsx`, `HealthMetricsViz.tsx`, `FamilyPane.tsx`, `FamilyTreeCanvas.tsx`, `family-tree-layout.ts`, `FriendsPane.tsx`, `PetsPane.tsx`, `EmailPane.tsx`.
  - Các pane tương ứng trong `WorkbenchModulePanes.tsx`.
  - `compressPetImage` cũng bị xóa nếu không còn nơi nào gọi.
- `WorkbenchModuleId` (`packages/practice-core/src/modules.ts`) chỉ còn: `desk`, `tasks`, `calendar`, `forms`, `notes`, `personal`. Sửa mọi nơi gọi theo lỗi build: `WorkbenchIcons`, dispatcher module, `agent-intent-apply.ts`, `context-manager.ts`, `practice-core/src/agent-intent.ts`.
- Agent intent: gỡ các đích `add_item` của module đã xóa.
- `DeskPane`: gỡ các lệnh đọc `readFinance`, `healthDeskCounts`, `readGrowth`, `readFamily`, dải thu/chi và widget đời sống. `DeskPane` được thay bằng Tổng quan mới (mục 6.3).
- `workbench-pins.ts`: gỡ store tasks, calendar, events cục bộ và store của các module đã xóa.
- `workbench-media-backup.ts`, `backup-addons.ts`: gỡ slot pets/health và các khóa `uniwork.teacher*`, `uniwork.teacherUiLang`.

### 4.3 Khác
- `license-entitlements.ts`: endpoint `/api/license/entitlements` không tồn tại, hàm fetch là stub. Gỡ file này cùng UI phụ thuộc vào nó.
- Ở hero: gỡ ô chọn ngôn ngữ, ghi chú giá, form Hub Token và các `window.confirm` về "Tốn Token".
- `tools/rebrand/README.md` và `MODIFICATIONS`: bỏ quy tắc "keep … teacher-edu work" và mô tả lại thay đổi. Nếu không sửa, lần đồng bộ upstream sau sẽ kéo code giáo dục quay lại.

## 5. Kiến trúc và luồng dữ liệu

### 5.1 Client công việc ở main process
File mới `apps/shell/src/main/uniwork-work/client.ts`. Viết theo pattern của `uniwork-docs/client.ts`:
- dùng chung session/token của `uniwork-auth`;
- `METADATA_TIMEOUT_MS`;
- token không bao giờ ra renderer.

| Hàm | Endpoint (`uniwork:server/internal/handler/router`, tiền tố `/api/v1`) |
|---|---|
| `homeSummary(ws)` | `GET /workspaces/{ws}/home` |
| `myTasks(ws)` | `GET /workspaces/{ws}/my-tasks` |
| `taskStatuses(ws)` | `GET /workspaces/{ws}/task-statuses` |
| `setTaskStatus(taskId, statusId)` | `PATCH /tasks/{taskID}` (`PatchTaskSDI`, chỉ gửi field trạng thái) |
| `createTask(ws, title, due?)` | `POST /workspaces/{ws}/tasks` (`CreateTaskSDI`, kèm header `Idempotency-Key` để thử lại an toàn) |
| `calendarEvents(ws, from, to)` | `GET /workspaces/{ws}/calendar/events?from&to&mine=true` |
| `person(org, userId)` | `GET /orgs/{org}/people/{userId}` |
| `recentDocuments(ws)` | `GET /workspaces/{ws}/documents/recent`. Dùng lại hàm sẵn có trong `uniwork-docs/client.ts` nếu được |

`listWorkspaces(org)` dùng lại từ `uniwork-docs/client.ts`.

Parse phòng thủ theo `uniwork:packages/core/api/endpoints/home.ts`: một section sai schema được thêm vào `partial[]`, không bị hiển thị thành danh sách rỗng.

### 5.2 IPC và lỗi có kiểu
- Mỗi hàm có một kênh `uniwork-work:*`. Preload expose `window.uniworkWork`, kiểu khai báo trong `apps/shell/src/shared/home-api.ts`.
- Kết quả có dạng `{ ok: true, data } | { ok: false, error: 'signed-out' | 'forbidden' | 'offline' | 'server' }`. Không throw chuỗi thô sang renderer.
- Đổi code main process và preload thì phải rebuild shell.

### 5.3 Workspace đang chọn
- `activeWorkspaceId` được lưu theo khóa (account, org).
- Bàn làm việc và `UniworkOpenDialog` cùng đọc giá trị này. Hiện `uniwork-docs-model.ts` giữ workspace riêng và không lưu lại.
- Đổi org thì chọn workspace đầu tiên của org mới.
- Tài khoản không có workspace nào thì hiện trạng thái rỗng, kèm liên kết tới onboarding trên web.

### 5.4 Bộ nhớ cục bộ
- Bucket `wb_kv` đổi từ `sha256(deploymentId + accountId)` sang `sha256(deploymentId + accountId + orgId)` (`main/workbench-accounts.ts`). Khi chưa đăng nhập vẫn dùng bucket `local`.
- Chỉ còn lưu cục bộ: ghi chú, biểu mẫu, tri thức và 4 trụ cột, ghim tab, vai trò đang chọn.

### 5.5 Làm mới dữ liệu
- Tải lại khi: mở tab, cửa sổ được focus lại, người dùng bấm "Làm mới", và mỗi 60 giây khi Tổng quan đang hiện.
- Cache trong renderer theo workspace. Cache cũng là dữ liệu hiển thị khi offline.

### 5.6 Vai trò nghiệp vụ
- Vai trò không còn là namespace dữ liệu.
- Vai trò chỉ quyết định kỹ năng, playbook, gợi ý UniAI và tab ghim mặc định.
- Mặc định là `entrepreneur`, lưu cục bộ.

## 6. Giao diện

### 6.1 Token
- `apps/shell` `--accent`: light `#0a52e6`, chữ trắng; dark `#5a96ff`, chữ `#0d1220`. Áp cho toàn bộ chrome của shell. Mark UniAI giữ gradient của nó.
- Thêm vào `packages/ui/src/tokens.css`, mỗi token đủ 3 khối (light, `[data-theme='dark']`, `prefers-color-scheme`):
  - `--tint-{gray,green,yellow,orange,violet,blue,teal,pink}` và `--tint-*-fg`;
  - `--info`, `--info-bg`.
  - Giá trị chép từ `uniwork:packages/ui/styles/tokens.css`, không chép selector.
- File mới `apps/shell/src/renderer/src/module-tones.ts`:

| Module | Tint |
|---|---|
| Tổng quan | gray |
| Việc | green |
| Lịch | yellow |
| Hồ sơ | pink |
| Biểu mẫu | teal |
| Tri thức | blue |
| Ghi chú | gray |

  Bảng này thay cho các màu badge hex thô trong `WorkbenchIcons.tsx`.
- Thang chữ: 11 (overline), 12 (caption), 13/14 (body), 18–20 (title). Radius 6, 8, 10, 12.
- Bỏ `wb-ms-breathe`, gradient hero và fade-up. Chuyển động 150–250 ms, chỉ để diễn tả thay đổi, có tôn trọng `prefers-reduced-motion`.

### 6.2 Khung
- **Thanh trên:**
  - Tiêu đề "Bàn làm việc".
  - Ô chọn "workspace · vai trò".
  - Nút "+ Tạo mới": menu dùng lại `NEW_ITEMS` (`Home.tsx`, khoảng dòng 2009) và thêm "Việc mới".
  - Nút Làm mới.
- **Thanh tab:**
  - Mỗi tab có ô icon 18 px tô màu tint. Tab đang chọn gạch chân bằng `--accent`.
  - Tab lõi luôn ghim: Tổng quan, Việc, Lịch.
  - Hồ sơ, Biểu mẫu, Ghi chú và 4 trụ cột ghim thêm qua nút "+".

### 6.3 Tổng quan
Bám `uniwork:packages/views/home/home-view.tsx`.
1. **Đầu trang:**
   - Dòng ngày ở cỡ overline.
   - Lời chào theo giờ, tính theo `timezone` của summary.
   - Một câu nêu điều cần nhìn trước, theo logic `buildHomeHeadline`. Nếu có họp đang diễn ra thì kèm nút "Vào", mở phòng họp trên web.
2. **5 ô số:** Đang mở, Quá hạn (danger), Đến hạn hôm nay (warning), Họp hôm nay, Chưa đọc.
   - Bấm vào ô thì nhảy tới danh sách liên quan.
   - Nguồn lỗi thì ô hiện "—" kèm Thử lại, không hiện 0.
3. **Tài liệu gần đây:** 4–6 thẻ có loại file, tên và thời điểm sửa.
   - Bấm để mở trong editor.
   - File cục bộ mang nhãn "trên máy".
   - Khi chưa đăng nhập, chỉ hiện file gần đây trên máy.
4. **Thân trang:**
   - Cột trái 2/3: "Việc của tôi". Mỗi dòng có checkbox xong, tiêu đề, dự án và pill hạn chót (quá hạn / hôm nay / ngày).
   - Cột phải 1/3: "Họp sắp tới" và "Thông báo".
5. **Không có gì cần làm:** hiện một dòng "Không có việc nào đang chờ" kèm lối tắt sang Soạn mới.

### 6.4 Việc
- Danh sách dày, chia nhóm: Quá hạn, Hôm nay, Tuần này, Sau đó, Không hạn.
- Cột: checkbox, tiêu đề, dự án, trạng thái (từ `task-statuses`), hạn.
- Ô "Thêm việc nhanh" ở đầu danh sách. Bấm vào tiêu đề để mở task trên web.

### 6.5 Lịch
- Agenda 14 ngày, nhóm theo ngày.
- Task có hạn và cuộc họp phân biệt bằng icon và tint.
- Bấm vào mục nào thì mở trên web.

### 6.6 Hồ sơ
- Thẻ chỉ đọc: tên, chức danh, phòng ban, quản lý, múi giờ.
- Dòng chú thích "UniAI dùng thông tin này khi soạn văn bản" và nút "Sửa trên web".
- Thay cho hồ sơ cục bộ của module `personal`. Code soạn văn bản đang đọc hồ sơ cục bộ thì chuyển sang đọc hồ sơ này.

### 6.7 Biểu mẫu, Ghi chú, 4 trụ cột
- Giữ chức năng hiện tại, áp token mới, có nhãn "trên máy này".
- Ghi chú bỏ kiểu giấy note màu, chuyển sang danh sách thẻ phẳng.

### 6.8 Câu chữ và i18n
- Chuỗi của Bàn làm việc (hiện viết qua `label(vi, en)`) chuyển sang `apps/shell/src/renderer/src/i18n/workbench/<lang>.ts`, với aggregator `strings-workbench.ts`:
  - `zh.ts` định nghĩa bộ key.
  - vi và en viết tay. Các locale khác khởi đầu bằng bản tiếng Anh.
  - Mỗi shard `satisfies Record<keyof typeof zh, string>`.
- Đổi key `navTeacher` thành `navWorkbench` và dịch đúng ở cả 21 locale.
- Tiếng Việt trang trọng: không viết tắt kiểu lớp học, không trộn tiếng Anh.
- Prompt kỹ năng viết cứng tiếng Việt (`skill-domains.ts`) giữ nguyên trong đợt này.

### 6.9 CSS
- Đổi tiền tố `teacher-*` thành `wb-*`. Đây là chrome dùng chung nên không được xóa.
- Xóa CSS của các module đã gỡ.
- Hex thô trong vùng Bàn làm việc (`home.css`, `DESK_CHART`, `SkillDomainTabs`, inline style trong TSX) chuyển hết sang token.

## 7. Trạng thái và lỗi

| Trạng thái | Hiển thị |
|---|---|
| Đang tải | Skeleton, tối đa khoảng 500 ms. Không dùng spinner |
| `partial[]` | Chỉ khối lỗi hiện "Không tải được · Thử lại" |
| `signed-out` | Một trạng thái rỗng cho cả nhóm tab server, kèm nút "Đăng nhập UniWork" |
| `forbidden` | Báo đã mất quyền với workspace, gợi ý chọn workspace khác |
| `offline` | Hiện cache kèm dòng "Cập nhật lúc HH:mm". Không có cache thì hiện trạng thái rỗng kèm Thử lại |
| Ghi thất bại | Hoàn tác thay đổi lạc quan trên UI và hiện toast có nút Thử lại |

## 8. Kiểm thử
- **Client `uniwork-work`** (vitest, fetch giả):
  - từng endpoint;
  - dữ liệu sai schema thì báo `partial`;
  - map 401/403/timeout/5xx sang lỗi có kiểu;
  - kết quả không chứa token.
- **Hàm thuần:**
  - nhóm task theo hạn;
  - câu tóm tắt đầu trang;
  - chọn workspace khi đổi org;
  - khóa bucket theo account + org.
- **Component:**
  - Tổng quan với các trạng thái: đầy đủ, `partial`, rỗng, `signed-out`, `offline`;
  - checkbox của tab Việc, cả khi thành công lẫn khi phải hoàn tác.
- **Test hiện có:**
  - `practice-core.test.ts`: chuyển sang danh sách module mới.
  - Các test dùng `'teacher'` làm mẫu: đổi sang `'entrepreneur'`. Gồm `agent-intent.test.ts`, `workbench-account-gate`, `workbench-db`, `my-ai-history`, `my-ai-playbooks-consent` và `project-store/tests/store.test.ts`.
  - Xóa test của module đã gỡ.
- **CI:**
  - `tools/check-theme-colors.mjs` phải pass.
  - Dò thủ công hex thô trong TSX của vùng Bàn làm việc.
- **E2E (Playwright):** đăng nhập server dev, kiểm Tổng quan hiện 5 ô số và mở được một tài liệu gần đây.

## 9. Rủi ro và bước đầu tiên
1. Chưa xác minh token desktop được chấp nhận ở `/home` và `/my-tasks`. Kế hoạch mở đầu bằng một spike gọi thử với server dev. Nếu bị từ chối, dừng lại và xử lý phía server trước.
   - Kết quả spike (2026-10-13, kiểm tĩnh trên `40dd0e2fd`): các route /home, /my-tasks, /task-statuses, /calendar/events, /people/{id}, PATCH /tasks/{id}, POST /workspaces/{ws}/tasks cùng nhóm RequireAuthWithDevice với /workspaces và /documents (router.go, nhóm `authed`); không route nào thêm middleware riêng, và /auth/desktop/exchange cấp token bằng cùng `TokenMinter.MintSession` (Web=false, đi qua kiểm tra thiết bị). Chưa probe trực tiếp (không có server dev); người dùng cần chạy probe trước khi phát hành. Kết luận: tiếp tục.
2. Gỡ `edu-core` khi chưa chuyển `hub.ts` sẽ làm vỡ AI gateway. Phải chuyển trước, xóa sau.
3. Đổi accent ảnh hưởng toàn bộ chrome của shell. Cần rà ảnh chụp các màn chính ở cả light và dark.
4. Bộ quy tắc rebrand và sync upstream phải được cập nhật cùng đợt (mục 4.3).
