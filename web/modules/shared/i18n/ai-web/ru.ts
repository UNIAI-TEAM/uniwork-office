import type { zh } from './zh'

export const ru = {
  aiWebClose: 'Закрыть',
  aiWebStateCreditsTitle: 'Кредиты ИИ закончились',
  aiWebStateCreditsBody:
    'Ваша организация израсходовала все кредиты UniWork AI за этот период. Обратитесь к администратору или дождитесь обновления.',
  aiWebStateEntitlementTitle: 'ИИ не входит в тариф',
  aiWebStateEntitlementBody:
    'Тариф UniWork вашей организации не включает эту функцию ИИ. Обратитесь к администратору.',
  aiWebStateRateTitle: 'Слишком много запросов к ИИ',
  aiWebStateRateBody: 'Подождите {seconds} с и повторите попытку.',
  aiWebStateRateBodyNow: 'Подождите немного и повторите попытку.',
  aiWebStateUnreachableTitle: 'Провайдер ИИ недоступен',
  aiWebStateUnreachableBody:
    'UniWork не удалось связаться с провайдером ИИ. Повторите попытку чуть позже.',
  aiWebStateCloudTitle: 'Облачный инструмент недоступен',
  aiWebStateCloudBody: 'Этот инструмент UniWork AI ещё не настроен на сервере.',
  aiWebStateOutageTitle: 'UniWork временно недоступен',
  aiWebStateOutageBody: 'Сейчас не удаётся связаться с UniWork. Повторите попытку чуть позже.',
  aiWebStateSessionTitle: 'Сеанс истёк',
  aiWebStateSessionBody: 'Чтобы продолжить, откройте документ заново из UniWork.',
  aiWebStateRefusedTitle: 'Запрос отклонён',
  aiWebStateRefusedBody: 'Сервер отклонил запрос к ИИ.',
  aiWebStateUnknownTitle: 'Ошибка запроса к ИИ',
  aiWebStateUnknownBody: 'Что-то пошло не так. Повторите попытку.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Эта книга слишком велика для ИИ в веб-версии. Откройте её в приложении UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Продолжай со следующей части.',
} satisfies Record<keyof typeof zh, string>
