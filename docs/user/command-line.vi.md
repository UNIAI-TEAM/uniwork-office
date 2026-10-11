# Liên kết dòng lệnh

UniWork Office có kèm một công cụ dòng lệnh. Lệnh của nó là `uniwork-office-cli` trên mọi hệ điều hành
(Windows, macOS và Linux). Vào Cài đặt → Chung → "Thêm vào terminal" để đưa lệnh vào `PATH`, giúp tập
lệnh và trợ lý AI tạo, chuyển đổi và đọc tài liệu mà không cần mở ứng dụng. Ứng dụng không thêm gì cho
đến khi bạn bấm nút. Lệnh có tên riêng là có chủ ý: trên Linux, `uniwork-office` là chính ứng dụng nên
dòng lệnh không dùng tên đó.

## Ứng dụng tự làm gì

- **Bản cài deb / rpm.** Gói cài đặt lệnh vào `PATH` là `/usr/bin/uniwork-office-cli`, đường dẫn này giữ
  nguyên khi cập nhật. Phần Tích hợp trong Cài đặt hiển thị `uniwork-office-cli` là lệnh đã sẵn sàng để
  gõ, và đó cũng là tên dùng cho tập lệnh và trợ lý. Các gói cũ còn tạo thêm `/usr/bin/genoffice`; cài
  phiên bản này sẽ xóa liên kết đó khi nó trỏ vào thư mục của chính ứng dụng (`genoffice` của chương
  trình khác thì được giữ nguyên).
- **Windows.** Trình cài đặt thêm thư mục `resources\cli` của ứng dụng vào `PATH` của người dùng; thư mục
  này có `uniwork-office-cli.cmd` (cho cmd và PowerShell) và `uniwork-office-cli` (cho Git Bash).
- **macOS, AppImage và tarball.** "Thêm vào terminal" tạo liên kết `uniwork-office-cli` trong
  `/usr/local/bin` (hoặc `/opt/homebrew/bin`, rồi `~/.local/bin`).
- **Mỗi lần mở ứng dụng.** Ứng dụng xóa các liên kết lệnh do nó tạo trước đây mà đích đã mất (ví dụ sau khi
  gỡ gói), chuyển liên kết đang trỏ vào đường dẫn cũ của cùng một bản cài (ví dụ thư mục có số phiên bản)
  sang trình khởi chạy hiện tại, và thay các liên kết của phiên bản cũ, tên `genoffice` hoặc
  `uniwork-office`, bằng `uniwork-office-cli`. Ứng dụng chỉ xem trong `/usr/local/bin`,
  `/opt/homebrew/bin`, `$XDG_BIN_HOME` và `~/.local/bin`, và chỉ với liên kết tượng trưng dẫn tới trình
  khởi chạy dòng lệnh của chính ứng dụng: chính ứng dụng (`uniwork-office`), `genoffice` hoặc
  `uniwork-office` của chương trình khác, tệp thường, và liên kết còn hoạt động nhưng dẫn vào một bản cài
  khác (ví dụ một bản dựng khác hoặc một bản sao khác của ứng dụng cài cạnh bản này) đều không bị động
  đến. Với bản deb / rpm, nơi `/usr/bin/uniwork-office-cli` đã có sẵn, liên kết như vậy không thêm được
  gì nên bị xóa. Trên Linux, ứng dụng cũng xóa dòng `uniwork://` đã cũ trong `~/.config/mimeapps.list`
  khi tệp desktop của ứng dụng không còn.
- **Khi gỡ gói.** Gói tự xóa `/usr/bin/uniwork-office-cli` (chỉ khi nó trỏ vào thư mục của ứng dụng). Bước
  gỡ chạy bằng quyền root nên không với tới thư mục cá nhân của bạn; liên kết bạn đã thêm có thể còn lại
  cho đến lần ứng dụng được mở tiếp theo. Liên kết hỏng không gây hại, nó chỉ khiến lệnh báo "No such
  file or directory".

## Dọn thủ công: bạn đã xóa tệp AppImage

Nếu bạn chạy AppImage rồi xóa tệp, ứng dụng không còn để tự dọn. Hãy xóa phần còn lại bằng tay:

```sh
# liên kết lệnh trỏ vào chỗ không còn gì (chỉ xóa những liên kết được báo là hỏng)
ls -l ~/.local/bin/uniwork-office-cli ~/.local/bin/uniwork-office ~/.local/bin/genoffice \
  /usr/local/bin/uniwork-office-cli /usr/local/bin/uniwork-office /usr/local/bin/genoffice 2>/dev/null
rm -f ~/.local/bin/uniwork-office-cli ~/.local/bin/genoffice

# trình xử lý uniwork://: xóa các dòng sau khỏi tệp, nếu có
#   x-scheme-handler/uniwork=...
#   x-scheme-handler/uniwork-office=...
${EDITOR:-nano} ~/.config/mimeapps.list

# tùy chọn: cài đặt và bộ nhớ đệm của ứng dụng
rm -rf "$HOME/.config/UniWork Office"
```

Chỉ xóa một liên kết khi `ls -l` cho thấy đích của nó đã mất hoặc nằm trong thư mục `.mount_…` của
AppImage. Liên kết trỏ vào chương trình còn chạy được là của thứ khác.
Đừng xóa `uniwork-office` trừ khi nó là liên kết hỏng: trên một số hệ thống đó chính là ứng dụng.
