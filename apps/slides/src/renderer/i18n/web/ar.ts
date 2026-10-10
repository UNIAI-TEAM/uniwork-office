import type { zh } from './zh'

export const ar = {
  webConflictTitle: 'تم تغيير هذا العرض التقديمي في مكان آخر',
  webConflictBody:
    'قام شخص ما بحفظ إصدار أحدث. الكتابة فوقه تستبدله بتغييراتك؛ إعادة تحميل الأحدث تتجاهل تغييراتك وتفتح أحدث إصدار.',
  webConflictOverwrite: 'الكتابة فوقه',
  webConflictReload: 'إعادة تحميل الأحدث',
  webConflictNotSaved: 'تم تغيير العرض التقديمي في مكان آخر',
  webDiscardTitle: 'هل تريد تجاهل التغييرات غير المحفوظة؟',
  webDiscardBody: 'يحتوي هذا العرض التقديمي على تغييرات غير محفوظة. فتح ملف آخر سيؤدي إلى فقدانها.',
  webDiscard: 'تجاهل وفتح',
  webCancel: 'إلغاء',
  webOk: 'موافق',
  webFatalTitle: 'تعذر فتح العرض التقديمي',
  webFatalBody: 'تعذر تحميل الملف من UniWork. أغلق علامة التبويب هذه وحاول مرة أخرى.',
  webNoHost: 'يعمل هذا المحرر داخل UniWork. افتح العرض التقديمي من UniWork.',
  webLegacyPpt:
    'هذا ملف .ppt قديم ولا يمكن فتحه في المتصفح. احفظه أولاً بتنسيق .pptx في PowerPoint.',
  webEncryptedPptx: 'هذا العرض التقديمي محمي بكلمة مرور ولا يمكن فتحه في المتصفح.',
  webCommentAuthor: 'مستخدم',
  webExternalMedia: 'لا يتم تشغيل الوسائط الخارجية المرتبطة إلا في تطبيق سطح المكتب.',
  webReadOnly: 'هذا العرض التقديمي للقراءة فقط.',
  webSaveNetwork: 'تعذّر الوصول إلى UniWork. تحقق من اتصالك وحاول مرة أخرى.',
  webSaveTimeout: 'استغرق الحفظ وقتًا طويلًا. تحقق من اتصالك وحاول مرة أخرى.',
  webFullscreenHint: 'انقر أو اضغط أي مفتاح للدخول إلى وضع ملء الشاشة',
} satisfies Record<keyof typeof zh, string>
