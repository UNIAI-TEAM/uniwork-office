import type { zh } from './zh'

export const ja = {
  searchMatchCase: '大文字と小文字を区別',
  searchWholeWord: '単語全体',
  commentsPanel: 'コメント',
  commentsFilter: '内容または作成者でコメントを絞り込み',
  commentsEmpty: 'このドキュメントにはまだコメントがありません',
  commentsLoading: 'コメントを読み込み中',
  editLink: 'リンク',
  editLinkHint: 'ページ上をドラッグしてハイパーリンクを追加',
  linkDialogTitle: 'リンクを追加',
  linkUrlLabel: 'ウェブアドレス',
  linkPageLabel: 'または本文書内のページ（1–{n}）',
} satisfies Record<keyof typeof zh, string>
