import type { zh } from './zh'

export const he = {
  backlinks: 'קישורים נכנסים',
  backlinksEmpty: 'אף פתק לא מקשר לכאן עדיין.',
  backlinksRefresh: 'רענון קישורים נכנסים',
  graph: 'תצוגת גרף',
  graphClose: 'סגירת הגרף',
  graphEmpty: 'עדיין אין פתקים בכספת.',
  graphTruncated: 'יותר מדי הערות: הגרף מציג את {shown} הראשונות מתוך {total}.',
  suggestCreateNote: 'צור פתק חדש',
  tags: 'תגיות',
  tagsEmpty: 'אין עדיין #תגיות בכספת',
  blockLink: 'העתק קישור לבלוק',
  blockLinkCopied: '{link} הועתק',
  blockLinkNone: 'אין כאן בלוק לקישור',
} satisfies Record<keyof typeof zh, string>
