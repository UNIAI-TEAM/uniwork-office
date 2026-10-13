import type { zh } from './zh'

export const th = {
  collabMentionLabel: 'กล่าวถึงใครสักคน',
  collabMentionSearching: 'กำลังค้นหา…',
  collabMentionCount: 'ผลลัพธ์: {count}',
  collabMentionNoMatch: 'ไม่มีผู้ที่เข้าถึงเอกสารนี้ได้ตรงกับ “{query}”',
  collabMentionNoCandidates: 'ยังไม่มีคนอื่นที่เข้าถึงเอกสารนี้ได้',
  collabMentionError: 'โหลดรายชื่อบุคคลไม่สำเร็จ',
} satisfies Record<keyof typeof zh, string>
