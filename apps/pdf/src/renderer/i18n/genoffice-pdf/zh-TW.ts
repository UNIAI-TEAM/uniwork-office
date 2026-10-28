import type { zh } from './zh'

export const zhTW = {
  searchMatchCase: '區分大小寫',
  searchWholeWord: '完整字詞',
  commentsPanel: '註解',
  commentsFilter: '依內容或作者篩選註解',
  commentsEmpty: '本文件還沒有註解',
  commentsLoading: '正在載入註解',
  editLink: '連結',
  editLinkHint: '在頁面上拖曳方框新增超連結',
  linkDialogTitle: '新增連結',
  linkUrlLabel: '網址',
  linkPageLabel: '或本文件中的頁（1–{n}）',
} satisfies Record<keyof typeof zh, string>
