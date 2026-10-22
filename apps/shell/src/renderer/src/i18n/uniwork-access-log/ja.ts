import type { zh } from './zh'

export const ja = {
  algMenu: 'アクセスログ',
  algTitle: 'アクセスログ',
  algDescription:
    '誰がドキュメントを閲覧・ダウンロードしたか、またはリンク経由で開いたかを表示します。管理者のみ閲覧できます。',
  algManageOnly: 'アクセスログを表示するには管理権限が必要です。',
  algLoading: 'ログを読み込んでいます…',
  algError: 'アクセスログを読み込めませんでした。',
  algEmpty: 'アクセスの記録はまだありません。',
  algFilterLabel: '操作',
  algFilterAll: 'すべての操作',
  algActionView: '閲覧',
  algActionDownload: 'ダウンロード',
  algActionExport: 'エクスポート',
  algActionLinkView: 'リンク経由で開いた',
  algActionUnknown: 'その他',
  algActorAnonymous: '匿名',
  algActorSystem: 'システム',
  algActorUnknown: '不明',
  algVersion: 'バージョン {no}',
} satisfies Record<keyof typeof zh, string>
