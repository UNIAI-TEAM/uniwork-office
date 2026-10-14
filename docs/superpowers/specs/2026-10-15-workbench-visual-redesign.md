# Bàn làm việc: thiết kế lại giao diện (vòng thị giác)

- Ngày: 2026-10-15
- Trạng thái: đã duyệt (người dùng duyệt bản audit + mockup ngày 15/10)
- Nguồn:
  - Audit mã: `scratchpad/wb-code-audit.md` (đã tóm tắt dưới đây).
  - Mockup: artifact "Bàn làm việc — Audit & Redesign" (các bảng Desk, Tasks, Calendar, Forms, Notes, Profile, Knowledge).
- Bản gốc các mockup: `.dc.html` trong thư mục scratchpad `wb-redesign/project/`. Người làm đọc chúng như bản vẽ tham chiếu, không chép markup.
- Phạm vi: chỉ phần trình bày của Bàn làm việc (`apps/shell/src/renderer/src`, các file `Workbench*`, `Work*`, `Desk*`, `NotesPane`, `SkillDomainTabs`, `PracticeHome` và các khối `.wb-*` / `.skill-domain-*` trong `home.css`).
- Ngoài phạm vi: sidebar, màn Tệp, Settings, My AI. Logic dữ liệu, IPC và hành vi giữ nguyên, trừ các điểm ghi rõ trong mục 5.

## 1. Nguyên tắc (PRODUCT.md + R1)

1. **Một khung, một nhịp.**
   - Đầu trang: h1 "Bàn làm việc" 20/600, kèm chip workspace và chip vai trò cùng kiểu, cao 28px.
   - Bên phải đầu trang: nút làm mới (icon có viền, 32px) và nút chính "Tạo mới".
   - Hàng tab gạch chân.
   - Mỗi tab mở bằng một **thanh công cụ**: tóm tắt bên trái, hành động bên phải. Thanh này thay `WorkPaneHeader`, nên bỏ tiêu đề tab lặp lại.
2. **Bốn cỡ chữ, một họ phông.**
   - Các cỡ: 20/600 tiêu đề trang, 13/600 tiêu đề mục, 13/400–500 nội dung, 12/500 phụ và nhãn.
   - Số đếm và nhãn trong tab dùng 11/600, và chỉ chúng được dùng cỡ này.
   - Không viết hoa tiêu đề mục.
   - Số dùng `tabular-nums`. Mono chỉ dùng cho mã việc (ENG-12), không dùng cho ngày hay chữ.
3. **Lưới 4px, cột 1.200px.**
   - Cột nội dung có `max-width: 1200px`, căn giữa như phần còn lại của Home sau redesign sidebar.
   - Lề ngang 32px, chỉ một lớp: bỏ lớp padding thứ hai của `.wb-home`.
   - Khoảng cách dùng 4/8/12/16/24/32.
   - Bo góc: 6 cho điều khiển nhỏ, 8 cho nút và ô nhập, 12 cho thẻ.
   - Thẻ là nền surface + viền 1px, không bóng. Bóng chỉ dùng cho menu, popover và toast.
4. **Một bộ thành phần.**
   - Dòng danh sách 44–52px; các cột phụ có độ rộng cố định nên thẳng hàng.
   - Ô nhập 32px, focus là viền accent + vòng 3px `--ac-soft`.
   - Một menu/popover dùng chung: Esc đóng, phím mũi tên đi, focus vào mục đầu, trả focus khi đóng.
   - Nút: chính / phụ / ghost / nguy hiểm. Nút bị khóa là xám trung tính (nền subtle, chữ tertiary), không dùng xanh nhạt.
5. **Màu đúng vai.**
   - Tint nhận diện module, dùng cho glyph tab và ô icon.
   - Signal báo trạng thái bằng nhãn (pill): xung đột / quá hạn = danger, chưa lưu / hôm nay = warning, đang họp / đã xong = success, bình luận / nhắc tên / khôi phục = info, còn lại neutral.
   - Accent chỉ cho một hành động chính mỗi màn. "Chạy" kỹ năng và các dụng cụ là nút phụ.
