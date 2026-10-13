# Thiết kế lại giao diện Bàn làm việc (hướng B: trung tâm điều phối tinh gọn)

- Ngày: 2026-10-13
- Trạng thái: chờ duyệt bản viết
- Tiếp nối: `docs/superpowers/specs/2026-10-13-workbench-enterprise-design.md` (tính năng, dữ liệu và token đã xong)
- Đường dẫn tương đối theo repo `uniwork-office`. Mặc định file nằm trong `apps/shell/src/renderer/src/`.

## 1. Mục tiêu và ràng buộc

Mục tiêu là nâng giao diện Bàn làm việc lên mức của các sản phẩm hàng đầu như Linear, Things, Superhuman. Mức đó đạt bằng độ tinh của typography, nhịp khoảng cách, trạng thái tương tác và trạng thái rỗng/lỗi, không bằng hiệu ứng trang trí.

| #   | Quyết định                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Nâng cấp trong khuôn khổ ngôn ngữ UniWork: font Inter, tint để nhận diện, signal để báo trạng thái. Không gradient trang trí, không glassmorphism, không texture.                                                                  |
| R2  | Phạm vi chỉ là Bàn làm việc: thanh trên, thanh tab, Tổng quan, Công việc, Lịch, Hồ sơ, Biểu mẫu, Ghi chú, 4 trụ cột, cùng các trạng thái tải, rỗng, lỗi, offline và chưa đăng nhập. Sidebar, màn Tệp, Settings và My AI không đổi. |
| R3  | Chọn hướng B: breadcrumb trên thanh trên, số đếm trên tab, dải số liệu liền, danh sách chia nhóm có hover, các tab phẳng một dòng tiêu đề.                                                                                         |
| R4  | Màu brand cho nút chính chỉ áp trong `.wb-home`. Quy tắc `.btn-primary` dùng chung (`--color-btn-primary`) không đổi.                                                                                                              |
| R5  | Không gợi ý phím tắt trên "+ Tạo mới", vì `CmdOrCtrl+N` đã dùng cho tài liệu mới (`main/index.ts:5287`).                                                                                                                           |
| R6  | Chỉ làm lại phần trình bày. Hook dữ liệu, cache, IPC, thứ tự gọi API và logic hiện có giữ nguyên. Chỗ nào cần nhóm hay đếm thì dùng lại hàm có sẵn (`groupTasksByDue`, `closedStatusKeys`, `formatDay`, `clock`…).                 |

Các quy tắc bắt buộc của `CLAUDE.md` vẫn áp dụng:

- Không viết màu thô trong CSS renderer hay style inline của chrome.
- Token mới phải có đủ 3 khối (light, `[data-theme='dark']`, system-dark).
- Chuỗi đi qua shard `i18n/workbench/<lang>.ts`.
- Không đưa `t` vào mảng phụ thuộc của hook.

## 2. Nền tảng (scope `.wb-home`)

### 2.1 Token mới (`packages/ui/src/tokens.css`, đủ 3 khối)

| Token               | Light                                                        | Dark      | Dùng cho                         |
| ------------------- | ------------------------------------------------------------ | --------- | -------------------------------- |
| `--wb-shadow`       | `0 1px 2px rgb(16 24 40 / 5%), 0 1px 3px rgb(16 24 40 / 4%)` | `none`    | khối danh sách, dải số liệu, thẻ |
| `--wb-row-hover`    | `#f7f8fa`                                                    | `#22252a` | nền khi rê chuột lên dòng        |
| `--wb-check-border` | `#c4c8ce`                                                    | `#5b6068` | viền checkbox tự vẽ              |

Giá trị dark lấy cùng họ với `--surface-subtle` và `--border-strong` của khối dark hiện có. Khi viết, implementer đối chiếu với token đang có và chỉnh để tương phản viền trên nền đạt ít nhất 3:1.

### 2.2 Nút (`.wb-btn`)

