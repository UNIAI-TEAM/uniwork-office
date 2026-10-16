import type { zh } from './zh'

export const th = {
  webConflictTitle: 'งานนำเสนอนี้ถูกเปลี่ยนแปลงจากที่อื่น',
  webConflictBody:
    'การเปลี่ยนแปลงของคุณยังไม่อยู่บน UniWork และจะเก็บไว้ในเบราว์เซอร์นี้จนกว่าคุณจะออกจากระบบ',
  webConflictOverwrite: 'เขียนทับ…',
  webConflictReload: 'โหลดล่าสุดใหม่',
  webConflictNotSaved: 'งานนำเสนอถูกเปลี่ยนแปลงจากที่อื่น',
  webDiscardTitle: 'ละทิ้งการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่',
  webDiscardBody: 'งานนำเสนอนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก การเปิดไฟล์อื่นจะทำให้สูญหาย',
  webDiscard: 'ละทิ้งและเปิด',
  webCancel: 'ยกเลิก',
  webOk: 'ตกลง',
  webFatalTitle: 'ไม่สามารถเปิดงานนำเสนอได้',
  webFatalBody: 'ไม่สามารถโหลดไฟล์จาก UniWork ได้ ปิดแท็บนี้แล้วลองอีกครั้ง',
  webRefusedTooLarge: 'งานนำเสนอนี้มีขนาดใหญ่หรือซับซ้อนเกินกว่าจะเปิดบนเว็บได้',
  webRefusedTooComplex:
    'งานนำเสนอนี้ซับซ้อนเกินกว่าจะเปิดบนเว็บได้ ({parts} ส่วน ขีดจำกัด {limit})',
  webRefusedOutOfMemory:
    'งานนำเสนอนี้มีขนาดใหญ่เกินไปและหน่วยความจำของเบราว์เซอร์ไม่เพียงพอขณะเปิด',
  webNoHost: 'ตัวแก้ไขนี้ทำงานภายใน UniWork โปรดเปิดงานนำเสนอจาก UniWork',
  webLegacyPpt:
    'นี่คือไฟล์ .ppt รุ่นเก่าซึ่งเปิดในเบราว์เซอร์ไม่ได้ โปรดบันทึกเป็น .pptx ใน PowerPoint ก่อน',
  webEncryptedPptx: 'งานนำเสนอนี้มีการป้องกันด้วยรหัสผ่านและเปิดในเบราว์เซอร์ไม่ได้',
  webCommentAuthor: 'ผู้ใช้',
  webExternalMedia: 'สื่อภายนอกที่ลิงก์ไว้เล่นได้เฉพาะในแอปเดสก์ท็อป',
  webReadOnly: 'งานนำเสนอนี้เป็นแบบอ่านอย่างเดียว',
  webSaveNetwork: 'เชื่อมต่อ UniWork ไม่ได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webSaveTimeout: 'การบันทึกใช้เวลานานเกินไป โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webFullscreenHint: 'คลิกหรือกดปุ่มใดก็ได้เพื่อเข้าสู่โหมดเต็มหน้าจอ',
} satisfies Record<keyof typeof zh, string>
