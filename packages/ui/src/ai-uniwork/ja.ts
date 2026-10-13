import type { zh } from './zh'

export const ja = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'クレジット残り {remaining} / {limit}',
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
} satisfies Record<keyof typeof zh, string>