- **Biến thể:**
  - `.wb-btn-primary`: nền `var(--accent)`, chữ `var(--on-accent)`.
  - `.wb-btn-secondary`: nền `var(--surface)`, viền `var(--border)`.
  - `.wb-btn-ghost`: không nền, không viền.
  - `.wb-btn-icon`: 32×32.
- **Cỡ và hình dạng:** cao 32px; bản `.wb-btn-sm` cao 28px. Bo `var(--radius-8)`, chữ 13px weight 500.
- **Hover:** chuyển màu `background-color, border-color, color` trong 150ms. Nút chính đổi sang `var(--accent-hover)`, nút phụ đổi nền sang `var(--hover)`.
- **Nhấn:** `transform: scale(0.98)`.
- **Focus:** `outline: 2px solid var(--accent); outline-offset: 2px`.
- **Disabled:** `opacity: .5`, `cursor: not-allowed`, không có hiệu ứng nhấn.
- **Giảm chuyển động:** dưới `prefers-reduced-motion: reduce` thì không còn transition hay transform.
- Bỏ mọi kiểu pill, bỏ bóng đen trên nút trong Bàn làm việc.

### 2.3 Chữ

| Vai trò             | Cỡ / weight / letter-spacing         |
| ------------------- | ------------------------------------ |
| Ngày (overline)     | 11.5 / 500, màu `--text-tertiary`    |
| Lời chào            | 22 / 600 / −0.02em                   |
| Tiêu đề tab         | 16 / 600 / −0.01em                   |
| Tiêu đề mục         | 13 / 600                             |
| Body                | 13 / 400                             |
| Caption, meta       | 12 / 400–500, màu `--text-secondary` |
| Số trên dải số liệu | 24 / 600 / −0.03em, `line-height: 1` |

- Mọi con số, giờ, ngày và số đếm dùng `font-variant-numeric: tabular-nums` (class `.wb-num`).
- Mã việc (`identifier`) và giờ trong danh sách dùng font mono hiện có của app (class `.wb-mono`, 11.5px, màu `--text-tertiary`).
- Đoạn văn: `max-width: 64ch; text-wrap: pretty`.

### 2.4 Bề mặt và bố cục

- **Khối** (danh sách, dải số liệu, thẻ hồ sơ): nền `var(--surface)`, viền 1px `var(--border)`, bo `var(--radius-12)`, bóng `var(--wb-shadow)`, `overflow: hidden`.
- **Dòng:** cao tối thiểu 36px, padding `7px 12px`. Khi rê chuột thì nền `var(--wb-row-hover)`. Các phần tử `.wb-row-act` chỉ hiện khi rê chuột hoặc khi dòng có `:focus-within`.
- **Nội dung:** `max-width: 1180px`, căn trái. Lề ngang 24px, khoảng cách giữa các mục 18px.

## 3. Khung

### 3.1 Thanh trên (`WorkbenchTopBar.tsx`)

- **Breadcrumb:**
  - Chip workspace: ô vuông 16px màu `--accent` có chữ cái đầu tên workspace, tên workspace và ▾. Bấm vào mở danh sách workspace.
  - Dấu `/`.
  - Chữ "Bàn làm việc".
  - Chip vai trò dạng nhỏ (nền `--surface-subtle`, viền, chữ 12px) có ▾.
- **Thực thi ô chọn:**
  - Hai ô chọn tách riêng. Mỗi ô là `<select>` gốc được phủ lên chip trong suốt (`opacity: 0`, `inset: 0`), nên giữ được hành vi bàn phím và trình đọc màn hình.
  - Mỗi ô có `aria-label` riêng: `wbTopWorkspace`, `wbTopRole`.
  - Khi chỉ có một workspace thì chip vẫn hiện, nhưng ▾ mờ đi.
  - Khi chưa đăng nhập thì không có chip workspace, chỉ còn chip vai trò.
