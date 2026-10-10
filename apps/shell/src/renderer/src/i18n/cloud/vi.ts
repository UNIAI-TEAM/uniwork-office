import type { zh } from './zh'

export const vi = {
  cloudTitle: 'AI đám mây UniWork',
  cloudStateReady: 'Sẵn sàng',
  cloudStateNotEntitled: 'Gói hiện tại chưa bao gồm',
  cloudStateExhausted: 'Đã hết tín dụng AI',
  cloudStateUnavailable: 'Tạm thời không dùng được',
  cloudStateSignedOut: 'Chưa đăng nhập',
  cloudStateInactive: 'Gói đăng ký không hoạt động',
  cloudCredits: 'Tín dụng AI',
  cloudCreditsLeft: 'Còn {remaining} / {limit}',
  cloudCreditsUnlimited: 'Không giới hạn',
  cloudCreditsRenews: 'Làm mới vào {date}',
  cloudSignedOutBody:
    'Đăng nhập UniWork để dùng tìm kiếm web, tạo ảnh và phân tích media bằng tín dụng AI của tổ chức.',
  cloudNotEntitledBody:
    'Gói của tổ chức bạn chưa bao gồm AI đám mây UniWork. Bạn vẫn có thể dùng nhà cung cấp riêng bên dưới.',
  cloudExhaustedBody:
    'Tổ chức của bạn đã dùng hết tín dụng AI UniWork trong kỳ này. Công cụ đám mây tạm dừng đến khi tín dụng được làm mới; nhà cung cấp riêng bên dưới vẫn hoạt động.',
  cloudUnavailableBody:
    'AI đám mây UniWork hiện không dùng được. Nhà cung cấp riêng bên dưới vẫn hoạt động.',
  cloudInactiveBody:
    'Gói đăng ký UniWork của tổ chức bạn không hoạt động nên AI đám mây đang tạm dừng. Hãy nhờ quản trị viên gia hạn; nhà cung cấp riêng bên dưới vẫn hoạt động.',
  cloudToolsOffBody:
    'Công cụ đám mây UniWork đang tắt. Bật “{switch}” trong {section} để dùng tín dụng AI của tổ chức; nhà cung cấp riêng bên dưới không bị ảnh hưởng.',
  cloudReadyBody:
    'Khi chưa có nhà cung cấp riêng, tìm kiếm, tạo ảnh và phân tích media sẽ dùng tín dụng AI UniWork của tổ chức.',
  cloudToolsToggle: 'Dùng công cụ đám mây UniWork',
  cloudToolsToggleDesc:
    'Khi chưa có nhà cung cấp riêng, tìm kiếm web, tạo ảnh và phân tích media sẽ chạy qua đám mây UniWork (trừ tín dụng AI).',
  cloudMediaLabel: 'Đám mây UniWork',
  cloudMediaDesc: 'Dùng tín dụng AI UniWork của tổ chức, không cần khóa API.',
  cloudSearchAutoHint: 'Ưu tiên đám mây UniWork (trừ tín dụng AI), sau đó đến tìm kiếm miễn phí.',
} satisfies Record<keyof typeof zh, string>
