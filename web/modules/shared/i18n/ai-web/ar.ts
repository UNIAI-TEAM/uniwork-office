import type { zh } from './zh'

export const ar = {
  aiWebClose: 'إغلاق',
  aiWebStateCreditsTitle: 'نفدت أرصدة الذكاء الاصطناعي',
  aiWebStateCreditsBody:
    'استخدمت مؤسستك كل أرصدة UniWork AI لهذه الفترة. تواصل مع المسؤول أو انتظر التجديد.',
  aiWebStateEntitlementTitle: 'الذكاء الاصطناعي غير مضمّن في خطتك',
  aiWebStateEntitlementBody:
    'لا تتضمن خطة UniWork لمؤسستك ميزة الذكاء الاصطناعي هذه. تواصل مع المسؤول.',
  aiWebStateRateTitle: 'طلبات ذكاء اصطناعي كثيرة جدًا',
  aiWebStateRateBody: 'انتظر {seconds} ثانية ثم حاول مرة أخرى.',
  aiWebStateRateBodyNow: 'انتظر قليلًا ثم حاول مرة أخرى.',
  aiWebStateUnreachableTitle: 'تعذّر الوصول إلى مزوّد الذكاء الاصطناعي',
  aiWebStateUnreachableBody: 'تعذّر على UniWork الوصول إلى مزوّد الذكاء الاصطناعي. حاول بعد قليل.',
  aiWebStateCloudTitle: 'الأداة السحابية غير متاحة',
  aiWebStateCloudBody: 'لم يتم إعداد أداة UniWork AI هذه على الخادم بعد.',
  aiWebStateOutageTitle: 'UniWork غير متاح مؤقتًا',
  aiWebStateOutageBody: 'تعذّر الوصول إلى UniWork الآن. حاول بعد قليل.',
  aiWebStateSessionTitle: 'انتهت الجلسة',
  aiWebStateSessionBody: 'أعد فتح المستند من UniWork للمتابعة.',
  aiWebStateRefusedTitle: 'رُفض الطلب',
  aiWebStateRefusedBody: 'رفض الخادم طلب الذكاء الاصطناعي.',
  aiWebStateUnknownTitle: 'فشل طلب الذكاء الاصطناعي',
  aiWebStateUnknownBody: 'حدث خطأ ما. حاول مرة أخرى.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'هذا المصنف كبير جدًا على الذكاء الاصطناعي على الويب. افتحه في تطبيق UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'تابع الجزء التالي.',
} satisfies Record<keyof typeof zh, string>
