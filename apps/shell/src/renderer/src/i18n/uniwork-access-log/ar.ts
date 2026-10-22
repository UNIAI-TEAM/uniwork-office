import type { zh } from './zh'

export const ar = {
  algMenu: 'سجل الوصول',
  algTitle: 'سجل الوصول',
  algDescription: 'من عرض المستند أو نزّله أو فتحه عبر رابط. يمكن للمديرين فقط قراءته.',
  algManageOnly: 'تحتاج إلى صلاحية الإدارة لقراءة سجل الوصول.',
  algLoading: 'جارٍ تحميل السجل…',
  algError: 'تعذّر تحميل سجل الوصول.',
  algEmpty: 'لم يُسجَّل أي وصول بعد.',
  algFilterLabel: 'الإجراء',
  algFilterAll: 'كل الإجراءات',
  algActionView: 'عرض',
  algActionDownload: 'تنزيل',
  algActionExport: 'تصدير',
  algActionLinkView: 'فُتح عبر رابط',
  algActionUnknown: 'أخرى',
  algActorAnonymous: 'مجهول',
  algActorSystem: 'النظام',
  algActorUnknown: 'غير معروف',
  algVersion: 'الإصدار {no}',
} satisfies Record<keyof typeof zh, string>