6. **Trạng thái trung thực.**
   - Skeleton đúng hình dòng.
   - Rỗng và lỗi nằm gọn trong vùng của nó, dùng biến thể compact.
   - Mỗi màn có tối đa một banner đăng nhập hoặc offline.
   - Toast xếp chồng ở góc dưới phải cột nội dung (một host duy nhất), tự tắt sau 6 giây khi không có hành động.
   - Xóa có "Hoàn tác" thay cho hộp confirm. Xóa gói vẫn cần xác nhận, nhưng dùng popover trong app.
7. **Chuyển động** 150ms vào / 120ms ra, chỉ để giải thích thay đổi; dùng `--transition-fast`. Tôn trọng `prefers-reduced-motion`.

Không áp dụng từ skill redesign:

- Đổi phông Geist/Satoshi: R1 yêu cầu Inter.
- Grain, glass, gradient, ảnh nền: PRODUCT.md cấm.
- Hiệu ứng vào lần lượt: cấm "orchestrated load".
- Lưới phá cách: không hợp màn làm việc dày đặc.

## 2. Nền tảng

### 2.1 Phông

- Dùng lại bộ woff2 tự host của `apps/uniai-pwa/fonts`, OFL:
  - Inter latin + latin-ext, 400/500/600/700;
  - Be Vietnam Pro vietnamese, 400/500/600/700, khai báo trước để dấu tiếng Việt ưu tiên Be Vietnam Pro, giống `apps/uniai-pwa/fonts.css`.
- Chép vào asset của shell renderer. Khai báo `@font-face` family `'UniWork Sans'` (cùng unicode-range).
- Áp cho `.wb-home`: `font-family: 'UniWork Sans', var(--ui-cjk), system-ui, sans-serif`.
- Phông phải chạy offline, không gọi CDN.

### 2.2 Biến scoped trong `.wb-home`

Không đổi token toàn app trong `tokens.css`, trừ khi buộc phải thêm token mới; thêm token mới thì đủ 3 khối.

- Hover hàng ở dark phải nhìn thấy được. `--wb-row-hover` dark đổi sang khoảng `#2a2d33`, đủ 3 khối.
- Thống nhất một họ xám lạnh cho các bề mặt Bàn làm việc: page `--bg-content`, card `--surface`, subtle `--surface-subtle`, viền `--border`, viền điều khiển `--border-strong`.
- Thêm `--wb-focus-ring` (light: accent 22%, dark: accent 35%) cho vòng focus ô nhập, đủ 3 khối.

### 2.3 Thành phần dùng chung

Dùng lại và chuẩn hóa những gì đã có, không thêm thư viện.

- `.wb-btn`: giữ hệ có sẵn; thêm `.wb-btn-danger`; trạng thái khóa trung tính.
- `.wb-input` (mới): một lớp cho `input`, `select`, `textarea` trong Bàn làm việc, cao 32px. Thay cả 6 kiểu cũ: `.wb-form`, `.wb-forms-add`, `.wb-kn-search`, `.wb-notes-add`, `.wb-desk-split`, `.wb-add-row select`.
- `.wb-pill` + `.is-danger|warning|success|info|neutral`, có chấm tùy chọn `.wb-pill-dot`.
- Hàng danh sách:
  - Một lớp `.wb-row`, tiêu đề 500 (`.wb-row-title`, có focus-visible).
  - `.wb-row-sub` 12px.
  - Hành động ở cột phải. Hành động chính của dòng hiện sẵn; hành động phụ hiện khi hover hoặc focus-within.
- `WbMenu` (mới, một component):
  - Thay ba menu chép tay: `.wb-new-menu`, `.wb-tab-menu`, `.skill-domain-menu`.
  - `role="menu"`, Esc, ↑/↓/Home/End, focus mục đầu khi mở, trả focus khi đóng.
  - Tự lật lên trên khi thiếu chỗ phía dưới.
  - Nhãn nhóm `role="presentation"`.
