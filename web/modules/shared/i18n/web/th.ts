import type { zh } from './zh'

export const th = {
  webCancel: 'ยกเลิก',
  webConflictTitle: 'เอกสารนี้ถูกแก้ไขจากที่อื่น',
  webConflictBody:
    'การเปลี่ยนแปลงของคุณยังไม่อยู่บน UniWork และจะเก็บไว้ในเบราว์เซอร์นี้จนกว่าคุณจะออกจากระบบ',
  webConflictOverwrite: 'เขียนทับ…',
  webConflictReload: 'โหลดเวอร์ชันล่าสุด',
  webConflictNotSaved: 'เอกสารถูกแก้ไขจากที่อื่น',
  webFatalTitle: 'ไม่สามารถเปิดเอกสารได้',
  webFatalBody: 'ปิดการแก้ไขและการบันทึกแล้ว โปรดโหลดหน้าใหม่หรือเปิดเอกสารอีกครั้งจาก UniWork',
  webNoHost: 'ตัวแก้ไขนี้ทำงานภายใน UniWork โปรดเปิดเอกสารจาก UniWork',
  webViewOnly: 'ดูอย่างเดียว',
  webViewOnlyNotSaved: 'เอกสารนี้ดูได้อย่างเดียวและบันทึกไม่ได้',
  webNotUtf8:
    'ไฟล์นี้ไม่ใช่ข้อความ UTF-8 จึงเปิดแบบดูอย่างเดียว เพื่อไม่ให้การบันทึกเปลี่ยนเนื้อหา',
  webDraftTitle: 'กู้คืนการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่',
  webDraftBody:
    'เบราว์เซอร์นี้เก็บสำเนาการเปลี่ยนแปลงที่ยังไม่ได้บันทึกของเอกสารนี้ไว้ ต้องการกู้คืนหรือทิ้ง',
  webDraftOlder: 'สำเนานี้อิงกับเอกสารเวอร์ชันเก่า การบันทึกจะแทนที่เวอร์ชันที่ใหม่กว่า',
  webDraftSavedAt: 'เก็บสำเนาเมื่อ',
  webDraftKept: 'เบราว์เซอร์นี้จะเก็บสำเนาไว้จนกว่าคุณจะออกจากระบบ',
  webDraftRestore: 'กู้คืน',
  webDraftDiscard: 'ทิ้ง',
  webSaveNetwork: 'เชื่อมต่อ UniWork ไม่ได้ โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webSaveTimeout: 'การบันทึกใช้เวลานานเกินไป โปรดตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  webClose: 'ปิด',
  webSaveUnauthorized: 'เซสชัน UniWork ของคุณสิ้นสุดแล้ว กรุณาเข้าสู่ระบบอีกครั้งแล้วลองบันทึกใหม่',
  webSaveForbidden: 'คุณไม่มีสิทธิ์บันทึกเอกสารนี้',
  webSaveNotFound: 'ไม่พบเอกสารนี้แล้ว หรือถูกย้ายไปที่อื่น',
  webSaveTooLarge: 'เอกสารมีขนาดใหญ่เกินกว่าจะบันทึกได้',
  webSaveRateLimited: 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่',
  webSaveServer: 'UniWork เกิดปัญหาขณะบันทึก กรุณาลองใหม่อีกครั้งในอีกสักครู่',
  webSaveFailedGeneric: 'ไม่สามารถบันทึกเอกสารได้ กรุณาลองใหม่',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'การเปลี่ยนแปลงของคุณยังไม่อยู่บน UniWork และจะเก็บไว้ในเบราว์เซอร์นี้จนกว่าคุณจะออกจากระบบ',
  uwConflictReloadWebBody:
    'เบราว์เซอร์ไม่เก็บแบบร่างที่ขัดแย้ง ดาวน์โหลดเวอร์ชันของคุณเพื่อคัดลอกภายหลัง หรือละทิ้งการเปลี่ยนแปลง',
  uwConflictDownloadThenReload: 'ดาวน์โหลดเวอร์ชันของฉัน แล้วโหลดใหม่',
  uwConflictDiscardThenReload: 'ละทิ้งการเปลี่ยนแปลงแล้วโหลดใหม่',
  uwConflictMineFileSuffix: '(เวอร์ชันของฉัน)',
  uwConflictDownloadCheck:
    'เบราว์เซอร์ได้รับไฟล์ของคุณแล้ว ตรวจสอบว่าบันทึกแล้ว จากนั้นเลือก "โหลดใหม่"',
  uwConflictSessionWeb:
    'เซสชันหมดอายุ จึงไม่ได้เขียนทับ การเปลี่ยนแปลงยังอยู่ในเบราว์เซอร์นี้ ลงชื่อเข้าใช้อีกครั้งแล้วลองใหม่',
  uwConflictTooLarge: 'เวอร์ชันของคุณเกินขนาดสูงสุดของ UniWork จึงเขียนทับไม่ได้',
  uwConflictDownloadTooLarge: 'เวอร์ชันของคุณเกินขนาดสูงสุดของ UniWork จึงดาวน์โหลดที่นี่ไม่ได้',
  uwConflictDownloadFailed: 'ดาวน์โหลดเวอร์ชันของคุณไม่ได้ เอกสารจึงไม่ถูกโหลดใหม่ โปรดลองอีกครั้ง',
  uwConflictOfflineWeb:
    'คุณออฟไลน์อยู่ บนเว็บต้องมีการเชื่อมต่อจึงทำได้ การเปลี่ยนแปลงยังอยู่ในเบราว์เซอร์นี้',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'เวอร์ชันของคุณ',
  uwConflictColServer: 'เวอร์ชันบน UniWork',
  uwConflictRowVersion: 'เวอร์ชัน',
  uwConflictRowTime: 'เวลา',
  uwConflictRowBy: 'บันทึกโดย',
  uwConflictMineUnsaved: 'คุณ (ยังไม่บันทึก)',
  uwConflictBasedOn: 'อิงจากเวอร์ชัน {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'ดูความแตกต่าง',
  uwConflictDiffPending: 'กำลังเปรียบเทียบ…',
  uwConflictDiffFailed: 'ตอนนี้ไม่สามารถเปรียบเทียบเวอร์ชันได้ โปรดลองอีกครั้งในภายหลัง',
  uwConflictNoEdit: 'คุณไม่มีสิทธิ์แก้ไขเอกสารนี้แล้ว',
  uwConflictOverwriteTitle: 'เขียนทับด้วยเวอร์ชันของคุณหรือไม่',
  uwConflictOverwriteConfirm:
    'UniWork จะสร้างเวอร์ชัน {next} จากสำเนาของคุณ เวอร์ชัน {server} ของ {author} ยังอยู่ในประวัติ',
  uwConflictOverwriteGo: 'เขียนทับ',
  uwConflictBack: 'ย้อนกลับ',
  uwConflictHeadMoved: 'ระหว่างนั้น UniWork ได้เวอร์ชัน {n} แล้ว ตารางอัปเดตแล้ว โปรดเลือกอีกครั้ง',
  uwConflictReloadTitle: 'โหลดเวอร์ชันล่าสุดใหม่',
  uwConflictReloadGo: 'โหลดใหม่',
  uwConflictSaveCopy: 'บันทึกเป็นสำเนา…',
  uwConflictSaveCopyTitle: 'บันทึกเป็นสำเนาหรือไม่',
  uwConflictSaveCopyConfirm:
    'UniWork จะสร้างเอกสารใหม่จากเวอร์ชันของคุณ โดยมีเจ้าของและสิทธิ์เข้าถึงเหมือนเอกสารนี้ เอกสารปัจจุบันและเวอร์ชัน {server} ของ {author} ยังคงเดิม',
  uwConflictSaveCopyGo: 'สร้างสำเนา',
  uwConflictSaveCopyDone:
    'บันทึกเวอร์ชันของคุณเป็นเอกสารใหม่แล้ว: {title} เอกสารนี้ไม่เปลี่ยนแปลง คุณยังเลือกโหลดใหม่หรือเขียนทับได้',
  uwConflictSaveCopyFailed: 'สร้างสำเนาไม่ได้ การเปลี่ยนแปลงของคุณยังปลอดภัย โปรดลองอีกครั้ง',
  uwConflictSaveCopyOffline:
    'คุณออฟไลน์อยู่ การสร้างสำเนาต้องมีการเชื่อมต่อ การเปลี่ยนแปลงของคุณยังเก็บไว้',
  uwConflictReloadFailed: 'โหลดเวอร์ชันล่าสุดไม่ได้ เอกสารของคุณไม่เปลี่ยนแปลง โปรดลองอีกครั้ง',
  uwConflictOverwriteFailed: 'ยังเขียนทับไม่ได้ เอกสารของคุณไม่เปลี่ยนแปลง โปรดลองอีกครั้ง',
  uwConflictClose: 'ปิด',

  // S6 new-version bar
  uwRemoteRegion: 'เวอร์ชันใหม่',
  uwRemoteUpdated: 'อัปเดตเป็นเวอร์ชัน {n} ที่ {author} บันทึกเมื่อ {time} แล้ว',
  uwRemoteUpdatedNoRev: 'อัปเดตเป็นเวอร์ชันล่าสุดบน UniWork แล้ว',
  uwRemoteNewerDirty:
    'มีเวอร์ชันที่ใหม่กว่าบน UniWork (เวอร์ชัน {n}) คุณมีการเปลี่ยนแปลงที่ยังไม่บันทึก เอกสารจึงไม่โหลดใหม่',
  uwRemoteNewerAi:
    'มีเวอร์ชันที่ใหม่กว่าบน UniWork (เวอร์ชัน {n}) UniWork AI กำลังทำงาน เอกสารจึงไม่โหลดใหม่ ผลลัพธ์ของ AI ใช้กับสำเนาที่เปิดอยู่เท่านั้น',
  uwRemoteNowClean:
    'คุณเลิกทำการเปลี่ยนแปลงทั้งหมดแล้ว เวอร์ชัน {n} บน UniWork ใหม่กว่าสำเนาที่เปิดอยู่',
  uwRemoteStopAiConfirm:
    'หยุดการทำงานของ UniWork AI ที่กำลังทำอยู่เพื่อโหลดใหม่หรือไม่ การเปลี่ยนแปลงที่ AI ทำไปแล้วเป็นของสำเนาที่เปิดอยู่',
  uwRemoteWaitCommit: 'กำลังรอให้การบันทึกที่ค้างอยู่เสร็จ จากนั้นจึงโหลดใหม่ได้',
  uwRemoteReload: 'โหลดเวอร์ชันล่าสุดใหม่…',
  uwRemoteLater: 'ภายหลัง',
  uwRemoteClose: 'ปิด',
  uwRemoteReloadFailed: 'โหลดเวอร์ชัน {n} ไม่ได้ คุณยังดูเวอร์ชันก่อนหน้าอยู่',
  uwRemoteDeleted: 'เอกสารนี้ถูกลบบน UniWork การบันทึกในคิวหยุดลงแล้ว',
  uwAuthorFallback: 'สมาชิกคนหนึ่ง',
  uwLockRegion: 'สถานะเอกสาร',
  uwActRetry: 'ลองอีกครั้ง',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้แล้ว การบันทึกหยุดลง การเปลี่ยนแปลงที่ยังไม่บันทึกจะเก็บไว้ในเบราว์เซอร์นี้จนกว่าคุณจะออกจากระบบ',
  uwRemoteOrgBlockedWeb:
    'บันทึกไม่ได้: {reason} การเปลี่ยนแปลงที่ยังไม่บันทึกจะเก็บไว้ในเบราว์เซอร์นี้จนกว่าคุณจะออกจากระบบ',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'เอกสารถูกเก็บถาวร',
  uwReasonSuspended: 'องค์กรถูกระงับ',
  uwReasonDeactivated: 'บัญชีของคุณถูกปิดใช้งานในองค์กรนี้',
} satisfies Record<keyof typeof zh, string>
