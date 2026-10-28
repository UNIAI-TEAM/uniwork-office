import type { zh } from './zh'

export const ru = {
  backlinks: 'Обратные ссылки',
  backlinksEmpty: 'Ещё ни одна заметка не ссылается сюда.',
  backlinksRefresh: 'Обновить обратные ссылки',
  graph: 'Просмотр графа',
  graphClose: 'Закрыть граф',
  graphEmpty: 'В хранилище ещё нет заметок.',
  graphTruncated: 'Слишком много заметок: на графике показаны первые {shown} из {total}.',
  suggestCreateNote: 'Создать новую заметку',
} satisfies Record<keyof typeof zh, string>
