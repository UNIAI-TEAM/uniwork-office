import type { zh } from './zh'

export const ar = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'الحفظ في قائمة الانتظار — ليس على UniWork بعد',
  uwChipQueuedNewer: 'الحفظ في قائمة الانتظار · تعديلات أحدث',
  uwChipPausedAdmin: 'الحفظ في قائمة الانتظار · الإرسال متوقف مؤقتًا',
  uwChipReconciling: 'جارٍ التحقق من آخر حفظ…',
  uwChipReconcileStuck: 'يلزم الدعم لتأكيد الحفظ',
  uwErrReconcileStuck: 'يلزم الدعم لتأكيد الحفظ.',
  uwChipRemoteNewer: 'إصدار أحدث على UniWork',
  uwTipQueued: 'حفظك من {time} محفوظ بأمان على هذا الكمبيوتر وسيُرسل عند اتصالك بالإنترنت.',
  uwTipQueuedNewer: 'الحفظ من {time} في انتظار الإرسال. التعديلات اللاحقة ليست جزءًا منه.',
  uwTipPausedAdmin: 'أوقف المسؤول الإرسال مؤقتًا. يبقى الحفظ على هذا الكمبيوتر.',
  uwTipPausedUser:
    'أوقفت الإرسال مؤقتًا. يبقى الحفظ من {time} على هذا الكمبيوتر؛ اختر استئناف الإرسال في مركز المزامنة.',
  uwTipReconciling:
    'لم يتضح بعد ما إذا كان آخر حفظ قد وصل إلى UniWork. يتحقق التطبيق من ذلك ولن ينشئ نسخة مكررة.',
  uwTipRemoteNewer: 'لديك تغييرات غير محفوظة، لذا لم تتم إعادة تحميل المستند.',
  uwTipFailed: 'لن تتم إعادة محاولة هذا الحفظ تلقائيًا: {reason}. تبقى تغييراتك على هذا الكمبيوتر.',
  uwTipWaitAi: 'في انتظار انتهاء الذكاء الاصطناعي من خطوته الحالية، ثم الحفظ.',
  uwTipWaitAiLong:
    'لم ينتهِ الذكاء الاصطناعي من خطوته الحالية. أوقف تشغيل الذكاء الاصطناعي للحفظ الآن.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'عرض قائمة الانتظار',
  uwActSaveAgain: 'الحفظ مرة أخرى',
  uwActStopAi: 'إيقاف الذكاء الاصطناعي',
  uwActBack: 'رجوع',
  uwQueuePopWaiting: 'في انتظار الحفظ: من {time} (استنادًا إلى الإصدار {base})',
  uwQueuePopNewer: 'تعديلات أحدث منذ ذلك الحين — لم تُرسل',
  uwQueueBlockedSave: 'آخر حفظ لا يزال في الانتظار. يمكنك الحفظ مرة أخرى بعد اكتماله.',
  uwQueueFull:
    'مساحة المزامنة على هذا الكمبيوتر ممتلئة، لذا لم يُضف الحفظ إلى قائمة الانتظار. لا تزال تغييراتك في النافذة المفتوحة؛ حرّر مساحة في مركز المزامنة.',
  uwQueueOpenCenter: 'فتح مركز المزامنة',
  uwQueueCancel: 'إلغاء الحفظ…',
  uwQueueCancelConfirm:
    'هل تريد إلغاء الحفظ في قائمة الانتظار؟ تبقى تغييراتك على هذا الكمبيوتر؛ ولا يتغير المستند على UniWork.',
  uwQueueCancelGo: 'إلغاء الحفظ',
  uwQueueCancelled: 'تم إلغاء الحفظ في قائمة الانتظار. تبقى تغييراتك على هذا الكمبيوتر.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'سجّل الدخول مجددًا',
  uwReasonSignedOut: 'تم تسجيل الخروج',
  uwReasonForeign: 'يخص حسابًا آخر',
  uwReasonArchived: 'تمت أرشفة المستند',
  uwReasonSuspended: 'المؤسسة معلّقة',
  uwReasonDeactivated: 'حسابك معطّل في هذه المؤسسة',
  uwReasonLease: 'انتهت صلاحية الوصول دون اتصال',
  uwReasonKeystore: 'سلسلة مفاتيح هذا الكمبيوتر مقفلة',
  uwReasonClock: 'تم إرجاع الساعة إلى الوراء',
  uwReasonStoreFull: 'مساحة المزامنة على هذا الكمبيوتر ممتلئة',
  uwReasonStoreNewer: 'يلزم إصدار أحدث من التطبيق',

  // S2 queue-row badges
  uwBadgeQueued: 'قيد الانتظار',
  uwBadgeWaitNetwork: 'في انتظار الشبكة',
  uwBadgePausedUser: 'أوقفته مؤقتًا',
  uwBadgePausedAdmin: 'أوقفه المسؤول مؤقتًا',
  uwBadgeSending: 'جارٍ الإرسال',
  uwBadgeReconciling: 'جارٍ التحقق',
  uwBadgeReconcileStuck: 'يحتاج إلى دعم',
  uwBadgeConflict: 'تعارض',
  uwBadgeBlocked: 'محظور',
  uwBadgeLocked: 'مقفل',
  uwBadgeRevoked: 'لا وصول',
  uwBadgeDeleted: 'محذوف',
  uwBadgeReconnect: 'يلزم إعادة الاتصال',
  uwBadgeKeystore: 'سلسلة المفاتيح مقفلة',
  uwBadgeFailed: 'تعذّر الإرسال',
  uwBadgeSaved: 'تم الحفظ',
  uwBadgeKeptDraft: 'مسودة محفوظة',
  uwBadgeMoved: 'تم النقل',
  uwBadgeArchived: 'مؤرشف',

  // S2 queue-row details
  uwRowQueued: 'حُفظ {time} · استنادًا إلى الإصدار {base} · {size}',
  uwRowWaitNetwork: 'سيُرسل عند الاتصال',
  uwRowPausedUser: 'سيُرسل عندما تختار استئناف الإرسال',
  uwRowPausedAdmin: 'سيُرسل عندما يعيد المسؤول تفعيل الإرسال',
  uwRowUploading: 'جارٍ الرفع {done} / {total}',
  uwRowCommitting: 'جارٍ إنشاء الإصدار',
  uwRowReconciling: 'نتيجة الإرسال في {time} غير واضحة بعد. جارٍ التحقق مع UniWork.',
  uwRowReconcileStuck:
    'محاولات التحقق: {count}، ولا توجد نتيجة بعد. لن يعيد التطبيق الإرسال؛ أرسل رمز الدعم إلى المسؤول.',
  uwStuckDiscardConfirm:
    'هل تريد تجاهل هذا الحفظ؟ إذا كان قد وصل إلى UniWork فسيبقى ذلك الإصدار؛ وتُحفظ نسختك كمسودة في مركز المزامنة.',
  uwRowConflict: 'حفظ {author} الإصدار {n} في {time}',
  uwRowFailed: 'تعذّر الإرسال: {reason}',
  uwRowBlocked: 'لا يمكن الحفظ: {reason}',
  uwRowCommitted: 'الإصدار {n} · {time}',
  uwRowKeptDraft: 'حُفظ عند إعادة التحميل في {time}',
  uwRowMoved: 'نُقل المستند إلى {workspace}',
  uwRowArchived: 'تمت أرشفة المستند على UniWork',

  // S2 row actions
  uwActDiscard: 'تجاهل',
  uwActDiscardSave: 'تجاهل الحفظ…',
  uwActSendNow: 'إرسال الآن',
  uwActRecheck: 'التحقق مجددًا',
  uwActGuide: 'الدليل',
  uwActOpenToResolve: 'فتح للحل',
  uwActCopySupport: 'نسخ رمز الدعم',
  uwActDownloadMine: 'تنزيل نسختي',
  uwActOpenDraft: 'فتح المسودة',
  uwActDiscardDraft: 'تجاهل المسودة…',
  uwActSignInAgain: 'تسجيل الدخول مجددًا',
  uwActSignIn: 'تسجيل الدخول',
  uwActSwitchAccount: 'تبديل الحساب',
  uwActReconnect: 'إعادة الاتصال',
  uwActDetails: 'التفاصيل',
  uwActOpen: 'فتح',
  uwDiscardDraftConfirm:
    'هل تريد تجاهل هذه المسودة؟ ستُزال تغييراتها من هذا الكمبيوتر ولا يمكن استعادتها.',

  // Sign-out prompt
  uwSignOutTitle: 'هل تريد تسجيل الخروج من UniWork؟',
  uwSignOutBody:
    'المستندات التي بها تغييرات غير محفوظة أو حفظ في قائمة الانتظار: {count}. تبقى مقفلة على هذا الكمبيوتر ولا يمكن فتحها مجددًا إلا بحسابك.',
  uwSignOutKeystore:
    'سلسلة مفاتيح الكمبيوتر مقفلة، لذا توجد التغييرات غير المحفوظة في النوافذ المفتوحة فقط. تسجيل الخروج الآن يتجاهلها؛ ويبقى ما حُفظ مشفّرًا بالفعل. للاحتفاظ بها، افتح قفل الكمبيوتر أولًا.',
  uwSignOutGo: 'تسجيل الخروج',
  uwSignOutWaiting: 'جارٍ إنهاء الحفظ الجاري قبل تسجيل الخروج…',
  uwSignOutCaptureFailed:
    'تعذّر التقاط بعض التغييرات غير المحفوظة في الوقت المناسب؛ تم الاحتفاظ بأحدث نسخة محفوظة أو محفوظة تلقائيًا لحسابك.',
  uwSignOutTimedOut:
    'تعذّر تأكيد تسجيل الخروج في الوقت المناسب؛ قد لا يزال الحساب مسجلاً للدخول. حاول مرة أخرى.',
  uwSwitchLostTitle: 'فُقدت بعض التغييرات غير المحفوظة للحساب السابق',
  uwSwitchLostBody:
    'سجّل حساب آخر الدخول على هذا الكمبيوتر، لذلك تم قفل الحساب السابق. المستندات التي تعذّر الاحتفاظ بتغييراتها غير المحفوظة: {count}. يبقى كل شيء آخر مقفلًا على هذا الكمبيوتر لذلك الحساب.',
  uwSwitchLostOk: 'حسنًا',

  // S2 sync center
  uwSyncTitle: 'مركز المزامنة',
  uwSyncOpenFromSettings: 'مركز المزامنة',
  uwSyncOnline: 'متصل بـ UniWork · تمت المزامنة {time}',
  uwSyncOffline: 'غير متصل · آخر مزامنة {time}',
  uwSyncOnlineNoTime: 'متصل بـ UniWork',
  uwSyncOfflineNoTime: 'غير متصل',
  uwSyncPaused: 'الإرسال متوقف مؤقتًا — ستنتظر عمليات الحفظ الجديدة',
  uwSyncAdminPaused: 'أوقف المسؤول الإرسال مؤقتًا. تبقى عمليات الحفظ على هذا الكمبيوتر.',
  uwSyncFeedOff:
    'إشعارات الإصدارات الجديدة متوقفة مؤقتًا. لا يزال UniWork يتحقق من التعارضات عند الحفظ.',
  uwSyncResynced: 'تمت إعادة المزامنة بالكامل في {time}',
  uwSyncResyncFailed:
    'تعذّرت إعادة المزامنة بعد عدة محاولات. إشعارات الإصدارات الجديدة متوقفة مؤقتًا؛ ولا يزال UniWork يتحقق من التعارضات عند الحفظ.',
  uwSyncSignedOut: 'لقد سجّلت الخروج. العناصر المحفوظة مقفلة على هذا الكمبيوتر: {count}.',
  uwSyncSignedOutEmpty: 'لقد سجّلت الخروج.',
  uwSyncSessionExpired: 'انتهت صلاحية جلستك. سجّل الدخول مجددًا لمتابعة الإرسال.',
  uwSyncOtherOrg: 'عمليات الحفظ المنتظرة في مؤسسة أخرى: {count}',
  uwSyncStoreBudget: 'مساحة المزامنة على هذا الكمبيوتر: {used} من {cap}',
  uwSyncStoreError: 'تعذّرت قراءة قائمة الانتظار على هذا الكمبيوتر. لم يُحذف أي شيء.',
  uwSyncNow: 'المزامنة الآن',
  uwSyncPause: 'إيقاف الإرسال مؤقتًا',
  uwSyncResume: 'استئناف الإرسال',
  uwSyncNowOffline: 'تحتاج المزامنة إلى اتصال.',
  uwSyncTabAttention: 'يحتاج إلى معالجة',
  uwSyncTabQueue: 'في انتظار الحفظ',
  uwSyncTabOffline: 'متاح دون اتصال',
  uwSyncTabRecent: 'المحفوظة مؤخرًا',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'المستند',
  uwSyncColState: 'الحالة',
  uwSyncColDetail: 'التفاصيل',
  uwSyncColActions: 'الإجراءات',
  uwSyncMoreActions: 'إجراءات أخرى لـ {doc}',
  uwSyncEmptyQueue: 'لا يوجد ما ينتظر الحفظ.',
  uwSyncEmptyAttention: 'لا شيء يحتاج إلى معالجة.',
  uwSyncEmptyRecent: 'لا توجد عمليات حفظ حديثة.',
  uwSyncActionFailed: 'تعذّر تنفيذ الإجراء. لم يُحذف أي شيء؛ حاول مرة أخرى.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'إتاحة دون اتصال',
  uwOfflineUnpin: 'إزالة النسخة دون اتصال',
  uwOfflineUnpinShort: 'إلغاء التثبيت',
  uwOfflineAdd: 'إضافة مستندات…',
  uwOfflineUsage: 'المستخدم {used} من {cap} على هذا الكمبيوتر',
  uwOfflineEmpty: 'لا توجد مستندات متاحة دون اتصال بعد.',
  uwOfflineCapReached:
    'وصلت المكتبة دون اتصال على هذا الكمبيوتر إلى حدها: السعة {cap}؛ الحد الأقصى للمستندات: {maxDocs}. أزل نسخة دون اتصال لإضافة أخرى.',
  uwOfflineReady: 'متاح دون اتصال',
  uwOfflineBadgeWaiting: 'في انتظار الشبكة',
  uwOfflineBadgeDownloading: 'جارٍ التنزيل',
  uwOfflineBadgeVerifying: 'جارٍ التحقق',
  uwOfflineBadgeUpdate: 'يتوفر تحديث',
  uwOfflineBadgeInterrupted: 'غير جاهز',
  uwOfflineBadgeDiskFull: 'لا توجد مساحة كافية',
  uwOfflineBadgeCorrupt: 'التنزيل تالف',
  uwOfflineBadgeLeaseSoon: 'الوصول دون اتصال ينتهي قريبًا',
  uwOfflineBadgeViewOnly: 'متاح دون اتصال · عرض فقط',
  uwOfflineRowWaiting: 'سيُنزَّل عند الاتصال',
  uwOfflineRowProgress: '{done} من {total}',
  uwOfflineRowProgressAria: '{done} من {total}',
  uwOfflineRowVerifying: 'جارٍ التحقق من السلامة',
  uwOfflineRowReady: 'الإصدار {n} · {size} · الوصول دون اتصال حتى {datetime}',
  uwOfflineRowUpdate: 'سيُنزَّل الإصدار {n} عند الاتصال؛ ولا يزال الإصدار {old} يعمل',
  uwOfflineRowUpdateKept: 'تعذّر التحديث إلى الإصدار {n}: {reason}. لا يزال الإصدار {old} يعمل.',
  uwOfflineRowInterrupted: 'انقطع التنزيل. لا تزال النسخة الأقدم (إن وجدت) تعمل.',
  uwOfflineRowDiskFull: 'يلزم {size} إضافية. يتم الاحتفاظ بالنسخة الأقدم.',
  uwOfflineRowCorrupt: 'أُزيلت النسخة التالفة. نزّلها مرة أخرى.',
  uwOfflineRowLeaseSoon: 'اتصل قبل {datetime} للتجديد',
  uwOfflineRowRevoked:
    'لم يعد لديك وصول إلى هذا المستند. أُزيلت النسخة المنزّلة؛ وتبقى المسودات مقفلة.',
  uwOfflineRowDeleted: 'حُذف المستند على UniWork. أُزيلت النسخة المنزّلة؛ وتبقى المسودات مقفلة.',
  uwOfflineRowArchived: 'تمت أرشفة المستند؛ تُفتح النسخة هنا حتى ينتهي الوصول دون اتصال.',
  uwOfflineRowMoved: 'نُقل إلى {workspace}؛ ولا تزال النسخة هنا تعمل.',
  uwOfflineRowViewOnly: 'الإصدار {n} · عرض فقط · الوصول دون اتصال حتى {datetime}',
  uwOfflineReadyAnnounce: 'متاح دون اتصال: {doc}',
  uwOfflineUnpinConfirm:
    'ستُزال النسخة المنزّلة من هذا الكمبيوتر. يتم الاحتفاظ بالمسودات وعمليات الحفظ في قائمة الانتظار.',
  uwOfflineCancelDownload: 'إلغاء التنزيل',
  uwOfflineDownloadNow: 'التنزيل الآن',
  uwOfflineOpenFolder: 'فتح مجلد التخزين',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'يلزم إعادة الاتصال',
  uwLockKeystoreTitle: 'سلسلة مفاتيح هذا الكمبيوتر مقفلة',
  uwLockClockTitle: 'يلزم التحقق من الوقت',
  uwLockRevokedTitle: 'لا وصول',
  uwLockDeletedTitle: 'تم حذف المستند',
  uwLockForeignTitle: 'يخص حسابًا آخر',
  uwLockOrgTitle: 'لا يمكن الفتح في هذه المؤسسة',
  uwLockExpired: 'انتهت صلاحية الوصول دون اتصال. يبقى المحتوى مشفّرًا؛ اتصل لفتحه مجددًا.',
  uwLockLibraryOff:
    'أوقف المسؤول المستندات دون اتصال، لذا لا يمكن تجديد الوصول دون اتصال. تبقى المسودات مقفلة في مركز المزامنة.',
  uwLockKeystore:
    'سلسلة مفاتيح الكمبيوتر مقفلة، لذا لا يمكن فتح المحتوى المشفّر. افتح قفلها وحاول مرة أخرى؛ لم يُحذف أي شيء.',
  uwLockClock:
    'تم إرجاع ساعة الكمبيوتر إلى الوراء، لذا الوصول دون اتصال مقفل. اتصل ليتمكن UniWork من التحقق من الوقت.',
  uwLockForeign: 'هذا المستند يخص حسابًا آخر على هذا الكمبيوتر. بدّل إلى ذلك الحساب لفتحه.',
  uwLockSuspended: 'المؤسسة معلّقة. يبقى المحتوى مشفّرًا؛ تواصل مع المسؤول.',
  uwLockDeactivated: 'حسابك معطّل في هذه المؤسسة. يبقى المحتوى مشفّرًا؛ تواصل مع المسؤول.',
  uwLockSignedOutTitle: 'لقد سجّلت الخروج',
  uwLockSignedOut: 'يبقى المحتوى مقفلًا على هذا الكمبيوتر. سجّل الدخول بالحساب نفسه لفتحه مجددًا.',
  uwLockRegion: 'حالة المستند',
  uwLockWhileOpen:
    'قُفل المستند أثناء فتحه. تُحفظ التغييرات غير المحفوظة مشفّرة؛ ولا يمكنك الحفظ أو النسخ حتى يُفتح قفله.',
  uwLockWhileOpenRam:
    'قُفل المستند أثناء فتحه ولا يستطيع هذا الكمبيوتر الاحتفاظ بتغييراتك بأمان بعد. توجد في هذه النافذة فقط (عرض فقط)؛ وإغلاقها يفقدها.',
  uwLockOtherWindow: 'هذا المستند مفتوح للتحرير في نافذة أخرى. هذه النافذة للعرض فقط.',
  uwLockOtherWindowGone:
    'توقفت النافذة التي تحرر هذا المستند عن الاستجابة. يمكنك التحرير في هذه النافذة.',
  uwLockGoToWindow: 'الانتقال إلى تلك النافذة',
  uwLockTakeEdit: 'التحرير في هذه النافذة',

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
  uwConflictSaveCopyNoSeat:
    'تعذّر إنشاء النسخة لأنك لست عضوًا في مساحة العمل التي يوجد فيها هذا المستند. لا تزال تغييراتك آمنة؛ يمكنك تنزيل نسختك.',
  uwConflictSaveCopyFolderRefused: 'لا يمكنك إنشاء مستندات في هذا المجلد. نزّل نسختك بدلًا من ذلك.',
  uwConflictDownloadDone:
    'حُفظت نسختك على هذا الكمبيوتر: {file}. لم يتغير هذا المستند؛ لا يزال بإمكانك إعادة التحميل أو الاستبدال.',
  uwConflictDownloadFailedDesktop: 'تعذّر حفظ الملف. لا تزال تغييراتك آمنة؛ حاول مرة أخرى.',
  uwConflictSaveCopyOffline: 'أنت غير متصل. يحتاج إنشاء نسخة إلى اتصال؛ ويتم الاحتفاظ بتغييراتك.',
  uwConflictReloadFailed: 'تعذّر تحميل أحدث إصدار. لم يتغير مستندك؛ حاول مرة أخرى.',
  uwConflictOverwriteFailed: 'تعذّر الاستبدال حتى الآن. لم يتغير مستندك؛ حاول مرة أخرى.',
  uwConflictClose: 'إغلاق',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'تم تغيير هذا المستند في مكان آخر',
  uwConflictBody: 'تغييراتك ليست على UniWork بعد وهي آمنة على هذا الكمبيوتر.',
  uwConflictReload: 'إعادة تحميل الأحدث',
  uwConflictOverwrite: 'استبدال…',
  uwConflictCancel: 'إلغاء',
  uwConflictKeepUnavailable:
    'لا يستطيع هذا الكمبيوتر الاحتفاظ بمسودة الآن (مساحة المزامنة ممتلئة أو سلسلة المفاتيح مقفلة).',
  uwConflictOfflineDesktop:
    'أنت غير متصل وأحدث إصدار غير موجود على هذا الكمبيوتر، لذا لا يمكن إعادة التحميل بعد.',
  uwConflictReloadDesktopBody: 'اختر ما يحدث لتغييراتك قبل تحميل الإصدار {n}.',
  uwConflictKeepDraft: 'الاحتفاظ بنسختي كمسودة',
  uwConflictDiscard: 'تجاهل تغييراتي',
  uwConflictKeepDraftHint:
    'تبقى المسودة في مركز المزامنة للعرض أو النسخ؛ ولا تُطبَّق على الإصدار الجديد تلقائيًا أبدًا.',
  uwConflictDraftCapReached:
    'وصل هذا المستند إلى الحد الأقصى لعدد المسودات المحفوظة: {cap}. تجاهل مسودة قديمة في مركز المزامنة للاحتفاظ بأخرى.',

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
  uwRemoteWaitCommit: 'في انتظار انتهاء الحفظ الجاري؛ يمكنك المتابعة عندما ينتهي.',
  uwRemoteReload: 'إعادة تحميل الأحدث…',
  uwRemoteLater: 'لاحقًا',
  uwRemoteClose: 'إغلاق',
  uwRemoteReloadFailed: 'تعذّر تحميل الإصدار {n}. ما زلت تعرض الإصدار السابق.',
  uwRemoteDeleted: 'حُذف هذا المستند على UniWork. توقفت عمليات الحفظ في قائمة الانتظار.',
  uwAuthorFallback: 'أحد الأعضاء',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'يحتاج الحفظ السابق إلى دعم، لذا لا يمكنك إعادة التحميل أو الاستبدال بعد. افتح مركز المزامنة لحله.',
  uwRemoteRevoked:
    'لم يعد لديك وصول إلى هذا المستند. توقف الحفظ؛ وتبقى التغييرات غير المحفوظة مقفلة على هذا الكمبيوتر.',
} satisfies Record<keyof typeof zh, string>
