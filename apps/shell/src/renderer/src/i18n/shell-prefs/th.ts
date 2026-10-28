import type { zh } from './zh'

export const th = {
  setRestoreSession: 'เปิดเอกสารจากครั้งที่แล้วอีกครั้ง',
  setRestoreSessionDesc:
    'เอกสารที่เปิดอยู่ตอนปิด UniWork Office จะเปิดขึ้นอีกครั้งโดยอัตโนมัติเมื่อเริ่มโปรแกรมครั้งถัดไป',
  setAutoUpdateCheck: 'ตรวจหาอัปเดตโดยอัตโนมัติ',
  setAutoUpdateCheckDesc:
    'เมื่อปิด UniWork Office จะไม่ตรวจหาเวอร์ชันใหม่ตอนเปิดโปรแกรมหรือในเบื้องหลัง คุณยังตรวจเองได้จาก วิธีใช้ › ตรวจหาการอัปเดต',
} satisfies Record<keyof typeof zh, string>
