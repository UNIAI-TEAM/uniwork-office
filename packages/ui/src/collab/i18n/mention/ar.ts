import type { zh } from './zh'

export const ar = {
  collabMentionLabel: 'الإشارة إلى شخص',
  collabMentionSearching: 'جارٍ البحث…',
  collabMentionCount: 'النتائج: {count}',
  collabMentionNoMatch: 'لا يوجد أي شخص لديه حق الوصول إلى هذا المستند يطابق “{query}”.',
  collabMentionNoCandidates: 'لا يوجد أي شخص آخر لديه حق الوصول إلى هذا المستند بعد.',
  collabMentionError: 'تعذّر تحميل قائمة الأشخاص.',
} satisfies Record<keyof typeof zh, string>
