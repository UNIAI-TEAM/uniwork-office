import type { zh } from './zh'

export const he = {
  setRestoreSession: 'פתיחה מחדש של המסמכים מהפעם הקודמת',
  setRestoreSessionDesc:
    'מסמכים שהיו פתוחים כש-UniWork Office נסגרה ייפתחו מחדש אוטומטית בהפעלה הבאה.',
  setAutoUpdateCheck: 'בדיקת עדכונים אוטומטית',
  setAutoUpdateCheckDesc:
    'כשהאפשרות כבויה, UniWork Office לא בודקת גרסאות חדשות בהפעלה או ברקע. עדיין אפשר לבדוק ידנית דרך עזרה › בדוק עדכונים.',
} satisfies Record<keyof typeof zh, string>
