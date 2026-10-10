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
  webViewOnlyNotSaved: 'هذا المستند للعرض فقط ولا يمكن حفظه',
  webNotUtf8: 'هذا الملف ليس نص UTF-8. يُفتح للعرض فقط حتى لا يغيّر الحفظ محتواه',
  webDraftTitle: 'هل تريد استعادة التغييرات غير المحفوظة؟',
  webDraftBody:
    'احتفظ هذا المتصفح بنسخة من تغييرات غير محفوظة على هذا المستند. هل تريد استعادتها أم تجاهلها؟',
  webDraftOlder: 'تستند هذه النسخة إلى إصدار أقدم من المستند. حفظها يستبدل الإصدار الأحدث.',
  webDraftSavedAt: 'حُفظت النسخة في',
  webDraftKept: 'يحتفظ هذا المتصفح بالنسخة حتى تسجّل الخروج.',
  webDraftRestore: 'استعادة',
  webDraftDiscard: 'تجاهل',
} satisfies Record<keyof typeof zh, string>
