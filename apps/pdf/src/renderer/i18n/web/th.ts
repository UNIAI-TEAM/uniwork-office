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
  webReloaded: 'โหลดเวอร์ชันล่าสุดใหม่แล้ว และละทิ้งการเปลี่ยนแปลงของคุณ',
  webViewOnlyNoSave: 'เอกสารนี้ดูได้อย่างเดียว',
  webMergeTitle: 'รวม PDF',
  webMergeBody: 'เลือก PDF แล้ว {count} ไฟล์ จะเพิ่ม PDF อีกหรือรวมเลย?',
  webMergeAdd: 'เพิ่ม PDF อีก',
  webMergeNow: 'รวมเลย',
  webSaveNetwork: 'เชื่อมต่อ UniWork ไม่ได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webSaveTimeout: 'การบันทึกใช้เวลานานเกินไป โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webAppOnlyHint: 'เปิดในแอป UniWork Office เพื่อใช้ฟีเจอร์นี้',
  webAppOnlyOpen: 'เปิดในแอป',
  webAppOnlyOcr: 'PDF นี้มีหน้าที่สแกน ไม่สามารถใช้การรู้จำข้อความ (OCR) ที่นี่ได้',
  webAppOnlyConvert: 'ไม่สามารถแปลง PDF เป็น Word, Excel หรือ PowerPoint ที่นี่ได้',
} satisfies Record<keyof typeof zh, string>