- **Bên phải:**
  - `.wb-btn-icon` ↻ với `aria-label` và `title` là `wbTopRefresh`.
  - `.wb-btn-primary` "+ Tạo mới". Menu của nút giữ nguyên nội dung và hành vi, chỉ đổi style: bo 10, bóng `var(--shadow-menu)`, mỗi mục cao 32px, rê chuột thì nền `var(--wb-row-hover)`.

### 3.2 Thanh tab (`WorkbenchTabs.tsx`)

- **Số đếm:** tab `tasks` hiện `counts.overdue` bằng màu `--danger` nếu lớn hơn 0; nếu bằng 0 thì hiện `counts.due_today` bằng màu `--text-tertiary`. Tab `calendar` hiện `counts.meetings_today`.
  - Số đếm lấy từ summary Tổng quan đã có trong cache (`cachedWork` theo key `home:<workspaceId>`, đúng key Tổng quan đang dùng). Không gọi API mới.
  - Không có summary, hoặc giá trị là `null` hay `0`, thì không hiện số.
  - Số đếm được bọc trong `<span class="wb-tab-count wb-num" aria-label="…">`. Nhãn đọc màn hình là i18n key mới `wbTabCountOverdue` / `wbTabCountDueToday` / `wbTabCountMeetings`, nhận tham số `{count}`.
- **Bỏ ghim và kéo:** nút × và tay kéo ⠿ có `opacity: 0`. Chúng hiện ra khi tab được rê chuột hoặc có `:focus-within`, hoặc khi tab đang chọn. Các tab lõi (Tổng quan, Công việc, Lịch) không có nút ×, giữ nguyên như hiện tại.
- **Vạch dưới tab đang chọn:** pseudo-element cao 2px, bo 2px, cách mép trái phải 8px, màu `--accent`.

## 4. Các màn

### 4.1 Tổng quan (`WorkOverview.tsx`)

- **Đầu trang:**
  - Dòng ngày (overline).
  - Lời chào dùng tên gọi ngắn: phần cuối của `display_name` cho tiếng Việt, phần đầu cho các ngôn ngữ khác. Logic này nằm trong hàm thuần mới `greetingName(displayName, lang)` trong `work-home.ts`, theo `uniwork:packages/views/home/home-view.tsx`; nếu không tách được thì dùng tên đầy đủ.
  - Câu nêu điều cần làm trước, giữ nguyên logic `buildHeadline`.
- **Dải số liệu `.wb-ov-strip`:**
  - Một khối chia 5 ô bằng đường kẻ dọc.
  - Mỗi ô có ô icon tint 20px, nhãn 12px và số 24px. Tint: `tasks` cho Đang mở, Quá hạn và Hạn hôm nay; `MEETING_TINT` cho Họp; `blue` cho Chưa đọc.
  - Rê chuột thì nền ô đổi sang `var(--wb-row-hover)`. Ô vẫn là `<button>` như hiện tại, giữ nguyên hành vi bấm.
  - Nguồn lỗi hiện "—" kèm "Thử lại" như cũ.
- **Tài liệu gần đây:**
  - Lưới 4 cột, mỗi thẻ có nhãn loại file (`FileBadge` hiện có), tên và thời gian. File cục bộ có nhãn "Trên máy".
  - Rê chuột thì viền thẻ đổi sang `var(--border-hover)` và có bóng `var(--wb-shadow)`.
  - Dòng báo lỗi cloud và nút Thử lại giữ nguyên.
- **Việc của tôi:**
  - Chia nhóm Quá hạn / Hôm nay / Sắp tới. Phân nhóm dùng `dueState` hiện có. Mỗi nhóm có tiêu đề kèm số đếm.
  - Checkbox tự vẽ `.wb-check`: input gốc ẩn bằng kỹ thuật visually-hidden, giữ nguyên khả năng truy cập. Khi đã tick thì nền `--accent`, chữ của dòng gạch ngang và chuyển màu `--text-tertiary`.
  - Mã việc dùng font mono. Link "Mở ↗" là `.wb-row-act`. Pill hạn chót giữ nguyên logic.
