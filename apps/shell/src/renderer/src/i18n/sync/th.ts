import type { zh } from './zh'

export const th = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'อยู่ในคิวบันทึก — ยังไม่อยู่บน UniWork',
  uwChipQueuedNewer: 'อยู่ในคิวบันทึก · มีการแก้ไขใหม่กว่า',
  uwChipPausedAdmin: 'อยู่ในคิวบันทึก · หยุดการส่งชั่วคราว',
  uwChipReconciling: 'กำลังตรวจสอบการบันทึกครั้งล่าสุด…',
  uwChipReconcileStuck: 'ต้องให้ฝ่ายสนับสนุนยืนยันการบันทึก',
  uwChipRemoteNewer: 'มีเวอร์ชันที่ใหม่กว่าบน UniWork',
  uwTipQueued:
    'การบันทึกเมื่อ {time} ถูกเก็บไว้อย่างปลอดภัยบนคอมพิวเตอร์เครื่องนี้และจะส่งเมื่อออนไลน์',
  uwTipQueuedNewer: 'การบันทึกเมื่อ {time} กำลังรอส่ง การแก้ไขหลังจากนั้นไม่รวมอยู่ในครั้งนี้',
  uwTipPausedAdmin: 'ผู้ดูแลระบบหยุดการส่งชั่วคราว การบันทึกถูกเก็บไว้บนคอมพิวเตอร์เครื่องนี้',
  uwTipPausedUser:
    'คุณหยุดการส่งชั่วคราว การบันทึกเมื่อ {time} ถูกเก็บไว้บนคอมพิวเตอร์เครื่องนี้ เลือก "ส่งต่อ" ในศูนย์ซิงค์',
  uwTipReconciling:
    'ยังไม่แน่ชัดว่าการบันทึกครั้งล่าสุดไปถึง UniWork หรือไม่ แอปกำลังตรวจสอบและจะไม่สร้างรายการซ้ำ',
  uwTipRemoteNewer: 'คุณมีการเปลี่ยนแปลงที่ยังไม่บันทึก เอกสารจึงไม่โหลดใหม่',
  uwTipFailed:
    'การบันทึกนี้จะไม่ลองใหม่เอง: {reason} การเปลี่ยนแปลงของคุณยังอยู่บนคอมพิวเตอร์เครื่องนี้',
  uwTipWaitAi: 'กำลังรอให้ AI ทำขั้นตอนปัจจุบันเสร็จแล้วจึงบันทึก',
  uwTipWaitAiLong: 'AI ยังทำขั้นตอนปัจจุบันไม่เสร็จ หยุดการทำงานของ AI เพื่อบันทึกทันที',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'ดูคิว',
  uwActSaveAgain: 'บันทึกอีกครั้ง',
  uwActStopAi: 'หยุด AI',
  uwActBack: 'ย้อนกลับ',
  uwQueuePopWaiting: 'รอบันทึก: จาก {time} (อิงจากเวอร์ชัน {base})',
  uwQueuePopNewer: 'มีการแก้ไขใหม่หลังจากนั้น — ยังไม่ได้ส่ง',
  uwQueueBlockedSave: 'การบันทึกครั้งก่อนยังรออยู่ คุณบันทึกอีกครั้งได้เมื่อครั้งนั้นเสร็จ',
  uwQueueFull:
    'พื้นที่ซิงค์บนคอมพิวเตอร์เครื่องนี้เต็ม การบันทึกจึงไม่ได้เข้าคิว การเปลี่ยนแปลงยังอยู่ในหน้าต่างที่เปิดอยู่ โปรดเพิ่มพื้นที่ว่างในศูนย์ซิงค์',
  uwQueueOpenCenter: 'เปิดศูนย์ซิงค์',
  uwQueueCancel: 'ยกเลิกการบันทึก…',
  uwQueueCancelConfirm:
    'ยกเลิกการบันทึกที่อยู่ในคิวหรือไม่ การเปลี่ยนแปลงยังอยู่บนคอมพิวเตอร์เครื่องนี้ และเอกสารบน UniWork ไม่เปลี่ยนแปลง',
  uwQueueCancelled: 'ยกเลิกการบันทึกในคิวแล้ว การเปลี่ยนแปลงยังอยู่บนคอมพิวเตอร์เครื่องนี้',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'ต้องลงชื่อเข้าใช้อีกครั้ง',
  uwReasonSignedOut: 'ออกจากระบบแล้ว',
  uwReasonForeign: 'เป็นของบัญชีอื่น',
  uwReasonArchived: 'เอกสารถูกเก็บถาวร',
  uwReasonSuspended: 'องค์กรถูกระงับ',
  uwReasonDeactivated: 'บัญชีของคุณถูกปิดใช้งานในองค์กรนี้',
  uwReasonLease: 'สิทธิ์ออฟไลน์หมดอายุ',
  uwReasonKeystore: 'พวงกุญแจของคอมพิวเตอร์เครื่องนี้ถูกล็อก',
  uwReasonClock: 'นาฬิกาถูกตั้งย้อนหลัง',
  uwReasonStoreFull: 'พื้นที่ซิงค์บนคอมพิวเตอร์เครื่องนี้เต็ม',
  uwReasonStoreNewer: 'ต้องใช้แอปเวอร์ชันที่ใหม่กว่า',

  // S2 queue-row badges
  uwBadgeQueued: 'กำลังรอ',
  uwBadgeWaitNetwork: 'รอเครือข่าย',
  uwBadgePausedUser: 'คุณหยุดชั่วคราว',
  uwBadgePausedAdmin: 'ผู้ดูแลระบบหยุดชั่วคราว',
  uwBadgeSending: 'กำลังส่ง',
  uwBadgeReconciling: 'กำลังตรวจสอบ',
  uwBadgeReconcileStuck: 'ต้องการความช่วยเหลือ',
  uwBadgeConflict: 'ขัดแย้ง',
  uwBadgeBlocked: 'ถูกบล็อก',
  uwBadgeLocked: 'ล็อกอยู่',
  uwBadgeRevoked: 'ไม่มีสิทธิ์เข้าถึง',
  uwBadgeDeleted: 'ถูกลบ',
  uwBadgeReconnect: 'ต้องเชื่อมต่อใหม่',
  uwBadgeKeystore: 'พวงกุญแจถูกล็อก',
  uwBadgeFailed: 'ส่งไม่ได้',
  uwBadgeSaved: 'บันทึกแล้ว',
  uwBadgeKeptDraft: 'แบบร่างที่เก็บไว้',
  uwBadgeMoved: 'ย้ายแล้ว',
  uwBadgeArchived: 'เก็บถาวรแล้ว',

  // S2 queue-row details
  uwRowQueued: 'บันทึกเมื่อ {time} · อิงจากเวอร์ชัน {base} · {size}',
  uwRowWaitNetwork: 'จะส่งเมื่อออนไลน์',
  uwRowPausedUser: 'จะส่งเมื่อคุณเลือก "ส่งต่อ"',
  uwRowPausedAdmin: 'จะส่งเมื่อผู้ดูแลระบบเปิดการส่งอีกครั้ง',
  uwRowUploading: 'กำลังอัปโหลด {done} / {total}',
  uwRowCommitting: 'กำลังสร้างเวอร์ชัน',
  uwRowReconciling: 'ยังไม่ทราบผลการส่งเมื่อ {time} กำลังตรวจสอบกับ UniWork',
  uwRowReconcileStuck:
    'จำนวนครั้งที่พยายามตรวจสอบ: {count} ยังไม่มีผล แอปจะไม่ส่งซ้ำ โปรดส่งรหัสสนับสนุนให้ผู้ดูแลระบบ',
  uwStuckDiscardConfirm:
    'ละทิ้งการบันทึกนี้หรือไม่ ถ้าไปถึง UniWork แล้ว เวอร์ชันนั้นยังคงอยู่ สำเนาของคุณจะเก็บเป็นแบบร่างในศูนย์ซิงค์',
  uwRowConflict: 'เวอร์ชัน {n} บันทึกโดย {author} เมื่อ {time}',
  uwRowFailed: 'ส่งไม่ได้: {reason}',
  uwRowBlocked: 'บันทึกไม่ได้: {reason}',
  uwRowCommitted: 'เวอร์ชัน {n} · {time}',
  uwRowKeptDraft: 'เก็บไว้เมื่อโหลดใหม่ตอน {time}',
  uwRowMoved: 'เอกสารถูกย้ายไปที่ {workspace}',
  uwRowArchived: 'เอกสารถูกเก็บถาวรบน UniWork',

  // S2 row actions
  uwActDiscard: 'ละทิ้ง',
  uwActDiscardSave: 'ละทิ้งการบันทึก…',
  uwActSendNow: 'ส่งเลย',
  uwActRecheck: 'ตรวจสอบอีกครั้ง',
  uwActGuide: 'คู่มือ',
  uwActOpenToResolve: 'เปิดเพื่อแก้ไข',
  uwActCopySupport: 'คัดลอกรหัสสนับสนุน',
  uwActDownloadMine: 'ดาวน์โหลดเวอร์ชันของฉัน',
  uwActOpenDraft: 'เปิดแบบร่าง',
  uwActDiscardDraft: 'ละทิ้งแบบร่าง…',
  uwActSignInAgain: 'ลงชื่อเข้าใช้อีกครั้ง',
  uwActSignIn: 'ลงชื่อเข้าใช้',
  uwActSwitchAccount: 'สลับบัญชี',
  uwActReconnect: 'เชื่อมต่อใหม่',
  uwActDetails: 'รายละเอียด',
  uwActOpen: 'เปิด',
  uwDiscardDraftConfirm:
    'ละทิ้งแบบร่างนี้หรือไม่ การเปลี่ยนแปลงจะถูกลบออกจากคอมพิวเตอร์เครื่องนี้และกู้คืนไม่ได้',

  // Sign-out prompt
  uwSignOutTitle: 'ออกจากระบบ UniWork หรือไม่',
  uwSignOutBody:
    'เอกสารที่มีการเปลี่ยนแปลงที่ยังไม่บันทึกหรือการบันทึกในคิว: {count} เอกสารเหล่านี้จะถูกล็อกไว้บนคอมพิวเตอร์เครื่องนี้ และมีเพียงบัญชีของคุณที่เปิดได้อีกครั้ง',
  uwSignOutKeystore:
    'พวงกุญแจของคอมพิวเตอร์ถูกล็อก การเปลี่ยนแปลงที่ยังไม่บันทึกจึงมีอยู่ในหน้าต่างที่เปิดเท่านั้น การออกจากระบบตอนนี้จะทิ้งการเปลี่ยนแปลงเหล่านั้น ส่วนที่เก็บแบบเข้ารหัสไว้แล้วยังอยู่ หากต้องการเก็บไว้ โปรดปลดล็อกคอมพิวเตอร์ก่อน',
  uwSignOutGo: 'ออกจากระบบ',
  uwSignOutWaiting: 'กำลังทำการบันทึกที่ค้างอยู่ให้เสร็จก่อนออกจากระบบ…',

  // S2 sync center
  uwSyncTitle: 'ศูนย์ซิงค์',
  uwSyncOpenFromSettings: 'ศูนย์ซิงค์',
  uwSyncOnline: 'เชื่อมต่อกับ UniWork · ซิงค์เมื่อ {time}',
  uwSyncOffline: 'ออฟไลน์ · ซิงค์ล่าสุด {time}',
  uwSyncPaused: 'หยุดการส่งชั่วคราว — การบันทึกใหม่จะรอ',
  uwSyncAdminPaused: 'ผู้ดูแลระบบหยุดการส่งชั่วคราว การบันทึกถูกเก็บไว้บนคอมพิวเตอร์เครื่องนี้',
  uwSyncFeedOff: 'หยุดการแจ้งเตือนเวอร์ชันใหม่ชั่วคราว UniWork ยังตรวจสอบความขัดแย้งเมื่อคุณบันทึก',
  uwSyncResynced: 'ซิงค์ใหม่ทั้งหมดแล้วเมื่อ {time}',
  uwSyncResyncFailed:
    'ซิงค์ใหม่ไม่สำเร็จหลังจากลองหลายครั้ง หยุดการแจ้งเตือนเวอร์ชันใหม่ชั่วคราว UniWork ยังตรวจสอบความขัดแย้งเมื่อคุณบันทึก',
  uwSyncSignedOut: 'คุณออกจากระบบแล้ว รายการที่ล็อกเก็บไว้บนคอมพิวเตอร์เครื่องนี้: {count}',
  uwSyncSignedOutEmpty: 'คุณออกจากระบบแล้ว',
  uwSyncSessionExpired: 'เซสชันหมดอายุ ลงชื่อเข้าใช้อีกครั้งเพื่อส่งต่อ',
  uwSyncOtherOrg: 'การบันทึกที่รออยู่ในองค์กรอื่น: {count}',
  uwSyncStoreBudget: 'พื้นที่ซิงค์บนคอมพิวเตอร์เครื่องนี้: {used} จาก {cap}',
  uwSyncStoreError: 'อ่านคิวบนคอมพิวเตอร์เครื่องนี้ไม่ได้ ไม่มีสิ่งใดถูกลบ',
  uwSyncNow: 'ซิงค์เลย',
  uwSyncPause: 'หยุดส่งชั่วคราว',
  uwSyncResume: 'ส่งต่อ',
  uwSyncNowOffline: 'การซิงค์ต้องใช้การเชื่อมต่อ',
  uwSyncTabAttention: 'ต้องจัดการ',
  uwSyncTabQueue: 'รอบันทึก',
  uwSyncTabOffline: 'ใช้ได้แบบออฟไลน์',
  uwSyncTabRecent: 'บันทึกล่าสุด',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'เอกสาร',
  uwSyncColState: 'สถานะ',
  uwSyncColDetail: 'รายละเอียด',
  uwSyncColActions: 'การดำเนินการ',
  uwSyncMoreActions: 'การดำเนินการเพิ่มเติมสำหรับ {doc}',
  uwSyncEmptyQueue: 'ไม่มีรายการที่รอบันทึก',
  uwSyncEmptyAttention: 'ไม่มีอะไรต้องจัดการ',
  uwSyncEmptyRecent: 'ไม่มีการบันทึกล่าสุด',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'ทำให้ใช้ได้แบบออฟไลน์',
  uwOfflineUnpin: 'ลบสำเนาออฟไลน์',
  uwOfflineUnpinShort: 'เลิกปักหมุด',
  uwOfflineAdd: 'เพิ่มเอกสาร…',
  uwOfflineUsage: 'ใช้ไป {used} จาก {cap} บนคอมพิวเตอร์เครื่องนี้',
  uwOfflineEmpty: 'ยังไม่มีเอกสารที่ใช้ได้แบบออฟไลน์',
  uwOfflineCapReached:
    'คลังออฟไลน์บนคอมพิวเตอร์เครื่องนี้ถึงขีดจำกัดแล้ว: พื้นที่ {cap}; จำนวนเอกสารสูงสุด: {maxDocs} ลบสำเนาออฟไลน์หนึ่งรายการเพื่อเพิ่มรายการอื่น',
  uwOfflineReady: 'ใช้ได้แบบออฟไลน์',
  uwOfflineBadgeWaiting: 'รอเครือข่าย',
  uwOfflineBadgeDownloading: 'กำลังดาวน์โหลด',
  uwOfflineBadgeVerifying: 'กำลังตรวจสอบ',
  uwOfflineBadgeUpdate: 'มีอัปเดต',
  uwOfflineBadgeInterrupted: 'ยังไม่พร้อม',
  uwOfflineBadgeDiskFull: 'พื้นที่ไม่พอ',
  uwOfflineBadgeCorrupt: 'ไฟล์ที่ดาวน์โหลดเสียหาย',
  uwOfflineBadgeLeaseSoon: 'สิทธิ์ออฟไลน์ใกล้หมดอายุ',
  uwOfflineBadgeViewOnly: 'ใช้ได้แบบออฟไลน์ · ดูอย่างเดียว',
  uwOfflineRowWaiting: 'จะดาวน์โหลดเมื่อออนไลน์',
  uwOfflineRowProgress: '{done} จาก {total}',
  uwOfflineRowProgressAria: '{done} จาก {total}',
  uwOfflineRowVerifying: 'กำลังตรวจสอบความสมบูรณ์',
  uwOfflineRowReady: 'เวอร์ชัน {n} · {size} · สิทธิ์ออฟไลน์ถึง {datetime}',
  uwOfflineRowUpdate: 'เวอร์ชัน {n} จะดาวน์โหลดเมื่อออนไลน์ เวอร์ชัน {old} ยังใช้ได้',
  uwOfflineRowUpdateKept: 'อัปเดตเป็นเวอร์ชัน {n} ไม่ได้: {reason} เวอร์ชัน {old} ยังใช้ได้',
  uwOfflineRowInterrupted: 'การดาวน์โหลดถูกขัดจังหวะ สำเนาเก่า (ถ้ามี) ยังใช้ได้',
  uwOfflineRowDiskFull: 'ต้องการพื้นที่เพิ่ม {size} สำเนาเก่ายังเก็บไว้',
  uwOfflineRowCorrupt: 'ลบสำเนาที่เสียหายแล้ว โปรดดาวน์โหลดอีกครั้ง',
  uwOfflineRowLeaseSoon: 'เชื่อมต่อก่อน {datetime} เพื่อต่ออายุ',
  uwOfflineRowRevoked:
    'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้แล้ว สำเนาที่ดาวน์โหลดถูกลบ แบบร่างยังถูกล็อกไว้',
  uwOfflineRowDeleted: 'เอกสารถูกลบบน UniWork สำเนาที่ดาวน์โหลดถูกลบ แบบร่างยังถูกล็อกไว้',
  uwOfflineRowArchived: 'เอกสารถูกเก็บถาวรแล้ว สำเนาที่นี่เปิดได้จนกว่าสิทธิ์ออฟไลน์จะหมด',
  uwOfflineRowMoved: 'ย้ายไปที่ {workspace} แล้ว สำเนาที่นี่ยังใช้ได้',
  uwOfflineRowViewOnly: 'เวอร์ชัน {n} · ดูอย่างเดียว · สิทธิ์ออฟไลน์ถึง {datetime}',
  uwOfflineReadyAnnounce: 'ใช้ได้แบบออฟไลน์: {doc}',
  uwOfflineUnpinConfirm:
    'สำเนาที่ดาวน์โหลดจะถูกลบออกจากคอมพิวเตอร์เครื่องนี้ แบบร่างและการบันทึกในคิวจะเก็บไว้',
  uwOfflineCancelDownload: 'ยกเลิกการดาวน์โหลด',
  uwOfflineDownloadNow: 'ดาวน์โหลดเลย',
  uwOfflineOpenFolder: 'เปิดโฟลเดอร์จัดเก็บ',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'ต้องเชื่อมต่อใหม่',
  uwLockKeystoreTitle: 'พวงกุญแจของคอมพิวเตอร์เครื่องนี้ถูกล็อก',
  uwLockClockTitle: 'ต้องตรวจสอบเวลา',
  uwLockRevokedTitle: 'ไม่มีสิทธิ์เข้าถึง',
  uwLockDeletedTitle: 'เอกสารถูกลบ',
  uwLockForeignTitle: 'เป็นของบัญชีอื่น',
  uwLockOrgTitle: 'เปิดในองค์กรนี้ไม่ได้',
  uwLockExpired: 'สิทธิ์ออฟไลน์หมดอายุ เนื้อหายังถูกเข้ารหัสไว้ เชื่อมต่อเพื่อเปิดอีกครั้ง',
  uwLockLibraryOff:
    'ผู้ดูแลระบบปิดเอกสารออฟไลน์ จึงต่ออายุสิทธิ์ออฟไลน์ไม่ได้ แบบร่างยังถูกล็อกไว้ในศูนย์ซิงค์',
  uwLockKeystore:
    'พวงกุญแจของคอมพิวเตอร์ถูกล็อก จึงเปิดเนื้อหาที่เข้ารหัสไม่ได้ ปลดล็อกแล้วลองอีกครั้ง ไม่มีสิ่งใดถูกลบ',
  uwLockClock:
    'นาฬิกาของคอมพิวเตอร์ถูกตั้งย้อนหลัง สิทธิ์ออฟไลน์จึงถูกล็อก เชื่อมต่อเพื่อให้ UniWork ตรวจสอบเวลา',
  uwLockForeign: 'เอกสารนี้เป็นของบัญชีอื่นบนคอมพิวเตอร์เครื่องนี้ สลับไปยังบัญชีนั้นเพื่อเปิด',
  uwLockSuspended: 'องค์กรถูกระงับ เนื้อหายังถูกเข้ารหัสไว้ โปรดติดต่อผู้ดูแลระบบ',
  uwLockDeactivated:
    'บัญชีของคุณถูกปิดใช้งานในองค์กรนี้ เนื้อหายังถูกเข้ารหัสไว้ โปรดติดต่อผู้ดูแลระบบ',
  uwLockSignedOutTitle: 'คุณออกจากระบบแล้ว',
  uwLockSignedOut:
    'เนื้อหาถูกล็อกไว้บนคอมพิวเตอร์เครื่องนี้ ลงชื่อเข้าใช้ด้วยบัญชีเดิมเพื่อเปิดอีกครั้ง',
  uwLockRegion: 'สถานะเอกสาร',
  uwLockWhileOpen:
    'เอกสารถูกล็อกขณะเปิดอยู่ การเปลี่ยนแปลงที่ยังไม่บันทึกถูกเก็บแบบเข้ารหัส คุณบันทึกหรือคัดลอกไม่ได้จนกว่าจะปลดล็อก',
  uwLockWhileOpenRam:
    'เอกสารถูกล็อกขณะเปิดอยู่และคอมพิวเตอร์เครื่องนี้ยังเก็บการเปลี่ยนแปลงอย่างปลอดภัยไม่ได้ การเปลี่ยนแปลงมีอยู่ในหน้าต่างนี้เท่านั้น (ดูอย่างเดียว) การปิดหน้าต่างจะทำให้สูญหาย',
  uwLockOtherWindow: 'เอกสารนี้เปิดแก้ไขอยู่ในหน้าต่างอื่น หน้าต่างนี้ดูได้อย่างเดียว',
  uwLockOtherWindowGone: 'หน้าต่างที่แก้ไขเอกสารนี้ไม่ตอบสนองแล้ว คุณแก้ไขในหน้าต่างนี้ได้',
  uwLockGoToWindow: 'ไปที่หน้าต่างนั้น',
  uwLockTakeEdit: 'แก้ไขในหน้าต่างนี้',

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
  uwConflictSaveCopyNoSeat:
    'สร้างสำเนาไม่ได้ เพราะคุณไม่ใช่สมาชิกของพื้นที่ทำงานที่มีเอกสารนี้ การเปลี่ยนแปลงของคุณยังปลอดภัย คุณสามารถดาวน์โหลดเวอร์ชันของคุณได้',
  uwConflictDownloadDone:
    'บันทึกเวอร์ชันของคุณลงในคอมพิวเตอร์เครื่องนี้แล้ว: {file} เอกสารนี้ไม่เปลี่ยนแปลง คุณยังเลือกโหลดใหม่หรือเขียนทับได้',
  uwConflictDownloadFailedDesktop:
    'บันทึกไฟล์ไม่ได้ การเปลี่ยนแปลงของคุณยังปลอดภัย โปรดลองอีกครั้ง',
  uwConflictSaveCopyOffline:
    'คุณออฟไลน์อยู่ การสร้างสำเนาต้องมีการเชื่อมต่อ การเปลี่ยนแปลงของคุณยังเก็บไว้',
  uwConflictReloadFailed: 'โหลดเวอร์ชันล่าสุดไม่ได้ เอกสารของคุณไม่เปลี่ยนแปลง โปรดลองอีกครั้ง',
  uwConflictOverwriteFailed: 'ยังเขียนทับไม่ได้ เอกสารของคุณไม่เปลี่ยนแปลง โปรดลองอีกครั้ง',
  uwConflictClose: 'ปิด',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'เอกสารนี้ถูกเปลี่ยนแปลงจากที่อื่น',
  uwConflictBody: 'การเปลี่ยนแปลงของคุณยังไม่อยู่บน UniWork และปลอดภัยบนคอมพิวเตอร์เครื่องนี้',
  uwConflictReload: 'โหลดเวอร์ชันล่าสุดใหม่',
  uwConflictOverwrite: 'เขียนทับ…',
  uwConflictCancel: 'ยกเลิก',
  uwConflictKeepUnavailable:
    'ตอนนี้คอมพิวเตอร์เครื่องนี้เก็บแบบร่างไม่ได้ (พื้นที่ซิงค์เต็มหรือพวงกุญแจถูกล็อก)',
  uwConflictOfflineDesktop:
    'คุณออฟไลน์อยู่และเวอร์ชันล่าสุดไม่อยู่บนคอมพิวเตอร์เครื่องนี้ จึงยังโหลดใหม่ไม่ได้',
  uwConflictReloadDesktopBody: 'เลือกว่าจะทำอย่างไรกับการเปลี่ยนแปลงของคุณก่อนโหลดเวอร์ชัน {n}',
  uwConflictKeepDraft: 'เก็บเวอร์ชันของฉันเป็นแบบร่าง',
  uwConflictDiscard: 'ละทิ้งการเปลี่ยนแปลงของฉัน',
  uwConflictKeepDraftHint:
    'แบบร่างอยู่ในศูนย์ซิงค์เพื่อดูหรือคัดลอก และจะไม่ถูกนำไปใช้กับเวอร์ชันใหม่โดยอัตโนมัติ',
  uwConflictDraftCapReached:
    'เอกสารนี้มีแบบร่างที่เก็บไว้ถึงจำนวนสูงสุดแล้ว: {cap} ละทิ้งแบบร่างเก่าในศูนย์ซิงค์เพื่อเก็บแบบร่างใหม่',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'การบันทึกครั้งก่อนต้องการความช่วยเหลือ จึงยังโหลดใหม่หรือเขียนทับไม่ได้ เปิดศูนย์ซิงค์เพื่อแก้ไข',
  uwRemoteRevoked:
    'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้แล้ว การบันทึกหยุดลง การเปลี่ยนแปลงที่ยังไม่บันทึกถูกล็อกไว้บนคอมพิวเตอร์เครื่องนี้',
} satisfies Record<keyof typeof zh, string>
