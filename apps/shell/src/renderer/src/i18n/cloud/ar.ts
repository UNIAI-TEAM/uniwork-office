import type { zh } from './zh'

export const ar = {
  cloudTitle: 'ذكاء UniWork السحابي',
  cloudStatus: 'الحالة',
  cloudStateReady: 'متاح',
  cloudStateNotEntitled: 'غير مضمّن في خطتك',
  cloudStateExhausted: 'نفدت أرصدة الذكاء الاصطناعي',
  cloudStateUnavailable: 'غير متاح',
  cloudCredits: 'أرصدة الذكاء الاصطناعي',
  cloudCreditsLeft: 'متبقٍ {remaining} / {limit}',
  cloudCreditsUnlimited: 'غير محدود',
  cloudCreditsRenews: 'يتجدد في {date}',
  cloudSignedOutBody:
    'سجّل الدخول إلى UniWork لاستخدام البحث على الويب وإنشاء الصور وتحليل الوسائط المدفوعة من أرصدة الذكاء الاصطناعي لمؤسستك.',
  cloudNotEntitledBody:
    'خطة مؤسستك لا تتضمن ذكاء UniWork السحابي. لا يزال بإمكانك استخدام مزوّديك أدناه.',
  cloudExhaustedBody:
    'استهلكت مؤسستك كل أرصدة الذكاء الاصطناعي من UniWork لهذه الفترة. تتوقف الأدوات السحابية حتى تتجدد الأرصدة؛ ويستمر عمل مزوّديك أدناه.',
  cloudUnavailableBody: 'ذكاء UniWork السحابي غير متاح حاليًا. ويستمر عمل مزوّديك أدناه.',
  cloudReadyBody:
    'عند عدم وجود مزوّد خاص بك، يستخدم البحث وإنشاء الصور وتحليل الوسائط أرصدة الذكاء الاصطناعي من UniWork لمؤسستك.',
  cloudToolsToggle: 'استخدام أدوات UniWork السحابية',
  cloudToolsToggleDesc:
    'عند عدم وجود مزوّد خاص بك، يعمل البحث على الويب وإنشاء الصور وتحليل الوسائط عبر سحابة UniWork (يستهلك أرصدة الذكاء الاصطناعي).',
  cloudMediaLabel: 'سحابة UniWork',
  cloudMediaDesc: 'يستخدم أرصدة الذكاء الاصطناعي من UniWork لمؤسستك؛ لا يلزم مفتاح.',
  cloudSearchAutoHint: 'سحابة UniWork أولًا (تستهلك أرصدة الذكاء الاصطناعي)، ثم البحث المجاني.',
} satisfies Record<keyof typeof zh, string>
