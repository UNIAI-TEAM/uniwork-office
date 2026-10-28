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
  tags: 'Метки',
  tagsEmpty: 'В хранилище пока нет #меток',
  blockLink: 'Скопировать ссылку на блок',
  blockLinkCopied: 'Скопировано: {link}',
  blockLinkNone: 'Здесь нет блока для ссылки',
  insertFootnote: 'Сноска',
  statusWords: '{n} слов',
  statusChars: '{n} символов',
  highlight: 'Выделить',
} satisfies Record<keyof typeof zh, string>