- `WbConfirm` (mới, popover xác nhận nhẹ):
  - Thay `window.confirm` (xóa gói, xóa tệp tài liệu) và modal "Dùng lượt AI?".
  - Gồm tiêu đề, một dòng mô tả, nút Hủy (ghost) và nút xác nhận (chính hoặc nguy hiểm). Esc đóng; focus vào nút Hủy.
- `WbToastHost` (mới): một host cho mọi toast của Bàn làm việc (Desk tools, Today, Tasks, Forms, Notes…). Toast xếp chồng, có hành động (Mở / Hoàn tác / Thử lại) và nút đóng; không chồng lên nhau.
- `WorkStatePanel`: thêm biến thể `compact` (ô icon 28px, padding 12px, căn trái) dùng trong vùng nhỏ. Bản đầy đủ căn giữa vùng.
- Skeleton: `WorkSkeleton` nhận `shape` (`rows` | `agenda` | `card`). Dòng skeleton có ô icon tròn, hai vạch chữ và một pill.
- Icon: thay mọi ký tự `▾ ⋮⋮ × → +` bằng SVG nét 1.5, khung 16, cùng kiểu với `WorkbenchIcons`. Chuẩn hóa nét `WorkbenchIcons` về 1.5; `skills` và `compose` chuyển sang dạng nét.
- Focus: mọi điều khiển đều có `:focus-visible`, outline 2px accent, offset 2px. Riêng tab và hàng dùng offset −2px.

## 3. Khung (`WorkbenchTopBar`, `WorkbenchTabs`, thanh công cụ tab)

- **Đầu trang:**
  - h1 20/600. Chip workspace và chip vai trò cùng kiểu, cao 28px, viền 1px, bo 8, chevron SVG.
  - Chip workspace giữ `<select>` phủ trong suốt như hiện nay.
  - Ô chữ cái workspace dùng tint blue, không dùng accent đặc.
  - Bên phải: nút làm mới có viền 32px và nút chính "Tạo mới" có chevron. Menu của "Tạo mới" chuyển sang `WbMenu`.
- **Tab:**
  - Cao 40px, chữ 13/500, gạch chân accent 2px.
  - Icon là glyph tint 16px, không có ô nền, để giảm tải màu.
  - Số đếm là pill 11/600: danger khi có việc quá hạn, neutral cho các trường hợp khác.
  - Nút gỡ tab là `<button>` riêng, đặt ngoài nút tab (không lồng), vùng bấm 24px, hiện khi hover hoặc focus-within.
  - Kéo để sắp xếp giữ nguyên. Thêm bàn phím: Alt+←/→ trên tab đang focus để đổi chỗ (chỉ tab không lõi).
  - Tràn ngang: mờ dần ở mép và có nút cuộn.
- **Thanh công cụ tab** (thay `WorkPaneHeader`):
  - Bên trái là một câu tóm tắt trạng thái thật, ví dụ "6 việc đang mở · 1 quá hạn · 2 đến hạn hôm nay".
  - Tab dữ liệu cục bộ có thêm nhãn "Lưu trên máy này".
  - Bên phải là hành động của tab.
  - Thông báo hoặc lỗi cấp tab không còn là dòng `wb-hint` / `wb-error` dính trên đầu mọi tab. Chúng chuyển thành toast hoặc lỗi tại chỗ.

## 4. Từng màn (theo mockup)

### 4.1 Mặt bàn

- **Thanh công cụ:**
  - "Chào buổi sáng, {tên}." (tên ngắn: dùng lại `greetingName`), sau đó là tóm tắt "N việc đang chờ bạn, M tài liệu chưa lưu" lấy từ dữ liệu có sẵn.
  - Bỏ lời chào khi không có tên.
