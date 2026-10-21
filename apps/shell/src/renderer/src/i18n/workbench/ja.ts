import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const ja = {
  ...en,
  wbNotif_document_changed: '{actor} さんが {count} 件のドキュメントを変更しました',
  wbNotif_document_changed_renamed_many:
    '{actor} さんが {count} 件のドキュメントの名前を変更しました',
  wbNotif_document_changed_renamed_one: '{actor} さんが “{document}” の名前を変更しました',
  wbNotif_document_changed_renamed_untitled: '{actor} さんがドキュメントの名前を変更しました',
  wbNotif_document_changed_moved_many: '{actor} さんが {count} 件のドキュメントを移動しました',
  wbNotif_document_changed_moved_one: '{actor} さんが “{document}” を移動しました',
  wbNotif_document_changed_moved_untitled: '{actor} さんがドキュメントを移動しました',
  wbNotif_document_changed_trashed_many:
    '{actor} さんが {count} 件のドキュメントをゴミ箱に移動しました',
  wbNotif_document_changed_trashed_one: '{actor} さんが “{document}” をゴミ箱に移動しました',
  wbNotif_document_changed_trashed_untitled: '{actor} さんがドキュメントをゴミ箱に移動しました',
  wbNotif_document_changed_restored_many: '{actor} さんが {count} 件のドキュメントを復元しました',
  wbNotif_document_changed_restored_one: '{actor} さんが “{document}” を復元しました',
  wbNotif_document_changed_restored_untitled: '{actor} さんがドキュメントを復元しました',
  wbNotif_document_changed_deleted_many:
    '{actor} さんが {count} 件のドキュメントを完全に削除しました',
  wbNotif_document_changed_deleted_one: '{actor} さんが “{document}” を完全に削除しました',
  wbNotif_document_changed_deleted_untitled: '{actor} さんがドキュメントを完全に削除しました',
  wbNotif_document_changed_shelved_many:
    '{actor} さんが {count} 件のドキュメントをアーカイブしました',
  wbNotif_document_changed_shelved_one: '{actor} さんが “{document}” をアーカイブしました',
  wbNotif_document_changed_shelved_untitled: '{actor} さんがドキュメントをアーカイブしました',
  wbNotif_document_changed_unshelved_many:
    '{actor} さんが {count} 件のドキュメントのアーカイブを解除しました',
  wbNotif_document_changed_unshelved_one: '{actor} さんが “{document}” のアーカイブを解除しました',
  wbNotif_document_changed_unshelved_untitled:
    '{actor} さんがドキュメントのアーカイブを解除しました',
  wbNotif_document_changed_access_changed_many:
    '{actor} さんが {count} 件のドキュメントのアクセス権を変更しました',
  wbNotif_document_changed_access_changed_one:
    '{actor} さんが “{document}” のアクセス権を変更しました',
  wbNotif_document_changed_access_changed_untitled:
    '{actor} さんがドキュメントのアクセス権を変更しました',
  wbNotif_document_changed_version_created_many:
    '{actor} さんが {count} 件のドキュメントに新しいバージョンを追加しました',
  wbNotif_document_changed_version_created_one:
    '{actor} さんが “{document}” に新しいバージョンを追加しました',
  wbNotif_document_changed_version_created_untitled:
    '{actor} さんがドキュメントに新しいバージョンを追加しました',
  wbNotif_document_changed_relocated_many:
    '{actor} さんがあなたの {count} 件のドキュメントを含むフォルダーをゴミ箱に移動しました。ドキュメントはワークスペースのルートに移されました',
  wbNotif_document_changed_relocated_one:
    '{actor} さんがあなたの “{document}” を含むフォルダーをゴミ箱に移動しました。ドキュメントはワークスペースのルートに移されました',
  wbNotif_document_changed_relocated_untitled:
    '{actor} さんがあなたのドキュメントを含むフォルダーをゴミ箱に移動しました。ドキュメントはワークスペースのルートに移されました',
  wbNotif_document_changed_generic_one: '{actor} さんが “{document}” を変更しました',
  wbNotif_document_changed_generic_untitled: '{actor} さんがドキュメントを変更しました',
  wbNotif_document_comment_resolved: '{actor} さんが “{document}” のコメントを解決済みにしました。',
  wbNotif_document_comment_resolved_untitled: '{actor} さんがコメントを解決済みにしました。',
  wbDeskPillChanged: '変更あり',
  wbDeskPillResolved: '解決済み',
  wbDocChangeTitle: '変更されたドキュメント',
  wbDocChangeLoading: 'ドキュメントを読み込み中',
  wbDocChangeEmptyTitle: '閲覧できるドキュメントはありません',
  wbDocChangeEmptyDesc: 'これらのドキュメントは削除されたか、閲覧権限がなくなりました。',
  wbDocChangeErrorTitle: 'ドキュメントを読み込めませんでした',
  wbDocChangeErrorDesc: '問題が発生しました。もう一度お試しください',
  wbDocChangeLoadMore: 'さらに読み込む',
  wbDocChangeLoadingMore: '読み込み中…',
  wbDocChangeDeleted: '完全に削除済み',
  wbDocChangeInTrash: 'ゴミ箱に移動済み',
  wbDocChangeUntitled: '無題のドキュメント',
  wbDocChangeViewList: '{count} 件のドキュメントを表示',
  wbDocChangeMore: '他 {count} 件',
} satisfies Record<keyof typeof zh, string>
