import type { zh } from './zh'

export const ru = {
  usMyFolder: 'Моя папка',
  usPrivateTag: 'Личное',
  usDialogTitle: 'Назовите документ',
  usHint:
    'Первое сохранение. Дальше документ сохраняется с этим именем; чтобы изменить его, используйте «Сохранить как».',
  usName: 'Имя',
  usLocation: 'Место',
  usSavingIn: 'Сохранение в: {folder}',
  usMyFolderPrivate: 'Личное, видно только вам',
  usChange: 'Изменить',
  usSave: 'Сохранить',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Закрыть',
  usPickTitle: 'Выберите место сохранения',
  usBack: 'Назад к имени',
  usSearchFolders: 'Поиск папок',
  usChooseFolder: 'Выбрать «{folder}»',
  usSelected: 'Выбрано',
  usRootBlocked: 'Выберите папку',
  usErrInvalidDestination: 'Сюда сохранить нельзя. Выберите другую папку.',
  usErrMyFolderLocked:
    '«Моя папка» — ваша личная системная папка: её нельзя переименовать, открыть для общего доступа, переместить или архивировать.',
  usErrFlushFailed:
    'Документ ещё не удалось записать на это устройство. Сначала сохраните документ, затем повторите попытку.',
  usErrBindFailed:
    'Документ «{title}» (ID {id}) создан, но его не удалось связать с этой вкладкой. Он перемещён в корзину, и его можно восстановить.',
  usErrOrphaned:
    'Документ «{title}» (ID {id}) создан в UniWork, но его не удалось ни связать с этой вкладкой, ни переместить в корзину. Удалите или используйте его в UniWork.',
  usErrAlreadyBound: 'Эта вкладка уже связана с документом UniWork. Сохраняйте как обычно.',
  usErrNotFound:
    'Не удалось найти сохраняемый файл или выбранную папку. Выберите место сохранения заново и повторите попытку.',
  usShareToggle: 'Share with workspace',
  usShareHint: 'Everyone in this workspace can view this document',
  usShareAlready: 'Already shared with the workspace',
  usShareFailed: 'Could not share. Check the principal and the level.',
} satisfies Record<keyof typeof zh, string>
