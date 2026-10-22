import type { zh } from './zh'

export const ru = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI думает…',
  askUniYou: 'Вы',
  askUniUni: 'UNI',
  askUniSources: 'Источники',
  askUniKindDocument: 'Документ',
  askUniKindTask: 'Задача',
  askUniKindMeeting: 'Встреча',
  askUniKindChat: 'Чат',
  askUniKindMember: 'Участник',
  askUniKindOther: 'Другое',
  askUniOpenDocument: 'Открыть документ',
  askUniOpenBrowser: 'Открыть в браузере',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'Не удалось открыть источник. Повторите попытку или откройте его в веб-версии.',
  askUniErrForbidden: 'У вас нет доступа к этим данным.',
  askUniErrQuota: 'Организация израсходовала лимит ИИ-токенов на этот месяц.',
  askUniErrRateLimited: 'Вы спрашиваете слишком быстро; повторите через минуту.',
  askUniErrRateLimitedIn: 'Вы спрашиваете слишком быстро; повторите через {seconds} с.',
  askUniErrDisabled: 'ИИ не настроен на этом сервере.',
  askUniErrOffline:
    'Нет подключения к сети. Для вопросов к UNI нужно соединение, чтобы искать документы.',
  askUniErrSession: 'Сессия UniWork истекла. Войдите снова, чтобы продолжить.',
  askUniErrDefault: 'Сейчас задать вопрос не удаётся; повторите позже.',
  askUniSignedOut:
    'Войдите в аккаунт UniWork, чтобы задавать UNI вопросы о вашем рабочем пространстве.',
  askUniNoticeNoSources:
    'Ничего из того, что вы видите в этом рабочем пространстве, пока не подходит под этот вопрос.',
  askUniNoticeUnavailable: 'UNI не смог ответить на этот вопрос.',
  askUniStop: 'Остановить',
  askUniSend: 'Отправить',
  askUniCounter: '{used}/{max} симв.',
  askUniPlaceholder: 'Спросите UNI о своей работе…',
} satisfies Record<keyof typeof zh, string>
