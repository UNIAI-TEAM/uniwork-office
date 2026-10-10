import type { zh } from './zh'

export const ja = {
  cloudTitle: 'UniWork クラウド AI',
  cloudStateReady: '利用可能',
  cloudStateNotEntitled: 'プランに含まれていません',
  cloudStateExhausted: 'AI クレジットを使い切りました',
  cloudStateUnavailable: '現在利用できません',
  cloudStateSignedOut: 'サインインしていません',
  cloudStateInactive: 'サブスクリプション無効',
  cloudCredits: 'AI クレジット',
  cloudCreditsLeft: '残り {remaining} / {limit}',
  cloudCreditsUnlimited: '無制限',
  cloudCreditsRenews: '{date} にリセット',
  cloudSignedOutBody:
    'UniWork にサインインすると、組織の AI クレジットでウェブ検索・画像生成・メディア分析を利用できます。',
  cloudNotEntitledBody:
    '組織のプランには UniWork クラウド AI が含まれていません。下の独自プロバイダーは引き続き使えます。',
  cloudExhaustedBody:
    '組織は今期の UniWork AI クレジットをすべて使い切りました。クレジットのリセットまでクラウドツールは停止します。下の独自プロバイダーは引き続き使えます。',
  cloudUnavailableBody:
    'UniWork クラウド AI は現在利用できません。下の独自プロバイダーは引き続き使えます。',
  cloudInactiveBody:
    '組織の UniWork サブスクリプションが有効でないため、クラウド AI は停止中です。管理者に更新を依頼してください。下の独自プロバイダーは引き続き使えます。',
  cloudToolsOffBody:
    'UniWork クラウドツールはオフです。組織の AI クレジットを使うには、{section} で「{switch}」をオンにしてください。下の独自プロバイダーには影響しません。',
  cloudReadyBody:
    '独自プロバイダーがない場合、検索・画像生成・メディア分析には組織の UniWork AI クレジットが使われます。',
  cloudToolsToggle: 'UniWork クラウドツールを使う',
  cloudToolsToggleDesc:
    '独自プロバイダーがない場合、ウェブ検索・画像生成・メディア分析に UniWork クラウドを使います（AI クレジットを消費）。',
  cloudMediaLabel: 'UniWork クラウド',
  cloudMediaDesc: '組織の UniWork AI クレジットを使用します。キーは不要です。',
  cloudSearchAutoHint: 'まず UniWork クラウド（AI クレジットを消費）、次に無料検索を使います。',
  aiTestErrInvalidKey: 'API キーがないか、拒否されました',
  aiTestErrNetwork: '接続できません。ネットワークを確認してください',
  aiTestErrLimit: 'プロバイダーの上限に達しました。後でもう一度お試しください',
  aiTestErrUnavailable: 'サービスが応答しません。後でもう一度お試しください',
} satisfies Record<keyof typeof zh, string>
