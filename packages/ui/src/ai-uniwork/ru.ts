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
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Запрос слишком длинный для UniWork AI. Сократите его до 8 000 символов и отправьте снова.',
  aiErrQuestionRejected: 'UniWork AI не может принять этот запрос. Измените его и отправьте снова.',
  aiUniworkImagesNotSent: 'Изображения не отправляются в UniWork AI; отправлен только ваш текст.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
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
  cloudInactiveBody:
    'Подписка UniWork вашей организации неактивна, поэтому облачный ИИ приостановлен. Попросите администратора продлить её; ваши собственные провайдеры ниже продолжают работать.',
  acctSignIn: 'Войти',
  acctSignInAgain: 'Войти снова',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Локальные файлы начинают новый диалог в вашей организации и не сохраняют реплики из других файлов.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta:
    'Записано ячеек: {written} ({range}) · Перезаписано существующих ячеек: {overwritten}',
  aiErrWorkbookTooLarge:
    'Эта книга слишком велика для ИИ в веб-версии. Откройте её в приложении UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'Тариф вашей организации не включает UniWork AI. Обратитесь к администратору организации по поводу тарифа или добавьте собственный ключ ИИ в меню Настройки > Модель ИИ.',
  credits_exhausted:
    'Ваша организация израсходовала все кредиты ИИ за этот период. Попросите администратора организации пополнить кредиты или добавьте собственный ключ ИИ в меню Настройки > Модель ИИ.',
} satisfies Record<keyof typeof zh, string>
