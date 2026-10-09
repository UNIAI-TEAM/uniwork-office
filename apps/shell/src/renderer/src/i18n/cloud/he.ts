import type { zh } from './zh'

export const he = {
  cloudTitle: 'בינה מלאכותית בענן של UniWork',
  cloudStatus: 'מצב',
  cloudStateReady: 'זמין',
  cloudStateNotEntitled: 'לא כלול בתוכנית שלך',
  cloudStateExhausted: 'נגמרו קרדיטי ה-AI',
  cloudStateUnavailable: 'לא זמין',
  cloudCredits: 'קרדיטי AI',
  cloudCreditsLeft: 'נותרו {remaining} / {limit}',
  cloudCreditsUnlimited: 'ללא הגבלה',
  cloudCreditsRenews: 'יתחדש ב-{date}',
  cloudSignedOutBody:
    'התחברו ל-UniWork כדי להשתמש בחיפוש באינטרנט, ביצירת תמונות ובניתוח מדיה בתשלום מקרדיטי ה-AI של הארגון.',
  cloudNotEntitledBody:
    'התוכנית של הארגון שלך לא כוללת בינה מלאכותית בענן של UniWork. עדיין אפשר להשתמש בספקים שלך למטה.',
  cloudExhaustedBody:
    'הארגון שלך ניצל את כל קרדיטי ה-AI של UniWork לתקופה זו. כלי הענן מושהים עד לחידוש; הספקים שלך למטה ממשיכים לעבוד.',
  cloudUnavailableBody:
    'הבינה המלאכותית בענן של UniWork אינה זמינה כרגע. הספקים שלך למטה ממשיכים לעבוד.',
  cloudReadyBody:
    'ללא ספק משלך, חיפוש, יצירת תמונות וניתוח מדיה משתמשים בקרדיטי ה-AI של UniWork של הארגון.',
  cloudToolsToggle: 'שימוש בכלי הענן של UniWork',
  cloudToolsToggleDesc:
    'ללא ספק משלך, חיפוש באינטרנט, יצירת תמונות וניתוח מדיה עוברים דרך הענן של UniWork (צורך קרדיטי AI).',
  cloudMediaLabel: 'הענן של UniWork',
  cloudMediaDesc: 'משתמש בקרדיטי ה-AI של UniWork של הארגון; אין צורך במפתח.',
  cloudSearchAutoHint: 'קודם הענן של UniWork (צורך קרדיטי AI), אחר כך חיפוש חינמי.',
} satisfies Record<keyof typeof zh, string>
