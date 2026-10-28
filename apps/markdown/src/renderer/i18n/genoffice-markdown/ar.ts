import type { zh } from './zh'

export const ar = {
  backlinks: 'روابط خلفية',
  backlinksEmpty: 'لا توجد ملاحظات تربط هنا بعد.',
  backlinksRefresh: 'تحديث الروابط الخلفية',
  graph: 'عرض المخطط',
  graphClose: 'إغلاق المخطط',
  graphEmpty: 'لا توجد ملاحظات في المكتبة بعد.',
  graphTruncated: 'ملاحظات كثيرة جدًا: يعرض الرسم أول {shown} من {total}.',
} satisfies Record<keyof typeof zh, string>
