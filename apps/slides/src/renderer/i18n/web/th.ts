import type { zh } from './zh'

export const th = {
  webConflictTitle: 'งานนำเสนอนี้ถูกเปลี่ยนแปลงจากที่อื่น',
  webConflictBody:
    'มีผู้บันทึกเวอร์ชันที่ใหม่กว่า เขียนทับจะแทนที่ด้วยการเปลี่ยนแปลงของคุณ โหลดล่าสุดใหม่จะละทิ้งการเปลี่ยนแปลงของคุณและเปิดเวอร์ชันล่าสุด',
  webConflictOverwrite: 'เขียนทับ',
  webConflictReload: 'โหลดล่าสุดใหม่',
  webConflictNotSaved: 'งานนำเสนอถูกเปลี่ยนแปลงจากที่อื่น',
  webDiscardTitle: 'ละทิ้งการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่',
  webDiscardBody: 'งานนำเสนอนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก การเปิดไฟล์อื่นจะทำให้สูญหาย',
  webDiscard: 'ละทิ้งและเปิด',
  webCancel: 'ยกเลิก',
  webOk: 'ตกลง',
  webFatalTitle: 'ไม่สามารถเปิดงานนำเสนอได้',
  webFatalBody: 'ไม่สามารถโหลดไฟล์จาก UniWork ได้ ปิดแท็บนี้แล้วลองอีกครั้ง',
  webNoHost: 'ตัวแก้ไขนี้ทำงานภายใน UniWork โปรดเปิดงานนำเสนอจาก UniWork',
  webLegacyPpt:
    'นี่คือไฟล์ .ppt รุ่นเก่าซึ่งเปิดในเบราว์เซอร์ไม่ได้ โปรดบันทึกเป็น .pptx ใน PowerPoint ก่อน',
  webEncryptedPptx: 'งานนำเสนอนี้มีการป้องกันด้วยรหัสผ่านและเปิดในเบราว์เซอร์ไม่ได้',
  webCommentAuthor: 'ผู้ใช้',
  webExternalMedia: 'สื่อภายนอกที่ลิงก์ไว้เล่นได้เฉพาะในแอปเดสก์ท็อป',
  webReadOnly: 'งานนำเสนอนี้เป็นแบบอ่านอย่างเดียว',
} satisfies Record<keyof typeof zh, string>
