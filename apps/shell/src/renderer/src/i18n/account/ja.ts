import type { zh } from './zh'

export const ja = {
  acctTitle: 'UniWork アカウント',
  acctOpenSettings: 'アカウント設定を開く',
  acctSignIn: 'サインイン',
  acctSignInUniwork: 'UniWork にサインイン',
  acctSignInAgain: '再度サインイン',
  acctSignOut: 'サインアウト',
  acctSigningOut: 'サインアウトしています…',
  acctSigningIn: 'サインインしています…',
  acctSigningInHint: 'ブラウザーで操作を続けて、サインインを完了してください。',
  acctCancel: 'キャンセル',
  acctOpenAgain: 'ブラウザーをもう一度開く',
  acctCopyLink: 'サインインリンクをコピー',
  acctLinkCopied: 'リンクをコピーしました',
  acctSignedInAs: '{name} としてサインイン中',
  acctSignedOutTitle: 'サインインしていません',
  acctSignedOutBody:
    'UniWork アカウントでサインインすると、このデバイスで組織のプランを利用できます。',
  acctRefreshing: 'アカウントを更新しています…',
  acctName: '名前',
  acctEmail: 'メール',
  acctOrg: '組織',
  acctPlan: 'プラン',
  acctServer: 'サーバー',
  acctNoPlan: 'プランなし',
  acctSwitchOrg: '組織を切り替える',
  acctSwitchOrgFailed: '組織を切り替えられませんでした。もう一度お試しください。',
  acctExpiredShort: 'セッションの期限切れ',
  acctExpiredTitle: 'セッションの有効期限が切れました',
  acctExpiredBody:
    'セキュリティのため、UniWork アカウントを引き続き使うには再度サインインしてください。',
  acctRevokedShort: 'セッションが終了しました',
  acctRevokedTitle: 'このデバイスはサインアウトされました',
  acctRevokedBody:
    'このデバイスのセッションは、別のデバイスまたは管理者によって終了されました。続けるには再度サインインしてください。',
  acctUnreachableTitle: 'UniWork に接続できません',
  acctUnreachableBody:
    'インターネット接続またはプロキシ設定を確認してください。サインインしたままですが、以下の情報は最新でない可能性があります。',
  acctRetry: '再試行',
  acctRetrying: '再試行しています…',
  acctWrongServerShort: '別のサーバー',
  acctWrongServerTitle: '別のサーバーにサインインしています',
  acctWrongServerBody:
    'このアプリは {server} に接続されていますが、現在のセッションは別の UniWork サーバーのものです。{server} で再度サインインするか、サインアウトしてください。',
  acctThisServer: '設定済みのサーバー',
  acctNotConfiguredShort: '未接続',
  acctNotConfiguredTitle: 'UniWork サーバーに接続されていません',
  acctNotConfiguredBody:
    'この UniWork Office はまだ UniWork サーバーと設定されていないため、サインインできません。設定済みのインストーラーについては管理者にお問い合わせください。',
  acctKeyringShort: 'セキュアストレージが必要です',
  acctKeyringTitle: 'セキュアストレージを利用できません',
  acctKeyringBody:
    'UniWork Office は、サインイン情報をシステムのセキュアストレージ (キーチェーン、資格情報マネージャー、またはキーリング) に保存します。ロックを解除するか設定してから、アプリを再起動してください。',
  acctErrLaunch: 'サインインを開始できませんでした。もう一度お試しください。',
  acctErrNetwork:
    'UniWork に接続できません。インターネット接続またはプロキシ設定を確認してください。',
  acctErrTimeout: 'UniWork からの応答に時間がかかりすぎています。もう一度お試しください。',
  acctErrLoginTimeout: 'サインインがタイムアウトしました。もう一度お試しください。',
  acctErrCancelled: 'サインインはキャンセルされました。',
  acctErrInvalidCallback: 'サインインの応答が無効でした。もう一度お試しください。',
  acctErrStateMismatch:
    'このサインインリンクは現在の操作と一致しません。アプリからもう一度サインインを開始してください。',
  acctCallbackMismatch:
    'このサインインリンクは一致しません。このアプリが開いたブラウザーのウィンドウでサインインを完了してください。',
  acctErrAuthCodeInvalid:
    'サインインコードの有効期限が切れているか、すでに使用されています。再度サインインしてください。',
  acctErrRateLimited: '試行回数が多すぎます。しばらく待ってからもう一度お試しください。',
  acctErrUnauthorized: 'セッションが無効になりました。再度サインインしてください。',
  acctErrDeviceRevoked: 'このデバイスはサインアウトされました。再度サインインしてください。',
  acctErrRefreshReused:
    'セキュリティのため、このセッションは終了されました。再度サインインしてください。',
  acctErrWrongDeployment: 'このアカウントは別の UniWork サーバーのものです。',
  acctErrNotConfigured: 'このアプリは UniWork サーバーに接続されていません。',
  acctErrKeyringUnavailable: 'このコンピューターのセキュアストレージを利用できません。',
  acctErrServerError: 'UniWork で問題が発生しました。しばらくしてからもう一度お試しください。',
  acctErrMalformedResponse:
    'UniWork から予期しない応答がありました。しばらくしてからもう一度お試しください。',
} satisfies Record<keyof typeof zh, string>
