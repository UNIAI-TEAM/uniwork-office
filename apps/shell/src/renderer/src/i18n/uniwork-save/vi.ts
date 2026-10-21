import type { zh } from './zh'

export const vi = {
  usMyFolder: 'Thư mục của tôi',
  usPrivateTag: 'Riêng tư',
  usDialogTitle: 'Đặt tên tài liệu',
  usHint: 'Lần lưu đầu tiên. Các lần lưu sau giữ nguyên tên; dùng “Lưu thành” nếu muốn đổi.',
  usName: 'Tên',
  usLocation: 'Nơi lưu',
  usSavingIn: 'Đang lưu trong: {folder}',
  usMyFolderPrivate: 'Riêng tư, chỉ bạn thấy',
  usChange: 'Đổi',
  usSave: 'Lưu',
  usFirstTitle: 'Đặt tên tài liệu',
  usFirstHint: 'Bạn có thể đổi tên hoặc di chuyển sau.',
  usClose: 'Đóng',
  usPickTitle: 'Chọn nơi lưu',
  usBack: 'Quay lại đặt tên',
  usSearchFolders: 'Tìm thư mục',
  usChooseFolder: 'Chọn “{folder}”',
  usSelected: 'Đang chọn',
  usRootBlocked: 'Hãy chọn một thư mục',
  usErrInvalidDestination: 'Không lưu được vào nơi này. Hãy chọn thư mục khác.',
  usErrMyFolderLocked:
    'Thư mục của tôi là thư mục hệ thống cá nhân và không thể đổi tên, chia sẻ, di chuyển hoặc chuyển vào thùng rác.',
  usErrFlushFailed: 'Chưa ghi được tài liệu xuống máy. Hãy lưu tài liệu trước rồi thử lại.',
  usErrBindFailed:
    'Đã tạo “{title}” (mã {id}) nhưng không gắn được vào thẻ này. Tài liệu đã được chuyển vào thùng rác và có thể khôi phục.',
  usErrOrphaned:
    'Đã tạo “{title}” (mã {id}) trên UniWork nhưng không gắn được vào thẻ này và cũng không chuyển được vào thùng rác. Hãy xóa hoặc dùng tài liệu đó trên UniWork.',
  usErrAlreadyBound: 'Thẻ này đã gắn với một tài liệu UniWork. Hãy lưu như bình thường.',
  usErrNotFound:
    'Không tìm thấy tệp cần lưu hoặc thư mục đã chọn. Hãy chọn lại nơi lưu rồi thử lại.',
  usShareToggle: 'Chia sẻ với workspace',
  usShareHint: 'Mọi người trong workspace có thể xem tài liệu này',
  usShareAlready: 'Đã chia sẻ với workspace',
  usShareFailed: 'Không chia sẻ được. Kiểm tra lại đối tượng và mức quyền.',
} satisfies Record<keyof typeof zh, string>
