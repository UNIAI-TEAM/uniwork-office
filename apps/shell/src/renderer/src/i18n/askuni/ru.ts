import type { zh } from './zh'

export const ru = {
  askUniModeGroup: 'Режим',
  askUniModeChat: 'Ассистент',
  askUniModeAsk: 'Спросить UNI',
  askUniTitle: 'Спросить UNI',
  askUniDescription:
    'UNI отвечает только по данным, которые вы видите в этом рабочем пространстве, и указывает источники.',
  askUniWorkspace: 'Рабочее пространство',
  askUniEmptyTitle: 'Что вы хотите узнать о работе команды?',
  askUniEmptyDescription:
    'UNI читает задачи, встречи, чаты, в которых вы участвуете, и участников — ответы всегда со ссылками на источники.',
  askUniPlaceholder: 'Спросите UNI о своей работе…',
  askUniSend: 'Отправить',
  askUniStop: 'Остановить',
  askUniStopped: 'Остановлено. Ответ не будет показан.',
  askUniThinking: 'UNI думает…',
  askUniNewChat: 'Новый чат',
  askUniYou: 'Вы',
  askUniUni: 'UNI',
  askUniSources: 'Источники',
  askUniKindDocument: 'Документ',
  askUniKindTask: 'Задача',
  askUniKindMeeting: 'Встреча',
  askUniKindChat: 'Чат',
  askUniKindMember: 'Участник',
  askUniOpenDocument: 'Открыть документ',
  askUniOpenBrowser: 'Открыть в браузере',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} симв.',
  askUniLoading: 'Загрузка…',
  askUniSignedOut:
    'Войдите в аккаунт UniWork, чтобы задавать UNI вопросы о вашем рабочем пространстве.',
  askUniNoWorkspace: 'В вашем аккаунте пока нет рабочего пространства, о котором можно спросить.',
  askUniNoticeNoSources:
    'Ничего из того, что вы видите в этом рабочем пространстве, пока не подходит под этот вопрос.',
  askUniNoticeUnavailable: 'UNI не смог ответить на этот вопрос.',
  askUniErrForbidden: 'У вас нет доступа к этим данным.',
  askUniErrQuota: 'Организация израсходовала лимит ИИ-токенов на этот месяц.',
  askUniErrRateLimited: 'Вы спрашиваете слишком быстро; повторите через минуту.',
  askUniErrRateLimitedIn: 'Вы спрашиваете слишком быстро; повторите через {seconds} с.',
  askUniErrDisabled: 'ИИ не настроен на этом сервере.',
  askUniErrOffline:
    'Нет подключения к сети. Для вопросов к UNI нужно соединение, чтобы искать документы.',
  askUniErrSession: 'Сессия UniWork истекла. Войдите снова, чтобы продолжить.',
  askUniErrDefault: 'Сейчас задать вопрос не удаётся; повторите позже.',
} satisfies Record<keyof typeof zh, string>
