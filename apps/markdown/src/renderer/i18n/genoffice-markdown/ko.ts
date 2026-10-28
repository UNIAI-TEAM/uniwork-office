import type { zh } from './zh'

export const ko = {
  backlinks: '백링크',
  backlinksEmpty: '아직 링크한 노트가 없습니다.',
  backlinksRefresh: '백링크 새로고침',
  graph: '그래프 보기',
  graphClose: '그래프 닫기',
  graphEmpty: '볼트에 아직 노트가 없습니다.',
  graphTruncated: '노트가 너무 많아 그래프에 앞의 {shown} / {total}개만 표시됩니다.',
} satisfies Record<keyof typeof zh, string>
