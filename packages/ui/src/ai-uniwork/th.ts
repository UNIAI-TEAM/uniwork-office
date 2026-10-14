import type { zh } from './zh'

export const th = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'เครดิตคงเหลือ {remaining} จาก {limit}',
  aiUniworkFooterSignIn: 'ลงชื่อเข้าใช้ UniWork เพื่อใช้ UniWork AI',
  aiUniworkSignedOut: 'คุณออกจากระบบ UniWork แล้ว เลือกผู้ให้บริการอื่นหรือลงชื่อเข้าใช้อีกครั้ง',
  aiUniworkOff: 'UniWork AI ปิดอยู่สำหรับเอกสารนี้ เลือกผู้ให้บริการอื่น',
  aiUniworkViewOnly: 'ดูอย่างเดียว: AI ตอบได้แต่แก้ไขหรือบันทึกเอกสารไม่ได้',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI อ่านเนื้อหาที่เปิดอยู่ในเอกสารนี้ รวมถึงการเปลี่ยนแปลงที่ยังไม่บันทึก และส่งไปยัง UniWork และผู้ให้บริการโมเดลเพื่อตอบ การทำงานแต่ละครั้งใช้เครดิต AI ของ {org} AI ไม่บันทึกแทนคุณ โปรดตรวจทานแล้วกดบันทึก',
  aiUniworkDisclosureLabel: 'สิ่งที่ UniWork AI ได้รับ',
  aiUniworkDisclosureShort:
    'ส่งเนื้อหาที่เปิดอยู่ (รวมที่ยังไม่บันทึก) ไปยัง UniWork · เครดิตของ {org}',
  aiUniworkLocalFile:
    'ไฟล์นี้อยู่บนคอมพิวเตอร์ของคุณ ไม่ได้อยู่ใน UniWork เมื่อใช้ UniWork AI เนื้อหาของไฟล์ที่เปิดอยู่จะถูกส่งไปยัง UniWork และใช้เครดิต AI ของ {org} ไฟล์จะไม่ถูกอัปโหลดเป็นเอกสาร UniWork',
  aiUniworkAck: 'เข้าใจแล้ว',
  aiUniworkLearnMore: 'ดูข้อมูลเพิ่มเติม',
  aiUniworkDetails: 'รายละเอียด',
  aiUniworkSendNeedsAck: 'โปรดอ่านและยืนยันประกาศก่อนส่ง',

  // S9 result chips and run controls
  aiResultAnswer: 'คำตอบ',
  aiResultClarify: 'ต้องการคำชี้แจง',
  aiResultEdited: 'แก้ไขในเอกสารแล้ว',
  aiResultUnsupported: 'ยังไม่รองรับ',
  aiResultError: 'ข้อผิดพลาด',
  aiResultEditedHint: 'ยังไม่บันทึก — เลิกทำด้วย Ctrl/⌘+Z หรือกดบันทึกเมื่อถูกต้องแล้ว',
  aiResultViewChanges: 'ดูการเปลี่ยนแปลง',
  aiRunStop: 'หยุด',
  aiRunSend: 'ส่ง',
  aiRunRunning: 'กำลังทำงาน… กดหยุดหรือ Esc เพื่อหยุด',
  aiRunStopped: 'หยุดแล้ว การเปลี่ยนแปลงที่นำไปใช้แล้ว (ถ้ามี) ยังอยู่ในเอกสารและเลิกทำได้',
  aiRunAskAgain: 'ถามต่อ',
  aiRunChooseOther: 'เลือกผู้ให้บริการอื่น',
  aiRunOpenInApp: 'เปิดในแอป',
  aiConversationRestarted:
    'การสนทนาก่อนหน้าหมดอายุ UniWork AI จึงเริ่มการสนทนาใหม่และจำข้อความก่อนหน้าไม่ได้แล้ว ส่งคำถามอีกครั้งเพื่อดำเนินการต่อ',
  aiConversationBoundary: 'การสนทนาใหม่กับ {provider}: ข้อความด้านบนจะไม่ถูกส่งไปด้วย',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'การทำงานครั้งนี้ถึงขีดจำกัดจำนวนขั้นตอนของ UniWork AI แล้ว ผลลัพธ์ที่ได้จนถึงตอนนี้ยังคงอยู่ โปรดแบ่งคำขอแล้วถามต่อ',
  aiErrCredits: 'องค์กรของคุณใช้เครดิต AI ของรอบนี้หมดแล้ว การทำงานครั้งนี้หยุดแล้ว',
  aiErrEntitlement: 'แผนขององค์กรคุณไม่รวม UniWork AI อีกต่อไป',
  aiErrRateLimited: 'คุณส่งเร็วเกินไป ลองอีกครั้งใน {seconds} วินาที',
  aiErrRateLimitedNoWait: 'คุณส่งเร็วเกินไป ลองอีกครั้งในอีกไม่กี่นาที',
  aiErrUnavailable: 'UniWork AI ไม่ตอบสนองในขณะนี้ เอกสารและการบันทึกยังใช้งานได้ตามปกติ',
  aiErrDisconnected:
    'การเชื่อมต่อขาดหาย การทำงานครั้งนี้จึงหยุด การเปลี่ยนแปลงที่นำไปใช้แล้ว (ถ้ามี) ยังอยู่ในเอกสารและเลิกทำได้',
  aiErrOffline: 'คุณออฟไลน์อยู่ UniWork AI ไม่ทำงานแบบออฟไลน์และคำขอจะไม่ถูกเข้าคิว',
  aiErrSession:
    'เซสชัน UniWork ของคุณหมดอายุ การทำงานครั้งนี้จึงหยุด ลงชื่อเข้าใช้อีกครั้งเพื่อดำเนินการต่อ',
  aiErrRevoked: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้แล้ว การทำงานของ AI จึงหยุด',
  aiErrDowngraded: 'สิทธิ์ของคุณเพิ่งเปลี่ยนเป็นดูอย่างเดียว AI จึงหยุดแก้ไข แต่ยังตอบต่อไป',
  aiErrCapabilityOff: 'UniWork AI เพิ่งถูกปิดสำหรับเอกสารนี้ การทำงานจึงหยุดหลังขั้นตอนปัจจุบัน',
  aiErrUnsupported: 'UniWork AI ยังทำสิ่งนี้ใน {module} ไม่ได้',
  aiErrViewOnlyEdit: 'คุณมีสิทธิ์ดูเอกสารนี้เท่านั้น AI จึงแก้ไขไม่ได้',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'คำขอยาวเกินไปสำหรับ UniWork AI โปรดย่อให้ต่ำกว่า 8,000 อักขระแล้วส่งอีกครั้ง',
  aiErrQuestionRejected: 'UniWork AI รับคำขอนี้ไม่ได้ โปรดแก้ไขคำขอแล้วส่งอีกครั้ง',
  aiUniworkImagesNotSent: 'ระบบไม่ส่งรูปภาพไปยัง UniWork AI ส่งเฉพาะข้อความของคุณเท่านั้น',
} satisfies Record<keyof typeof zh, string>
