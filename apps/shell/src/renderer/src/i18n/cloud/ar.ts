import type { zh } from './zh'

export const ar = {
  cloudTitle: 'ذكاء UniWork السحابي',
  cloudStateReady: 'متاح',
  cloudStateNotEntitled: 'غير مضمّن في خطتك',
  cloudStateExhausted: 'نفدت أرصدة الذكاء الاصطناعي',
  cloudStateUnavailable: 'غير متاح',
  cloudStateInactive: 'الاشتراك غير نشط',
  cloudCredits: 'أرصدة الذكاء الاصطناعي',
  cloudCreditsLeft: 'متبقٍ {remaining} / {limit}',
  cloudCreditsUnlimited: 'غير محدود',
  cloudCreditsRenews: 'يتجدد في {date}',
  cloudToolsToggle: 'استخدام أدوات UniWork السحابية',
  cloudToolsToggleDesc:
    'عند عدم وجود مزوّد خاص بك، يعمل البحث على الويب وإنشاء الصور وتحليل الوسائط عبر سحابة UniWork (يستهلك أرصدة الذكاء الاصطناعي).',
} satisfies Record<keyof typeof zh, string>
