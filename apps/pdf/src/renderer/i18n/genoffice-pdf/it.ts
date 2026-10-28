import type { zh } from './zh'

export const it = {
  searchMatchCase: 'Maiuscole/minuscole',
  searchWholeWord: 'Parola intera',
  commentsPanel: 'Комментарии',
  commentsFilter: 'Фильтровать комментарии по тексту или автору',
  commentsEmpty: 'В этом документе пока нет комментариев',
  commentsLoading: 'Загрузка комментариев',
  editLink: 'Ссылка',
  editLinkHint: 'Выделите рамку на странице, чтобы добавить гиперссылку',
  linkDialogTitle: 'Добавить ссылку',
  linkUrlLabel: 'Веб-адрес',
  linkPageLabel: 'Или страница в этом документе (1–{n})',
} satisfies Record<keyof typeof zh, string>