- **Họp sắp tới:** cột giờ mono 600, tên cuộc họp, dòng phụ là ngày hoặc thời lượng nếu có dữ liệu. Cuộc họp đang diễn ra có chip "Vào" (nền `--accent-soft`, chữ `--accent`).
- **Thông báo:** ô chữ cái 20px (tint `blue`, ký tự đầu của actor), nội dung và giờ mono.
- **Trạng thái yên (không có việc nào):** dùng mẫu trạng thái rỗng ở mục 5.

### 4.2 Tiêu đề chung cho các tab còn lại

Tạo component `WorkPaneHeader` gồm: ô icon tint của module, tiêu đề 16px, meta ngắn (caption), cùng slot phải cho thao tác hoặc số tóm tắt.

`WorkbenchModulePane` dùng component này và thôi bọc nội dung trong card thứ hai. Cụ thể:

- Bỏ khối `wb-panel wb-detail` bên ngoài: nội dung tab nằm trực tiếp dưới tiêu đề.
- Bỏ H2 lặp lại.
- Đoạn mô tả module trở thành meta trên một dòng.

### 4.3 Công việc (`WorkTasksPane.tsx`)

- Ô "Thêm việc…" là dòng đầu tiên trong khối danh sách. Bên trái có ô viền đứt chứa dấu +. Bấm Enter để thêm, giữ nguyên logic.
- Danh sách chia nhóm như hiện có. Mỗi dòng gồm checkbox, tiêu đề, mã việc mono, pill trạng thái (nền `--surface-subtle`) và pill hạn chót (signal).
- Slot phải của tiêu đề hiện "`n` đang mở", chỉ khi danh sách đã tải.

### 4.4 Lịch (`WorkCalendarPane.tsx`)

- Mỗi ngày có một tiêu đề `position: sticky` (nền `var(--bg-content)`). Ngày hôm nay có chấm `--accent` và chữ "Hôm nay".
- Mỗi dòng gồm cột giờ mono (hoặc chữ "Cả ngày"), ô tint (việc: `tasks`; họp: `MEETING_TINT`; lịch ngoài: `gray`) và tiêu đề.

### 4.5 Hồ sơ (`WorkProfilePane.tsx`)

- Thẻ gồm ô chữ cái 48px (tint `pink`) và tên 18px semibold, bên dưới là chức danh dạng caption.
- Các trường xếp lưới `dl` 2 cột: nhãn caption bên trái, giá trị body bên phải.
- Dòng chú thích UniAI và nút `.wb-btn-secondary` "Sửa trên web".

### 4.6 Biểu mẫu (trong `WorkbenchModulePanes.tsx`)

- Form thêm mẫu xếp trên một hàng: ô "Tên biểu mẫu" co giãn, ô "Ghi chú" rộng 220px, nút phụ "Tải tệp mẫu lên…" và nút chính "Thêm vào thư viện".
- Đoạn hướng dẫn dài rút thành một dòng meta. Câu "Chọn gói ở Tri thức trước khi soạn" hiện bên cạnh nút Soạn khi nút bị khóa.
- Danh sách mẫu dạng bảng dòng: tên, ghi chú (caption), các thao tác `.wb-row-act` (Soạn, Mở tệp, Xóa).
- Trạng thái rỗng theo mẫu ở mục 5.

### 4.7 Ghi chú (`NotesPane.tsx`)

- Ô nhập phẳng, cao 36px, nút chính "Thêm ghi chú".
- Mỗi ghi chú là một dòng thẻ: nội dung, thời gian sửa (caption) và nút xóa dạng `.wb-row-act`.

