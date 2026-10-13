import type { zh } from './zh'

export const ja = {
  collabMentionLabel: '誰かにメンション',
  collabMentionSearching: '検索中…',
  collabMentionCount: '結果：{count}',
  collabMentionNoMatch:
    'このドキュメントにアクセスできる人の中に「{query}」に一致する人はいません。',
  collabMentionNoCandidates: 'このドキュメントにアクセスできる他のユーザーはまだいません。',
  collabMentionError: 'ユーザー一覧を読み込めませんでした。',
} satisfies Record<keyof typeof zh, string>
