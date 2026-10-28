import type { zh } from './zh'

export const th = {
  searchMatchCase: 'จับคู่ตามตัวพิมพ์',
  searchWholeWord: 'จับคู่ทั้งคำ',
  commentsPanel: 'ความคิดเห็น',
  commentsFilter: 'กรองความคิดเห็นตามข้อความหรือผู้เขียน',
  commentsEmpty: 'ยังไม่มีความคิดเห็นในเอกสารนี้',
  commentsLoading: 'กำลังโหลดความคิดเห็น',
  editLink: 'ลิงก์',
  editLinkHint: 'ลากกรอบบนหน้าเพื่อเพิ่มไฮเปอร์ลิงก์',
  linkDialogTitle: 'เพิ่มลิงก์',
  linkUrlLabel: 'ที่อยู่เว็บ',
  linkPageLabel: 'หรือหน้าในเอกสารนี้ (1–{n})',
} satisfies Record<keyof typeof zh, string>