- **Dụng cụ:**
  - Thẻ có tiêu đề "Dụng cụ" và gợi ý "Kéo tệp vào bất kỳ đâu trên Mặt bàn…".
  - Nhóm thứ nhất "PDF sang": Word / Excel / PowerPoint, mỗi nút kèm FileBadge 16px của định dạng đích.
  - Vạch ngăn, rồi nhóm thứ hai: Xuất PDF / Ghép PDF / Tách PDF, mỗi nút một icon nét riêng.
  - Tất cả là nút phụ.
  - Panel thả tệp và hộp "số trang mỗi phần" dùng `WbConfirm`/popover gọn:
    - danh sách tệp ở trên;
    - nút dụng cụ là nút phụ, căn trái;
    - Hủy / Mở căn phải;
    - ghi chú "xuất từ bản đã lưu" nằm trên hàng nút.
- **Cần bạn xử lý:** dòng gồm avatar chữ cái (người) hoặc FileBadge (tệp), tiêu đề, dòng phụ (trích bình luận hoặc lý do), pill trạng thái, thời gian hoặc hành động.
  - Xung đột hoặc lỗi đồng bộ: pill danger "Xung đột" / "Chưa đồng bộ", nút phụ "Giải quyết" (mở tài liệu).
  - Bình luận: pill info "Bình luận".
  - Nhắc tên: pill info "Nhắc tên".
  - Được chia sẻ: pill neutral "Mới chia sẻ".
- **Đang làm dở:**
  - Dòng gồm FileBadge, tên, dòng phụ (vị trí / nguồn), pill ("Chưa lưu" warning, "Có bản khôi phục" info) và nút phụ ("Chuyển tới" / "Khôi phục"), hoặc thời gian.
  - "Mở tệp…" là liên kết ở đầu thẻ.
  - Khi đang tải dùng skeleton, **không** hiện câu rỗng.
- **Biểu mẫu hay dùng:**
  - Tiêu đề mục, chip chọn gói đích (dùng `packId` hiện có; chưa chọn thì ghi "Dự án mặc định").
  - Liên kết "Quản lý biểu mẫu".
  - Các chip là nút phụ có FileBadge; thêm nút ghost "Thêm biểu mẫu".
- **Hôm nay** (thẻ bên phải, 320px):
  - Đầu thẻ: "Hôm nay" + ngày.
  - Nhãn phụ "Việc đến hạn", các dòng checkbox + tiêu đề + pill, liên kết "Tất cả việc".
  - Nhãn phụ "Lịch họp", các dòng giờ (600, tabular) + tiêu đề + dòng phụ. Cuộc họp đang diễn ra có dòng phụ màu success và nút phụ "Vào họp".
  - Chân thẻ: icon chuông + liên kết "N thông báo khác trên UniWork".
- **Cùng mép trên:** hai cột thẳng mép trên vì cột phải không còn dòng ngày nằm ngoài thẻ.
- **Chưa đăng nhập:** một banner info duy nhất ở đầu Mặt bàn ("Đăng nhập UniWork để thấy việc, lịch, thông báo; dụng cụ và tài liệu trên máy vẫn dùng được.") + nút "Đăng nhập". Khay và cột Hôm nay không lặp lời mời. Offline: banner warning tương tự, có "Thử lại".

### 4.2 Công việc

- **Thanh công cụ:** "6 việc đang mở · 1 quá hạn · 2 đến hạn hôm nay" + nút ghost "Mở trên web ↗" (SVG).
  - Số trên tab vẫn là số quá hạn. Câu tóm tắt nói rõ cả hai số, nên không còn mâu thuẫn.
- **Một thẻ, theo thứ tự:**
  - Hàng thêm nhanh: ô "+" viền đứt (ngoại lệ duy nhất được dùng viền đứt), input không viền, gợi ý ↵. Không còn nút "Thêm" bị khóa; Enter để thêm. Lỗi hiện tại chỗ.
  - Hàng tiêu đề cột: Việc / Mã / Trạng thái / Hạn.
  - Các nhóm: tiêu đề nhóm 12/600 kèm số; nhóm quá hạn màu danger.
  - Mỗi dòng là lưới `16px | 1fr | 64px | 112px | 108px | 28px`: checkbox, tiêu đề 500, mã mono, pill trạng thái có chấm, pill hạn, icon mở trên web (hiện khi hover).
