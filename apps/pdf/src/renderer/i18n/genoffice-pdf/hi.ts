import type { zh } from './zh'

export const hi = {
  searchMatchCase: 'अक्षर-स्थिति मिलाएँ',
  searchWholeWord: 'पूरे शब्द',
  commentsPanel: 'टिप्पणियाँ',
  commentsFilter: 'टेक्स्ट या लेखक के अनुसार टिप्पणियाँ छाँटें',
  commentsEmpty: 'इस दस्तावेज़ में अभी कोई टिप्पणी नहीं है',
  commentsLoading: 'टिप्पणियाँ लोड हो रही हैं',
} satisfies Record<keyof typeof zh, string>
