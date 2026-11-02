import type { zh } from './zh'

export const ja = {
  cloudTitle: 'UniWork クラウド AI',
  cloudStateReady: '利用可能',
  cloudStateNotEntitled: 'プランに含まれていません',
  cloudStateExhausted: 'AI クレジットを使い切りました',
  cloudStateUnavailable: '現在利用できません',
  cloudStateInactive: 'サブスクリプション無効',
  cloudCredits: 'AI クレジット',
  cloudCreditsLeft: '残り {remaining} / {limit}',
  cloudCreditsUnlimited: '無制限',
  cloudCreditsRenews: '{date} にリセット',
  cloudToolsToggle: 'UniWork クラウドツールを使う',
  cloudToolsToggleDesc:
    '独自プロバイダーがない場合、ウェブ検索・画像生成・メディア分析に UniWork クラウドを使います（AI クレジットを消費）。',
} satisfies Record<keyof typeof zh, string>
