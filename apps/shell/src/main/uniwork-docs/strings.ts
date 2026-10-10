/**
 * Main-process copy for the UniWork document dialogs (the conflict choice,
 * its discard confirmation, the copy Save As, the close prompt for changes
 * not in UniWork yet). vi and en are reviewed; every
 * other UI language falls back to en.
 */

const en = {
  conflictTitle: 'This document changed in UniWork',
  conflictMessage: 'A newer version of “{title}” was saved in UniWork after you opened it.',
  conflictDetail:
    'Your changes are still on this computer. If you save your version, the other version stays in the document’s version history in UniWork.',
  conflictOverwrite: 'Save my version as the newest version',
  conflictSaveCopy: 'Save a copy on this computer',
  conflictOpenLatest: 'Discard my changes and open the latest',
  conflictLater: 'Decide later',
  discardTitle: 'Discard your changes?',
  discardMessage: 'Your changes to “{title}” will be replaced by the latest version from UniWork.',
  discardDetail: 'This cannot be undone. To keep your changes, save a copy on this computer first.',
  discardConfirm: 'Discard and open the latest',
  discardCancel: 'Cancel',
  copyDialogTitle: 'Save a copy on this computer',
  copySuffix: '(my copy)',
  openLatestFailed: 'Couldn’t open the latest version. Your copy was not changed.',
  copyFailed: 'Couldn’t save the copy there. Choose another folder and try again.',
  closeMessage: 'Changes not saved to UniWork.',
  closeDetail: 'They stay on this computer; open the document again to save them.',
  closeSave: 'Save to UniWork',
  closeAnyway: 'Close anyway',
  closeCancel: 'Cancel',
  closeResolve: 'Resolve…',
  closeConflictDetail:
    'This document changed in UniWork after you opened it. Resolve it to save your version, or close and keep it on this computer.',
  closeBlockedNotFound:
    'The document can’t be found in UniWork, so your changes can’t be saved there. They stay on this computer.',
  closeBlockedDeleted:
    'The document was deleted in UniWork, so your changes can’t be saved there. They stay on this computer.',
  closeBlockedOther:
    'UniWork isn’t accepting this document right now, so your changes can’t be saved there. They stay on this computer.',
}

type Key = keyof typeof en

const vi = {
  conflictTitle: 'Tài liệu đã thay đổi trên UniWork',
  conflictMessage: 'Một phiên bản mới hơn của “{title}” đã được lưu trên UniWork sau khi bạn mở.',
  conflictDetail:
    'Các thay đổi của bạn vẫn còn trên máy này. Nếu bạn lưu phiên bản của mình, phiên bản kia vẫn được giữ trong lịch sử phiên bản của tài liệu trên UniWork.',
  conflictOverwrite: 'Lưu phiên bản của tôi thành phiên bản mới nhất',
  conflictSaveCopy: 'Lưu một bản sao trên máy này',
  conflictOpenLatest: 'Bỏ thay đổi của tôi và mở bản mới nhất',
  conflictLater: 'Để sau',
  discardTitle: 'Bỏ các thay đổi của bạn?',
  discardMessage:
    'Các thay đổi của bạn trong “{title}” sẽ được thay bằng phiên bản mới nhất từ UniWork.',
  discardDetail:
    'Không thể hoàn tác. Nếu muốn giữ các thay đổi, hãy lưu một bản sao trên máy này trước.',
  discardConfirm: 'Bỏ thay đổi và mở bản mới nhất',
  discardCancel: 'Hủy',
  copyDialogTitle: 'Lưu một bản sao trên máy này',
  copySuffix: '(bản của tôi)',
  openLatestFailed: 'Không mở được phiên bản mới nhất. Bản của bạn vẫn giữ nguyên.',
  copyFailed: 'Không lưu được bản sao vào đó. Hãy chọn thư mục khác rồi thử lại.',
  closeMessage: 'Thay đổi chưa được lưu lên UniWork.',
  closeDetail: 'Các thay đổi vẫn còn trên máy này; hãy mở lại tài liệu để lưu chúng.',
  closeSave: 'Lưu lên UniWork',
  closeAnyway: 'Vẫn đóng',
  closeCancel: 'Hủy',
  closeResolve: 'Giải quyết…',
  closeConflictDetail:
    'Tài liệu đã thay đổi trên UniWork sau khi bạn mở. Hãy giải quyết để lưu phiên bản của bạn, hoặc đóng và giữ nó trên máy này.',
  closeBlockedNotFound:
    'Không tìm thấy tài liệu trên UniWork nên không thể lưu thay đổi lên đó. Các thay đổi vẫn còn trên máy này.',
  closeBlockedDeleted:
    'Tài liệu đã bị xóa trên UniWork nên không thể lưu thay đổi lên đó. Các thay đổi vẫn còn trên máy này.',
  closeBlockedOther:
    'UniWork hiện không nhận tài liệu này nên không thể lưu thay đổi lên đó. Các thay đổi vẫn còn trên máy này.',
} satisfies Record<Key, string>

export const UNIWORK_DOC_STRINGS = { en, vi } as const

export function tUniworkDocs(lang: string, key: Key, params: { title?: string } = {}): string {
  const table: Record<Key, string> = lang === 'vi' ? vi : en
  return table[key].replace('{title}', params.title ?? '')
}
