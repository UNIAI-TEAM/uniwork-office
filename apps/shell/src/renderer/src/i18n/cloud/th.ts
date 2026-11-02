import type { zh } from './zh'

export const th = {
  cloudTitle: 'AI คลาวด์ของ UniWork',
  cloudStateReady: 'พร้อมใช้งาน',
  cloudStateNotEntitled: 'ไม่รวมในแพ็กเกจของคุณ',
  cloudStateExhausted: 'เครดิต AI หมดแล้ว',
  cloudStateUnavailable: 'ใช้งานไม่ได้ในขณะนี้',
  cloudStateInactive: 'การสมัครสมาชิกไม่ใช้งาน',
  cloudCredits: 'เครดิต AI',
  cloudCreditsLeft: 'เหลือ {remaining} / {limit}',
  cloudCreditsUnlimited: 'ไม่จำกัด',
  cloudCreditsRenews: 'รีเซ็ตวันที่ {date}',
  cloudToolsToggle: 'ใช้เครื่องมือคลาวด์ของ UniWork',
  cloudToolsToggleDesc:
    'เมื่อไม่มีผู้ให้บริการของคุณเอง การค้นหาเว็บ การสร้างภาพ และการวิเคราะห์สื่อจะทำผ่านคลาวด์ของ UniWork (ใช้เครดิต AI)',
} satisfies Record<keyof typeof zh, string>
