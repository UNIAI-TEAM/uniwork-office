import type { zh } from './zh'

export const ru = {
  collabMentionLabel: 'Упомянуть пользователя',
  collabMentionSearching: 'Поиск…',
  collabMentionCount: 'Результаты: {count}',
  collabMentionNoMatch:
    'Среди тех, у кого есть доступ к этому документу, нет совпадений с «{query}».',
  collabMentionNoCandidates: 'Пока ни у кого больше нет доступа к этому документу.',
  collabMentionError: 'Не удалось загрузить список людей.',
} satisfies Record<keyof typeof zh, string>
