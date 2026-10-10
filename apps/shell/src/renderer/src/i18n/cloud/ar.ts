import type { zh } from './zh'

export const ar = {
  cloudTitle: 'ذكاء UniWork السحابي',
  cloudStateReady: 'متاح',
  cloudStateNotEntitled: 'غير مضمّن في خطتك',
  cloudStateExhausted: 'نفدت أرصدة الذكاء الاصطناعي',
  cloudStateUnavailable: 'غير متاح',
  cloudStateSignedOut: 'غير مسجّل الدخول',
  cloudStateInactive: 'الاشتراك غير نشط',
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
  cloudInactiveBody:
    'اشتراك UniWork الخاص بمؤسستك غير نشط، لذا تم إيقاف الذكاء الاصطناعي السحابي مؤقتًا. اطلب من المسؤول تجديده؛ ستستمر مزوّداتك الخاصة أدناه في العمل.',
  cloudToolsOffBody:
    'أدوات UniWork السحابية متوقفة. فعّل «{switch}» في {section} لاستخدام رصيد الذكاء الاصطناعي لمؤسستك؛ مزوّداتك الخاصة أدناه لا تتأثر.',
  cloudReadyBody:
    'عند عدم وجود مزوّد خاص بك، يستخدم البحث وإنشاء الصور وتحليل الوسائط أرصدة الذكاء الاصطناعي من UniWork لمؤسستك.',
  cloudToolsToggle: 'استخدام أدوات UniWork السحابية',
  cloudToolsToggleDesc:
    'عند عدم وجود مزوّد خاص بك، يعمل البحث على الويب وإنشاء الصور وتحليل الوسائط عبر سحابة UniWork (يستهلك أرصدة الذكاء الاصطناعي).',
  cloudMediaLabel: 'سحابة UniWork',
  cloudMediaDesc: 'يستخدم أرصدة الذكاء الاصطناعي من UniWork لمؤسستك؛ لا يلزم مفتاح.',
  cloudSearchAutoHint: 'سحابة UniWork أولًا (تستهلك أرصدة الذكاء الاصطناعي)، ثم البحث المجاني.',
  aiTestErrInvalidKey: 'مفتاح API مفقود أو مرفوض',
  aiTestErrNetwork: 'تعذّر الاتصال. تحقّق من الشبكة',
  aiTestErrLimit: 'تم بلوغ حد المزوّد. حاول لاحقًا',
  aiTestErrUnavailable: 'الخدمة لا تستجيب. حاول لاحقًا',
} satisfies Record<keyof typeof zh, string>
