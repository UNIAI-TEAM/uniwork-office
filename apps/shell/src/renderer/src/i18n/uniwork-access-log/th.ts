import type { zh } from './zh'

export const th = {
  algMenu: 'บันทึกการเข้าถึง',
  algTitle: 'บันทึกการเข้าถึง',
  algDescription: 'ใครดู ดาวน์โหลด หรือเปิดเอกสารผ่านลิงก์ เฉพาะผู้จัดการเท่านั้นที่อ่านได้',
  algManageOnly: 'คุณต้องมีสิทธิ์จัดการจึงจะอ่านบันทึกการเข้าถึงได้',
  algLoading: 'กำลังโหลดบันทึก…',
  algError: 'ไม่สามารถโหลดบันทึกการเข้าถึงได้',
  algEmpty: 'ยังไม่มีการเข้าถึงที่บันทึกไว้',
  algFilterLabel: 'การดำเนินการ',
  algFilterAll: 'ทุกการดำเนินการ',
  algActionView: 'ดู',
  algActionDownload: 'ดาวน์โหลด',
  algActionExport: 'ส่งออก',
  algActionLinkView: 'เปิดผ่านลิงก์',
  algActionUnknown: 'อื่น ๆ',
  algActorAnonymous: 'ไม่ระบุตัวตน',
  algActorSystem: 'ระบบ',
  algActorUnknown: 'ไม่ทราบ',
  algVersion: 'เวอร์ชัน {no}',
} satisfies Record<keyof typeof zh, string>
