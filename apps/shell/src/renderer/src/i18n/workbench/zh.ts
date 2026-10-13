/**
 * Workbench strings; zh defines the key set. This file seeds the keys several
 * tabs share; Tasks 12–18 append their own (wbTop*, wbOv*, wbWork*, wbTasks*,
 * wbCal*, wbProfile*, wbNotes*, and Task 18's moved label() copy).
 */
export const zh = {
  // the local-only label (Overview recents, Forms, Notes, the four pillars)
  wbOnThisDevice: '在本机',
  // notifications (C10): wbNotif_<server kind>; params come from the server as-is
  wbNotifFallback: '新通知',
  wbNotif_task_assigned: '{actor} 给你分配了“{task}”',
  wbNotif_task_status_changed: '{actor} 将“{task}”改为 {status}',
  wbNotif_task_commented: '{actor} 评论了“{task}”',
  wbNotif_mentioned: '{actor} 在“{task}”中提到了你',
  wbNotif_meeting_invited: '{actor} 邀请你参加“{meeting}”',
  wbNotif_meeting_starting: '“{meeting}”将在 {minutes} 分钟后开始',
  wbNotif_meeting_summary_reminder: '“{meeting}”已结束 · 总结并创建任务',
  wbNotif_member_added: '{actor} 将你加入工作区 {workspace}',
  wbNotif_role_changed: '{actor} 将你的角色改为 {role}',
  wbNotif_audit_export_ready: '你的审计导出已就绪',
  wbNotif_chat_follow_up: '你为一条消息设置了跟进',
  wbNotif_chat_reminder: '提醒：{body}',
  wbNotif_email_hub_new_mail: '你有 {count} 封未读邮件 · {mailbox}',
  wbNotif_document_commented: '{actor} 评论了“{document}”',
  wbNotif_document_mentioned: '{actor} 在“{document}”中提到了你',
  wbNotif_chat_mentioned: '{actor} 在 {room} 中提到了你',
  wbNotif_chat_dm: '{actor} 给你发了消息',
  wbNotif_chat_thread_replied: '{actor} 回复了 {room} 中的话题',
  wbTopTitle: '工作台',
  wbTopWorkspace: '工作区',
  wbTopRole: '角色',
  wbTopNew: '新建',
  wbTopNewTask: '新任务',
  wbTopRefresh: '刷新',
}