- **Việc vừa xong:** vẫn hiện, gạch ngang, đến lần làm mới.
- **Rỗng:** panel compact nằm _trong_ thẻ, dưới hàng thêm nhanh.

### 4.3 Lịch

- **Thanh công cụ:** "14 ngày tới · N mục", chú giải (Cuộc họp tím, Hạn việc xanh lá, Lịch ngoài xám), nút ghost "Mở lịch trên web".
- **Một thẻ duy nhất:**
  - Đầu ngày dính (`position: sticky; top: 0` trong vùng cuộn, không offset cứng): "Hôm nay" có chấm accent, rồi thứ + ngày, số mục căn phải.
  - Mỗi mục là lưới `96px | 3px | 1fr | auto`:
    - giờ 600 tabular, dòng dưới là thời lượng 12px;
    - "Cả ngày" là chip viền, cùng phông với giờ;
    - vạch màu tint theo loại;
    - tiêu đề + dòng phụ: loại, mã (mono), nơi họp nếu có;
    - bên phải là pill hoặc nút "Vào họp".
- **Mục đã qua:** chữ tertiary.
- **Icon việc:** bỏ dấu tích, không còn giống "đã xong".

### 4.4 Biểu mẫu

- **Thanh công cụ:** "N biểu mẫu · Lưu trên máy này" + nút phụ "Thêm biểu mẫu", mở thẻ soạn.
- **Banner một lần:** "Bản soạn từ biểu mẫu sẽ vào gói [chip chọn gói ▾]" + dòng phụ "Chưa chọn gói thì vào Dự án mặc định". Bỏ câu cảnh báo lặp trên từng dòng.
  - Đổi hành vi: "Soạn" không bao giờ bị khóa; dùng gói mặc định như Ngăn kéo.
- **Thẻ "Biểu mẫu mới":**
  - Lưới ba cột: Tên (bắt buộc, có dấu `*`), Ghi chú, Tệp mẫu (hàng tệp đã chọn + "Đổi tệp" / "Tải tệp mẫu lên…").
  - Nút Hủy / Thêm vào thư viện căn phải. Thêm bị khóa khi thiếu tên.
  - Là `<form>`, Enter ở mọi ô đều gửi.
- **Danh sách:** lưới `28px | 1.4fr | 1fr | auto | 28px`: FileBadge, tên + ghi chú, tên tệp mẫu, nút phụ "Soạn", menu ⋯ (Mở tệp mẫu gốc, Sửa tên/ghi chú, Xóa khỏi thư viện).
- **Xóa:** toast "Đã xóa “…”" + Hoàn tác.

### 4.5 Ghi chú

- **Thanh công cụ:** "N ghi chú · Lưu trên máy này".
- **Thẻ soạn** (tối đa 640px): textarea không viền, chân thẻ "⌘↵ để lưu" + nút chính nhỏ "Lưu ghi chú". Nút khóa trung tính khi rỗng.
- **Các thẻ ghi chú:**
  - Lưới cột kiểu masonry (`columns: 3 280px`).
  - Ghi chú vẫn sửa tại chỗ, tự lưu. Khi đang sửa có viền accent + vòng focus.
  - Chân thẻ: "Sửa lúc 10:42 / hôm qua / 13/10" (định dạng tương đối chung) + hành động khi hover (Sao chép, Xóa).
- **Xóa:** toast Hoàn tác.

### 4.6 Hồ sơ

