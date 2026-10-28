import type { zh } from './zh'

export const th = {
  backlinks: 'ลิงก์ย้อนกลับ',
  backlinksEmpty: 'ยังไม่มีโน้ตที่ลิงก์มาที่นี่',
  backlinksRefresh: 'รีเฟรชลิงก์ย้อนกลับ',
  graph: 'มุมมองกราฟ',
  graphClose: 'ปิดกราฟ',
  graphEmpty: 'ยังไม่มีโน้ตในไลบรารี',
  graphTruncated: 'มีโน้ตมากเกินไป: กราฟแสดง {shown} จาก {total} รายการแรก',
  suggestCreateNote: 'สร้างโน้ตใหม่',
} satisfies Record<keyof typeof zh, string>
