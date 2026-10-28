import type { zh } from './zh'

export const ar = {
  searchMatchCase: 'مطابقة حالة الأحرف',
  searchWholeWord: 'كلمة كاملة',
  commentsPanel: 'تعليقات',
  commentsFilter: 'تصفية التعليقات حسب النص أو المؤلف',
  commentsEmpty: 'لا توجد تعليقات في هذا المستند بعد',
  commentsLoading: 'جارٍ تحميل التعليقات',
  editLink: 'رابط',
  editLinkHint: 'اسحب مربعًا على الصفحة لإضافة ارتباط تشعبي',
  linkDialogTitle: 'إضافة رابط',
  linkUrlLabel: 'عنوان الويب',
  linkPageLabel: 'أو صفحة في هذا المستند (1–{n})',
} satisfies Record<keyof typeof zh, string>
