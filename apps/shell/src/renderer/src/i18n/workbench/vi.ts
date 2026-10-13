import type { zh } from './zh'

export const vi = {
  wbOnThisDevice: 'Trên máy này',
  wbNotifFallback: 'Thông báo mới',
  wbNotif_task_assigned: '{actor} đã giao bạn việc “{task}”',
  wbNotif_task_status_changed: '{actor} chuyển “{task}” sang {status}',
  wbNotif_task_commented: '{actor} đã bình luận trong “{task}”',
  wbNotif_mentioned: '{actor} đã nhắc đến bạn trong “{task}”',
  wbNotif_meeting_invited: '{actor} đã mời bạn họp “{meeting}”',
  wbNotif_meeting_starting: '“{meeting}” bắt đầu sau {minutes} phút',
  wbNotif_meeting_summary_reminder: '“{meeting}” đã kết thúc · Tóm tắt và tạo việc',
  wbNotif_member_added: '{actor} đã thêm bạn vào không gian làm việc {workspace}',
  wbNotif_role_changed: '{actor} đã đổi vai trò của bạn thành {role}',
  wbNotif_audit_export_ready: 'Bản xuất nhật ký của bạn đã sẵn sàng',
  wbNotif_chat_follow_up: 'Bạn đã đánh dấu cần theo dõi một tin nhắn',
  wbNotif_chat_reminder: 'Nhắc hẹn: {body}',
  wbNotif_email_hub_new_mail: 'Bạn có {count} thư chưa đọc · {mailbox}',
  wbNotif_document_commented: '{actor} đã bình luận trong “{document}”',
  wbNotif_document_mentioned: '{actor} đã nhắc đến bạn trong “{document}”',
  wbNotif_chat_mentioned: '{actor} đã nhắc đến bạn trong {room}',
  wbNotif_chat_dm: '{actor} đã nhắn tin cho bạn',
  wbNotif_chat_thread_replied: '{actor} đã trả lời một chuỗi tin nhắn trong {room}',
} satisfies Record<keyof typeof zh, string>
