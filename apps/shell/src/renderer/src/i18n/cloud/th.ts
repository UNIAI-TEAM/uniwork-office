import type { zh } from './zh'

export const th = {
  cloudTitle: 'AI คลาวด์ของ UniWork',
  cloudStatus: 'สถานะ',
  cloudStateReady: 'พร้อมใช้งาน',
  cloudStateNotEntitled: 'ไม่รวมในแพ็กเกจของคุณ',
  cloudStateExhausted: 'เครดิต AI หมดแล้ว',
  cloudStateUnavailable: 'ใช้งานไม่ได้ในขณะนี้',
  cloudCredits: 'เครดิต AI',
  cloudCreditsLeft: 'เหลือ {remaining} / {limit}',
  cloudCreditsUnlimited: 'ไม่จำกัด',
  cloudCreditsRenews: 'รีเซ็ตวันที่ {date}',
  cloudSignedOutBody:
    'ลงชื่อเข้าใช้ UniWork เพื่อใช้การค้นหาเว็บ การสร้างภาพ และการวิเคราะห์สื่อ โดยชำระด้วยเครดิต AI ขององค์กร',
  cloudNotEntitledBody:
    'แพ็กเกจขององค์กรคุณไม่รวม AI คลาวด์ของ UniWork คุณยังใช้ผู้ให้บริการของคุณเองด้านล่างได้',
  cloudExhaustedBody:
    'องค์กรของคุณใช้เครดิต AI ของ UniWork ในรอบนี้หมดแล้ว เครื่องมือคลาวด์จะหยุดจนกว่าเครดิตจะรีเซ็ต ผู้ให้บริการของคุณเองด้านล่างยังใช้งานได้',
  cloudUnavailableBody:
    'AI คลาวด์ของ UniWork ใช้งานไม่ได้ในขณะนี้ ผู้ให้บริการของคุณเองด้านล่างยังใช้งานได้',
  cloudReadyBody:
    'เมื่อไม่มีผู้ให้บริการของคุณเอง การค้นหา การสร้างภาพ และการวิเคราะห์สื่อจะใช้เครดิต AI ของ UniWork ขององค์กร',
  cloudToolsToggle: 'ใช้เครื่องมือคลาวด์ของ UniWork',
  cloudToolsToggleDesc:
    'เมื่อไม่มีผู้ให้บริการของคุณเอง การค้นหาเว็บ การสร้างภาพ และการวิเคราะห์สื่อจะทำผ่านคลาวด์ของ UniWork (ใช้เครดิต AI)',
  cloudMediaLabel: 'คลาวด์ของ UniWork',
  cloudMediaDesc: 'ใช้เครดิต AI ของ UniWork ขององค์กร ไม่ต้องใช้คีย์',
  cloudSearchAutoHint: 'ใช้คลาวด์ของ UniWork ก่อน (ใช้เครดิต AI) แล้วจึงใช้การค้นหาฟรี',
} satisfies Record<keyof typeof zh, string>
