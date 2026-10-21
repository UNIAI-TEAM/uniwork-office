import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy for every key not yet translated (spec 6.8); override keys after the spread
export const th = {
  ...en,
  wbNotif_document_changed: '{actor} เปลี่ยนแปลงเอกสาร {count} รายการ',
  wbNotif_document_changed_renamed_many: '{actor} เปลี่ยนชื่อเอกสาร {count} รายการ',
  wbNotif_document_changed_renamed_one: '{actor} เปลี่ยนชื่อ “{document}”',
  wbNotif_document_changed_renamed_untitled: '{actor} เปลี่ยนชื่อเอกสารหนึ่งรายการ',
  wbNotif_document_changed_moved_many: '{actor} ย้ายเอกสาร {count} รายการ',
  wbNotif_document_changed_moved_one: '{actor} ย้าย “{document}”',
  wbNotif_document_changed_moved_untitled: '{actor} ย้ายเอกสารหนึ่งรายการ',
  wbNotif_document_changed_trashed_many: '{actor} ย้ายเอกสาร {count} รายการไปที่ถังขยะ',
  wbNotif_document_changed_trashed_one: '{actor} ย้าย “{document}” ไปที่ถังขยะ',
  wbNotif_document_changed_trashed_untitled: '{actor} ย้ายเอกสารหนึ่งรายการไปที่ถังขยะ',
  wbNotif_document_changed_restored_many: '{actor} กู้คืนเอกสาร {count} รายการ',
  wbNotif_document_changed_restored_one: '{actor} กู้คืน “{document}”',
  wbNotif_document_changed_restored_untitled: '{actor} กู้คืนเอกสารหนึ่งรายการ',
  wbNotif_document_changed_deleted_many: '{actor} ลบเอกสาร {count} รายการถาวร',
  wbNotif_document_changed_deleted_one: '{actor} ลบ “{document}” ถาวร',
  wbNotif_document_changed_deleted_untitled: '{actor} ลบเอกสารหนึ่งรายการถาวร',
  wbNotif_document_changed_shelved_many: '{actor} เก็บเอกสาร {count} รายการเข้าคลัง',
  wbNotif_document_changed_shelved_one: '{actor} เก็บ “{document}” เข้าคลัง',
  wbNotif_document_changed_shelved_untitled: '{actor} เก็บเอกสารหนึ่งรายการเข้าคลัง',
  wbNotif_document_changed_unshelved_many: '{actor} นำเอกสาร {count} รายการออกจากคลัง',
  wbNotif_document_changed_unshelved_one: '{actor} นำ “{document}” ออกจากคลัง',
  wbNotif_document_changed_unshelved_untitled: '{actor} นำเอกสารหนึ่งรายการออกจากคลัง',
  wbNotif_document_changed_access_changed_many:
    '{actor} เปลี่ยนสิทธิ์การเข้าถึงเอกสาร {count} รายการ',
  wbNotif_document_changed_access_changed_one: '{actor} เปลี่ยนสิทธิ์การเข้าถึง “{document}”',
  wbNotif_document_changed_access_changed_untitled:
    '{actor} เปลี่ยนสิทธิ์การเข้าถึงเอกสารหนึ่งรายการ',
  wbNotif_document_changed_version_created_many:
    '{actor} เพิ่มเวอร์ชันใหม่ให้เอกสาร {count} รายการ',
  wbNotif_document_changed_version_created_one: '{actor} เพิ่มเวอร์ชันใหม่ให้ “{document}”',
  wbNotif_document_changed_version_created_untitled:
    '{actor} เพิ่มเวอร์ชันใหม่ให้เอกสารหนึ่งรายการ',
  wbNotif_document_changed_relocated_many:
    '{actor} ย้ายโฟลเดอร์ที่มีเอกสารของคุณ {count} รายการไปที่ถังขยะ เอกสารถูกย้ายไปที่รากของเวิร์กสเปซ',
  wbNotif_document_changed_relocated_one:
    '{actor} ย้ายโฟลเดอร์ที่มี “{document}” ของคุณไปที่ถังขยะ เอกสารถูกย้ายไปที่รากของเวิร์กสเปซ',
  wbNotif_document_changed_relocated_untitled:
    '{actor} ย้ายโฟลเดอร์ที่มีเอกสารของคุณหนึ่งรายการไปที่ถังขยะ เอกสารถูกย้ายไปที่รากของเวิร์กสเปซ',
  wbNotif_document_changed_generic_one: '{actor} เปลี่ยนแปลง “{document}”',
  wbNotif_document_changed_generic_untitled: '{actor} เปลี่ยนแปลงเอกสารหนึ่งรายการ',
  wbNotif_document_comment_resolved: '{actor} ทำเครื่องหมายความคิดเห็นใน “{document}” ว่าแก้ไขแล้ว',
  wbNotif_document_comment_resolved_untitled: '{actor} ทำเครื่องหมายความคิดเห็นว่าแก้ไขแล้ว',
  wbDeskPillChanged: 'มีการเปลี่ยนแปลง',
  wbDeskPillResolved: 'แก้ไขแล้ว',
  wbDocChangeTitle: 'เอกสารที่เปลี่ยนแปลง',
  wbDocChangeLoading: 'กำลังโหลดเอกสาร',
  wbDocChangeEmptyTitle: 'ไม่มีเอกสารที่คุณอ่านได้เหลืออยู่',
  wbDocChangeEmptyDesc: 'เอกสารเหล่านี้ถูกลบแล้ว หรือคุณไม่มีสิทธิ์เข้าถึงอีกต่อไป',
  wbDocChangeErrorTitle: 'โหลดเอกสารไม่ได้',
  wbDocChangeErrorDesc: 'เกิดข้อผิดพลาด ลองอีกครั้ง',
  wbDocChangeLoadMore: 'โหลดเพิ่ม',
  wbDocChangeLoadingMore: 'กำลังโหลด…',
  wbDocChangeDeleted: 'ลบถาวรแล้ว',
  wbDocChangeInTrash: 'ย้ายไปที่ถังขยะแล้ว',
  wbDocChangeUntitled: 'เอกสารไม่มีชื่อ',
  wbDocChangeMore: 'และอีก {count} รายการ',
  wbNoticeNoAccess: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้',
} satisfies Record<keyof typeof zh, string>
