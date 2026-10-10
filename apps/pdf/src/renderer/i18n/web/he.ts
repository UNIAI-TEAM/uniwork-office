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
  webReloaded: 'הגרסה העדכנית נטענה מחדש והשינויים שלך נמחקו',
  webViewOnlyNoSave: 'מסמך זה לצפייה בלבד',
  webMergeTitle: 'מיזוג קובצי PDF',
  webMergeBody: 'נבחרו {count} קובצי PDF. להוסיף קובץ PDF נוסף או למזג עכשיו?',
  webMergeAdd: 'הוספת קובץ PDF נוסף',
  webMergeNow: 'מיזוג עכשיו',
  webSaveNetwork: 'לא ניתן להתחבר ל-UniWork. בדקו את החיבור ונסו שוב.',
  webSaveTimeout: 'השמירה ארכה זמן רב מדי. בדקו את החיבור ונסו שוב.',
  webAppOnlyHint: 'פתחו באפליקציית UniWork Office כדי להשתמש בתכונה זו',
  webAppOnlyOpen: 'פתח באפליקציה',
  webAppOnlyOcr: 'ב-PDF זה יש עמודים סרוקים. זיהוי טקסט (OCR) אינו זמין כאן.',
  webAppOnlyConvert: 'המרת PDF ל-Word, Excel או PowerPoint אינה זמינה כאן.',
} satisfies Record<keyof typeof zh, string>
