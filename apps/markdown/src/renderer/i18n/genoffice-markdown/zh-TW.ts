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
} satisfies Record<keyof typeof zh, string>
