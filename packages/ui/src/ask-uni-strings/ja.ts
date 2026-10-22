import type { zh } from './zh'

export const ja = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI が考えています…',
  askUniYou: 'あなた',
  askUniUni: 'UNI',
  askUniSources: '出典',
  askUniKindDocument: 'ドキュメント',
  askUniKindTask: 'タスク',
  askUniKindMeeting: '会議',
  askUniKindChat: 'チャット',
  askUniKindMember: 'メンバー',
  askUniKindOther: 'その他',
  askUniOpenDocument: 'ドキュメントを開く',
  askUniOpenBrowser: 'ブラウザーで開く',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'このソースを開けませんでした。もう一度試すか、ウェブで開いてください。',
  askUniErrForbidden: 'このデータを閲覧する権限がありません。',
  askUniErrQuota: '組織の今月の AI トークン上限に達しました。',
  askUniErrRateLimited: '質問の間隔が短すぎます。1 分後にもう一度お試しください。',
  askUniErrRateLimitedIn: '質問の間隔が短すぎます。{seconds} 秒後にもう一度お試しください。',
  askUniErrDisabled: 'このサーバーでは AI が設定されていません。',
  askUniErrOffline: 'オフラインです。UNI への質問にはドキュメントを検索するための接続が必要です。',
  askUniErrSession:
    'UniWork のセッションが期限切れです。もう一度サインインして質問を続けてください。',
  askUniErrDefault: '今は質問できません。しばらくしてからもう一度お試しください。',
  askUniSignedOut:
    'UniWork アカウントにサインインすると、ワークスペースについて UNI に質問できます。',
  askUniNoticeNoSources: 'この質問に一致する、閲覧可能なデータはまだありません。',
  askUniNoticeUnavailable: 'UNI はこの質問に回答できませんでした。',
  askUniStop: '停止',
  askUniSend: '送信',
  askUniCounter: '{used}/{max} 文字',
  askUniPlaceholder: '仕事について UNI に質問…',
} satisfies Record<keyof typeof zh, string>
