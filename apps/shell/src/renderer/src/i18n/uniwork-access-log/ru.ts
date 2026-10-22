import type { zh } from './zh'

export const ru = {
  algMenu: 'Журнал доступа',
  algTitle: 'Журнал доступа',
  algDescription:
    'Кто просматривал, скачивал или открывал документ по ссылке. Читать журнал могут только управляющие.',
  algManageOnly: 'Для чтения журнала доступа нужны права управления.',
  algLoading: 'Загрузка журнала…',
  algError: 'Не удалось загрузить журнал доступа.',
  algEmpty: 'Обращений пока не зафиксировано.',
  algFilterLabel: 'Действие',
  algFilterAll: 'Все действия',
  algActionView: 'Просмотр',
  algActionDownload: 'Скачивание',
  algActionExport: 'Экспорт',
  algActionLinkView: 'Открыто по ссылке',
  algActionUnknown: 'Другое',
  algActorAnonymous: 'Аноним',
  algActorSystem: 'Система',
  algActorUnknown: 'Неизвестно',
  algVersion: 'версия {no}',
} satisfies Record<keyof typeof zh, string>
