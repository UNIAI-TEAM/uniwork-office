import type { zh } from './zh'

export const ko = {
  searchMatchCase: '대/소문자 구분',
  searchWholeWord: '단어 단위',
  commentsPanel: '댓글',
  commentsFilter: '내용 또는 작성자로 댓글 필터',
  commentsEmpty: '이 문서에는 아직 댓글이 없습니다',
  commentsLoading: '댓글 불러오는 중',
} satisfies Record<keyof typeof zh, string>
