import type { zh } from './zh'

export const ja = {
  cloudTitle: 'UniWork クラウド AI',
  cloudStatus: '状態',
  cloudStateReady: '利用可能',
  cloudStateNotEntitled: 'プランに含まれていません',
  cloudStateExhausted: 'AI クレジットを使い切りました',
  cloudStateUnavailable: '現在利用できません',
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
  cloudReadyBody:
    '独自プロバイダーがない場合、検索・画像生成・メディア分析には組織の UniWork AI クレジットが使われます。',
  cloudToolsToggle: 'UniWork クラウドツールを使う',
  cloudToolsToggleDesc:
    '独自プロバイダーがない場合、ウェブ検索・画像生成・メディア分析に UniWork クラウドを使います（AI クレジットを消費）。',
  cloudMediaLabel: 'UniWork クラウド',
  cloudMediaDesc: '組織の UniWork AI クレジットを使用します。キーは不要です。',
  cloudSearchAutoHint: 'まず UniWork クラウド（AI クレジットを消費）、次に無料検索を使います。',
} satisfies Record<keyof typeof zh, string>
