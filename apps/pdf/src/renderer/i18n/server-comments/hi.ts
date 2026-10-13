import type { zh } from './zh'

export const hi = {
  serverCommentStartUnavailable: 'अभी इस दस्तावेज़ में नई टिप्पणी नहीं जोड़ी जा सकती।',
  serverCommentSaveFirst: 'टिप्पणी जोड़ने के लिए पहले दस्तावेज़ सहेजें',
} satisfies Record<keyof typeof zh, string>
