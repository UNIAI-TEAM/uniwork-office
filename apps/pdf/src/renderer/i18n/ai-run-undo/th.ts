import type { zh } from './zh'

export const th = {
  aiRunUndo: 'ย้อนกลับการทำงานครั้งนี้',
  aiRunUndoDone: 'ย้อนกลับการทำงานแล้ว',
  aiRunUndoLater:
    'มีการแก้ไขหลังการทำงานครั้งนี้ โปรดย้อนกลับการแก้ไขเหล่านั้นก่อน แล้วจึงย้อนกลับการทำงานครั้งนี้',
  aiRunUndoBusy: 'ใช้ได้เมื่อผู้ช่วยทำงานเสร็จ',
} satisfies Record<keyof typeof zh, string>
