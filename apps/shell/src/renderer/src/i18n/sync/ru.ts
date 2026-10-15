import type { zh } from './zh'

export const ru = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Сохранение в очереди — ещё не в UniWork',
  uwChipQueuedNewer: 'Сохранение в очереди · есть новые правки',
  uwChipPausedAdmin: 'Сохранение в очереди · отправка приостановлена',
  uwChipReconciling: 'Проверка последнего сохранения…',
  uwChipReconcileStuck: 'Нужна поддержка, чтобы подтвердить сохранение',
  uwChipRemoteNewer: 'В UniWork есть более новая версия',
  uwTipQueued:
    'Сохранение от {time} надёжно хранится на этом компьютере и будет отправлено, когда появится сеть.',
  uwTipQueuedNewer: 'Сохранение от {time} ждёт отправки. Более поздние правки в него не входят.',
  uwTipPausedAdmin: 'Администратор приостановил отправку. Сохранение хранится на этом компьютере.',
  uwTipPausedUser:
    'Вы приостановили отправку. Сохранение от {time} хранится на этом компьютере; выберите «Возобновить отправку» в центре синхронизации.',
  uwTipReconciling:
    'Пока неясно, дошло ли последнее сохранение до UniWork. Приложение проверяет это и не создаст дубликат.',
  uwTipRemoteNewer: 'У вас есть несохранённые изменения, поэтому документ не перезагрузился.',
  uwTipFailed:
    'Это сохранение не будет повторено автоматически: {reason}. Изменения остаются на этом компьютере.',
  uwTipWaitAi: 'Ожидание завершения текущего шага ИИ, затем сохранение.',
  uwTipWaitAiLong: 'ИИ ещё не завершил текущий шаг. Остановите запуск ИИ, чтобы сохранить сейчас.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Показать очередь',
  uwActSaveAgain: 'Сохранить снова',
  uwActStopAi: 'Остановить ИИ',
  uwActBack: 'Назад',
  uwQueuePopWaiting: 'Ожидает сохранения: от {time} (на основе версии {base})',
  uwQueuePopNewer: 'С тех пор есть новые правки — не отправлены',
  uwQueueBlockedSave:
    'Последнее сохранение ещё ожидает. Сохранить снова можно, когда оно завершится.',
  uwQueueFull:
    'Хранилище синхронизации на этом компьютере заполнено, поэтому сохранение не поставлено в очередь. Изменения остаются в открытом окне; освободите место в центре синхронизации.',
  uwQueueOpenCenter: 'Открыть центр синхронизации',
  uwQueueCancel: 'Отменить сохранение…',
  uwQueueCancelConfirm:
    'Отменить сохранение в очереди? Изменения останутся на этом компьютере; документ в UniWork не изменится.',
  uwQueueCancelled: 'Сохранение в очереди отменено. Изменения остаются на этом компьютере.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'нужно войти снова',
  uwReasonSignedOut: 'выполнен выход',
  uwReasonForeign: 'принадлежит другой учётной записи',
  uwReasonArchived: 'документ в архиве',
  uwReasonSuspended: 'организация приостановлена',
  uwReasonDeactivated: 'ваша учётная запись отключена в этой организации',
  uwReasonLease: 'офлайн-доступ истёк',
  uwReasonKeystore: 'связка ключей этого компьютера заблокирована',
  uwReasonClock: 'часы переведены назад',
  uwReasonStoreFull: 'хранилище синхронизации на этом компьютере заполнено',
  uwReasonStoreNewer: 'нужна более новая версия приложения',

  // S2 queue-row badges
  uwBadgeQueued: 'Ожидает',
  uwBadgeWaitNetwork: 'Ожидание сети',
  uwBadgePausedUser: 'Приостановлено вами',
  uwBadgePausedAdmin: 'Приостановлено администратором',
  uwBadgeSending: 'Отправка',
  uwBadgeReconciling: 'Проверка',
  uwBadgeReconcileStuck: 'Нужна поддержка',
  uwBadgeConflict: 'Конфликт',
  uwBadgeBlocked: 'Заблокировано',
  uwBadgeLocked: 'Заблокирован',
  uwBadgeRevoked: 'Нет доступа',
  uwBadgeDeleted: 'Удалён',
  uwBadgeReconnect: 'Нужно переподключиться',
  uwBadgeKeystore: 'Связка ключей заблокирована',
  uwBadgeFailed: 'Не отправлено',
  uwBadgeSaved: 'Сохранено',
  uwBadgeKeptDraft: 'Сохранённый черновик',
  uwBadgeMoved: 'Перемещён',
  uwBadgeArchived: 'В архиве',

  // S2 queue-row details
  uwRowQueued: 'Сохранено {time} · на основе версии {base} · {size}',
  uwRowWaitNetwork: 'Будет отправлено, когда появится сеть',
  uwRowPausedUser: 'Будет отправлено, когда вы выберете «Возобновить отправку»',
  uwRowPausedAdmin: 'Будет отправлено, когда администратор снова включит отправку',
  uwRowUploading: 'Загрузка {done} / {total}',
  uwRowCommitting: 'Создание версии',
  uwRowReconciling: 'Результат отправки в {time} пока неясен. Проверяем в UniWork.',
  uwRowReconcileStuck:
    'Попыток сверки: {count}, результата пока нет. Приложение не будет отправлять повторно; отправьте код поддержки администратору.',
  uwStuckDiscardConfirm:
    'Отменить это сохранение? Если оно уже дошло до UniWork, та версия останется; ваша копия сохранится как черновик в центре синхронизации.',
  uwRowConflict: 'Версию {n} сохранил(а) {author} в {time}',
  uwRowFailed: 'Не отправлено: {reason}',
  uwRowBlocked: 'Невозможно сохранить: {reason}',
  uwRowCommitted: 'Версия {n} · {time}',
  uwRowKeptDraft: 'Сохранено при перезагрузке в {time}',
  uwRowMoved: 'Документ перемещён в {workspace}',
  uwRowArchived: 'Документ отправлен в архив в UniWork',

  // S2 row actions
  uwActDiscard: 'Отменить',
  uwActDiscardSave: 'Отменить сохранение…',
  uwActSendNow: 'Отправить сейчас',
  uwActRecheck: 'Проверить снова',
  uwActGuide: 'Инструкция',
  uwActOpenToResolve: 'Открыть для решения',
  uwActCopySupport: 'Скопировать код поддержки',
  uwActDownloadMine: 'Скачать мою версию',
  uwActOpenDraft: 'Открыть черновик',
  uwActDiscardDraft: 'Удалить черновик…',
  uwActSignInAgain: 'Войти снова',
  uwActSignIn: 'Войти',
  uwActSwitchAccount: 'Сменить учётную запись',
  uwActReconnect: 'Переподключиться',
  uwActDetails: 'Подробнее',
  uwActOpen: 'Открыть',
  uwDiscardDraftConfirm:
    'Удалить этот черновик? Его изменения будут удалены с этого компьютера без возможности восстановления.',

  // Sign-out prompt
  uwSignOutTitle: 'Выйти из UniWork?',
  uwSignOutBody:
    'Документы с несохранёнными изменениями или сохранениями в очереди: {count}. Они останутся заблокированными на этом компьютере, и открыть их снова сможет только ваша учётная запись.',
  uwSignOutKeystore:
    'Связка ключей компьютера заблокирована, поэтому несохранённые изменения есть только в открытых окнах. Если выйти сейчас, они будут потеряны; то, что уже сохранено в зашифрованном виде, останется. Чтобы сохранить их, сначала разблокируйте компьютер.',
  uwSignOutGo: 'Выйти',
  uwSignOutWaiting: 'Завершается текущее сохранение перед выходом…',
  uwSignOutCaptureFailed:
    'Некоторые несохранённые изменения не удалось захватить вовремя; для вашего аккаунта сохранена последняя автосохранённая версия.',

  // S2 sync center
  uwSyncTitle: 'Центр синхронизации',
  uwSyncOpenFromSettings: 'Центр синхронизации',
  uwSyncOnline: 'Подключено к UniWork · синхронизировано {time}',
  uwSyncOffline: 'Нет сети · последняя синхронизация {time}',
  uwSyncPaused: 'Отправка приостановлена — новые сохранения будут ждать',
  uwSyncAdminPaused: 'Администратор приостановил отправку. Сохранения хранятся на этом компьютере.',
  uwSyncFeedOff:
    'Уведомления о новых версиях приостановлены. UniWork по-прежнему проверяет конфликты при сохранении.',
  uwSyncResynced: 'Полностью повторно синхронизировано в {time}',
  uwSyncResyncFailed:
    'Не удалось повторно синхронизировать после нескольких попыток. Уведомления о новых версиях приостановлены; UniWork по-прежнему проверяет конфликты при сохранении.',
  uwSyncSignedOut: 'Вы вышли из системы. Элементов, заблокированных на этом компьютере: {count}.',
  uwSyncSignedOutEmpty: 'Вы вышли из системы.',
  uwSyncSessionExpired: 'Сеанс истёк. Войдите снова, чтобы продолжить отправку.',
  uwSyncOtherOrg: 'Сохранений в очереди в другой организации: {count}',
  uwSyncStoreBudget: 'Хранилище синхронизации на этом компьютере: {used} из {cap}',
  uwSyncStoreError: 'Не удалось прочитать очередь на этом компьютере. Ничего не удалено.',
  uwSyncNow: 'Синхронизировать',
  uwSyncPause: 'Приостановить отправку',
  uwSyncResume: 'Возобновить отправку',
  uwSyncNowOffline: 'Для синхронизации нужно подключение.',
  uwSyncTabAttention: 'Требует внимания',
  uwSyncTabQueue: 'Ожидает сохранения',
  uwSyncTabOffline: 'Доступно офлайн',
  uwSyncTabRecent: 'Недавно сохранённые',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Документ',
  uwSyncColState: 'Состояние',
  uwSyncColDetail: 'Подробности',
  uwSyncColActions: 'Действия',
  uwSyncMoreActions: 'Другие действия для {doc}',
  uwSyncEmptyQueue: 'Нет ожидающих сохранений.',
  uwSyncEmptyAttention: 'Ничего не требует внимания.',
  uwSyncEmptyRecent: 'Нет недавних сохранений.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Сделать доступным офлайн',
  uwOfflineUnpin: 'Удалить офлайн-копию',
  uwOfflineUnpinShort: 'Открепить',
  uwOfflineAdd: 'Добавить документы…',
  uwOfflineUsage: 'Используется {used} из {cap} на этом компьютере',
  uwOfflineEmpty: 'Пока нет документов, доступных офлайн.',
  uwOfflineCapReached:
    'Офлайн-библиотека на этом компьютере достигла предела: объём {cap}; максимум документов: {maxDocs}. Удалите офлайн-копию, чтобы добавить другую.',
  uwOfflineReady: 'Доступно офлайн',
  uwOfflineBadgeWaiting: 'Ожидание сети',
  uwOfflineBadgeDownloading: 'Загрузка',
  uwOfflineBadgeVerifying: 'Проверка',
  uwOfflineBadgeUpdate: 'Есть обновление',
  uwOfflineBadgeInterrupted: 'Не готово',
  uwOfflineBadgeDiskFull: 'Недостаточно места',
  uwOfflineBadgeCorrupt: 'Загрузка повреждена',
  uwOfflineBadgeLeaseSoon: 'Офлайн-доступ скоро закончится',
  uwOfflineBadgeViewOnly: 'Доступно офлайн · только просмотр',
  uwOfflineRowWaiting: 'Будет загружено, когда появится сеть',
  uwOfflineRowProgress: '{done} из {total}',
  uwOfflineRowProgressAria: '{done} из {total}',
  uwOfflineRowVerifying: 'Проверка целостности',
  uwOfflineRowReady: 'Версия {n} · {size} · офлайн-доступ до {datetime}',
  uwOfflineRowUpdate:
    'Версия {n} загрузится, когда появится сеть; версия {old} по-прежнему работает',
  uwOfflineRowUpdateKept:
    'Не удалось обновить до версии {n}: {reason}. Версия {old} по-прежнему работает.',
  uwOfflineRowInterrupted: 'Загрузка прервана. Старая копия (если есть) по-прежнему работает.',
  uwOfflineRowDiskFull: 'Нужно ещё {size}. Старая копия сохранена.',
  uwOfflineRowCorrupt: 'Повреждённая копия удалена. Загрузите её снова.',
  uwOfflineRowLeaseSoon: 'Подключитесь до {datetime}, чтобы продлить',
  uwOfflineRowRevoked:
    'У вас больше нет доступа к этому документу. Загруженная копия удалена; черновики остаются заблокированными.',
  uwOfflineRowDeleted:
    'Документ удалён в UniWork. Загруженная копия удалена; черновики остаются заблокированными.',
  uwOfflineRowArchived:
    'Документ отправлен в архив; локальная копия открывается до окончания офлайн-доступа.',
  uwOfflineRowMoved: 'Перемещено в {workspace}; локальная копия по-прежнему работает.',
  uwOfflineRowViewOnly: 'Версия {n} · только просмотр · офлайн-доступ до {datetime}',
  uwOfflineReadyAnnounce: 'Доступно офлайн: {doc}',
  uwOfflineUnpinConfirm:
    'Загруженная копия будет удалена с этого компьютера. Черновики и сохранения в очереди останутся.',
  uwOfflineCancelDownload: 'Отменить загрузку',
  uwOfflineDownloadNow: 'Загрузить сейчас',
  uwOfflineOpenFolder: 'Открыть папку хранилища',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Нужно переподключиться',
  uwLockKeystoreTitle: 'Связка ключей этого компьютера заблокирована',
  uwLockClockTitle: 'Нужна проверка времени',
  uwLockRevokedTitle: 'Нет доступа',
  uwLockDeletedTitle: 'Документ удалён',
  uwLockForeignTitle: 'Принадлежит другой учётной записи',
  uwLockOrgTitle: 'Нельзя открыть в этой организации',
  uwLockExpired:
    'Офлайн-доступ истёк. Содержимое остаётся зашифрованным; подключитесь, чтобы открыть его снова.',
  uwLockLibraryOff:
    'Администратор отключил офлайн-документы, поэтому офлайн-доступ нельзя продлить. Черновики остаются заблокированными в центре синхронизации.',
  uwLockKeystore:
    'Связка ключей компьютера заблокирована, поэтому зашифрованное содержимое нельзя открыть. Разблокируйте её и повторите попытку; ничего не удалено.',
  uwLockClock:
    'Часы компьютера переведены назад, поэтому офлайн-доступ заблокирован. Подключитесь, чтобы UniWork проверил время.',
  uwLockForeign:
    'Этот документ принадлежит другой учётной записи на этом компьютере. Переключитесь на неё, чтобы открыть его.',
  uwLockSuspended:
    'Организация приостановлена. Содержимое остаётся зашифрованным; обратитесь к администратору.',
  uwLockDeactivated:
    'Ваша учётная запись отключена в этой организации. Содержимое остаётся зашифрованным; обратитесь к администратору.',
  uwLockSignedOutTitle: 'Вы вышли из системы',
  uwLockSignedOut:
    'Содержимое остаётся заблокированным на этом компьютере. Войдите в ту же учётную запись, чтобы открыть его снова.',
  uwLockRegion: 'Состояние документа',
  uwLockWhileOpen:
    'Документ заблокирован, пока был открыт. Несохранённые изменения хранятся в зашифрованном виде; сохранять и копировать нельзя, пока он не разблокирован.',
  uwLockWhileOpenRam:
    'Документ заблокирован, пока был открыт, и этот компьютер пока не может надёжно сохранить изменения. Они есть только в этом окне (только просмотр); при закрытии они будут потеряны.',
  uwLockOtherWindow:
    'Этот документ открыт для редактирования в другом окне. Это окно только для просмотра.',
  uwLockOtherWindowGone:
    'Окно, в котором редактировался этот документ, перестало отвечать. Вы можете редактировать в этом окне.',
  uwLockGoToWindow: 'Перейти в то окно',
  uwLockTakeEdit: 'Редактировать в этом окне',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Этот документ изменён в другом месте',
  uwConflictBody: 'Ваших изменений ещё нет в UniWork, они в безопасности на этом компьютере.',
  uwConflictReload: 'Загрузить последнюю версию',
  uwConflictOverwrite: 'Перезаписать…',
  uwConflictCancel: 'Отмена',
  uwConflictKeepUnavailable:
    'Этот компьютер сейчас не может сохранить черновик (хранилище синхронизации заполнено или связка ключей заблокирована).',
  uwConflictOfflineDesktop:
    'Нет сети, а последней версии нет на этом компьютере, поэтому перезагрузить пока нельзя.',
  uwConflictReloadDesktopBody:
    'Выберите, что сделать с вашими изменениями перед загрузкой версии {n}.',
  uwConflictKeepDraft: 'Сохранить мою версию как черновик',
  uwConflictDiscard: 'Отменить мои изменения',
  uwConflictKeepDraftHint:
    'Черновик остаётся в центре синхронизации для просмотра или копирования; он никогда не применяется к новой версии автоматически.',
  uwConflictDraftCapReached:
    'Для этого документа достигнуто максимальное число сохранённых черновиков: {cap}. Удалите старый черновик в центре синхронизации, чтобы сохранить новый.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'Предыдущее сохранение требует поддержки, поэтому пока нельзя перезагрузить или перезаписать. Откройте центр синхронизации, чтобы решить это.',
  uwRemoteRevoked:
    'У вас больше нет доступа к этому документу. Сохранение остановлено; несохранённые изменения хранятся заблокированными на этом компьютере.',
} satisfies Record<keyof typeof zh, string>
