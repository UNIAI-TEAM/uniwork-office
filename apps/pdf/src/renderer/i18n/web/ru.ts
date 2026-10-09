import type { zh } from './zh'

export const ru = {
  webCancel: 'Отмена',
  webConflictTitle: 'Этот документ был изменён в другом месте',
  webConflictBody:
    'Пока вы редактировали, была сохранена более новая версия. Перезаписать её вашей версией или загрузить последнюю версию и отменить ваши изменения?',
  webConflictOverwrite: 'Перезаписать',
  webConflictReload: 'Загрузить последнюю версию',
  webConflictNotSaved: 'документ был изменён в другом месте',
  webFatalTitle: 'Не удалось открыть документ',
  webFatalBody:
    'Редактирование и сохранение отключены. Обновите страницу или снова откройте документ из UniWork.',
  webNoHost: 'Этот редактор работает внутри UniWork. Откройте документ из UniWork.',
  webViewOnly: 'Только просмотр',
  webReloaded: 'загружена последняя версия, ваши изменения отменены',
  webViewOnlyNoSave: 'этот документ доступен только для просмотра',
  webMergeTitle: 'Объединить PDF',
  webMergeBody: 'Выбрано PDF: {count}. Добавить ещё PDF или объединить сейчас?',
  webMergeAdd: 'Добавить ещё PDF',
  webMergeNow: 'Объединить сейчас',
} satisfies Record<keyof typeof zh, string>
