import type { zh } from './zh'

export const ko = {
  collabMentionLabel: '누군가 멘션하기',
  collabMentionSearching: '검색 중…',
  collabMentionCount: '결과: {count}',
  collabMentionNoMatch:
    '이 문서에 접근할 수 있는 사람 중 “{query}”와(과) 일치하는 사람이 없습니다.',
  collabMentionNoCandidates: '이 문서에 접근할 수 있는 다른 사람이 아직 없습니다.',
  collabMentionError: '사람 목록을 불러오지 못했습니다.',
  collabMentionNoAccessBadge: '볼 수 없음',
} satisfies Record<keyof typeof zh, string>
