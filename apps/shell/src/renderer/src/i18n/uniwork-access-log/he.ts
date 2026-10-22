import type { zh } from './zh'

export const he = {
  algMenu: 'יומן גישה',
  algTitle: 'יומן גישה',
  algDescription: 'מי צפה במסמך, הוריד אותו או פתח אותו דרך קישור. רק מנהלים יכולים לקרוא אותו.',
  algManageOnly: 'נדרשת הרשאת ניהול כדי לקרוא את יומן הגישה.',
  algLoading: 'טוען את היומן…',
  algError: 'לא ניתן לטעון את יומן הגישה.',
  algEmpty: 'עדיין לא נרשמה גישה.',
  algFilterLabel: 'פעולה',
  algFilterAll: 'כל הפעולות',
  algActionView: 'צפייה',
  algActionDownload: 'הורדה',
  algActionExport: 'ייצוא',
  algActionLinkView: 'נפתח דרך קישור',
  algActionUnknown: 'אחר',
  algActorAnonymous: 'אנונימי',
  algActorSystem: 'מערכת',
  algActorUnknown: 'לא ידוע',
  algVersion: 'גרסה {no}',
} satisfies Record<keyof typeof zh, string>