- **Thanh công cụ:** "Hồ sơ UniWork của bạn · chỉ đọc" + nút phụ "Sửa trên web ↗".
- **Lưới `340px | 1fr`:**
  - Thẻ danh tính: avatar **tròn** 64px tint pink (giống avatar sidebar), tên 20/600, chức danh, email.
  - Thẻ "Thông tin công việc" dạng `dl` hai cột: Phòng ban, Quản lý trực tiếp (avatar nhỏ), Email, Múi giờ. Chân thẻ nền subtle: "UniAI dùng các thông tin này để điền sẵn khi soạn văn bản cho bạn."

### 4.7 Tri thức

- **Thanh công cụ:** ô tìm 320px có icon, "N gói", "Lưu trên máy này", nút phụ "Gói mới" (sang Soạn mới).
- **Lưới `340px | 1fr`:**
  - Danh sách gói: tiêu đề 500 + dòng phụ thuộc tính + pill số tệp. Gói đang chọn có nền `--ac-soft`, tiêu đề màu accent và `aria-current`.
    - Bỏ thao tác ẩn "bấm lại để bỏ chọn".
  - Chi tiết:
    - Đầu chi tiết: tiêu đề 20/600, pill thuộc tính, các nút phụ ("Tài liệu của gói", "Mở thư mục" nếu có API sẵn; không có thì bỏ), menu ⋯ chứa "Xóa gói…" (nguy hiểm, `WbConfirm`).
    - Mục "Tệp trong gói": tối đa 3 dòng + "Xem cả N tệp".
    - Thẻ: chip có nút bỏ + input "Thêm thẻ, Enter".
    - Ghi chú: textarea.
    - Chân: "Có thay đổi chưa lưu" + Bỏ thay đổi / Lưu.
- **Không có kết quả tìm kiếm:** compact "Không có gói khớp “{q}”" + Xóa tìm kiếm. Khác hẳn với trạng thái chưa có gói.
- **Chưa có gói:** panel đầy đủ với hành động "Tạo gói đầu tiên".

### 4.8 Tài liệu

- **Thanh công cụ:** chip "Gói: {tên} ▾" (dùng danh sách gói có sẵn) + "N tệp" + nút phụ "Thêm tài liệu".
- **Thẻ "Tệp trong gói":** dòng FileBadge, tên, pill vai trò, thời gian; hành động Mở + ⋯ (Hiện trong thư mục, Gỡ khỏi gói qua `WbConfirm`).
- **Mục "Tạo nhanh từ mẫu":**
  - Lưới 4 thẻ mẫu: "Văn bản trống" / "Bảng tính" / "Bản trình chiếu" / "PDF". Việt hóa, bỏ "Docs/Sheets/Slides".
  - Hàng chip mẫu theo vai trò, liên kết "Mở chuỗi mẫu theo thứ tự".
  - Bỏ h3 trần 18,7px.
- **Chưa chọn gói:** panel có nút "Chọn gói ở Tri thức".
- **Lỗi tải tệp:** lỗi tại chỗ + Thử lại, không giả làm rỗng.

### 4.9 Kỹ năng

- **Thanh công cụ:** chip "Ngữ cảnh: {gói} ▾" + "Mỗi lần chạy dùng 1 lượt AI".
- **Mục "Theo vai trò · {vai trò}":** dòng gồm ô icon spark tint blue, tên 500, mô tả 12px, pill danh mục **đã dịch** (không hiện khóa thô "ai", "bao-gia"), nút phụ "Chạy" (icon spark).
  - Bấm "Chạy" mở `WbConfirm` ngay tại nút: "Chạy “{tên}” với gói {gói}?" + "Dùng 1 lượt AI." + Hủy / Chạy (chính).
  - Bỏ modal `.btn` đen bo tròn.
- **Mục "Theo lĩnh vực":**
  - Bộ chọn dạng segmented: các lĩnh vực đã ghim + nút ghost "Thêm lĩnh vực" mở `WbMenu`, tự lật lên khi thiếu chỗ.
  - Gỡ và sắp xếp lĩnh vực nằm trong menu ⋯ của segmented. Bỏ tay kéo và × trên từng chip.
  - Chữ cái badge lấy từ nhãn theo ngôn ngữ hiện tại.
