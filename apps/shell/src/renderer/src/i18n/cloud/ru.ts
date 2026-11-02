import type { zh } from './zh'

export const ru = {
  cloudTitle: 'Облачный ИИ UniWork',
  cloudStateReady: 'Доступен',
  cloudStateNotEntitled: 'Не входит в ваш тариф',
  cloudStateExhausted: 'Кредиты ИИ закончились',
  cloudStateUnavailable: 'Недоступен',
  cloudStateInactive: 'Подписка неактивна',
  cloudCredits: 'Кредиты ИИ',
  cloudCreditsLeft: 'Осталось {remaining} / {limit}',
  cloudCreditsUnlimited: 'Без ограничений',
  cloudCreditsRenews: 'Обновится {date}',
  cloudToolsToggle: 'Использовать облачные инструменты UniWork',
  cloudToolsToggleDesc:
    'Веб-поиск, генерация изображений и анализ медиа идут через облако UniWork (расходует кредиты ИИ).',
} satisfies Record<keyof typeof zh, string>
