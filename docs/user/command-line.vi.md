# Liên kết dòng lệnh (Linux)

UniWork Office có kèm một công cụ dòng lệnh. Vào Cài đặt → Chung → "Thêm vào terminal" để đưa
lệnh `uniwork-office` vào `PATH`, giúp tập lệnh và trợ lý AI tạo, chuyển đổi và đọc tài liệu mà
không cần mở ứng dụng. Ứng dụng không thêm gì cho đến khi bạn bấm nút.

## Ứng dụng tự làm gì

- **Bản cài deb / rpm.** Liên kết trỏ vào trình khởi chạy của chính gói cài là `/usr/bin/genoffice`,
  đường dẫn này giữ nguyên khi cập nhật. Vì `/usr/bin/uniwork-office` chính là ứng dụng, ứng dụng không
  đặt thêm một lệnh `uniwork-office` khác đứng trước nó trong `PATH`: khi đó phần Tích hợp trong Cài đặt hiển thị
  `genoffice` là lệnh đã sẵn sàng để gõ.
- **Mỗi lần mở ứng dụng.** Ứng dụng xóa các liên kết lệnh do nó tạo trước đây mà đích đã mất (ví dụ sau khi
  gỡ gói), chuyển liên kết đang trỏ vào bản cũ của ứng dụng sang bản hiện tại, và thay liên kết tên
  `genoffice` của các phiên bản cũ bằng `uniwork-office`. Liên kết, tệp hoặc chương trình do ứng dụng
  không tạo thì không bao giờ bị động đến. Trên Linux, ứng dụng cũng xóa dòng `uniwork://` đã cũ trong
  `~/.config/mimeapps.list` khi tệp desktop của ứng dụng không còn.
- **Khi gỡ gói.** Bước gỡ chạy bằng quyền root nên không với tới thư mục cá nhân của bạn; liên kết bạn đã
  thêm có thể còn lại cho đến lần ứng dụng được mở tiếp theo. Liên kết hỏng không gây hại, nó chỉ khiến
  lệnh báo "No such file or directory".

## Dọn thủ công: bạn đã xóa tệp AppImage

Nếu bạn chạy AppImage rồi xóa tệp, ứng dụng không còn để tự dọn. Hãy xóa phần còn lại bằng tay:

```sh
# liên kết lệnh trỏ vào chỗ không còn gì (chỉ xóa những liên kết được báo là hỏng)
ls -l ~/.local/bin/uniwork-office ~/.local/bin/genoffice /usr/local/bin/uniwork-office /usr/local/bin/genoffice 2>/dev/null
rm -f ~/.local/bin/uniwork-office ~/.local/bin/genoffice

# trình xử lý uniwork://: xóa các dòng sau khỏi tệp, nếu có
#   x-scheme-handler/uniwork=...
#   x-scheme-handler/uniwork-office=...
${EDITOR:-nano} ~/.config/mimeapps.list

# tùy chọn: cài đặt và bộ nhớ đệm của ứng dụng
rm -rf "$HOME/.config/UniWork Office"
```

Chỉ xóa một liên kết khi `ls -l` cho thấy đích của nó đã mất hoặc nằm trong thư mục `.mount_…` của
AppImage. Liên kết trỏ vào chương trình còn chạy được là của thứ khác.
