import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const ja = {
  ...en,
  wbNotif_document_commented_untitled: '{actor} さんがドキュメントにコメントしました',
  wbNotif_document_mentioned:
    '{actor} さんが “{document}” のコメントであなたにメンションしました。',
  wbNotif_document_mentioned_untitled:
    '{actor} さんがドキュメントのコメントであなたにメンションしました。',
  wbNotif_document_body_mentioned: '{actor} さんが “{document}” であなたにメンションしました。',
  wbNotif_document_body_mentioned_untitled:
    '{actor} さんがドキュメントであなたにメンションしました。',
  wbNotif_document_comment_replied:
    '{actor} さんが “{document}” のあなたのコメントに返信しました。',
  wbNotif_document_comment_replied_untitled:
    '{actor} さんがドキュメントのあなたのコメントに返信しました。',
  wbNotif_document_discussion_mentioned:
    '{actor} さんが “{document}” のディスカッションであなたにメンションしました。',
  wbNotif_document_discussion_mentioned_untitled:
    '{actor} さんがドキュメントのディスカッションであなたにメンションしました。',
  wbNotif_document_discussion_replied:
    '{actor} さんが “{document}” のあなたのディスカッション投稿に返信しました。',
  wbNotif_document_discussion_replied_untitled:
    '{actor} さんがドキュメントのあなたのディスカッション投稿に返信しました。',
  wbNotif_document_edit_requested: '{actor} さんが “{document}” の編集を希望しています',
  wbNotif_document_edit_request_answered:
    '{actor} さんが “{document}” の編集権をあなたに渡しました',
  wbNotif_document_edit_request_answered_declined: '{actor} さんが “{document}” をまだ編集中です',
  wbNotif_document_edit_taken_over:
    '{actor} さんが “{document}” の編集を引き継ぎました。未保存の変更は開いているドキュメントに残っています。',
  wbNotif_document_break_glass:
    '{actor} さんが “{document}” への緊急閲覧アクセス（24時間）を開きました。',
  wbNotif_document_break_glass_untitled:
    '{actor} さんがドキュメントへの緊急閲覧アクセス（24時間）を開きました。',
  wbNotif_document_access_requested: '{actor} さんが “{document}” へのアクセスを申請しました。',
  wbNotif_document_access_requested_untitled:
    '{actor} さんがドキュメントへのアクセスを申請しました。',
  wbNotif_document_access_approved:
    '{actor} さんが “{document}” へのアクセス権をあなたに付与しました。',
  wbNotif_document_access_approved_untitled:
    '{actor} さんがドキュメントへのアクセス権をあなたに付与しました。',
  wbNotif_document_access_declined: 'ドキュメントへのアクセス申請は却下されました。',
  wbNotif_document_shared: '{actor} さんが “{document}” をあなたと共有しました（{level}）。',
  wbNotif_document_shared_untitled: '{actor} さんがドキュメントをあなたと共有しました（{level}）。',
  wbNotif_document_shared_nolevel: '{actor} さんが “{document}” をあなたと共有しました。',
  wbNotif_document_shared_untitled_nolevel: '{actor} さんがドキュメントをあなたと共有しました。',
  wbNotif_document_trashed_by_other:
    '{actor} さんがあなたのドキュメントをゴミ箱に移動しました。{date} までに復元してください',
  wbNotif_document_trashed_by_other_untitled:
    '{actor} さんがあなたのドキュメントのひとつをゴミ箱に移動しました。{date} までに復元してください',
  wbNotif_document_trashed_by_other_nodate:
    '{actor} さんがあなたのドキュメントをゴミ箱に移動しました',
  wbNotif_document_trashed_by_other_untitled_nodate:
    '{actor} さんがあなたのドキュメントのひとつをゴミ箱に移動しました',
  wbNotif_chat_call_incoming: '{actor} さんから着信があります',
  wbNotifFallback: '新しい通知',
  wbNotif_audit_export_ready: '監査ログのエクスポートの準備ができました',
  wbNotif_chat_dm: '{actor} さんからメッセージが届きました',
  wbNotif_chat_follow_up: 'メッセージにフォローアップを保存しました',
  wbNotif_chat_mentioned: '{actor} さんが {room} であなたに言及しました',
  wbNotif_chat_reminder: 'リマインダー: {body}',
  wbNotif_chat_thread_replied: '{actor} さんが {room} のスレッドに返信しました',
  wbNotif_document_commented: '{actor} さんが “{document}” にコメントしました',
  wbNotif_email_hub_new_mail: '未読メッセージ: {count} 件 · {mailbox}',
  wbNotif_meeting_invited: '{actor} さんが “{meeting}” にあなたを招待しました',
  wbNotif_meeting_starting: '“{meeting}” まであと {minutes} 分です',
  wbNotif_meeting_summary_reminder: '“{meeting}” が終了しました · 要約してタスクを作成しましょう',
  wbNotif_member_added: '{actor} さんがあなたをワークスペース {workspace} に追加しました',
  wbNotif_mentioned: '{actor} さんが “{task}” であなたに言及しました',
  wbNotif_role_changed: '{actor} さんがあなたの役割を {role} に変更しました',
  wbNotif_task_assigned: '{actor} さんが “{task}” をあなたに割り当てました',
  wbNotif_task_commented: '{actor} さんが “{task}” にコメントしました',
  wbNotif_task_status_changed: '{actor} さんが “{task}” を {status} に移動しました',
  wbDeskPillComment: 'コメント',
  wbDeskPillMention: 'メンション',
  wbDeskPillShared: '新規共有',
  wbDeskPillReply: '返信',
  wbDeskPillEdit: '編集中',
  wbDeskPillAccess: 'アクセス',
  wbDeskPillTrash: 'ゴミ箱',
  wbDeskPillBreakGlass: '緊急',
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
  wbDocChangeMore: '他 {count} 件',
  wbNoticeNoAccess: 'このドキュメントにアクセスする権限がありません。',
  wbTabCountUnread: '未読の通知: {count}',
} satisfies Record<keyof typeof zh, string>
