import type { zh } from './zh'

export const ru = {
  webCancel: 'Отмена',
  webConflictTitle: 'Этот документ был изменён в другом месте',
  webConflictBody:
    'Ваших изменений ещё нет в UniWork; они хранятся в этом браузере, пока вы не выйдете.',
  webConflictOverwrite: 'Перезаписать…',
  webConflictReload: 'Загрузить последнюю версию',
  webConflictNotSaved: 'документ был изменён в другом месте',
  webFatalTitle: 'Не удалось открыть документ',
  webFatalBody:
    'Редактирование и сохранение отключены. Обновите страницу или снова откройте документ из UniWork.',
  webNoHost: 'Этот редактор работает внутри UniWork. Откройте документ из UniWork.',
  webViewOnly: 'Только просмотр',
  webViewOnlyNotSaved: 'Этот документ доступен только для просмотра и не может быть сохранён',
  webNotUtf8:
    'Этот файл не является текстом UTF-8. Он открыт только для просмотра, чтобы сохранение не изменило его байты',
  webDraftTitle: 'Восстановить несохранённые изменения?',
  webDraftBody:
    'Браузер сохранил копию несохранённых изменений этого документа. Восстановить их или удалить?',
  webDraftOlder:
    'Копия основана на более старой версии документа. При сохранении она заменит более новую версию.',
  webDraftSavedAt: 'Копия сохранена в',
  webDraftKept: 'Браузер хранит копию, пока вы не выйдете из аккаунта.',
  webDraftRestore: 'Восстановить',
  webDraftDiscard: 'Удалить',
  webSaveNetwork: 'Не удалось связаться с UniWork. Проверьте подключение и повторите попытку.',
  webSaveTimeout:
    'Сохранение заняло слишком много времени. Проверьте подключение и повторите попытку.',
  webClose: 'Закрыть',
  webSaveUnauthorized: 'Сеанс UniWork завершён. Войдите снова и повторите сохранение.',
  webSaveForbidden: 'У вас нет прав на сохранение этого документа.',
  webSaveNotFound: 'Этот документ больше не существует или перемещён.',
  webSaveTooLarge: 'Документ слишком велик для сохранения.',
  webSaveRateLimited: 'Слишком много запросов. Подождите немного и повторите попытку.',
  webSaveServer: 'При сохранении в UniWork возникла проблема. Повторите попытку чуть позже.',
  webSaveFailedGeneric: 'Не удалось сохранить документ. Повторите попытку.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Ваших изменений ещё нет в UniWork; они хранятся в этом браузере, пока вы не выйдете.',
  uwConflictReloadWebBody:
    'Браузер не хранит черновики конфликтов. Скачайте свою версию, чтобы скопировать из неё позже, или отмените изменения.',
  uwConflictDownloadThenReload: 'Скачать мою версию и перезагрузить',
  uwConflictDiscardThenReload: 'Отменить изменения и перезагрузить',
  uwConflictMineFileSuffix: '(моя версия)',
  uwConflictDownloadCheck:
    'Браузер получил ваш файл. Убедитесь, что он сохранён, затем выберите «Перезагрузить».',
  uwConflictSessionWeb:
    'Сеанс истёк, поэтому перезапись не выполнена. Изменения остаются в этом браузере; войдите снова и повторите.',
  uwConflictTooLarge:
    'Ваша версия превышает ограничение размера UniWork, поэтому перезаписать не удалось.',
  uwConflictDownloadTooLarge:
    'Ваша версия превышает ограничение размера UniWork, поэтому скачать её здесь нельзя.',
  uwConflictDownloadFailed:
    'Не удалось скачать вашу версию, поэтому документ не перезагружен. Повторите попытку.',
  uwConflictOfflineWeb:
    'Нет сети. В веб-версии для этого нужно подключение; изменения остаются в этом браузере.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Ваша версия',
  uwConflictColServer: 'Версия в UniWork',
  uwConflictRowVersion: 'Версия',
  uwConflictRowTime: 'Время',
  uwConflictRowBy: 'Кем сохранено',
  uwConflictMineUnsaved: 'Вы (не сохранено)',
  uwConflictBasedOn: 'на основе версии {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Показать различия',
  uwConflictDiffPending: 'Сравнение…',
  uwConflictDiffFailed: 'Сейчас не удалось сравнить версии. Повторите попытку позже.',
  uwConflictNoEdit: 'У вас больше нет прав на редактирование этого документа.',
  uwConflictOverwriteTitle: 'Перезаписать вашей версией?',
  uwConflictOverwriteConfirm:
    'UniWork создаст версию {next} из вашей копии. Версия {server} от {author} останется в истории.',
  uwConflictOverwriteGo: 'Перезаписать',
  uwConflictBack: 'Назад',
  uwConflictHeadMoved:
    'Тем временем в UniWork появилась версия {n}. Таблица обновлена; выберите снова.',
  uwConflictReloadTitle: 'Загрузить последнюю версию',
  uwConflictReloadGo: 'Перезагрузить',
  uwConflictSaveCopy: 'Сохранить как копию…',
  uwConflictSaveCopyTitle: 'Сохранить как копию?',
  uwConflictSaveCopyConfirm:
    'UniWork создаст новый документ из вашей версии с тем же владельцем и доступом, что и у этого документа. Текущий документ и версия {server} от {author} останутся без изменений.',
  uwConflictSaveCopyGo: 'Создать копию',
  uwConflictSaveCopyDone:
    'Ваша версия сохранена как новый документ: {title}. Этот документ не изменился; вы по-прежнему можете перезагрузить или перезаписать.',
  uwConflictSaveCopyFailed:
    'Не удалось создать копию. Ваши изменения в безопасности; повторите попытку.',
  uwConflictSaveCopyOffline:
    'Нет сети. Для создания копии нужно подключение; ваши изменения сохранены.',
  uwConflictReloadFailed:
    'Не удалось загрузить последнюю версию. Документ не изменился; повторите попытку.',
  uwConflictOverwriteFailed:
    'Пока не удалось перезаписать. Документ не изменился; повторите попытку.',
  uwConflictClose: 'Закрыть',

  // S6 new-version bar
  uwRemoteRegion: 'Новая версия',
  uwRemoteUpdated: 'Обновлено до версии {n}, сохранённой {author} в {time}.',
  uwRemoteUpdatedNoRev: 'Обновлено до последней версии в UniWork.',
  uwRemoteNewerDirty:
    'В UniWork есть более новая версия (версия {n}). У вас есть несохранённые изменения, поэтому документ не перезагрузился.',
  uwRemoteNewerAi:
    'В UniWork есть более новая версия (версия {n}). UniWork AI работает, поэтому документ не перезагрузился; результаты ИИ применяются только к открытой копии.',
  uwRemoteNowClean: 'Вы отменили все изменения. Версия {n} в UniWork новее открытой копии.',
  uwRemoteStopAiConfirm:
    'Остановить текущий запуск UniWork AI, чтобы перезагрузить? Изменения, уже внесённые ИИ, относятся к открытой копии.',
  uwRemoteWaitCommit: 'Ожидание завершения текущего сохранения; после этого можно перезагрузить.',
  uwRemoteReload: 'Загрузить последнюю версию…',
  uwRemoteLater: 'Позже',
  uwRemoteClose: 'Закрыть',
  uwRemoteReloadFailed: 'Не удалось загрузить версию {n}. Вы по-прежнему видите предыдущую версию.',
  uwRemoteDeleted: 'Этот документ удалён в UniWork. Сохранения в очереди остановлены.',
  uwAuthorFallback: 'участник',
  uwLockRegion: 'Состояние документа',
  uwActRetry: 'Повторить',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'У вас больше нет доступа к этому документу. Сохранение остановлено; несохранённые изменения хранятся в этом браузере, пока вы не выйдете.',
  uwRemoteOrgBlockedWeb:
    'Не удалось сохранить: {reason}. Несохранённые изменения хранятся в этом браузере, пока вы не выйдете.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'документ в архиве',
  uwReasonSuspended: 'организация приостановлена',
  uwReasonDeactivated: 'ваша учётная запись отключена в этой организации',
} satisfies Record<keyof typeof zh, string>
