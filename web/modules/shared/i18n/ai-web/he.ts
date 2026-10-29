import type { zh } from './zh'

export const he = {
  aiWebClose: 'סגירה',
  aiWebStateCreditsTitle: 'קרדיטי ה-AI נגמרו',
  aiWebStateCreditsBody:
    'הארגון שלך ניצל את כל קרדיטי UniWork AI לתקופה זו. פנה למנהל המערכת או המתן לחידוש.',
  aiWebStateEntitlementTitle: 'AI לא כלול בתוכנית שלך',
  aiWebStateEntitlementBody:
    'תוכנית UniWork של הארגון שלך אינה כוללת את תכונת ה-AI הזו. פנה למנהל המערכת.',
  aiWebStateRateTitle: 'יותר מדי בקשות AI',
  aiWebStateRateBody: 'המתן {seconds} שניות ונסה שוב.',
  aiWebStateRateBodyNow: 'המתן רגע ונסה שוב.',
  aiWebStateUnreachableTitle: 'אין גישה לספק ה-AI',
  aiWebStateUnreachableBody: 'UniWork לא הצליח להגיע לספק ה-AI. נסה שוב בעוד רגע.',
  aiWebStateCloudTitle: 'כלי הענן אינו זמין',
  aiWebStateCloudBody: 'כלי UniWork AI זה עדיין לא הוגדר בשרת.',
  aiWebStateOutageTitle: 'UniWork אינו זמין זמנית',
  aiWebStateOutageBody: 'לא ניתן להגיע ל-UniWork כרגע. נסה שוב בעוד רגע.',
  aiWebStateSessionTitle: 'פג תוקף ההפעלה',
  aiWebStateSessionBody: 'פתח שוב את המסמך מ-UniWork כדי להמשיך.',
  aiWebStateRefusedTitle: 'הבקשה נדחתה',
  aiWebStateRefusedBody: 'השרת דחה את בקשת ה-AI.',
  aiWebStateUnknownTitle: 'בקשת ה-AI נכשלה',
  aiWebStateUnknownBody: 'משהו השתבש. נסה שוב.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'חוברת העבודה הזו גדולה מדי ל-AI באינטרנט. פתח אותה באפליקציית UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'המשך לחלק הבא.',
} satisfies Record<keyof typeof zh, string>
