import type { zh } from './zh'

export const ja = {
  aiWebClose: '閉じる',
  aiWebStateCreditsTitle: 'AI クレジットを使い切りました',
  aiWebStateCreditsBody:
    '組織は今期の UniWork AI クレジットをすべて使用しました。管理者に問い合わせるか、リセットをお待ちください。',
  aiWebStateEntitlementTitle: 'プランに AI が含まれていません',
  aiWebStateEntitlementBody:
    '組織の UniWork プランにはこの AI 機能が含まれていません。管理者にお問い合わせください。',
  aiWebStateRateTitle: 'AI リクエストが多すぎます',
  aiWebStateRateBody: '{seconds} 秒待ってからもう一度お試しください。',
  aiWebStateRateBodyNow: 'しばらく待ってからもう一度お試しください。',
  aiWebStateUnreachableTitle: 'AI プロバイダーに接続できません',
  aiWebStateUnreachableBody:
    'UniWork が AI プロバイダーに接続できませんでした。しばらくしてからお試しください。',
  aiWebStateCloudTitle: 'クラウドツールを利用できません',
  aiWebStateCloudBody: 'この UniWork AI ツールはまだサーバーで設定されていません。',
  aiWebStateOutageTitle: 'UniWork が一時的に利用できません',
  aiWebStateOutageBody: '現在 UniWork に接続できません。しばらくしてからお試しください。',
  aiWebStateSessionTitle: 'セッションの有効期限が切れました',
  aiWebStateSessionBody: '続行するには UniWork からドキュメントを開き直してください。',
  aiWebStateRefusedTitle: 'リクエストが拒否されました',
  aiWebStateRefusedBody: 'サーバーが AI リクエストを拒否しました。',
  aiWebStateUnknownTitle: 'AI リクエストに失敗しました',
  aiWebStateUnknownBody: '問題が発生しました。もう一度お試しください。',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'このブックは大きすぎるため、Web 版では AI を使えません。UniWork Office アプリで開いてください。',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: '次の部分に進んでください。',
} satisfies Record<keyof typeof zh, string>
