import type { zh } from './zh'

export const hi = {
  collabMentionLabel: 'किसी का उल्लेख करें',
  collabMentionSearching: 'खोज रहे हैं…',
  collabMentionCount: 'परिणाम: {count}',
  collabMentionNoMatch:
    'इस दस्तावेज़ तक पहुँच रखने वाला कोई भी व्यक्ति “{query}” से मेल नहीं खाता।',
  collabMentionNoCandidates: 'अभी तक किसी और की इस दस्तावेज़ तक पहुँच नहीं है।',
  collabMentionError: 'लोगों की सूची लोड नहीं हो सकी।',
  collabMentionNoAccessBadge: 'देख नहीं सकते',
} satisfies Record<keyof typeof zh, string>
