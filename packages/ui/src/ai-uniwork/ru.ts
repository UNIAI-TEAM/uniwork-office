import type { zh } from './zh'

export const ru = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Осталось кредитов: {remaining} из {limit}',
  aiUniworkFooterSignIn: 'Войдите в UniWork, чтобы пользоваться UniWork AI',
  aiUniworkSignedOut: 'Вы вышли из UniWork. Выберите другого провайдера или войдите снова.',
  aiUniworkOff: 'UniWork AI отключён для этого документа. Выберите другого провайдера.',
  aiUniworkViewOnly:
    'Только просмотр: ИИ может отвечать, но не может редактировать или сохранять документ.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI читает то, что открыто в этом документе, включая несохранённые изменения, и отправляет это в UniWork и провайдеру модели для ответа. Каждый запуск расходует кредиты ИИ организации {org}. ИИ никогда не сохраняет за вас: проверьте и нажмите «Сохранить».',
  aiUniworkDisclosureLabel: 'Что получает UniWork AI',
  aiUniworkDisclosureShort:
    'Отправляет открытое содержимое (включая несохранённое) в UniWork · кредиты {org}',
  aiUniworkLocalFile:
    'Этот файл находится на вашем компьютере, а не в UniWork. С UniWork AI содержимое открытого файла отправляется в UniWork и расходует кредиты ИИ организации {org}. Файл не загружается как документ UniWork.',
  aiUniworkAck: 'Понятно',
  aiUniworkLearnMore: 'Подробнее',
  aiUniworkDetails: 'Подробнее',
  aiUniworkSendNeedsAck: 'Прочитайте и подтвердите уведомление перед отправкой.',

  // S9 result chips and run controls
  aiResultAnswer: 'Ответ',
  aiResultClarify: 'Нужно уточнение',
  aiResultEdited: 'Изменено в документе',
  aiResultUnsupported: 'Не поддерживается',
  aiResultError: 'Ошибка',
  aiResultEditedHint:
    'Не сохранено — отмените через Ctrl/⌘+Z или нажмите «Сохранить», если всё верно.',
  aiResultViewChanges: 'Показать изменения',
  aiRunStop: 'Стоп',
  aiRunSend: 'Отправить',
  aiRunRunning: 'Выполняется… Нажмите «Стоп» или Esc, чтобы остановить.',
  aiRunStopped: 'Остановлено. Уже применённые изменения остаются в документе, их можно отменить.',
  aiRunAskAgain: 'Спросить снова',
  aiRunChooseOther: 'Выбрать другого провайдера',
  aiRunOpenInApp: 'Открыть в приложении',
  aiConversationRestarted:
    'Предыдущий разговор истёк, поэтому UniWork AI начал новый и не помнит прежние реплики. Отправьте вопрос снова, чтобы продолжить.',
  aiConversationBoundary: 'Новый разговор с {provider}: реплики выше не отправляются.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Этот запуск достиг лимита шагов UniWork AI. Полученные результаты сохранены; разделите запрос и спросите снова.',
  aiErrCredits: 'У вашей организации закончились кредиты ИИ на этот период. Запуск остановлен.',
  aiErrEntitlement: 'Тариф вашей организации больше не включает UniWork AI.',
  aiErrRateLimited: 'Вы отправляете слишком быстро. Повторите через {seconds} с.',
  aiErrRateLimitedNoWait: 'Вы отправляете слишком быстро. Повторите через несколько минут.',
  aiErrUnavailable: 'UniWork AI сейчас не отвечает. Документ и «Сохранить» по-прежнему работают.',
  aiErrDisconnected:
    'Соединение прервалось, поэтому запуск остановлен. Уже применённые изменения остаются в документе, их можно отменить.',
  aiErrOffline:
    'Нет подключения к сети. UniWork AI не работает офлайн, и запросы не ставятся в очередь.',
  aiErrSession: 'Сеанс UniWork истёк, поэтому запуск остановлен. Войдите снова, чтобы продолжить.',
  aiErrRevoked: 'У вас больше нет доступа к этому документу, поэтому запуск ИИ остановлен.',
  aiErrDowngraded:
    'Ваш доступ только что изменился на «только просмотр», поэтому ИИ прекратил редактирование. Ответы продолжаются.',
  aiErrCapabilityOff:
    'UniWork AI только что отключили для этого документа, поэтому запуск остановлен после текущего шага.',
  aiErrUnsupported: 'UniWork AI пока не умеет делать это в {module}.',
  aiErrViewOnlyEdit:
    'У вас есть только доступ на просмотр этого документа, поэтому ИИ не может его редактировать.',
} satisfies Record<keyof typeof zh, string>
