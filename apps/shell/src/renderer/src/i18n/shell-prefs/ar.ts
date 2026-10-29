import type { zh } from './zh'

export const ar = {
  setRestoreSession: 'إعادة فتح مستندات المرة السابقة',
  setRestoreSessionDesc:
    'تُعاد فتح المستندات المفتوحة عند إغلاق UniWork Office تلقائيًا في المرة التالية التي يبدأ فيها.',
  setAutoUpdateCheck: 'التحقق من التحديثات تلقائيًا',
  setAutoUpdateCheckDesc:
    'عند الإيقاف، لن يتحقق UniWork Office من الإصدارات الجديدة عند التشغيل أو في الخلفية. يمكنك التحقق يدويًا من تعليمات › التحقق من التحديثات.',
} satisfies Record<keyof typeof zh, string>
