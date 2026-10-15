import type { zh } from './zh'

export const hi = {
  aiRunUndo: 'इस रन को पूर्ववत करें',
  aiRunUndoDone: 'रन पूर्ववत किया गया',
  aiRunUndoLater: 'इस रन के बाद और बदलाव हुए हैं। पहले उन्हें पूर्ववत करें, फिर इस रन को।',
  aiRunUndoBusy: 'सहायक के काम पूरा करने पर उपलब्ध होगा।',
} satisfies Record<keyof typeof zh, string>
