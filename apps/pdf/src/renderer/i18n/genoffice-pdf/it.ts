import type { zh } from './zh'

export const it = {
  searchMatchCase: 'Maiuscole/minuscole',
  searchWholeWord: 'Parola intera',
  commentsPanel: 'Комментарии',
  commentsFilter: 'Фильтровать комментарии по тексту или автору',
  commentsEmpty: 'В этом документе пока нет комментариев',
  commentsLoading: 'Загрузка комментариев',
} satisfies Record<keyof typeof zh, string>