- **Tiêu đề mục:** 13/600, không còn h3 trần.

### 4.10 Soạn mới

- **Thanh công cụ:** "Tạo gói công việc mới · Lưu trên máy này".
- **Lưới `minmax(0,720px) | 300px`:**
  - Thẻ form, các mục:
    - "Thông tin chính": tên gói và các facet bắt buộc, có dấu `*`.
    - "Phân loại": các facet dạng chọn, hai cột.
    - "Thẻ".
    - "Ghi chú".
  - Ô nhập dùng `.wb-input`, select cùng kiểu.
  - Lỗi tại trường: viền danger + dòng lỗi 12px, focus về trường lỗi đầu tiên.
  - Chân thẻ: "Sau khi tạo, gói mở trong Tri thức." + Hủy (ghost) / Tạo gói (chính).
  - Cột phải: thẻ subtle "Gói gồm gì?" (3 dòng: Tài liệu, Biểu mẫu, Kỹ năng AI dùng ngữ cảnh gói).
- **Đổi hành vi:** tạo xong **không** tự mở một tài liệu Word trắng; chuyển sang Tri thức với gói mới được chọn và hiện toast "Đã tạo gói “…”" + "Soạn văn bản đầu tiên".

### 4.11 Trạng thái chung

Áp mục 2.3 cho mọi tab:

- Rỗng compact trong vùng nhỏ, đầy đủ và căn giữa trong vùng lớn.
- Lỗi tại vùng + Thử lại.
- "Mất quyền" có hành động "Chọn không gian khác" mở chip workspace.
- Banner đăng nhập hoặc offline tối đa một cái mỗi màn.

### 4.12 Lời văn

- Thống nhất tên AI là "UniAI" ở mọi chuỗi Bàn làm việc. Bỏ "Hub AI" và "Trợ lý của bạn" trong phạm vi này.
- "Mô-đun" → "Khu vực khác".
- "Tổng quan / Mặt bàn" giữ "Mặt bàn".
- Chuỗi mới thêm vào `zh`/`en`/`vi` (các shard khác spread `en`).
- Tiêu đề trạng thái không có dấu chấm cuối.

## 5. Thay đổi hành vi (quyết định thay người dùng)

1. "Soạn" từ Biểu mẫu không còn bị khóa khi chưa chọn gói; vào gói mặc định, giống Ngăn kéo.
2. Soạn mới tạo xong không tự mở tài liệu Word trắng; chọn gói mới trong Tri thức và hiện toast có hành động.
3. Xóa biểu mẫu, ghi chú → toast Hoàn tác (khôi phục bản đã xóa). Xóa gói và gỡ tệp → `WbConfirm` trong app, thay `window.confirm`.
4. Bấm lại gói đang chọn không còn bỏ chọn.
5. Thông báo cấp tab → toast; lỗi nhập → tại trường.

## 6. Kiểm thử

- Cập nhật các test component hiện có theo cấu trúc mới (selector, chuỗi). Không xóa test khi hành vi vẫn còn.
- Test mới:
  - `WbMenu`: Esc, mũi tên, trả focus.
  - `WbConfirm`: Esc, focus, xác nhận.
  - `WbToastHost`: xếp chồng, Hoàn tác, tự tắt.
  - Hoàn tác xóa ở Biểu mẫu và Ghi chú.
  - Soạn mới: lỗi tại trường; tạo xong không mở tài liệu.
  - Tab: nút gỡ không lồng trong nút tab, có aria-label.
- Chạy:
  - `npm run typecheck -w @genoffice/shell`
  - suite shell (đã biết các lỗi có sẵn: `uniwork-docs-ui-components`, `uniwork-docs-lock-retry`)
  - `npm run check:theme-colors -- --base <đầu đợt>`
  - `npm run check:english-comments`
  - prettier
  - hai e2e Desk: `e2e/workbench-desk*.spec.ts`
