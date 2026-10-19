import type { zh } from './zh'

export const he = {
  usMyFolder: 'התיקייה שלי',
  usPrivateTag: 'פרטי',
  usDialogTitle: 'מתן שם למסמך',
  usHint: 'שמירה ראשונה. בשמירות הבאות השם יישאר; כדי לשנות אותו השתמשו ב"שמירה בשם".',
  usName: 'שם',
  usLocation: 'מיקום',
  usSavingIn: 'שמירה בתוך: {folder}',
  usMyFolderPrivate: 'פרטי, רק לך גלוי',
  usChange: 'שינוי',
  usSave: 'שמירה',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'סגירה',
  usPickTitle: 'בחירת מקום השמירה',
  usBack: 'חזרה למתן שם',
  usSearchFolders: 'חיפוש תיקיות',
  usChooseFolder: 'בחירת "{folder}"',
  usSelected: 'נבחר',
  usRootBlocked: 'יש לבחור תיקייה',
  usErrInvalidDestination: 'אי אפשר לשמור כאן. בחרו תיקייה אחרת.',
  usErrMyFolderLocked:
    'התיקייה שלי היא תיקיית מערכת אישית, ואי אפשר לשנות את שמה, לשתף, להעביר או להעביר לארכיון.',
  usErrFlushFailed: 'עדיין לא ניתן היה לכתוב את המסמך למכשיר הזה. שמרו קודם את המסמך ונסו שוב.',
  usErrBindFailed:
    '"{title}" (מזהה {id}) נוצר, אך לא ניתן היה לקשר אותו ללשונית הזו. המסמך הועבר לאשפה ואפשר לשחזר אותו.',
  usErrOrphaned:
    '"{title}" (מזהה {id}) נוצר ב-UniWork, אך לא ניתן היה לקשר אותו ללשונית הזו או להעביר אותו לאשפה. מחקו את המסמך או השתמשו בו ב-UniWork.',
  usErrAlreadyBound: 'הלשונית הזו כבר מקושרת למסמך UniWork. שמרו כרגיל.',
  usErrNotFound: 'הקובץ לשמירה או התיקייה שנבחרה לא נמצאו. בחרו שוב את מקום השמירה ונסו שוב.',
} satisfies Record<keyof typeof zh, string>
