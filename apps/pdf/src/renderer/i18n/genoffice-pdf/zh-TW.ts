import type { zh } from './zh'

export const zhTW = {
  searchMatchCase: '區分大小寫',
  searchWholeWord: '完整字詞',
  commentsPanel: '註解',
  commentsFilter: '依內容或作者篩選註解',
  commentsEmpty: '本文件還沒有註解',
  commentsLoading: '正在載入註解',
} satisfies Record<keyof typeof zh, string>
