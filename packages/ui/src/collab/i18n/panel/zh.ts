/**
 * Collab panel copy shared by every app (G8-20, spine String catalogue G8: S12, S13 and the
 * panel-level S15 messages). zh defines the key set; every sibling shard satisfies
 * Record<keyof typeof zh, string>. Counted strings take one key with a {count} placeholder whose
 * sentence holds for any number. {time} arrives already formatted by the host. "UniWork" is the
 * product name and stays untranslated in every locale.
 */
export const zh = {
  // panel and panel states
  collabComments: '评论',
  collabDiscussion: '讨论',
  collabClosePanel: '关闭{panel}',
  collabLabelCount: '{label} · {count}',
  collabLoading: '正在加载…',
  collabEmptyComments: '还没有评论。请在文档中选择一处内容，然后选择“评论”。',
  collabEmptyDiscussion: '还没有讨论。写下你想就这份文档交流的内容吧。',
  collabLoadError: '无法加载此内容',
  collabLoadErrorBody: '没有丢失任何内容。请稍后再试。',
  collabRetry: '重试',
  collabOffline: '无法连接到 UniWork。你仍可阅读已加载的内容，但暂时无法发送。',
  collabServerError: 'UniWork 出了点问题。你仍可阅读已加载的内容，但暂时无法发送。',
  collabSignedOut: '登录已过期。请重新登录后再发送。',
  collabNoAccess: '你已无权查看此内容',
  collabNoAccessBody: '根据你目前对此文档的权限，此内容已被隐藏。',
  collabViewOnlyBadge: '仅查看',
  collabViewOnly: '你只有查看权限：可以阅读，但不能写入。',
  collabUpdatedAnnounce: '内容已更新。',

  // anchors
  collabAnchorDocx: '文字：“{quote}”',
  collabAnchorCell: '单元格 {cell}',
  collabAnchorSlide: '幻灯片 {slide}',
  collabAnchorPage: '第 {page} 页',
  collabAnchorStale: '位置可能已发生变化',
  collabAnchorLost: '再也找不到被评论的位置',
  collabGoToAnchor: '转到该位置',

  // thread, actions, history
  collabResolved: '已解决',
  collabResolve: '标记为已解决',
  collabReopen: '重新打开',
  collabReply: '回复',
  collabReplyCount: '回复：{count}',
  collabActions: '更多操作',
  collabEdit: '编辑',
  collabSave: '保存',
  collabCancel: '取消',
  collabDelete: '删除',
  collabCopyText: '复制内容',
  collabDeleteTitle: '删除此内容？',
  collabDeleteBody: '内容和编辑历史将被永久删除。已有的回复会保留。',
  collabDeleteConfirm: '永久删除',
  collabDeleted: '此内容已被删除',
  collabEdited: '已编辑 · {time}',
  collabEditedMark: '(已编辑)',
  collabFormerMember: '前成员',
  collabHistory: '查看编辑历史',
  collabHistoryTitle: '编辑历史',
  collabHistoryCurrent: '当前版本',
  collabHistoryEntry: '{name}，{time}',
  collabHistoryEmpty: '此内容还没有被编辑过。',
  collabHistoryError: '无法加载编辑历史。',
  collabActionFailed: '操作未能完成',

  // composer
  collabComposerComment: '写下评论…',
  collabComposerReply: '写下回复…',
  collabComposerDiscussion: '在讨论中写点什么…',
  collabSend: '发送',
  collabSendHint: '{shortcut} 发送',
  collabSending: '正在发送…',
  collabSendFailed: '未能发送。你的内容仍保留在输入框中。',
  collabCommentDeleted: '此评论已被删除。',
  collabDiscussionDeleted: '此讨论帖已被删除。',
  collabDiscardTitle: '放弃草稿？',
  collabDiscardBody: '你正在写的内容将会丢失。',
  collabDiscard: '放弃',
  collabKeepWriting: '继续写',
  collabAiDraftLabel: '这是 UniWork AI 建议的草稿。请检查后再发送。',

  // comments stored in the file (read-only)
  collabInFileSection: '文件中的评论',
  collabInFileHint: '已保存在文件中，仅可查看：无法在此编辑或回复。',

  // mention access warning & post-send notice
  collabMentionWarnTitle: '被提及的人无权查看此文档',
  collabMentionWarnBody: '{names}无法查看此文档，因此不会收到通知。',
  collabShareViewThenSend: '共享查看权限并发送',
  collabSendWithoutNotify: '直接发送，不通知',
  collabMentionAskManager: '请让管理此文档的人与{names}共享查看权限。',
  collabMentionMixedUnshareable: '无法与{unshareable}共享；他们不会收到通知。',
  collabSharingView: '正在共享查看权限…',
  collabShareViewFailed: '未能与{failedNames}共享查看权限。你可以重试，或直接发送而不通知。',
  collabShareViewPartial:
    '已与{sharedNames}共享查看权限。未能与{failedNames}共享（他们不会收到通知）。',
  collabSendComment: '发送评论',
  collabRetryShareFor: '为{failedNames}重试',
  collabSendFailedAfterShare:
    '已与{sharedNames}共享查看权限，但未能发送评论。你的内容仍保留在输入框中——请尝试重新发送。',
  collabPostSendNoAccess: '{names}无法查看此文档，因此未收到通知。',
  collabPostSendShareAction: '共享查看权限',
  collabPostSendNoRetroNote:
    '现在共享不会补发上面这条评论的通知；如需通知他们，请在新评论中再次提及。',
  collabDismissNotice: '关闭通知',
}
