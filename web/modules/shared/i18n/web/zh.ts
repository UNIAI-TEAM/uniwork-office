export const zh = {
  webCancel: '取消',
  webConflictTitle: '此文档已在其他地方被修改',
  webConflictBody:
    '在你编辑期间已保存了更新的版本。要用你的版本覆盖它,还是重新加载最新版本并放弃你的更改?',
  webConflictOverwrite: '覆盖',
  webConflictReload: '重新加载最新版本',
  webConflictNotSaved: '文档已在其他地方被修改',
  webFatalTitle: '无法打开文档',
  webFatalBody: '编辑和保存已停用。请刷新页面或从 UniWork 重新打开文档。',
  webNoHost: '此编辑器需在 UniWork 中运行。请从 UniWork 打开文档。',
  webViewOnly: '仅查看',
  webViewOnlyNotSaved: '此文档为仅查看，无法保存',
  webNotUtf8: '此文件不是 UTF-8 文本，已以仅查看方式打开，以免保存时改动其内容',
  webDraftTitle: '恢复未保存的更改？',
  webDraftBody: '此浏览器保留了此文档未保存更改的副本。要恢复还是放弃这些更改？',
  webDraftOlder: '此副本基于文档的旧版本。保存后将替换较新的版本。',
  webDraftSavedAt: '副本保存于',
  webDraftKept: '此浏览器会保留该副本，直到你退出登录。',
  webDraftRestore: '恢复',
  webDraftDiscard: '放弃',
  webSaveNetwork: '无法连接到 UniWork。请检查网络后重试。',
  webSaveTimeout: '保存耗时过长。请检查网络后重试。',
  webClose: '关闭',
  webSaveUnauthorized: '你的 UniWork 登录已失效。请重新登录后再保存。',
  webSaveForbidden: '你没有保存此文档的权限。',
  webSaveNotFound: '此文档已不存在或已被移动。',
  webSaveTooLarge: '文档太大,无法保存。',
  webSaveRateLimited: '请求过于频繁。请稍等片刻后重试。',
  webSaveServer: 'UniWork 保存时出了问题。请稍后重试。',
  webSaveFailedGeneric: '无法保存文档。请重试。',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe: '你的更改尚未存到 UniWork，会保留在此浏览器中，直到你退出登录。',
  uwConflictReloadWebBody:
    '浏览器不会保留冲突草稿。请把你的版本下载到电脑以便日后复制，或放弃你的更改。',
  uwConflictDownloadThenReload: '下载我的版本，然后重新加载',
  uwConflictDiscardThenReload: '放弃更改并重新加载',
  uwConflictMineFileSuffix: '（我的版本）',
  uwConflictDownloadCheck: '浏览器已收到你的文件。请确认文件已保存，然后选择“重新加载”。',
  uwConflictSessionWeb:
    '登录会话已过期，因此没有完成覆盖。你的更改仍保留在此浏览器中；请重新登录后重试。',
  uwConflictTooLarge: '你的版本超过了 UniWork 的大小限制，因此无法覆盖。',
  uwConflictDownloadFailed: '无法下载你的版本，因此文档没有重新加载。请重试。',
  uwConflictOfflineWeb: '离线中。在网页上执行此操作需要网络连接；你的更改仍保留在浏览器中。',

  // S5 conflict dialog: two-column table
  uwConflictColMine: '你的版本',
  uwConflictColServer: 'UniWork 上的版本',
  uwConflictRowVersion: '版本',
  uwConflictRowTime: '时间',
  uwConflictRowBy: '保存者',
  uwConflictMineUnsaved: '你（未保存）',
  uwConflictBasedOn: '基于版本 {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: '查看差异',
  uwConflictNoEdit: '你已无权编辑此文档。',
  uwConflictOverwriteTitle: '用你的版本覆盖？',
  uwConflictOverwriteConfirm:
    'UniWork 将根据你的副本创建版本 {next}。{author} 的版本 {server} 仍保留在历史记录中。',
  uwConflictOverwriteGo: '覆盖',
  uwConflictBack: '返回',
  uwConflictHeadMoved: '与此同时 UniWork 上已有版本 {n}。表格已更新；请重新选择。',
  uwConflictReloadTitle: '重新加载最新版本',
  uwConflictReloadGo: '重新加载',
  uwConflictSaveCopy: '另存为副本…',
  uwConflictSaveCopyTitle: '另存为副本？',
  uwConflictSaveCopyConfirm:
    'UniWork 将根据你的版本创建一个新文档，所有者和访问权限与此文档相同。当前文档和 {author} 的版本 {server} 保持不变。',
  uwConflictSaveCopyGo: '创建副本',
  uwConflictSaveCopyDone:
    '你的版本已另存为新文档：{title}。此文档未改变；你仍可选择重新加载或覆盖。',
  uwConflictSaveCopyFailed: '无法创建副本。你的更改仍然安全；请重试。',
  uwConflictSaveCopyOffline: '离线中。创建副本需要网络连接；你的更改会保留。',
  uwConflictReloadFailed: '无法加载最新版本。你的文档没有改变；请重试。',
  uwConflictOverwriteFailed: '暂时无法覆盖。你的文档没有改变；请重试。',
  uwConflictClose: '关闭',

  // S6 new-version bar
  uwRemoteRegion: '新版本',
  uwRemoteUpdated: '已更新到版本 {n}，由 {author} 于 {time} 保存。',
  uwRemoteUpdatedNoRev: '已更新到 UniWork 上的最新版本。',
  uwRemoteNewerDirty:
    'UniWork 上有更新的版本（版本 {n}）。你有未保存的更改，因此文档没有自动重新加载。',
  uwRemoteNewerAi:
    'UniWork 上有更新的版本（版本 {n}）。UniWork AI 正在运行，因此文档没有自动重新加载；AI 结果只应用于当前打开的副本。',
  uwRemoteNowClean: '你已撤销所有更改。UniWork 上的版本 {n} 比当前打开的副本更新。',
  uwRemoteStopAiConfirm:
    '要停止正在运行的 UniWork AI 以重新加载吗？AI 已做出的更改属于当前打开的副本。',
  uwRemoteWaitCommit: '正在等待发送中的保存完成；完成后即可重新加载。',
  uwRemoteReload: '重新加载最新版本…',
  uwRemoteLater: '稍后',
  uwRemoteClose: '关闭',
  uwRemoteReloadFailed: '无法加载版本 {n}。你仍在查看之前的版本。',
  uwRemoteDeleted: '此文档已在 UniWork 中删除。排队中的保存已停止。',
  uwAuthorFallback: '一位成员',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    '你已无权访问此文档。保存已停止；未保存的更改会保留在此浏览器中，直到你退出登录。',
  uwRemoteOrgBlockedWeb: '无法保存：{reason}。未保存的更改会保留在此浏览器中，直到你退出登录。',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: '文档已归档',
  uwReasonSuspended: '组织已被暂停',
  uwReasonDeactivated: '你在此组织中的账号已被停用',
}
