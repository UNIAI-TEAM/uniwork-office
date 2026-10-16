import type { zh } from './zh'

export const ar = {
  aiRunUndo: 'تراجع عن هذه الجولة',
  aiRunUndoDone: 'تم التراجع عن الجولة',
  aiRunUndoLater: 'هناك تغييرات أُجريت بعد هذه الجولة. تراجع عنها أولًا ثم تراجع عن الجولة.',
  aiRunUndoBusy: 'يتوفر عندما ينتهي المساعد.',
  aiEditsPaused: 'المساعد يعمل على هذا المستند. تعديلاتك متوقفة مؤقتًا؛ أوقف المساعد للمتابعة.',
} satisfies Record<keyof typeof zh, string>
