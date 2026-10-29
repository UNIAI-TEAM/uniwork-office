import type { zh } from './zh'

export const vi = {
  aiWebClose: 'Đóng',
  aiWebStateCreditsTitle: 'Đã hết tín dụng AI',
  aiWebStateCreditsBody:
    'Tổ chức của bạn đã dùng hết tín dụng UniWork AI của kỳ này. Hãy liên hệ quản trị viên hoặc chờ kỳ mới.',
  aiWebStateEntitlementTitle: 'Gói không bao gồm AI',
  aiWebStateEntitlementBody:
    'Gói UniWork của tổ chức bạn không bao gồm tính năng AI này. Hãy liên hệ quản trị viên.',
  aiWebStateRateTitle: 'Quá nhiều yêu cầu AI',
  aiWebStateRateBody: 'Hãy chờ {seconds} giây rồi thử lại.',
  aiWebStateRateBodyNow: 'Hãy chờ một lát rồi thử lại.',
  aiWebStateUnreachableTitle: 'Không kết nối được nhà cung cấp AI',
  aiWebStateUnreachableBody:
    'UniWork không kết nối được tới nhà cung cấp AI. Hãy thử lại sau ít phút.',
  aiWebStateCloudTitle: 'Công cụ đám mây chưa sẵn sàng',
  aiWebStateCloudBody: 'Công cụ UniWork AI này chưa được cấu hình trên máy chủ.',
  aiWebStateOutageTitle: 'UniWork tạm thời chưa dùng được',
  aiWebStateOutageBody: 'Hiện chưa kết nối được tới UniWork. Hãy thử lại sau ít phút.',
  aiWebStateSessionTitle: 'Phiên đã hết hạn',
  aiWebStateSessionBody: 'Hãy mở lại tài liệu từ UniWork để tiếp tục.',
  aiWebStateRefusedTitle: 'Yêu cầu bị từ chối',
  aiWebStateRefusedBody: 'Máy chủ đã từ chối yêu cầu AI.',
  aiWebStateUnknownTitle: 'Yêu cầu AI thất bại',
  aiWebStateUnknownBody: 'Đã xảy ra lỗi. Hãy thử lại.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Bảng tính này quá lớn để AI xử lý trên web. Mở bằng ứng dụng UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Tiếp tục phần tiếp theo.',
} satisfies Record<keyof typeof zh, string>
