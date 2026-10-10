import type { zh } from './zh'

export const ja = {
  aiWebSettingsTitle: 'AI 設定',
  aiWebSettingsIntro:
    'アシスタントはご自身のプロバイダー API キーを使用します。キーは UniWork が暗号化して保存し、このページには送信されません。',
  aiWebProvider: 'プロバイダー',
  aiWebModel: 'モデル',
  aiWebKeySaved: '保存済みのキー {hint}',
  aiWebNoKey: 'キーが保存されていません',
  aiWebApiKey: 'API キー',
  aiWebApiKeyKeep: '新しい API キー（空欄の場合は保存済みのキーを使用）',
  aiWebBaseUrl: 'Base URL',
  aiWebSaveKey: 'キーを保存',
  aiWebRemoveKey: 'キーを削除',
  aiWebDone: '完了',
  aiWebLoading: '読み込み中…',
  aiWebLoadFailed: 'AI 設定を読み込めませんでした。後でもう一度お試しください。',
  aiWebCloudTitle: 'UniWork AI クラウドツール',
  aiWebCloudOff: '組織のプランに含まれていません',
  aiWebCredits: '残りクレジット: {remaining} / {limit}',
  aiWebCreditsUnlimited: 'クレジット: 無制限',
  aiWebCreditsRenew: '{date} にリセット',
  aiWebOpenSettings: 'AI 設定',
  aiWebClose: '閉じる',
  aiWebStateCreditsTitle: 'AI クレジットを使い切りました',
  aiWebStateCreditsBody:
    '組織は今期の UniWork AI クレジットをすべて使用しました。管理者に問い合わせるか、リセットをお待ちください。',
  aiWebStateEntitlementTitle: 'プランに AI が含まれていません',
  aiWebStateEntitlementBody:
    '組織の UniWork プランにはこの AI 機能が含まれていません。管理者にお問い合わせください。',
  aiWebStateKeyMissingTitle: 'AI キーがまだありません',
  aiWebStateKeyMissingBody: 'アシスタントを使うには、AI 設定で API キーを追加してください。',
  aiWebStateKeyRejectedTitle: 'AI キーが拒否されました',
  aiWebStateKeyRejectedBody:
    'プロバイダーが保存済みのキーを拒否しました。AI 設定でキーを置き換えてください。',
  aiWebStateRateTitle: 'AI リクエストが多すぎます',
  aiWebStateRateBody: '{seconds} 秒待ってからもう一度お試しください。',
  aiWebStateRateBodyNow: 'しばらく待ってからもう一度お試しください。',
  aiWebStateUnreachableTitle: 'AI プロバイダーに接続できません',
  aiWebStateUnreachableBody:
    'UniWork が AI プロバイダーに接続できませんでした。しばらくしてからお試しください。',
  aiWebStateCloudTitle: 'クラウドツールを利用できません',
  aiWebStateCloudBody: 'この UniWork AI ツールはまだサーバーで設定されていません。',
  aiWebStateSessionTitle: 'セッションの有効期限が切れました',
  aiWebStateSessionBody: '続行するには UniWork からドキュメントを開き直してください。',
  aiWebStateRefusedTitle: 'リクエストが拒否されました',
  aiWebStateRefusedBody: 'サーバーが AI リクエストを拒否しました。',
  aiWebStateModelTitle: 'モデルを選択してください',
  aiWebStateModelBody:
    'メッセージ欄の横にあるモデルメニューでモデルを選び、もう一度送信してください。',
  aiWebStateBaseUrlBody:
    'この Base URL は使用できません。公開された https:// アドレスを使用してください。',
  aiWebStateProviderBody: 'このプロバイダーはサポートされていません。',
  aiWebStateUnknownTitle: 'AI リクエストに失敗しました',
  aiWebStateUnknownBody: '問題が発生しました。もう一度お試しください。',
} satisfies Record<keyof typeof zh, string>
