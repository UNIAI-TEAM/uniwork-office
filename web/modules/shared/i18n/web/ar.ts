import type { zh } from './zh'

export const ar = {
  webCancel: 'إلغاء',
  webConflictTitle: 'تم تعديل هذا المستند في مكان آخر',
  webConflictBody: 'تغييراتك ليست على UniWork بعد وتبقى في هذا المتصفح حتى تسجّل الخروج.',
  webConflictOverwrite: 'استبدال…',
  webConflictReload: 'إعادة تحميل أحدث إصدار',
  webConflictNotSaved: 'تم تعديل المستند في مكان آخر',
  webFatalTitle: 'تعذر فتح المستند',
  webFatalBody: 'تم تعطيل التحرير والحفظ. أعد تحميل الصفحة أو افتح المستند مرة أخرى من UniWork.',
  webNoHost: 'يعمل هذا المحرر داخل UniWork. افتح المستند من UniWork.',
  webViewOnly: 'عرض فقط',
  webViewOnlyNotSaved: 'هذا المستند للعرض فقط ولا يمكن حفظه',
  webNotUtf8: 'هذا الملف ليس نص UTF-8. يُفتح للعرض فقط حتى لا يغيّر الحفظ محتواه',
  webDraftTitle: 'هل تريد استعادة التغييرات غير المحفوظة؟',
  webDraftBody:
    'احتفظ هذا المتصفح بنسخة من تغييرات غير محفوظة على هذا المستند. هل تريد استعادتها أم تجاهلها؟',
  webDraftOlder: 'تستند هذه النسخة إلى إصدار أقدم من المستند. حفظها يستبدل الإصدار الأحدث.',
  webDraftSavedAt: 'حُفظت النسخة في',
  webDraftKept: 'يحتفظ هذا المتصفح بالنسخة حتى تسجّل الخروج.',
  webDraftRestore: 'استعادة',
  webDraftDiscard: 'تجاهل',
  webSaveNetwork: 'تعذّر الوصول إلى UniWork. تحقق من اتصالك وحاول مرة أخرى.',
  webSaveTimeout: 'استغرق الحفظ وقتًا طويلًا. تحقق من اتصالك وحاول مرة أخرى.',
  webClose: 'إغلاق',
  webSaveUnauthorized: 'انتهت جلسة UniWork. سجّل الدخول مرة أخرى ثم حاول الحفظ من جديد.',
  webSaveForbidden: 'ليس لديك إذن بحفظ هذا المستند.',
  webSaveNotFound: 'لم يعد هذا المستند موجودًا أو تم نقله.',
  webSaveTooLarge: 'المستند كبير جدًا بحيث لا يمكن حفظه.',
  webSaveRateLimited: 'طلبات كثيرة جدًا. انتظر لحظة ثم حاول مرة أخرى.',
  webSaveServer: 'واجه UniWork مشكلة أثناء الحفظ. حاول مرة أخرى بعد قليل.',
  webSaveFailedGeneric: 'تعذّر حفظ المستند. حاول مرة أخرى.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe: 'تغييراتك ليست على UniWork بعد وتبقى في هذا المتصفح حتى تسجّل الخروج.',
  uwConflictReloadWebBody:
    'لا يحتفظ المتصفح بمسودات التعارض. نزّل نسختك لتنسخ منها لاحقًا، أو تجاهل تغييراتك.',
  uwConflictDownloadThenReload: 'تنزيل نسختي ثم إعادة التحميل',
  uwConflictDiscardThenReload: 'تجاهل التغييرات وإعادة التحميل',
  uwConflictMineFileSuffix: '(نسختي)',
  uwConflictDownloadCheck: 'استلم متصفحك ملفك. تحقق من أنه حُفظ، ثم اختر إعادة التحميل.',
  uwConflictSessionWeb:
    'انتهت صلاحية جلستك، لذا لم يتم الاستبدال. تبقى تغييراتك في هذا المتصفح؛ سجّل الدخول مجددًا وأعد المحاولة.',
  uwConflictTooLarge: 'نسختك تتجاوز حد الحجم في UniWork، لذا تعذّر الاستبدال.',
  uwConflictDownloadFailed: 'تعذّر تنزيل نسختك، لذا لم تتم إعادة تحميل المستند. حاول مرة أخرى.',
  uwConflictOfflineWeb:
    'أنت غير متصل. على الويب يحتاج هذا إلى اتصال؛ وتبقى تغييراتك في هذا المتصفح.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'نسختك',
  uwConflictColServer: 'الإصدار على UniWork',
  uwConflictRowVersion: 'الإصدار',
  uwConflictRowTime: 'الوقت',
  uwConflictRowBy: 'حفظه',
  uwConflictMineUnsaved: 'أنت (غير محفوظ)',
  uwConflictBasedOn: 'استنادًا إلى الإصدار {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'عرض الاختلافات',
  uwConflictNoEdit: 'لم تعد لديك صلاحية تحرير هذا المستند.',
  uwConflictOverwriteTitle: 'هل تريد الاستبدال بنسختك؟',
  uwConflictOverwriteConfirm:
    'سينشئ UniWork الإصدار {next} من نسختك. يبقى الإصدار {server} الخاص بـ {author} في السجل.',
  uwConflictOverwriteGo: 'استبدال',
  uwConflictBack: 'رجوع',
  uwConflictHeadMoved: 'في الأثناء حصل UniWork على الإصدار {n}. تم تحديث الجدول؛ اختر مرة أخرى.',
  uwConflictReloadTitle: 'إعادة تحميل الأحدث',
  uwConflictReloadGo: 'إعادة التحميل',
  uwConflictSaveCopy: 'الحفظ كنسخة…',
  uwConflictSaveCopyTitle: 'هل تريد الحفظ كنسخة؟',
  uwConflictSaveCopyConfirm:
    'سينشئ UniWork مستندًا جديدًا من نسختك، بالمالك وصلاحيات الوصول نفسها لهذا المستند. يبقى المستند الحالي والإصدار {server} الخاص بـ {author} كما هما.',
  uwConflictSaveCopyGo: 'إنشاء نسخة',
  uwConflictSaveCopyDone:
    'حُفظت نسختك كمستند جديد: {title}. لم يتغير هذا المستند؛ لا يزال بإمكانك إعادة التحميل أو الاستبدال.',
  uwConflictSaveCopyFailed: 'تعذّر إنشاء النسخة. لا تزال تغييراتك آمنة؛ حاول مرة أخرى.',
  uwConflictSaveCopyOffline: 'أنت غير متصل. يحتاج إنشاء نسخة إلى اتصال؛ ويتم الاحتفاظ بتغييراتك.',
  uwConflictReloadFailed: 'تعذّر تحميل أحدث إصدار. لم يتغير مستندك؛ حاول مرة أخرى.',
  uwConflictOverwriteFailed: 'تعذّر الاستبدال حتى الآن. لم يتغير مستندك؛ حاول مرة أخرى.',
  uwConflictClose: 'إغلاق',

  // S6 new-version bar
  uwRemoteRegion: 'إصدار جديد',
  uwRemoteUpdated: 'تم التحديث إلى الإصدار {n} الذي حفظه {author} في {time}.',
  uwRemoteUpdatedNoRev: 'تم التحديث إلى أحدث إصدار على UniWork.',
  uwRemoteNewerDirty:
    'يوجد إصدار أحدث على UniWork (الإصدار {n}). لديك تغييرات غير محفوظة، لذا لم تتم إعادة تحميل المستند.',
  uwRemoteNewerAi:
    'يوجد إصدار أحدث على UniWork (الإصدار {n}). يعمل UniWork AI، لذا لم تتم إعادة تحميل المستند؛ وتنطبق نتائج الذكاء الاصطناعي على النسخة المفتوحة فقط.',
  uwRemoteNowClean: 'لقد تراجعت عن كل التغييرات. الإصدار {n} على UniWork أحدث من النسخة المفتوحة.',
  uwRemoteStopAiConfirm:
    'هل تريد إيقاف تشغيل UniWork AI الجاري لإعادة التحميل؟ التغييرات التي أجراها الذكاء الاصطناعي تخص النسخة المفتوحة.',
  uwRemoteWaitCommit: 'في انتظار انتهاء الحفظ الجاري؛ يمكنك إعادة التحميل بعد ذلك.',
  uwRemoteReload: 'إعادة تحميل الأحدث…',
  uwRemoteLater: 'لاحقًا',
  uwRemoteClose: 'إغلاق',
  uwRemoteReloadFailed: 'تعذّر تحميل الإصدار {n}. ما زلت تعرض الإصدار السابق.',
  uwRemoteDeleted: 'حُذف هذا المستند على UniWork. توقفت عمليات الحفظ في قائمة الانتظار.',
  uwAuthorFallback: 'أحد الأعضاء',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'لم يعد لديك وصول إلى هذا المستند. توقف الحفظ؛ وتبقى التغييرات غير المحفوظة في هذا المتصفح حتى تسجّل الخروج.',
  uwRemoteOrgBlockedWeb:
    'تعذّر الحفظ: {reason}. تبقى التغييرات غير المحفوظة في هذا المتصفح حتى تسجّل الخروج.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'تمت أرشفة المستند',
  uwReasonSuspended: 'المؤسسة معلّقة',
  uwReasonDeactivated: 'حسابك معطّل في هذه المؤسسة',
} satisfies Record<keyof typeof zh, string>
