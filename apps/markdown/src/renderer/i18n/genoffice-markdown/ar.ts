import type { zh } from './zh'

export const ar = {
  backlinks: 'روابط خلفية',
  backlinksEmpty: 'لا توجد ملاحظات تربط هنا بعد.',
  backlinksRefresh: 'تحديث الروابط الخلفية',
  graph: 'عرض المخطط',
  graphClose: 'إغلاق المخطط',
  graphEmpty: 'لا توجد ملاحظات في المكتبة بعد.',
  graphTruncated: 'ملاحظات كثيرة جدًا: يعرض الرسم أول {shown} من {total}.',
  suggestCreateNote: 'إنشاء ملاحظة جديدة',
  tags: 'الوسوم',
  tagsEmpty: 'لا توجد #وسوم في الخزانة بعد',
  blockLink: 'نسخ رابط الكتلة',
  blockLinkCopied: 'تم نسخ {link}',
  blockLinkNone: 'لا توجد كتلة للربط هنا',
  insertFootnote: 'حاشية سفلية',
  statusWords: '{n} كلمة',
  statusChars: '{n} حرفًا',
  highlight: 'تظليل',
} satisfies Record<keyof typeof zh, string>
