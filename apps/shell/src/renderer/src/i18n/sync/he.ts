import type { zh } from './zh'

export const he = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'השמירה בתור — עדיין לא ב-UniWork',
  uwChipQueuedNewer: 'השמירה בתור · עריכות חדשות יותר',
  uwChipPausedAdmin: 'השמירה בתור · השליחה מושהית',
  uwChipReconciling: 'בודק את השמירה האחרונה…',
  uwChipReconcileStuck: 'נדרשת תמיכה כדי לאשר את השמירה',
  uwChipRemoteNewer: 'גרסה חדשה יותר ב-UniWork',
  uwTipQueued: 'השמירה שלך מ-{time} נשמרת בבטחה במחשב הזה ותישלח כשתהיה מחובר.',
  uwTipQueuedNewer: 'השמירה מ-{time} ממתינה לשליחה. עריכות מאוחרות יותר אינן חלק ממנה.',
  uwTipPausedAdmin: 'מנהל המערכת השהה את השליחה. השמירה נשארת במחשב הזה.',
  uwTipPausedUser:
    'השהית את השליחה. השמירה מ-{time} נשארת במחשב הזה; בחר "חידוש השליחה" במרכז הסנכרון.',
  uwTipReconciling:
    'עדיין לא ברור אם השמירה האחרונה הגיעה ל-UniWork. האפליקציה בודקת ולא תיצור כפילות.',
  uwTipRemoteNewer: 'יש לך שינויים שלא נשמרו, ולכן המסמך לא נטען מחדש.',
  uwTipFailed: 'השמירה הזו לא תנוסה שוב אוטומטית: {reason}. השינויים שלך נשארים במחשב הזה.',
  uwTipWaitAi: 'ממתין שה-AI יסיים את השלב הנוכחי, ואז שומר.',
  uwTipWaitAiLong: 'ה-AI עדיין לא סיים את השלב הנוכחי. עצור את הרצת ה-AI כדי לשמור עכשיו.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'הצגת התור',
  uwActSaveAgain: 'שמירה חוזרת',
  uwActStopAi: 'עצירת AI',
  uwActBack: 'חזרה',
  uwQueuePopWaiting: 'ממתין לשמירה: מ-{time} (מבוסס על גרסה {base})',
  uwQueuePopNewer: 'עריכות חדשות יותר מאז — לא נשלחו',
  uwQueueBlockedSave: 'השמירה האחרונה שלך עדיין ממתינה. תוכל לשמור שוב כשהיא תסתיים.',
  uwQueueFull:
    'אחסון הסנכרון במחשב הזה מלא, ולכן השמירה לא נכנסה לתור. השינויים שלך עדיין בחלון הפתוח; פנה מקום במרכז הסנכרון.',
  uwQueueOpenCenter: 'פתיחת מרכז הסנכרון',
  uwQueueCancel: 'ביטול השמירה…',
  uwQueueCancelConfirm:
    'לבטל את השמירה שבתור? השינויים שלך נשארים במחשב הזה; המסמך ב-UniWork לא משתנה.',
  uwQueueCancelled: 'השמירה שבתור בוטלה. השינויים שלך נשארים במחשב הזה.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'יש להתחבר מחדש',
  uwReasonSignedOut: 'התנתקת',
  uwReasonForeign: 'שייך לחשבון אחר',
  uwReasonArchived: 'המסמך הועבר לארכיון',
  uwReasonSuspended: 'הארגון מושעה',
  uwReasonDeactivated: 'החשבון שלך מושבת בארגון הזה',
  uwReasonLease: 'הגישה במצב לא מקוון פגה',
  uwReasonKeystore: 'מחזיק המפתחות של המחשב הזה נעול',
  uwReasonClock: 'השעון הוחזר לאחור',
  uwReasonStoreFull: 'אחסון הסנכרון במחשב הזה מלא',
  uwReasonStoreNewer: 'נדרשת גרסה חדשה יותר של האפליקציה',

  // S2 queue-row badges
  uwBadgeQueued: 'ממתין',
  uwBadgeWaitNetwork: 'ממתין לרשת',
  uwBadgePausedUser: 'הושהה על ידך',
  uwBadgePausedAdmin: 'הושהה על ידי מנהל',
  uwBadgeSending: 'שולח',
  uwBadgeReconciling: 'בודק',
  uwBadgeReconcileStuck: 'נדרשת תמיכה',
  uwBadgeConflict: 'התנגשות',
  uwBadgeBlocked: 'חסום',
  uwBadgeLocked: 'נעול',
  uwBadgeRevoked: 'אין גישה',
  uwBadgeDeleted: 'נמחק',
  uwBadgeReconnect: 'נדרשת התחברות מחדש',
  uwBadgeKeystore: 'מחזיק המפתחות נעול',
  uwBadgeFailed: 'השליחה נכשלה',
  uwBadgeSaved: 'נשמר',
  uwBadgeKeptDraft: 'טיוטה שנשמרה',
  uwBadgeMoved: 'הועבר',
  uwBadgeArchived: 'בארכיון',

  // S2 queue-row details
  uwRowQueued: 'נשמר {time} · מבוסס על גרסה {base} · {size}',
  uwRowWaitNetwork: 'יישלח כשתהיה מחובר',
  uwRowPausedUser: 'יישלח כשתבחר "חידוש השליחה"',
  uwRowPausedAdmin: 'יישלח כשמנהל המערכת יפעיל מחדש את השליחה',
  uwRowUploading: 'מעלה {done} / {total}',
  uwRowCommitting: 'יוצר את הגרסה',
  uwRowReconciling: 'התוצאה של השליחה ב-{time} עדיין לא ברורה. בודק מול UniWork.',
  uwRowReconcileStuck:
    'ניסיונות התאמה: {count}, עדיין אין תוצאה. האפליקציה לא תשלח שוב; שלח את קוד התמיכה למנהל המערכת.',
  uwStuckDiscardConfirm:
    'לבטל את השמירה הזו? אם היא כבר הגיעה ל-UniWork, הגרסה הזו נשארת; העותק שלך נשמר כטיוטה במרכז הסנכרון.',
  uwRowConflict: 'גרסה {n} נשמרה על ידי {author} ב-{time}',
  uwRowFailed: 'השליחה נכשלה: {reason}',
  uwRowBlocked: 'לא ניתן לשמור: {reason}',
  uwRowCommitted: 'גרסה {n} · {time}',
  uwRowKeptDraft: 'נשמר בטעינה מחדש ב-{time}',
  uwRowMoved: 'המסמך הועבר אל {workspace}',
  uwRowArchived: 'המסמך הועבר לארכיון ב-UniWork',

  // S2 row actions
  uwActDiscard: 'ביטול',
  uwActDiscardSave: 'ביטול השמירה…',
  uwActSendNow: 'שליחה עכשיו',
  uwActRecheck: 'בדיקה חוזרת',
  uwActGuide: 'מדריך',
  uwActOpenToResolve: 'פתיחה לפתרון',
  uwActCopySupport: 'העתקת קוד התמיכה',
  uwActDownloadMine: 'הורדת הגרסה שלי',
  uwActOpenDraft: 'פתיחת הטיוטה',
  uwActDiscardDraft: 'מחיקת הטיוטה…',
  uwActSignInAgain: 'התחברות מחדש',
  uwActSignIn: 'התחברות',
  uwActSwitchAccount: 'החלפת חשבון',
  uwActReconnect: 'התחברות מחדש לרשת',
  uwActDetails: 'פרטים',
  uwActOpen: 'פתיחה',
  uwDiscardDraftConfirm:
    'למחוק את הטיוטה הזו? השינויים שבה יוסרו מהמחשב הזה ולא ניתן יהיה לשחזר אותם.',

  // Sign-out prompt
  uwSignOutTitle: 'להתנתק מ-UniWork?',
  uwSignOutBody:
    'מסמכים עם שינויים שלא נשמרו או שמירות בתור: {count}. הם נשארים נעולים במחשב הזה ורק החשבון שלך יוכל לפתוח אותם שוב.',
  uwSignOutKeystore:
    'מחזיק המפתחות של המחשב נעול, ולכן שינויים שלא נשמרו קיימים רק בחלונות פתוחים. התנתקות עכשיו תמחק אותם; מה שכבר נשמר מוצפן נשאר. כדי לשמור אותם, בטל קודם את נעילת המחשב.',
  uwSignOutGo: 'התנתקות',
  uwSignOutWaiting: 'מסיים את השמירה המתבצעת לפני ההתנתקות…',
  uwSignOutCaptureFailed:
    'לא ניתן היה ללכוד חלק מהשינויים שלא נשמרו בזמן; הגרסה האחרונה שנשמרה אוטומטית נשמרת עבור חשבונך.',

  // S2 sync center
  uwSyncTitle: 'מרכז הסנכרון',
  uwSyncOpenFromSettings: 'מרכז הסנכרון',
  uwSyncOnline: 'מחובר ל-UniWork · סונכרן {time}',
  uwSyncOffline: 'לא מקוון · סונכרן לאחרונה {time}',
  uwSyncPaused: 'השליחה מושהית — שמירות חדשות ימתינו',
  uwSyncAdminPaused: 'מנהל המערכת השהה את השליחה. השמירות נשארות במחשב הזה.',
  uwSyncFeedOff: 'ההתראות על גרסאות חדשות מושהות. UniWork עדיין בודק התנגשויות כשאתה שומר.',
  uwSyncResynced: 'סונכרן מחדש במלואו ב-{time}',
  uwSyncResyncFailed:
    'לא ניתן היה לסנכרן מחדש אחרי כמה ניסיונות. ההתראות על גרסאות חדשות מושהות; UniWork עדיין בודק התנגשויות כשאתה שומר.',
  uwSyncSignedOut: 'התנתקת. פריטים שנשמרים נעולים במחשב הזה: {count}.',
  uwSyncSignedOutEmpty: 'התנתקת.',
  uwSyncSessionExpired: 'פג תוקף ההפעלה. התחבר מחדש כדי להמשיך לשלוח.',
  uwSyncOtherOrg: 'שמירות שממתינות בארגון אחר: {count}',
  uwSyncStoreBudget: 'אחסון הסנכרון במחשב הזה: {used} מתוך {cap}',
  uwSyncStoreError: 'לא ניתן לקרוא את התור במחשב הזה. שום דבר לא נמחק.',
  uwSyncNow: 'סנכרון עכשיו',
  uwSyncPause: 'השהיית השליחה',
  uwSyncResume: 'חידוש השליחה',
  uwSyncNowOffline: 'סנכרון דורש חיבור.',
  uwSyncTabAttention: 'דורש טיפול',
  uwSyncTabQueue: 'ממתין לשמירה',
  uwSyncTabOffline: 'זמין במצב לא מקוון',
  uwSyncTabRecent: 'נשמרו לאחרונה',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'מסמך',
  uwSyncColState: 'מצב',
  uwSyncColDetail: 'פרטים',
  uwSyncColActions: 'פעולות',
  uwSyncMoreActions: 'פעולות נוספות עבור {doc}',
  uwSyncEmptyQueue: 'אין שום דבר שממתין לשמירה.',
  uwSyncEmptyAttention: 'אין שום דבר שדורש טיפול.',
  uwSyncEmptyRecent: 'אין שמירות אחרונות.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'הפיכה לזמין במצב לא מקוון',
  uwOfflineUnpin: 'הסרת העותק הלא מקוון',
  uwOfflineUnpinShort: 'ביטול הצמדה',
  uwOfflineAdd: 'הוספת מסמכים…',
  uwOfflineUsage: 'בשימוש {used} מתוך {cap} במחשב הזה',
  uwOfflineEmpty: 'עדיין אין מסמכים זמינים במצב לא מקוון.',
  uwOfflineCapReached:
    'הספרייה הלא מקוונת במחשב הזה הגיעה למגבלה: נפח {cap}; מספר מסמכים מרבי: {maxDocs}. הסר עותק לא מקוון כדי להוסיף אחר.',
  uwOfflineReady: 'זמין במצב לא מקוון',
  uwOfflineBadgeWaiting: 'ממתין לרשת',
  uwOfflineBadgeDownloading: 'מוריד',
  uwOfflineBadgeVerifying: 'מאמת',
  uwOfflineBadgeUpdate: 'עדכון זמין',
  uwOfflineBadgeInterrupted: 'לא מוכן',
  uwOfflineBadgeDiskFull: 'אין מספיק מקום',
  uwOfflineBadgeCorrupt: 'ההורדה פגומה',
  uwOfflineBadgeLeaseSoon: 'הגישה הלא מקוונת מסתיימת בקרוב',
  uwOfflineBadgeViewOnly: 'זמין במצב לא מקוון · צפייה בלבד',
  uwOfflineRowWaiting: 'יורד כשתהיה מחובר',
  uwOfflineRowProgress: '{done} מתוך {total}',
  uwOfflineRowProgressAria: '{done} מתוך {total}',
  uwOfflineRowVerifying: 'בודק תקינות',
  uwOfflineRowReady: 'גרסה {n} · {size} · גישה לא מקוונת עד {datetime}',
  uwOfflineRowUpdate: 'גרסה {n} תורד כשתהיה מחובר; גרסה {old} עדיין עובדת',
  uwOfflineRowUpdateKept: 'לא ניתן היה לעדכן לגרסה {n}: {reason}. גרסה {old} עדיין עובדת.',
  uwOfflineRowInterrupted: 'ההורדה נקטעה. העותק הישן (אם קיים) עדיין עובד.',
  uwOfflineRowDiskFull: 'נדרשים עוד {size}. העותק הישן נשמר.',
  uwOfflineRowCorrupt: 'העותק הפגום הוסר. הורד אותו שוב.',
  uwOfflineRowLeaseSoon: 'התחבר לפני {datetime} כדי לחדש',
  uwOfflineRowRevoked: 'אין לך עוד גישה למסמך הזה. העותק שהורד הוסר; הטיוטות נשארות נעולות.',
  uwOfflineRowDeleted: 'המסמך נמחק ב-UniWork. העותק שהורד הוסר; הטיוטות נשארות נעולות.',
  uwOfflineRowArchived: 'המסמך הועבר לארכיון; העותק כאן נפתח עד שהגישה הלא מקוונת תסתיים.',
  uwOfflineRowMoved: 'הועבר אל {workspace}; העותק כאן עדיין עובד.',
  uwOfflineRowViewOnly: 'גרסה {n} · צפייה בלבד · גישה לא מקוונת עד {datetime}',
  uwOfflineReadyAnnounce: 'זמין במצב לא מקוון: {doc}',
  uwOfflineUnpinConfirm: 'העותק שהורד יוסר מהמחשב הזה. טיוטות ושמירות בתור נשמרות.',
  uwOfflineCancelDownload: 'ביטול ההורדה',
  uwOfflineDownloadNow: 'הורדה עכשיו',
  uwOfflineOpenFolder: 'פתיחת תיקיית האחסון',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'נדרשת התחברות מחדש',
  uwLockKeystoreTitle: 'מחזיק המפתחות של המחשב הזה נעול',
  uwLockClockTitle: 'נדרשת בדיקת שעה',
  uwLockRevokedTitle: 'אין גישה',
  uwLockDeletedTitle: 'המסמך נמחק',
  uwLockForeignTitle: 'שייך לחשבון אחר',
  uwLockOrgTitle: 'לא ניתן לפתוח בארגון הזה',
  uwLockExpired: 'הגישה הלא מקוונת פגה. התוכן נשאר מוצפן; התחבר כדי לפתוח אותו שוב.',
  uwLockLibraryOff:
    'מנהל המערכת כיבה מסמכים לא מקוונים, ולכן לא ניתן לחדש את הגישה הלא מקוונת. הטיוטות נשארות נעולות במרכז הסנכרון.',
  uwLockKeystore:
    'מחזיק המפתחות של המחשב נעול, ולכן לא ניתן לפתוח את התוכן המוצפן. בטל את הנעילה ונסה שוב; שום דבר לא נמחק.',
  uwLockClock:
    'שעון המחשב הוחזר לאחור, ולכן הגישה הלא מקוונת נעולה. התחבר כדי ש-UniWork יוכל לבדוק את השעה.',
  uwLockForeign: 'המסמך הזה שייך לחשבון אחר במחשב הזה. עבור לחשבון הזה כדי לפתוח אותו.',
  uwLockSuspended: 'הארגון מושעה. התוכן נשאר מוצפן; פנה למנהל המערכת.',
  uwLockDeactivated: 'החשבון שלך מושבת בארגון הזה. התוכן נשאר מוצפן; פנה למנהל המערכת.',
  uwLockSignedOutTitle: 'התנתקת',
  uwLockSignedOut: 'התוכן נשאר נעול במחשב הזה. התחבר עם אותו חשבון כדי לפתוח אותו שוב.',
  uwLockRegion: 'מצב המסמך',
  uwLockWhileOpen:
    'המסמך ננעל בזמן שהיה פתוח. שינויים שלא נשמרו נשמרים מוצפנים; לא ניתן לשמור או להעתיק עד לביטול הנעילה.',
  uwLockWhileOpenRam:
    'המסמך ננעל בזמן שהיה פתוח והמחשב הזה עדיין לא יכול לשמור את השינויים שלך בבטחה. הם קיימים רק בחלון הזה (צפייה בלבד); סגירתו תאבד אותם.',
  uwLockOtherWindow: 'המסמך הזה פתוח לעריכה בחלון אחר. החלון הזה לצפייה בלבד.',
  uwLockOtherWindowGone: 'החלון שערך את המסמך הזה הפסיק להגיב. אפשר לערוך בחלון הזה.',
  uwLockGoToWindow: 'מעבר לחלון ההוא',
  uwLockTakeEdit: 'עריכה בחלון הזה',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'הגרסה שלך',
  uwConflictColServer: 'הגרסה ב-UniWork',
  uwConflictRowVersion: 'גרסה',
  uwConflictRowTime: 'שעה',
  uwConflictRowBy: 'נשמר על ידי',
  uwConflictMineUnsaved: 'אתה (לא נשמר)',
  uwConflictBasedOn: 'מבוסס על גרסה {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'הצגת ההבדלים',
  uwConflictNoEdit: 'אין לך עוד הרשאת עריכה למסמך הזה.',
  uwConflictOverwriteTitle: 'לדרוס עם הגרסה שלך?',
  uwConflictOverwriteConfirm:
    'UniWork ייצור את גרסה {next} מהעותק שלך. גרסה {server} של {author} נשארת בהיסטוריה.',
  uwConflictOverwriteGo: 'דריסה',
  uwConflictBack: 'חזרה',
  uwConflictHeadMoved: 'בינתיים UniWork קיבל את גרסה {n}. הטבלה עודכנה; בחר שוב.',
  uwConflictReloadTitle: 'טעינה מחדש של הגרסה האחרונה',
  uwConflictReloadGo: 'טעינה מחדש',
  uwConflictSaveCopy: 'שמירה כעותק…',
  uwConflictSaveCopyTitle: 'לשמור כעותק?',
  uwConflictSaveCopyConfirm:
    'UniWork ייצור מסמך חדש מהגרסה שלך, עם אותו בעלים ואותה גישה כמו המסמך הזה. המסמך הנוכחי וגרסה {server} של {author} נשארים כפי שהם.',
  uwConflictSaveCopyGo: 'יצירת עותק',
  uwConflictSaveCopyDone:
    'הגרסה שלך נשמרה כמסמך חדש: {title}. המסמך הזה לא השתנה; עדיין אפשר לטעון מחדש או לדרוס.',
  uwConflictSaveCopyFailed: 'לא ניתן היה ליצור את העותק. השינויים שלך עדיין בטוחים; נסה שוב.',
  uwConflictSaveCopyOffline: 'אתה במצב לא מקוון. יצירת עותק דורשת חיבור; השינויים שלך נשמרים.',
  uwConflictReloadFailed: 'לא ניתן היה לטעון את הגרסה האחרונה. המסמך שלך לא השתנה; נסה שוב.',
  uwConflictOverwriteFailed: 'לא ניתן היה לדרוס עדיין. המסמך שלך לא השתנה; נסה שוב.',
  uwConflictClose: 'סגירה',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'המסמך הזה שונה במקום אחר',
  uwConflictBody: 'השינויים שלך עדיין לא ב-UniWork והם בטוחים במחשב הזה.',
  uwConflictReload: 'טעינה מחדש של הגרסה האחרונה',
  uwConflictOverwrite: 'דריסה…',
  uwConflictCancel: 'ביטול',
  uwConflictKeepUnavailable:
    'המחשב הזה לא יכול לשמור טיוטה כרגע (אחסון הסנכרון מלא או שמחזיק המפתחות נעול).',
  uwConflictOfflineDesktop:
    'אתה במצב לא מקוון והגרסה האחרונה לא נמצאת במחשב הזה, ולכן עדיין אי אפשר לטעון מחדש.',
  uwConflictReloadDesktopBody: 'בחר מה יקרה לשינויים שלך לפני שגרסה {n} תיטען.',
  uwConflictKeepDraft: 'שמירת הגרסה שלי כטיוטה',
  uwConflictDiscard: 'ביטול השינויים שלי',
  uwConflictKeepDraftHint:
    'הטיוטה נשארת במרכז הסנכרון לצפייה או להעתקה; היא אף פעם לא מוחלת על הגרסה החדשה באופן אוטומטי.',
  uwConflictDraftCapReached:
    'המסמך הזה הגיע למספר המרבי של טיוטות שמורות: {cap}. מחק טיוטה ישנה במרכז הסנכרון כדי לשמור אחרת.',

  // S6 new-version bar
  uwRemoteRegion: 'גרסה חדשה',
  uwRemoteUpdated: 'עודכן לגרסה {n}, שנשמרה על ידי {author} ב-{time}.',
  uwRemoteUpdatedNoRev: 'עודכן לגרסה האחרונה ב-UniWork.',
  uwRemoteNewerDirty:
    'יש גרסה חדשה יותר ב-UniWork (גרסה {n}). יש לך שינויים שלא נשמרו, ולכן המסמך לא נטען מחדש.',
  uwRemoteNewerAi:
    'יש גרסה חדשה יותר ב-UniWork (גרסה {n}). UniWork AI פועל, ולכן המסמך לא נטען מחדש; תוצאות ה-AI חלות רק על העותק הפתוח.',
  uwRemoteNowClean: 'ביטלת את כל השינויים. גרסה {n} ב-UniWork חדשה יותר מהעותק הפתוח.',
  uwRemoteStopAiConfirm:
    'לעצור את הרצת UniWork AI כדי לטעון מחדש? שינויים שה-AI כבר ביצע שייכים לעותק הפתוח.',
  uwRemoteWaitCommit: 'ממתין לסיום השמירה המתבצעת; אחר כך אפשר לטעון מחדש.',
  uwRemoteReload: 'טעינה מחדש של הגרסה האחרונה…',
  uwRemoteLater: 'אחר כך',
  uwRemoteClose: 'סגירה',
  uwRemoteReloadFailed: 'לא ניתן היה לטעון את גרסה {n}. אתה עדיין צופה בגרסה הקודמת.',
  uwRemoteDeleted: 'המסמך הזה נמחק ב-UniWork. השמירות שבתור נעצרו.',
  uwAuthorFallback: 'חבר צוות',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'השמירה הקודמת דורשת תמיכה, ולכן עדיין אי אפשר לטעון מחדש או לדרוס. פתח את מרכז הסנכרון כדי לפתור זאת.',
  uwRemoteRevoked:
    'אין לך עוד גישה למסמך הזה. השמירה נעצרה; שינויים שלא נשמרו נשארים נעולים במחשב הזה.',
} satisfies Record<keyof typeof zh, string>
