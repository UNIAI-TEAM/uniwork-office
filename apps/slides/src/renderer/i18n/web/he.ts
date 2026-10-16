import type { zh } from './zh'

export const he = {
  webConflictTitle: 'המצגת הזו שונתה במקום אחר',
  webConflictBody: 'השינויים שלך עדיין לא ב-UniWork והם נשמרים בדפדפן הזה עד שתתנתק.',
  webConflictOverwrite: 'דריסה…',
  webConflictReload: 'טעינת הגרסה האחרונה',
  webConflictNotSaved: 'המצגת שונתה במקום אחר',
  webDiscardTitle: 'לבטל שינויים שלא נשמרו?',
  webDiscardBody: 'במצגת זו יש שינויים שלא נשמרו. פתיחת קובץ אחר תגרום לאובדנם.',
  webDiscard: 'ביטול ופתיחה',
  webCancel: 'ביטול',
  webOk: 'אישור',
  webFatalTitle: 'לא ניתן לפתוח את המצגת',
  webFatalBody: 'לא ניתן לטעון את הקובץ מ-UniWork. סגור כרטיסייה זו ונסה שוב.',
  webRefusedTooLarge: 'מצגת זו גדולה מדי או מורכבת מדי לפתיחה באינטרנט.',
  webRefusedTooComplex: 'מצגת זו מורכבת מדי לפתיחה באינטרנט ({parts} חלקים, מגבלה {limit}).',
  webRefusedOutOfMemory: 'מצגת זו גדולה מדי וזיכרון הדפדפן אזל בעת הפתיחה.',
  webNoHost: 'העורך הזה פועל בתוך UniWork. פתח את המצגת מ-UniWork.',
  webLegacyPpt:
    'זהו קובץ ‎.ppt ישן ולא ניתן לפתוח אותו בדפדפן. שמור אותו תחילה כ-‎.pptx ב-PowerPoint.',
  webEncryptedPptx: 'מצגת זו מוגנת בסיסמה ולא ניתן לפתוח אותה בדפדפן.',
  webCommentAuthor: 'משתמש',
  webExternalMedia: 'מדיה חיצונית מקושרת מופעלת רק באפליקציית שולחן העבודה.',
  webReadOnly: 'מצגת זו לקריאה בלבד.',
  webSaveNetwork: 'לא ניתן להתחבר ל-UniWork. בדקו את החיבור ונסו שוב.',
  webSaveTimeout: 'השמירה ארכה זמן רב מדי. בדקו את החיבור ונסו שוב.',
  webFullscreenHint: 'לחצו או הקישו על מקש כלשהו כדי לעבור למסך מלא',
} satisfies Record<keyof typeof zh, string>
