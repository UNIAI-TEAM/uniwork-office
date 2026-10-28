import type { zh } from './zh'

export const ja = {
  backlinks: 'バックリンク',
  backlinksEmpty: 'まだどのノートもリンクしていません。',
  backlinksRefresh: 'バックリンクを更新',
  graph: 'グラフビュー',
  graphClose: 'グラフを閉じる',
  graphEmpty: 'ボールトにノートがまだありません。',
  graphTruncated: 'ノートが多すぎます。グラフには先頭 {shown} / {total} 件のみ表示しています。',
  suggestCreateNote: '新規ノートを作成',
  tags: 'タグ',
  tagsEmpty: 'ボールトに #タグはまだありません',
  blockLink: 'ブロックへのリンクをコピー',
  blockLinkCopied: '{link} をコピーしました',
  blockLinkNone: 'ここにリンクできるブロックはありません',
  insertFootnote: '脚注',
  statusWords: '{n} 語',
  statusChars: '{n} 文字',
  highlight: 'ハイライト',
} satisfies Record<keyof typeof zh, string>
