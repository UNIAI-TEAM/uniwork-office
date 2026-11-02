import type { zh } from './zh'

export const he = {
  cloudTitle: 'בינה מלאכותית בענן של UniWork',
  cloudStateReady: 'זמין',
  cloudStateNotEntitled: 'לא כלול בתוכנית שלך',
  cloudStateExhausted: 'נגמרו קרדיטי ה-AI',
  cloudStateUnavailable: 'לא זמין',
  cloudStateInactive: 'המנוי אינו פעיל',
  cloudCredits: 'קרדיטי AI',
  cloudCreditsLeft: 'נותרו {remaining} / {limit}',
  cloudCreditsUnlimited: 'ללא הגבלה',
  cloudCreditsRenews: 'יתחדש ב-{date}',
  cloudToolsToggle: 'שימוש בכלי הענן של UniWork',
  cloudToolsToggleDesc:
    'ללא ספק משלך, חיפוש באינטרנט, יצירת תמונות וניתוח מדיה עוברים דרך הענן של UniWork (צורך קרדיטי AI).',
} satisfies Record<keyof typeof zh, string>
