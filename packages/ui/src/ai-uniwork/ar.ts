import type { zh } from './zh'

export const ar = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'الأرصدة المتبقية: {remaining} من {limit}',
  aiUniworkFooterSignIn: 'سجّل الدخول إلى UniWork لاستخدام UniWork AI',
  aiUniworkSignedOut: 'لقد سجّلت الخروج من UniWork. اختر مزودًا آخر أو سجّل الدخول مجددًا.',
  aiUniworkOff: 'UniWork AI متوقف لهذا المستند. اختر مزودًا آخر.',
  aiUniworkViewOnly: 'عرض فقط: يمكن للذكاء الاصطناعي الإجابة لكنه لا يستطيع تحرير المستند أو حفظه.',

  // S8 disclosure
  aiUniworkDisclosure:
    'يقرأ UniWork AI ما هو مفتوح في هذا المستند، بما في ذلك التغييرات غير المحفوظة، ويرسله إلى UniWork ومزوّد النموذج للإجابة. يستخدم كل تشغيل أرصدة الذكاء الاصطناعي الخاصة بـ {org}. لا يحفظ الذكاء الاصطناعي نيابةً عنك أبدًا: راجع ثم اضغط حفظ.',
  aiUniworkDisclosureLabel: 'ما يتلقاه UniWork AI',
  aiUniworkDisclosureShort: 'يرسل المحتوى المفتوح (بما فيه غير المحفوظ) إلى UniWork · أرصدة {org}',
  aiUniworkLocalFile:
    'هذا الملف على جهاز الكمبيوتر لديك وليس في UniWork. مع UniWork AI يُرسل محتوى الملف المفتوح إلى UniWork ويستخدم أرصدة الذكاء الاصطناعي الخاصة بـ {org}. لا يُرفع الملف كمستند في UniWork.',
  aiUniworkAck: 'فهمت',
  aiUniworkLearnMore: 'معرفة المزيد',
  aiUniworkDetails: 'التفاصيل',
  aiUniworkSendNeedsAck: 'اقرأ الإشعار وأكّده قبل الإرسال.',

  // S9 result chips and run controls
  aiResultAnswer: 'إجابة',
  aiResultClarify: 'يحتاج إلى توضيح',
  aiResultEdited: 'تم التحرير في المستند',
  aiResultUnsupported: 'غير مدعوم',
  aiResultError: 'خطأ',
  aiResultEditedHint: 'غير محفوظ — تراجع باستخدام Ctrl/⌘+Z، أو اضغط حفظ عندما يبدو صحيحًا.',
  aiResultViewChanges: 'عرض التغييرات',
  aiRunStop: 'إيقاف',
  aiRunSend: 'إرسال',
  aiRunRunning: 'قيد التشغيل… اضغط إيقاف أو Esc للإيقاف.',
  aiRunStopped: 'تم الإيقاف. تبقى أي تغييرات مطبّقة بالفعل في المستند ويمكن التراجع عنها.',
  aiRunAskAgain: 'السؤال مجددًا',
  aiRunChooseOther: 'اختيار مزود آخر',
  aiRunOpenInApp: 'الفتح في التطبيق',
  aiConversationRestarted:
    'انتهت صلاحية المحادثة السابقة، لذا بدأ UniWork AI محادثة جديدة ولم يعد يتذكر الأدوار السابقة. أرسل سؤالك مرة أخرى للمتابعة.',
  aiConversationBoundary: 'محادثة جديدة مع {provider}: لا تُرسل الأدوار أعلاه.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'وصل هذا التشغيل إلى حد خطوات UniWork AI. تُحفظ النتائج حتى الآن؛ قسّم الطلب ثم اسأل مجددًا.',
  aiErrCredits: 'نفدت أرصدة الذكاء الاصطناعي لمؤسستك لهذه الفترة. توقف هذا التشغيل.',
  aiErrEntitlement: 'لم تعد خطة مؤسستك تتضمن UniWork AI.',
  aiErrRateLimited: 'أنت ترسل بسرعة كبيرة. أعد المحاولة بعد {seconds} ث.',
  aiErrRateLimitedNoWait: 'أنت ترسل بسرعة كبيرة. أعد المحاولة بعد بضع دقائق.',
  aiErrUnavailable: 'لا يستجيب UniWork AI حاليًا. لا يزال مستندك وزر الحفظ يعملان.',
  aiErrDisconnected:
    'انقطع الاتصال، لذا توقف هذا التشغيل. تبقى أي تغييرات مطبّقة بالفعل في المستند ويمكن التراجع عنها.',
  aiErrOffline: 'أنت غير متصل. لا يعمل UniWork AI دون اتصال ولا توضع الطلبات في قائمة الانتظار.',
  aiErrSession: 'انتهت جلسة UniWork، لذا توقف هذا التشغيل. سجّل الدخول مجددًا للمتابعة.',
  aiErrRevoked: 'لم يعد لديك وصول إلى هذا المستند، لذا توقف تشغيل الذكاء الاصطناعي.',
  aiErrDowngraded:
    'تغيّر وصولك للتو إلى العرض فقط، لذا توقف الذكاء الاصطناعي عن التحرير. تستمر الإجابات.',
  aiErrCapabilityOff: 'تم إيقاف UniWork AI للتو لهذا المستند، لذا توقف التشغيل بعد خطوته الحالية.',
  aiErrUnsupported: 'لا يستطيع UniWork AI فعل ذلك في {module} بعد.',
  aiErrViewOnlyEdit: 'لديك وصول للعرض فقط إلى هذا المستند، لذا لا يمكن للذكاء الاصطناعي تحريره.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'طلبك طويل جدًا على UniWork AI. اختصره إلى أقل من 8000 حرف ثم أرسله مرة أخرى.',
  aiErrQuestionRejected: 'تعذّر على UniWork AI قبول هذا الطلب. عدّله ثم أرسله مرة أخرى.',
  aiUniworkImagesNotSent: 'لا تُرسل الصور إلى UniWork AI؛ أُرسل النص فقط.',
} satisfies Record<keyof typeof zh, string>
