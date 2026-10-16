import type { zh } from './zh'

export const he = {
  aiRunUndo: 'ביטול הריצה הזו',
  aiRunUndoDone: 'הריצה בוטלה',
  aiRunUndoLater: 'בוצעו שינויים נוספים אחרי הריצה הזו. בטלו אותם קודם, ואז בטלו את הריצה.',
  aiRunUndoBusy: 'זמין כשהעוזר מסיים.',
  aiEditsPaused: 'העוזר עובד על המסמך הזה. העריכות שלך מושהות; עצור את העוזר כדי להמשיך.',
} satisfies Record<keyof typeof zh, string>
