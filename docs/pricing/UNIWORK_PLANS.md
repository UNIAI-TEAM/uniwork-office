# UniWork — gói bán desktop (Personal / Pro / Team)

Mô hình: **cài trên máy người dùng** + tài khoản UniWork.  
PWA uniAI / dữ liệu local trên thiết bị **không phải SKU chính**; hàng bán chính là **UniWork Office desktop + (tuỳ gói) Bridge cloud + AI Token Hub**.

Giá dưới đây là **đề xuất go-to-market** (có thể chỉnh trước khi public billing).

## Tóm tắt giá

| Gói | USD / tháng | USD / năm | VND / tháng | VND / năm | Máy | AI token / tháng |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Free** | $0 | $0 | 0đ | 0đ | 1 | 10 000 |
| **Personal** | $9.99 | $79 | 249 000đ | 1 990 000đ | 2 | 50 000 |
| **Pro** | $19.99 | $159 | 499 000đ | 3 990 000đ | 3 | 200 000 |
| **Team** | $12 / seat | $99 / seat | 299 000đ / seat | 2 490 000đ / seat | 2 / seat | 50 000 / seat |

- Thanh toán năm = khoảng **~2 tháng miễn phí** so với tháng.  
- Team: tối thiểu **3 seat**, hóa đơn theo workspace/tenant.  
- Token vượt gói: mua thêm qua **Token Hub** (không gộp unlimited vào giá cố định).

## Ma trận quyền

| Quyền | Free | Personal | Pro | Team |
| --- | :---: | :---: | :---: | :---: |
| Cài UniWork Office (Docs / Sheets / Slides / PDF / MD / HTML) | ✓ | ✓ | ✓ | ✓ |
| Sửa file **local** trên máy | ✓ | ✓ | ✓ | ✓ |
| Workbench local (tasks, health, pets…) | ✓ | ✓ | ✓ | ✓ |
| PWA uniAI (chat local trên thiết bị) | ✓ | ✓ | ✓ | ✓ |
| Số thiết bị đăng nhập đồng thời | 1 | 2 | 3 | 2 / seat |
| Mở app qua `uniwork://office/app` | ✓ | ✓ | ✓ | ✓ |
| **Office Bridge** mở/lưu Work Product cloud | — | ✓ | ✓ | ✓ |
| Lịch sử phiên bản cloud / Save to UniWork | — | cơ bản | đầy đủ | đầy đủ + audit |
| uniAI / Token Hub (quota bảng trên) | ✓ | ✓ | ✓ | ✓ |
| Ưu tiên cập nhật & hỗ trợ | cộng đồng | email | ưu tiên | ưu tiên + admin |
| Admin tenant, ghế user, quyền file | — | — | — | ✓ |
| SSO / policy Enterprise | — | — | — | phase sau |

## Thông điệp bán (dùng cho Pricing / Settings)

> Cài UniWork trên máy để soạn Docs/Sheets/Slides thật. PWA là trợ lý và cửa mở file — dữ liệu local ở máy bạn; file công ty vào UniWork khi bạn chọn (gói Personal trở lên).

## Gợi ý triển khai sản phẩm

1. Catalog nguồn sự thật: `apps/uniai-pwa/plans.js` (PWA Settings) + `license-entitlements.ts` (desktop).  
2. Quản lý license / thiết bị: xem `LICENSE_ENTITLEMENTS.md`.  
2b. Thanh toán VietQR: xem `VIETQR_PAYMENT.md`.  
3. Free mặc định khi chưa đăng nhập / chưa thanh toán.  
4. Bridge API từ chối save cloud nếu plan &lt; Personal (server enforce; client chỉ hiển thị).

## Chưa làm trong phase này

- Stripe / cổng VN  
- SSO Enterprise  
- Perpetual license (có thể thêm: giá ≈ 2× năm Personal + 1 năm update)
