import type { zh } from './zh'

export const ja = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: '{limit} クレジット中、残り {remaining}',
  aiUniworkFooterSignIn: 'UniWork AI を使うには UniWork にログインしてください',
  aiUniworkSignedOut:
    'UniWork からログアウトしています。別のプロバイダーを選ぶか、再ログインしてください。',
  aiUniworkOff: 'このドキュメントでは UniWork AI がオフです。別のプロバイダーを選んでください。',
  aiUniworkViewOnly: '表示のみ：AI は回答できますが、ドキュメントの編集や保存はできません。',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI は、このドキュメントで開いている内容（未保存の変更を含む）を読み取り、回答のために UniWork とモデルプロバイダーに送信します。実行ごとに {org} の AI クレジットを使用します。AI が代わりに保存することはありません。確認してから「保存」を押してください。',
  aiUniworkDisclosureLabel: 'UniWork AI が受け取る内容',
  aiUniworkDisclosureShort: '開いている内容（未保存を含む）を UniWork に送信 · {org} のクレジット',
  aiUniworkLocalFile:
    'このファイルはあなたのコンピューター上にあり、UniWork にはありません。UniWork AI を使うと、開いているファイルの内容が UniWork に送信され、{org} の AI クレジットを使用します。ファイルが UniWork ドキュメントとしてアップロードされることはありません。',
  aiUniworkAck: 'わかりました',
  aiUniworkLearnMore: '詳細',
  aiUniworkDetails: '詳細',
  aiUniworkSendNeedsAck: '送信する前にお知らせを読んで確認してください。',

  // S9 result chips and run controls
  aiResultAnswer: '回答',
  aiResultClarify: '確認が必要',
  aiResultEdited: 'ドキュメントを編集済み',
  aiResultUnsupported: '未対応',
  aiResultError: 'エラー',
  aiResultEditedHint: '未保存 — Ctrl/⌘+Z で元に戻すか、問題なければ「保存」を押してください。',
  aiResultViewChanges: '変更を表示',
  aiRunStop: '停止',
  aiRunSend: '送信',
  aiRunRunning: '実行中… 停止するには「停止」または Esc を押してください。',
  aiRunStopped:
    '停止しました。すでに適用された変更（ある場合）はドキュメントに残り、元に戻せます。',
  aiRunRetry: '再試行',
  aiRunAskAgain: 'もう一度質問',
  aiRunChooseOther: '別のプロバイダーを選択',
  aiRunOpenInApp: 'アプリで開く',
  aiConversationRestarted:
    '以前の会話の有効期限が切れたため、UniWork AI は新しい会話を始めました。以前のやり取りは覚えていません。続けるには質問をもう一度送信してください。',
  aiConversationBoundary: '{provider} との新しい会話：上のやり取りは送信されません。',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'この実行は UniWork AI のステップ上限に達しました。ここまでの結果は保持されます。リクエストを分けてもう一度質問してください。',
  aiErrCredits: '組織の今期の AI クレジットがなくなりました。この実行は停止しました。',
  aiErrEntitlement: '組織のプランに UniWork AI が含まれなくなりました。',
  aiErrRateLimited: '送信が速すぎます。{seconds} 秒後にもう一度お試しください。',
  aiErrRateLimitedNoWait: '送信が速すぎます。数分後にもう一度お試しください。',
  aiErrUnavailable: 'UniWork AI は現在応答していません。ドキュメントと「保存」は引き続き使えます。',
  aiErrGeneric:
    'UniWork AI で予期しない問題が発生したため、この実行を停止しました。ドキュメントと「保存」は引き続き使えます。',
  aiErrDisconnected:
    '接続が切れたため、この実行は停止しました。すでに適用された変更（ある場合）はドキュメントに残り、元に戻せます。',
  aiErrOffline:
    'オフラインです。UniWork AI はオフラインでは動作せず、リクエストもキューに入りません。',
  aiErrSession:
    'UniWork のセッションの有効期限が切れたため、この実行は停止しました。続けるには再ログインしてください。',
  aiErrRevoked: 'このドキュメントへのアクセス権がなくなったため、AI の実行は停止しました。',
  aiErrDowngraded: 'アクセス権が表示のみに変わったため、AI は編集を停止しました。回答は続きます。',
  aiErrCapabilityOff:
    'このドキュメントで UniWork AI がオフにされたため、実行は現在のステップの後で停止しました。',
  aiErrUnsupported: 'UniWork AI は {module} ではまだこの操作を行えません。',
  aiErrViewOnlyEdit: 'このドキュメントには表示権限しかないため、AI は編集できません。',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'UniWork AI へのリクエストが長すぎます。8,000 文字未満に短くしてから送信してください。',
  aiErrQuestionRejected:
    'UniWork AI はこのリクエストを受け付けられませんでした。内容を変更してから送信してください。',
  aiUniworkImagesNotSent: '画像は UniWork AI に送信されません。テキストのみ送信しました。',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateNotEntitled: 'プランに含まれていません',
  cloudStateExhausted: 'AI クレジットを使い切りました',
  cloudStateUnavailable: '現在利用できません',
  cloudStateInactive: 'サブスクリプション無効',
  cloudCreditsLeft: '残り {remaining} / {limit}',
  cloudCreditsUnlimited: '無制限',
  cloudInactiveBody:
    '組織の UniWork サブスクリプションが有効でないため、クラウド AI は停止中です。管理者に更新を依頼してください。下の独自プロバイダーは引き続き使えます。',
  acctSignIn: 'サインイン',
  acctSignInAgain: '再度サインイン',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'ローカルファイルは組織の下で新しい会話を開始し、他のファイルのやり取りは引き継ぎません。',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta: '書き込んだセル: {written}（{range}）· 上書きした既存セル: {overwritten}',
  aiResultCellsMetaNoOverwrite: '書き込んだセル: {written}（{range}）',
  aiErrWorkbookTooLarge:
    'このブックは大きすぎるため、Web 版では AI を使えません。UniWork Office アプリで開いてください。',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    '組織のプランに UniWork AI が含まれていません。プランについて組織の管理者に確認するか、「設定 > AI モデル」でご自身の AI キーを追加してください。',
  credits_exhausted:
    '組織の今期の AI クレジットをすべて使い切りました。組織の管理者にクレジットの追加を依頼するか、「設定 > AI モデル」でご自身の AI キーを追加してください。',
} satisfies Record<keyof typeof zh, string>
