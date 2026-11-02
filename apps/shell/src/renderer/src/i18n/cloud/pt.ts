import type { zh } from './zh'

export const pt = {
  cloudTitle: 'IA na nuvem UniWork',
  cloudStateReady: 'Disponível',
  cloudStateNotEntitled: 'Não incluído no seu plano',
  cloudStateExhausted: 'Créditos de IA esgotados',
  cloudStateUnavailable: 'Indisponível',
  cloudStateInactive: 'Assinatura inativa',
  cloudCredits: 'Créditos de IA',
  cloudCreditsLeft: 'Restam {remaining} / {limit}',
  cloudCreditsUnlimited: 'Ilimitado',
  cloudCreditsRenews: 'Renova em {date}',
  cloudToolsToggle: 'Usar ferramentas na nuvem UniWork',
  cloudToolsToggleDesc:
    'Pesquisa na web, geração de imagens e análise de mídia usam a nuvem UniWork (consome créditos de IA).',
} satisfies Record<keyof typeof zh, string>
