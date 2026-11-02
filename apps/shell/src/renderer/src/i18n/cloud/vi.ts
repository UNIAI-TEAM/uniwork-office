import type { zh } from './zh'

export const vi = {
  cloudTitle: 'AI đám mây UniWork',
  cloudStateReady: 'Sẵn sàng',
  cloudStateNotEntitled: 'Gói hiện tại chưa bao gồm',
  cloudStateExhausted: 'Đã hết tín dụng AI',
  cloudStateUnavailable: 'Tạm thời không dùng được',
  cloudStateInactive: 'Gói đăng ký không hoạt động',
  cloudCredits: 'Tín dụng AI',
  cloudCreditsLeft: 'Còn {remaining} / {limit}',
  cloudCreditsUnlimited: 'Không giới hạn',
  cloudCreditsRenews: 'Làm mới vào {date}',
  cloudToolsToggle: 'Dùng công cụ đám mây UniWork',
  cloudToolsToggleDesc:
    'Tìm kiếm web, tạo ảnh và phân tích media sẽ chạy qua đám mây UniWork (trừ tín dụng AI).',
} satisfies Record<keyof typeof zh, string>
