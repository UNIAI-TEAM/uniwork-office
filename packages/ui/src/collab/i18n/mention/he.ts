import type { zh } from './zh'

export const he = {
  collabMentionLabel: 'הזכרת מישהו',
  collabMentionSearching: 'מחפש…',
  collabMentionCount: 'תוצאות: {count}',
  collabMentionNoMatch: 'אף אחד מבעלי הגישה למסמך הזה לא תואם ל-“{query}”.',
  collabMentionNoCandidates: 'עדיין אין אף אחד אחר עם גישה למסמך הזה.',
  collabMentionError: 'לא ניתן לטעון את רשימת האנשים.',
} satisfies Record<keyof typeof zh, string>
