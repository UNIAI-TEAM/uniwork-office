import type { zh } from './zh'

export const he = {
  webCancel: 'ביטול',
  webConflictTitle: 'מסמך זה שונה במקום אחר',
  webConflictBody: 'השינויים שלך עדיין לא ב-UniWork והם נשמרים בדפדפן הזה עד שתתנתק.',
  webConflictOverwrite: 'דריסה…',
  webConflictReload: 'טעינת הגרסה העדכנית',
  webConflictNotSaved: 'המסמך שונה במקום אחר',
  webFatalTitle: 'לא ניתן לפתוח את המסמך',
  webFatalBody: 'העריכה והשמירה מושבתות. טען מחדש את הדף או פתח את המסמך שוב מ-UniWork.',
  webNoHost: 'עורך זה פועל בתוך UniWork. פתח את המסמך מ-UniWork.',
  webViewOnly: 'צפייה בלבד',
  webViewOnlyNotSaved: 'מסמך זה לצפייה בלבד ולא ניתן לשמור אותו',
  webNotUtf8: 'קובץ זה אינו טקסט UTF-8. הוא נפתח לצפייה בלבד כדי ששמירה לא תשנה את תוכנו',
  webDraftTitle: 'לשחזר שינויים שלא נשמרו?',
  webDraftBody: 'הדפדפן שמר עותק של שינויים במסמך זה שלא נשמרו. לשחזר אותם או למחוק?',
  webDraftOlder: 'העותק מבוסס על גרסה ישנה יותר של המסמך. שמירתו תחליף את הגרסה החדשה יותר.',
  webDraftSavedAt: 'העותק נשמר ב-',
  webDraftKept: 'הדפדפן הזה שומר את ההעתק עד שתתנתק.',
  webDraftRestore: 'שחזור',
  webDraftDiscard: 'מחיקה',
  webSaveNetwork: 'לא ניתן להתחבר ל-UniWork. בדקו את החיבור ונסו שוב.',
  webSaveTimeout: 'השמירה ארכה זמן רב מדי. בדקו את החיבור ונסו שוב.',
  webClose: 'סגור',
  webSaveUnauthorized: 'ההתחברות שלך ל-UniWork פגה. היכנס שוב ונסה לשמור שוב.',
  webSaveForbidden: 'אין לך הרשאה לשמור מסמך זה.',
  webSaveNotFound: 'מסמך זה כבר לא קיים או שהועבר.',
  webSaveTooLarge: 'המסמך גדול מדי לשמירה.',
  webSaveRateLimited: 'יותר מדי בקשות. המתן רגע ונסה שוב.',
  webSaveServer: 'ל-UniWork הייתה בעיה בשמירה. נסה שוב בעוד רגע.',
  webSaveFailedGeneric: 'לא ניתן היה לשמור את המסמך. נסה שוב.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe: 'השינויים שלך עדיין לא ב-UniWork והם נשמרים בדפדפן הזה עד שתתנתק.',
  uwConflictReloadWebBody:
    'הדפדפן לא שומר טיוטות של התנגשויות. הורד את הגרסה שלך כדי להעתיק ממנה מאוחר יותר, או בטל את השינויים.',
  uwConflictDownloadThenReload: 'הורדת הגרסה שלי ואז טעינה מחדש',
  uwConflictDiscardThenReload: 'ביטול השינויים וטעינה מחדש',
  uwConflictMineFileSuffix: '(הגרסה שלי)',
  uwConflictDownloadCheck: 'הדפדפן קיבל את הקובץ שלך. ודא שהוא נשמר, ואז בחר "טעינה מחדש".',
  uwConflictSessionWeb:
    'פג תוקף ההפעלה, ולכן הדריסה לא בוצעה. השינויים שלך נשארים בדפדפן הזה; התחבר מחדש ונסה שוב.',
  uwConflictTooLarge: 'הגרסה שלך חורגת ממגבלת הגודל של UniWork, ולכן לא ניתן היה לדרוס.',
  uwConflictDownloadTooLarge:
    'הגרסה שלך חורגת ממגבלת הגודל של UniWork, ולכן לא ניתן להוריד אותה כאן.',
  uwConflictDownloadFailed: 'לא ניתן היה להוריד את הגרסה שלך, ולכן המסמך לא נטען מחדש. נסה שוב.',
  uwConflictOfflineWeb:
    'אתה במצב לא מקוון. באינטרנט הפעולה הזו דורשת חיבור; השינויים שלך נשארים בדפדפן הזה.',

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

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'אין לך עוד גישה למסמך הזה. השמירה נעצרה; שינויים שלא נשמרו נשמרים בדפדפן הזה עד שתתנתק.',
  uwRemoteOrgBlockedWeb:
    'לא ניתן היה לשמור: {reason}. שינויים שלא נשמרו נשמרים בדפדפן הזה עד שתתנתק.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'המסמך הועבר לארכיון',
  uwReasonSuspended: 'הארגון מושעה',
  uwReasonDeactivated: 'החשבון שלך מושבת בארגון הזה',
} satisfies Record<keyof typeof zh, string>
