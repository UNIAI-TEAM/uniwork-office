import type { zh } from './zh'

export const hi = {
  backlinks: 'बैकलिंक',
  backlinksEmpty: 'अभी कोई नोट यहाँ लिंक नहीं करता।',
  backlinksRefresh: 'बैकलिंक रीफ़्रेश करें',
  graph: 'ग्राफ़ दृश्य',
  graphClose: 'ग्राफ़ बंद करें',
  graphEmpty: 'वॉल्ट में अभी कोई नोट नहीं है।',
  graphTruncated: 'बहुत अधिक नोट्स: ग्राफ़ पहली {shown} / {total} दिखाता है।',
  suggestCreateNote: 'नया नोट बनाएँ',
} satisfies Record<keyof typeof zh, string>
