import type { zh } from './zh'

export const th = {
  usMyFolder: 'โฟลเดอร์ของฉัน',
  usPrivateTag: 'ส่วนตัว',
  usDialogTitle: 'ตั้งชื่อเอกสาร',
  usHint: 'บันทึกครั้งแรก การบันทึกครั้งต่อไปจะใช้ชื่อเดิม หากต้องการเปลี่ยนให้ใช้ "บันทึกเป็น"',
  usName: 'ชื่อ',
  usLocation: 'ที่บันทึก',
  usSavingIn: 'กำลังบันทึกใน: {folder}',
  usMyFolderPrivate: 'ส่วนตัว เห็นได้เฉพาะคุณ',
  usChange: 'เปลี่ยน',
  usSave: 'บันทึก',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'ปิด',
  usPickTitle: 'เลือกที่บันทึก',
  usBack: 'กลับไปตั้งชื่อ',
  usSearchFolders: 'ค้นหาโฟลเดอร์',
  usSharedNote: 'เมื่อบันทึกลงในโฟลเดอร์ที่แชร์ เอกสารจะได้รับสิทธิ์ของโฟลเดอร์นั้น',
  usChooseFolder: 'เลือก "{folder}"',
  usSelected: 'เลือกอยู่',
  usRootBlocked: 'โปรดเลือกโฟลเดอร์',
  usErrInvalidDestination: 'บันทึกที่นี่ไม่ได้ โปรดเลือกโฟลเดอร์อื่น',
  usErrMyFolderLocked:
    'โฟลเดอร์ของฉันเป็นโฟลเดอร์ระบบส่วนตัว จึงเปลี่ยนชื่อ แชร์ ย้าย หรือเก็บถาวรไม่ได้',
  usErrFlushFailed: 'ยังเขียนเอกสารลงในเครื่องนี้ไม่ได้ โปรดบันทึกเอกสารก่อนแล้วลองอีกครั้ง',
  usErrBindFailed:
    'สร้าง "{title}" (ID {id}) แล้ว แต่เชื่อมกับแท็บนี้ไม่ได้ เอกสารถูกย้ายไปถังขยะแล้วและกู้คืนได้',
  usErrOrphaned:
    'สร้าง "{title}" (ID {id}) ใน UniWork แล้ว แต่เชื่อมกับแท็บนี้ไม่ได้และย้ายไปถังขยะก็ไม่ได้ โปรดลบหรือใช้เอกสารนั้นใน UniWork',
  usErrAlreadyBound: 'แท็บนี้เชื่อมกับเอกสาร UniWork อยู่แล้ว บันทึกได้ตามปกติ',
  usErrNotFound: 'ไม่พบไฟล์ที่จะบันทึกหรือโฟลเดอร์ที่เลือก โปรดเลือกที่บันทึกใหม่แล้วลองอีกครั้ง',
} satisfies Record<keyof typeof zh, string>
