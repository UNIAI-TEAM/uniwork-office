import type { zh } from './zh'

export const vi = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Còn {remaining} / {limit}',
  aiUniworkFooterSignIn: 'Đăng nhập UniWork để dùng UniWork AI',
  aiUniworkSignedOut: 'Phiên UniWork đã đăng xuất. Chọn nhà cung cấp khác hoặc đăng nhập lại.',
  aiUniworkOff: 'UniWork AI đang tắt cho tài liệu này. Chọn nhà cung cấp khác.',
  aiUniworkViewOnly: 'Chế độ chỉ xem: AI trả lời được nhưng không sửa hoặc lưu tài liệu.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI đọc nội dung đang mở trong tài liệu này, kể cả phần chưa lưu, và gửi tới UniWork cùng nhà cung cấp mô hình để trả lời. Mỗi lượt dùng tín dụng AI của {org}. AI không tự lưu: bạn xem lại rồi bấm Lưu.',
  aiUniworkDisclosureLabel: 'Nội dung gửi tới UniWork AI',
  aiUniworkDisclosureShort:
    'Gửi nội dung đang mở (kể cả chưa lưu) tới UniWork · tín dụng của {org}',
  aiUniworkLocalFile:
    'Tệp này nằm trên máy bạn, chưa ở UniWork. Khi dùng UniWork AI, nội dung tệp đang mở được gửi tới UniWork và dùng tín dụng AI của {org}. Tệp không được tải lên thành tài liệu UniWork.',
  aiUniworkAck: 'Đã hiểu',
  aiUniworkLearnMore: 'Tìm hiểu thêm',
  aiUniworkDetails: 'Chi tiết',
  aiUniworkSendNeedsAck: 'Hãy đọc và xác nhận lời công bố trước khi gửi.',

  // S9 result chips and run controls
  aiResultAnswer: 'Trả lời',
  aiResultClarify: 'Cần làm rõ',
  aiResultEdited: 'Đã sửa trong tài liệu',
  aiResultUnsupported: 'Chưa hỗ trợ',
  aiResultError: 'Lỗi',
  aiResultEditedHint: 'Chưa lưu — hoàn tác bằng Ctrl/⌘+Z hoặc bấm Lưu khi đã ổn.',
  aiResultViewChanges: 'Xem thay đổi',
  aiRunStop: 'Dừng',
  aiRunSend: 'Gửi',
  aiRunRunning: 'Đang chạy… Bấm Dừng hoặc Esc để dừng.',
  aiRunStopped: 'Đã dừng. Thay đổi đã áp dụng (nếu có) vẫn trong tài liệu và hoàn tác được.',
  aiRunAskAgain: 'Hỏi tiếp',
  aiRunChooseOther: 'Chọn nhà cung cấp khác',
  aiRunOpenInApp: 'Mở bằng ứng dụng',
  aiConversationRestarted:
    'Cuộc trò chuyện trước đã hết hạn nên UniWork AI bắt đầu cuộc mới và không còn nhớ các lượt trước. Gửi lại câu hỏi để tiếp tục.',
  aiConversationBoundary:
    'Cuộc trò chuyện mới với {provider}: các lượt phía trên không được gửi kèm.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Lượt này đã chạm giới hạn số bước của UniWork AI. Kết quả tới đây vẫn được giữ; hãy chia nhỏ yêu cầu rồi hỏi tiếp.',
  aiErrCredits: 'Tổ chức đã dùng hết tín dụng AI kỳ này. Lượt này đã dừng.',
  aiErrEntitlement: 'Gói của tổ chức không còn bao gồm UniWork AI.',
  aiErrRateLimited: 'Bạn đang gửi quá nhanh. Thử lại sau {seconds} giây.',
  aiErrRateLimitedNoWait: 'Bạn đang gửi quá nhanh. Hãy thử lại sau ít phút.',
  aiErrUnavailable: 'UniWork AI tạm thời không phản hồi. Tài liệu và nút Lưu vẫn dùng bình thường.',
  aiErrGeneric:
    'UniWork AI gặp sự cố ngoài dự kiến nên lượt này đã dừng. Tài liệu và nút Lưu vẫn dùng bình thường.',
  aiErrDisconnected:
    'Mất kết nối giữa chừng nên lượt này đã dừng. Thay đổi đã áp dụng (nếu có) vẫn trong tài liệu và hoàn tác được.',
  aiErrOffline: 'Không có mạng. UniWork AI không chạy khi offline và yêu cầu không được xếp hàng.',
  aiErrSession:
    'Phiên đăng nhập UniWork đã hết hạn nên lượt này đã dừng. Đăng nhập lại để tiếp tục.',
  aiErrRevoked: 'Bạn không còn quyền với tài liệu này nên lượt AI đã dừng.',
  aiErrDowngraded:
    'Quyền của bạn vừa đổi thành chỉ xem nên AI ngừng sửa tài liệu. Câu trả lời vẫn tiếp tục.',
  aiErrCapabilityOff:
    'UniWork AI vừa được tắt cho tài liệu này nên lượt đã dừng sau bước hiện tại.',
  aiErrUnsupported: 'UniWork AI chưa làm được thao tác này trong {module}.',
  aiErrViewOnlyEdit: 'Bạn chỉ có quyền xem tài liệu này nên AI không sửa được.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong: 'Yêu cầu quá dài với UniWork AI. Hãy rút gọn dưới 8.000 ký tự rồi gửi lại.',
  aiErrQuestionRejected: 'UniWork AI không nhận được yêu cầu này. Hãy sửa lại yêu cầu rồi gửi lại.',
  aiUniworkImagesNotSent: 'UniWork AI không nhận ảnh; chỉ phần chữ đã được gửi.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
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
  cloudInactiveBody:
    'Gói đăng ký UniWork của tổ chức bạn không hoạt động nên AI đám mây đang tạm dừng. Hãy nhờ quản trị viên gia hạn; nhà cung cấp riêng bên dưới vẫn hoạt động.',
  acctSignIn: 'Đăng nhập',
  acctSignInAgain: 'Đăng nhập lại',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Tệp trên máy bắt đầu cuộc trò chuyện mới theo tổ chức của bạn và không giữ các lượt từ tệp khác.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: 'Đã ghi {written} ô ({range}) · {overwritten} ô có sẵn bị ghi đè',
  aiErrWorkbookTooLarge:
    'Bảng tính này quá lớn để AI xử lý trên web. Mở bằng ứng dụng UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'Gói của tổ chức bạn chưa bao gồm UniWork AI. Hãy liên hệ quản trị viên tổ chức về gói, hoặc thêm khóa AI của riêng bạn trong Cài đặt > Mô hình AI.',
  credits_exhausted:
    'Tổ chức của bạn đã dùng hết tín dụng AI trong kỳ này. Hãy nhờ quản trị viên tổ chức bổ sung, hoặc thêm khóa AI của riêng bạn trong Cài đặt > Mô hình AI.',
} satisfies Record<keyof typeof zh, string>
