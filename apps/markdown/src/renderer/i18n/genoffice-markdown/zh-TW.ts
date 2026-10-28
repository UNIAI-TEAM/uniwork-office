import type { zh } from './zh'

export const zhTW = {
  backlinks: '反向連結',
  backlinksEmpty: '還沒有筆記連結到這裡。',
  backlinksRefresh: '重新整理反向連結',
  graph: '關係圖譜',
  graphClose: '關閉圖譜',
  graphEmpty: '庫中還沒有筆記。',
  graphTruncated: '筆記太多，圖譜只畫出了前 {shown} / {total} 篇。',
  suggestCreateNote: '新增筆記',
  tags: '標籤',
  tagsEmpty: '知識庫裡還沒有 #標籤',
  blockLink: '複製區塊連結',
  blockLinkCopied: '已複製 {link}',
  blockLinkNone: '此處沒有可連結的區塊',
  insertFootnote: '腳注',
  statusWords: '{n} 個字',
  statusChars: '{n} 個字元',
  highlight: '高亮',
} satisfies Record<keyof typeof zh, string>
