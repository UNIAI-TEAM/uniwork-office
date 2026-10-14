/**
 * UniWork AI panel copy shared by every app (U-02 closed catalogue, S7-S10). zh defines the key set;
 * every sibling shard satisfies Record<keyof typeof zh, string>. Counted strings take one key with a
 * {count}-style placeholder whose sentence holds for any number: no plural-form keys, no ICU plural.
 * "UniWork AI" is the provider name and stays untranslated in every locale.
 */
export const zh = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: '剩余 {remaining} / {limit}',
  aiUniworkFooterSignIn: '登录 UniWork 以使用 UniWork AI',
  aiUniworkSignedOut: '你已退出 UniWork。请选择其他服务商或重新登录。',
  aiUniworkOff: '此文档已关闭 UniWork AI。请选择其他服务商。',
  aiUniworkViewOnly: '仅查看：AI 可以回答，但不能编辑或保存文档。',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI 会读取此文档中当前打开的内容（包括未保存的部分），并发送给 UniWork 和模型服务商以生成回答。每次运行都会消耗 {org} 的 AI 额度。AI 不会替你保存：请检查后再点“保存”。',
  aiUniworkDisclosureLabel: 'UniWork AI 会收到的内容',
  aiUniworkDisclosureShort: '将打开的内容（包括未保存部分）发送到 UniWork · 使用 {org} 的额度',
  aiUniworkLocalFile:
    '此文件在你的电脑上，不在 UniWork 中。使用 UniWork AI 时，打开文件的内容会发送到 UniWork，并消耗 {org} 的 AI 额度。文件不会作为 UniWork 文档上传。',
  aiUniworkAck: '知道了',
  aiUniworkLearnMore: '了解详情',
  aiUniworkDetails: '详细信息',
  aiUniworkSendNeedsAck: '发送前请阅读并确认此说明。',

  // S9 result chips and run controls
  aiResultAnswer: '回答',
  aiResultClarify: '需要澄清',
  aiResultEdited: '已在文档中编辑',
  aiResultUnsupported: '尚不支持',
  aiResultError: '错误',
  aiResultEditedHint: '尚未保存 — 可用 Ctrl/⌘+Z 撤销，确认无误后点“保存”。',
  aiResultViewChanges: '查看更改',
  aiRunStop: '停止',
  aiRunSend: '发送',
  aiRunRunning: '正在运行… 按“停止”或 Esc 停止。',
  aiRunStopped: '已停止。已应用的更改（如有）仍在文档中，可以撤销。',
  aiRunAskAgain: '继续提问',
  aiRunChooseOther: '选择其他服务商',
  aiRunOpenInApp: '在应用中打开',
  aiConversationRestarted:
    '之前的对话已过期，因此 UniWork AI 开始了新对话，不再记得之前的轮次。请重新发送问题以继续。',
  aiConversationBoundary: '与 {provider} 的新对话：上方的轮次不会一并发送。',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit: '本次运行已达到 UniWork AI 的步骤上限。目前的结果会保留；请拆分请求后继续提问。',
  aiErrCredits: '你的组织本周期的 AI 额度已用完。本次运行已停止。',
  aiErrEntitlement: '你的组织的套餐已不再包含 UniWork AI。',
  aiErrRateLimited: '你发送得太快了。请在 {seconds} 秒后重试。',
  aiErrRateLimitedNoWait: '你发送得太快了。请几分钟后重试。',
  aiErrUnavailable: 'UniWork AI 暂时没有响应。你的文档和“保存”仍可正常使用。',
  aiErrGeneric: 'UniWork AI 遇到意外问题，本次运行已停止。你的文档和“保存”仍可正常使用。',
  aiErrDisconnected: '连接中断，本次运行已停止。已应用的更改（如有）仍在文档中，可以撤销。',
  aiErrOffline: '你已离线。UniWork AI 无法离线运行，请求也不会排队。',
  aiErrSession: '你的 UniWork 登录已过期，本次运行已停止。请重新登录以继续。',
  aiErrRevoked: '你已无权访问此文档，因此 AI 运行已停止。',
  aiErrDowngraded: '你的权限刚变为仅查看，因此 AI 已停止编辑。回答会继续。',
  aiErrCapabilityOff: '此文档的 UniWork AI 刚被关闭，因此本次运行在当前步骤后停止。',
  aiErrUnsupported: 'UniWork AI 暂时还无法在{module}中执行此操作。',
  aiErrViewOnlyEdit: '你对此文档只有查看权限，因此 AI 无法编辑。',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong: '你的请求对 UniWork AI 来说太长了。请缩短到 8,000 个字符以内后再发送。',
  aiErrQuestionRejected: 'UniWork AI 无法接受此请求。请修改后再发送。',
  aiUniworkImagesNotSent: '图片不会发送给 UniWork AI，只发送了你的文字。',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateReady: '可用',
  cloudStateNotEntitled: '套餐不含此功能',
  cloudStateExhausted: 'AI 额度已用完',
  cloudStateUnavailable: '暂不可用',
  cloudStateSignedOut: '未登录',
  cloudStateInactive: '订阅未生效',
  cloudCredits: 'AI 额度',
  cloudCreditsLeft: '剩余 {remaining} / {limit}',
  cloudCreditsUnlimited: '不限量',
  cloudCreditsRenews: '{date} 重置',
  cloudInactiveBody:
    '你所在组织的 UniWork 订阅未生效，云端 AI 已暂停。请联系管理员续订；下方自己的服务商不受影响。',
  acctSignIn: '登录',
  acctSignInAgain: '重新登录',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart: '本地文件会在你的组织下开始新对话，不会保留其他文件的对话轮次。',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: '已写入 {written} 个单元格（{range}）· 覆盖已有单元格 {overwritten} 个',
  aiErrWorkbookTooLarge: '此工作簿太大，无法在网页上使用 AI。请在 UniWork Office 应用中打开。',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    '你所在组织的套餐不包含 UniWork AI。请联系组织管理员了解套餐，或在“设置 > AI 模型”中添加你自己的 AI 密钥。',
  credits_exhausted:
    '你所在组织本周期的 AI 额度已用完。请联系组织管理员补充额度，或在“设置 > AI 模型”中添加你自己的 AI 密钥。',
}
