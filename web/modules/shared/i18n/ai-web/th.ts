import type { zh } from './zh'

export const th = {
  aiWebClose: 'ปิด',
  aiWebStateCreditsTitle: 'เครดิต AI หมดแล้ว',
  aiWebStateCreditsBody:
    'องค์กรของคุณใช้เครดิต UniWork AI ของรอบนี้หมดแล้ว โปรดติดต่อผู้ดูแลระบบหรือรอรอบใหม่',
  aiWebStateEntitlementTitle: 'แพ็กเกจไม่มี AI',
  aiWebStateEntitlementBody:
    'แพ็กเกจ UniWork ขององค์กรคุณไม่รวมฟีเจอร์ AI นี้ โปรดติดต่อผู้ดูแลระบบ',
  aiWebStateRateTitle: 'คำขอ AI มากเกินไป',
  aiWebStateRateBody: 'โปรดรอ {seconds} วินาทีแล้วลองอีกครั้ง',
  aiWebStateRateBodyNow: 'โปรดรอสักครู่แล้วลองอีกครั้ง',
  aiWebStateUnreachableTitle: 'เชื่อมต่อผู้ให้บริการ AI ไม่ได้',
  aiWebStateUnreachableBody: 'UniWork เชื่อมต่อผู้ให้บริการ AI ไม่ได้ โปรดลองอีกครั้งในอีกสักครู่',
  aiWebStateCloudTitle: 'เครื่องมือคลาวด์ใช้งานไม่ได้',
  aiWebStateCloudBody: 'เครื่องมือ UniWork AI นี้ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์',
  aiWebStateOutageTitle: 'UniWork ใช้งานไม่ได้ชั่วคราว',
  aiWebStateOutageBody: 'ตอนนี้เชื่อมต่อ UniWork ไม่ได้ โปรดลองอีกครั้งในอีกสักครู่',
  aiWebStateSessionTitle: 'เซสชันหมดอายุ',
  aiWebStateSessionBody: 'เปิดเอกสารอีกครั้งจาก UniWork เพื่อดำเนินการต่อ',
  aiWebStateRefusedTitle: 'คำขอถูกปฏิเสธ',
  aiWebStateRefusedBody: 'เซิร์ฟเวอร์ปฏิเสธคำขอ AI',
  aiWebStateUnknownTitle: 'คำขอ AI ล้มเหลว',
  aiWebStateUnknownBody: 'เกิดข้อผิดพลาด โปรดลองอีกครั้ง',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge: 'เวิร์กบุ๊กนี้ใหญ่เกินไปสำหรับ AI บนเว็บ เปิดในแอป UniWork Office',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'ทำส่วนถัดไปต่อ',
} satisfies Record<keyof typeof zh, string>
