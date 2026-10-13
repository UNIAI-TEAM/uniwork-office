import type { zh } from './zh'

export const en = {
  wbOnThisDevice: 'On this device',
  wbNotifFallback: 'New notification',
  wbNotif_task_assigned: '{actor} assigned you “{task}”',
  wbNotif_task_status_changed: '{actor} moved “{task}” to {status}',
  wbNotif_task_commented: '{actor} commented on “{task}”',
  wbNotif_mentioned: '{actor} mentioned you in “{task}”',
  wbNotif_meeting_invited: '{actor} invited you to “{meeting}”',
  wbNotif_meeting_starting: '“{meeting}” starts in {minutes} min',
  wbNotif_meeting_summary_reminder: '“{meeting}” ended · Summarize it and create tasks',
  wbNotif_member_added: '{actor} added you to workspace {workspace}',
  wbNotif_role_changed: '{actor} changed your role to {role}',
  wbNotif_audit_export_ready: 'Your audit export is ready',
  wbNotif_chat_follow_up: 'You saved a follow-up on a message',
  wbNotif_chat_reminder: 'Reminder: {body}',
  wbNotif_email_hub_new_mail: 'Unread messages: {count} · {mailbox}',
  wbNotif_document_commented: '{actor} commented on “{document}”',
  wbNotif_document_mentioned: '{actor} mentioned you in “{document}”',
  wbNotif_chat_mentioned: '{actor} mentioned you in {room}',
  wbNotif_chat_dm: '{actor} sent you a message',
  wbNotif_chat_thread_replied: '{actor} replied to a thread in {room}',
} satisfies Record<keyof typeof zh, string>
