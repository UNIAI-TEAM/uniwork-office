import type { zh } from './zh'

export const he = {
  webCancel: 'ביטול',
  webConflictTitle: 'מסמך זה שונה במקום אחר',
  webConflictBody:
    'גרסה חדשה יותר נשמרה בזמן שערכת. לדרוס אותה בגרסה שלך, או לטעון מחדש את הגרסה העדכנית ולבטל את השינויים שלך?',
  webConflictOverwrite: 'דריסה',
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
} satisfies Record<keyof typeof zh, string>
