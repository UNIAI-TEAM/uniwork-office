import type { zh } from './zh'

export const he = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'קרדיטים שנותרו: {remaining} מתוך {limit}',
  aiUniworkFooterSignIn: 'התחבר ל-UniWork כדי להשתמש ב-UniWork AI',
  aiUniworkSignedOut: 'התנתקת מ-UniWork. בחר ספק אחר או התחבר מחדש.',
  aiUniworkOff: 'UniWork AI כבוי עבור המסמך הזה. בחר ספק אחר.',
  aiUniworkViewOnly: 'צפייה בלבד: ה-AI יכול לענות אבל לא לערוך או לשמור את המסמך.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI קורא את מה שפתוח במסמך הזה, כולל שינויים שלא נשמרו, ושולח אותו ל-UniWork ולספק המודל כדי לענות. כל הרצה משתמשת בקרדיטים של AI של {org}. ה-AI אף פעם לא שומר בשבילך: בדוק ואז לחץ על שמירה.',
  aiUniworkDisclosureLabel: 'מה UniWork AI מקבל',
  aiUniworkDisclosureShort: 'שולח את התוכן הפתוח (כולל מה שלא נשמר) ל-UniWork · קרדיטים של {org}',
  aiUniworkLocalFile:
    'הקובץ הזה נמצא במחשב שלך, לא ב-UniWork. עם UniWork AI, תוכן הקובץ הפתוח נשלח ל-UniWork ומשתמש בקרדיטים של AI של {org}. הקובץ לא מועלה כמסמך UniWork.',
  aiUniworkAck: 'הבנתי',
  aiUniworkLearnMore: 'מידע נוסף',
  aiUniworkDetails: 'פרטים',
  aiUniworkSendNeedsAck: 'קרא ואשר את ההודעה לפני השליחה.',

  // S9 result chips and run controls
  aiResultAnswer: 'תשובה',
  aiResultClarify: 'נדרשת הבהרה',
  aiResultEdited: 'נערך במסמך',
  aiResultUnsupported: 'לא נתמך',
  aiResultError: 'שגיאה',
  aiResultEditedHint: 'לא נשמר — בטל עם Ctrl/⌘+Z, או לחץ על שמירה כשהכול נראה תקין.',
  aiResultViewChanges: 'הצגת השינויים',
  aiRunStop: 'עצירה',
  aiRunSend: 'שליחה',
  aiRunRunning: 'פועל… לחץ על עצירה או Esc כדי לעצור.',
  aiRunStopped: 'נעצר. שינויים שכבר הוחלו נשארים במסמך וניתן לבטל אותם.',
  aiRunAskAgain: 'שאל שוב',
  aiRunChooseOther: 'בחירת ספק אחר',
  aiRunOpenInApp: 'פתיחה באפליקציה',
  aiConversationRestarted:
    'השיחה הקודמת פגה, ולכן UniWork AI התחיל שיחה חדשה ואינו זוכר עוד את התורות הקודמים. שלח שוב את השאלה כדי להמשיך.',
  aiConversationBoundary: 'שיחה חדשה עם {provider}: התורות שלמעלה לא נשלחים.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'ההרצה הזו הגיעה למגבלת השלבים של UniWork AI. התוצאות עד כה נשמרות; פצל את הבקשה ושאל שוב.',
  aiErrCredits: 'לארגון שלך נגמרו הקרדיטים של AI לתקופה הזו. ההרצה נעצרה.',
  aiErrEntitlement: 'התוכנית של הארגון שלך כבר לא כוללת את UniWork AI.',
  aiErrRateLimited: 'אתה שולח מהר מדי. נסה שוב בעוד {seconds} שנ׳.',
  aiErrRateLimitedNoWait: 'אתה שולח מהר מדי. נסה שוב בעוד כמה דקות.',
  aiErrUnavailable: 'UniWork AI לא מגיב כרגע. המסמך שלך והשמירה עדיין עובדים.',
  aiErrDisconnected:
    'החיבור נותק ולכן ההרצה נעצרה. שינויים שכבר הוחלו נשארים במסמך וניתן לבטל אותם.',
  aiErrOffline: 'אתה במצב לא מקוון. UniWork AI לא פועל במצב לא מקוון ובקשות לא נכנסות לתור.',
  aiErrSession: 'ההפעלה שלך ב-UniWork פגה ולכן ההרצה נעצרה. התחבר שוב כדי להמשיך.',
  aiErrRevoked: 'כבר אין לך גישה למסמך הזה ולכן הרצת ה-AI נעצרה.',
  aiErrDowngraded: 'הגישה שלך שונתה עכשיו לצפייה בלבד ולכן ה-AI הפסיק לערוך. התשובות ממשיכות.',
  aiErrCapabilityOff: 'UniWork AI כובה עכשיו עבור המסמך הזה ולכן ההרצה נעצרה אחרי השלב הנוכחי.',
  aiErrUnsupported: 'UniWork AI עדיין לא יכול לעשות את זה ב-{module}.',
  aiErrViewOnlyEdit: 'יש לך רק גישת צפייה למסמך הזה ולכן ה-AI לא יכול לערוך אותו.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong: 'הבקשה ארוכה מדי עבור UniWork AI. קצר אותה לפחות מ-8,000 תווים ושלח שוב.',
  aiErrQuestionRejected: 'UniWork AI לא יכול לקבל את הבקשה הזו. שנה אותה ושלח שוב.',
  aiUniworkImagesNotSent: 'תמונות לא נשלחות ל-UniWork AI; נשלח רק הטקסט שלך.',
} satisfies Record<keyof typeof zh, string>
