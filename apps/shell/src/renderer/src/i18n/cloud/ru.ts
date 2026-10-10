import type { zh } from './zh'

export const ru = {
  cloudTitle: 'Облачный ИИ UniWork',
  cloudStateReady: 'Доступен',
  cloudStateNotEntitled: 'Не входит в ваш тариф',
  cloudStateExhausted: 'Кредиты ИИ закончились',
  cloudStateUnavailable: 'Недоступен',
  cloudStateSignedOut: 'Вход не выполнен',
  cloudStateInactive: 'Подписка неактивна',
  cloudCredits: 'Кредиты ИИ',
  cloudCreditsLeft: 'Осталось {remaining} / {limit}',
  cloudCreditsUnlimited: 'Без ограничений',
  cloudCreditsRenews: 'Обновится {date}',
  cloudSignedOutBody:
    'Войдите в UniWork, чтобы пользоваться веб-поиском, генерацией изображений и анализом медиа за счёт кредитов ИИ вашей организации.',
  cloudNotEntitledBody:
    'Тариф вашей организации не включает облачный ИИ UniWork. Ваши собственные провайдеры ниже по-прежнему доступны.',
  cloudExhaustedBody:
    'Ваша организация израсходовала все кредиты ИИ UniWork за этот период. Облачные инструменты приостановлены до обновления; ваши провайдеры ниже продолжают работать.',
  cloudUnavailableBody:
    'Облачный ИИ UniWork сейчас недоступен. Ваши провайдеры ниже продолжают работать.',
  cloudInactiveBody:
    'Подписка UniWork вашей организации неактивна, поэтому облачный ИИ приостановлен. Попросите администратора продлить её; ваши собственные провайдеры ниже продолжают работать.',
  cloudToolsOffBody:
    'Облачные инструменты UniWork выключены. Включите «{switch}» в разделе «{section}», чтобы использовать ИИ-кредиты организации; ваши собственные провайдеры ниже не затронуты.',
  cloudReadyBody:
    'Без собственного провайдера поиск, генерация изображений и анализ медиа используют кредиты ИИ UniWork вашей организации.',
  cloudToolsToggle: 'Использовать облачные инструменты UniWork',
  cloudToolsToggleDesc:
    'Без собственного провайдера веб-поиск, генерация изображений и анализ медиа идут через облако UniWork (расходует кредиты ИИ).',
  cloudMediaLabel: 'Облако UniWork',
  cloudMediaDesc: 'Использует кредиты ИИ UniWork вашей организации; ключ не нужен.',
  cloudSearchAutoHint: 'Сначала облако UniWork (расходует кредиты ИИ), затем бесплатный поиск.',
} satisfies Record<keyof typeof zh, string>