### 4.8 Tri thức và 4 trụ cột (phần trụ cột trong `PracticeHome.tsx`)

- Ô tìm kiếm cao 32px, rộng tối đa 360px, có icon kính lúp ở đầu ô. Nhãn "Tìm" chuyển thành placeholder cộng `aria-label`.
- Bố cục 2 cột: thư viện bên trái (`minmax(0,1fr)`), chi tiết bên phải (`minmax(0,1.4fr)`).
- Tiêu đề "Thư viện" có số đếm ở cỡ caption.
- Câu báo rỗng về đúng cỡ body và dùng mẫu ở mục 5.

## 5. Trạng thái

Tạo một component dùng chung `WorkStatePanel`, đặt cạnh `WorkErrorState` và dùng lại chuỗi i18n hiện có. Nó gồm:

- ô icon 36px bo 10, dùng tint của module cho trạng thái rỗng và signal cho lỗi;
- tiêu đề 14/600;
- một câu giải thích (`max-width: 52ch`);
- tối đa một hành động.

Áp cho các trạng thái:

- **rỗng:** Tổng quan yên, Công việc, Lịch, Biểu mẫu, Ghi chú, Thư viện;
- **lỗi:** `server`;
- **mất quyền:** `forbidden`;
- **offline khi không có cache;**
- **chưa đăng nhập;**
- **chưa có workspace.**

Bỏ toàn bộ hộp viền đứt (`border-style: dashed`) trong vùng Bàn làm việc. Riêng ô dấu + của "Thêm việc…" được giữ viền đứt.

**Skeleton:** các khối hình chữ nhật bo 6 có nền `var(--surface-subtle)` và hiệu ứng shimmer 1.2s chạy bằng `background-position`. Dưới `prefers-reduced-motion` thì tắt shimmer. Skeleton có hình dạng khớp với dải số liệu và 3 dòng danh sách.

## 6. Chế độ tối

Mọi giá trị đi qua token. Ở chế độ tối, `--wb-shadow` là `none`: khối được phân tách bằng viền `var(--border)`. Mọi cặp chữ trên nền mới thêm đều phải đạt AA ở cả hai chế độ.

## 7. Kiểm thử

- **Cập nhật test hiện có:** test component (`work-overview`, `work-tasks-pane`, `work-calendar-pane`, `work-profile-pane`, `workbench-topbar`, `workbench-tabs*`, `notes`, `forms`) được sửa selector và chuỗi theo cấu trúc mới. Không xóa test nào khi hành vi của nó vẫn còn.
- **Test mới:**
  - Số đếm trên tab hiện khi có summary trong cache, ẩn khi chưa có summary hoặc khi giá trị là 0 hay `null`. Nhãn đọc màn hình đúng.
  - Thanh trên có hai `<select>` với hai `aria-label` riêng. Không có chip workspace khi chưa đăng nhập.
  - `WorkStatePanel` hiện tiêu đề, giải thích và một hành động.
  - Tab lõi không có nút ×; tab không lõi có nút × kèm class để CSS ẩn hoặc hiện.
  - `greetingName` tách tên đúng cho vi và en.
- **Kiểm tra tự động mỗi task:** `npm run typecheck`, suite shell, `npm run check:theme-colors -- --base <commit đầu đợt này>`, `npm run check:english-comments`, `prettier --check` trên các file đã sửa.
- **Ảnh chụp trước và sau:** dùng script chụp ảnh tạm trong scratchpad (không commit), bổ sung stub cho `/my-tasks`, `/task-statuses`, `/calendar/events`, `/people/{id}`. Chụp 10 màn × light/dark × vi/en sau khi làm xong để người dùng duyệt.

## 8. Ngoài phạm vi

- Sidebar, màn Tệp, Settings và My AI.
- Phím tắt mới.
- Chế độ xem kanban hoặc tuần cho Lịch.
- Thay đổi màu `.btn-primary` dùng chung.
- Font mới.
