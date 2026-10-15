import type { zh } from './zh'

export const hi = {
  aiRunUndo: 'इस रन को पूर्ववत करें',
  aiRunUndoDone: 'रन पूर्ववत किया गया',
  aiRunUndoLater: 'इस रन के बाद और बदलाव हुए हैं। पहले उन्हें पूर्ववत करें, फिर इस रन को।',
  aiRunUndoBusy: 'सहायक के काम पूरा करने पर उपलब्ध होगा।',
  aiEditsPaused:
    'सहायक इस दस्तावेज़ को संपादित कर रहा है। आपके संपादन रोक दिए गए हैं; जारी रखने के लिए सहायक को रोकें।',
} satisfies Record<keyof typeof zh, string>
