import type { zh } from './zh'

export const ko = {
  searchMatchCase: '대/소문자 구분',
  searchWholeWord: '단어 단위',
  commentsPanel: '댓글',
  commentsFilter: '내용 또는 작성자로 댓글 필터',
  commentsEmpty: '이 문서에는 아직 댓글이 없습니다',
  commentsLoading: '댓글 불러오는 중',
  editLink: '링크',
  editLinkHint: '페이지에서 상자를 드래그하여 하이퍼링크 추가',
  linkDialogTitle: '링크 추가',
  linkUrlLabel: '웹 주소',
  linkPageLabel: '또는 이 문서의 페이지(1–{n})',
} satisfies Record<keyof typeof zh, string>
