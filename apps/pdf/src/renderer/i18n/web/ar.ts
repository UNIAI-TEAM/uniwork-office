import type { zh } from './zh'

export const ar = {
  webCancel: 'إلغاء',
  webConflictTitle: 'تم تعديل هذا المستند في مكان آخر',
  webConflictBody:
    'تم حفظ إصدار أحدث أثناء تحريرك. هل تريد استبداله بإصدارك، أم إعادة تحميل أحدث إصدار وتجاهل تغييراتك؟',
  webConflictOverwrite: 'استبدال',
  webConflictReload: 'إعادة تحميل أحدث إصدار',
  webConflictNotSaved: 'تم تعديل المستند في مكان آخر',
  webFatalTitle: 'تعذر فتح المستند',
  webFatalBody: 'تم تعطيل التحرير والحفظ. أعد تحميل الصفحة أو افتح المستند مرة أخرى من UniWork.',
  webNoHost: 'يعمل هذا المحرر داخل UniWork. افتح المستند من UniWork.',
  webViewOnly: 'عرض فقط',
  webReloaded: 'أُعيد تحميل أحدث إصدار وتم تجاهل تغييراتك',
  webViewOnlyNoSave: 'هذا المستند للعرض فقط',
  webMergeTitle: 'دمج ملفات PDF',
  webMergeBody: 'تم تحديد {count} من ملفات PDF. هل تريد إضافة ملف PDF آخر أم الدمج الآن؟',
  webMergeAdd: 'إضافة ملف PDF آخر',
  webMergeNow: 'الدمج الآن',
} satisfies Record<keyof typeof zh, string>
