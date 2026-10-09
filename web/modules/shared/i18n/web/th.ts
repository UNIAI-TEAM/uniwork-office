import type { zh } from './zh'

export const th = {
  webCancel: 'ยกเลิก',
  webConflictTitle: 'เอกสารนี้ถูกแก้ไขจากที่อื่น',
  webConflictBody:
    'มีการบันทึกเวอร์ชันใหม่กว่าระหว่างที่คุณแก้ไข ต้องการเขียนทับด้วยเวอร์ชันของคุณ หรือโหลดเวอร์ชันล่าสุดใหม่และละทิ้งการเปลี่ยนแปลงของคุณ?',
  webConflictOverwrite: 'เขียนทับ',
  webConflictReload: 'โหลดเวอร์ชันล่าสุด',
  webConflictNotSaved: 'เอกสารถูกแก้ไขจากที่อื่น',
  webFatalTitle: 'ไม่สามารถเปิดเอกสารได้',
  webFatalBody: 'ปิดการแก้ไขและการบันทึกแล้ว โปรดโหลดหน้าใหม่หรือเปิดเอกสารอีกครั้งจาก UniWork',
  webNoHost: 'ตัวแก้ไขนี้ทำงานภายใน UniWork โปรดเปิดเอกสารจาก UniWork',
  webViewOnly: 'ดูอย่างเดียว',
  webViewOnlyNotSaved: 'เอกสารนี้ดูได้อย่างเดียวและบันทึกไม่ได้',
  webNotUtf8:
    'ไฟล์นี้ไม่ใช่ข้อความ UTF-8 จึงเปิดแบบดูอย่างเดียว เพื่อไม่ให้การบันทึกเปลี่ยนเนื้อหา',
} satisfies Record<keyof typeof zh, string>
