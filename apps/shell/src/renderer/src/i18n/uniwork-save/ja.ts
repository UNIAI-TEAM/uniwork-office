import type { zh } from './zh'

export const ja = {
  usMyFolder: 'マイフォルダー',
  usPrivateTag: '非公開',
  usDialogTitle: 'ドキュメントに名前を付ける',
  usHint:
    '初回の保存です。以降の保存ではこの名前のままです。変更するには「名前を付けて保存」を使います。',
  usName: '名前',
  usLocation: '保存先',
  usSavingIn: '保存先: {folder}',
  usMyFolderPrivate: '非公開、あなただけが見られます',
  usChange: '変更',
  usSave: '保存',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: '閉じる',
  usPickTitle: '保存先を選択',
  usBack: '名前の入力に戻る',
  usSearchFolders: 'フォルダーを検索',
  usSharedNote: '共有フォルダーに保存すると、ドキュメントにはそのフォルダーの権限が適用されます。',
  usChooseFolder: '「{folder}」を選択',
  usSelected: '選択中',
  usRootBlocked: 'フォルダーを選んでください',
  usErrInvalidDestination: 'ここには保存できません。別のフォルダーを選んでください。',
  usErrMyFolderLocked:
    'マイフォルダーは個人用のシステムフォルダーのため、名前の変更、共有、移動、アーカイブはできません。',
  usErrFlushFailed:
    'ドキュメントをまだこの端末に書き込めていません。先にドキュメントを保存してから、もう一度お試しください。',
  usErrBindFailed:
    '「{title}」（ID {id}）を作成しましたが、このタブに関連付けられませんでした。ドキュメントはごみ箱に移動したため、復元できます。',
  usErrOrphaned:
    'UniWork に「{title}」（ID {id}）を作成しましたが、このタブに関連付けられず、ごみ箱にも移動できませんでした。UniWork でそのドキュメントを削除するか使用してください。',
  usErrAlreadyBound:
    'このタブはすでに UniWork のドキュメントに関連付けられています。通常どおり保存してください。',
  usErrNotFound:
    '保存するファイルまたは選択したフォルダーが見つかりません。保存先を選び直してから、もう一度お試しください。',
} satisfies Record<keyof typeof zh, string>
