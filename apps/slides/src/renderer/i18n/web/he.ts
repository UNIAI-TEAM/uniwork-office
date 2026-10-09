import type { zh } from './zh'

export const he = {
  webConflictTitle: 'המצגת הזו שונתה במקום אחר',
  webConflictBody:
    'מישהו שמר גרסה חדשה יותר. דריסה מחליפה אותה בשינויים שלך; טעינת הגרסה האחרונה מבטלת את השינויים שלך ופותחת את הגרסה החדשה ביותר.',
  webConflictOverwrite: 'דריסה',
  webConflictReload: 'טעינת הגרסה האחרונה',
  webConflictNotSaved: 'המצגת שונתה במקום אחר',
  webDiscardTitle: 'לבטל שינויים שלא נשמרו?',
  webDiscardBody: 'במצגת זו יש שינויים שלא נשמרו. פתיחת קובץ אחר תגרום לאובדנם.',
  webDiscard: 'ביטול ופתיחה',
  webCancel: 'ביטול',
  webOk: 'אישור',
  webFatalTitle: 'לא ניתן לפתוח את המצגת',
  webFatalBody: 'לא ניתן לטעון את הקובץ מ-UniWork. סגור כרטיסייה זו ונסה שוב.',
  webNoHost: 'העורך הזה פועל בתוך UniWork. פתח את המצגת מ-UniWork.',
  webLegacyPpt:
    'זהו קובץ ‎.ppt ישן ולא ניתן לפתוח אותו בדפדפן. שמור אותו תחילה כ-‎.pptx ב-PowerPoint.',
  webEncryptedPptx: 'מצגת זו מוגנת בסיסמה ולא ניתן לפתוח אותה בדפדפן.',
  webCommentAuthor: 'משתמש',
  webExternalMedia: 'מדיה חיצונית מקושרת מופעלת רק באפליקציית שולחן העבודה.',
  webReadOnly: 'מצגת זו לקריאה בלבד.',
} satisfies Record<keyof typeof zh, string>
