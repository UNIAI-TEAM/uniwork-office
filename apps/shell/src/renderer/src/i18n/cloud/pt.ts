import type { zh } from './zh'

export const pt = {
  cloudTitle: 'IA na nuvem UniWork',
  cloudStatus: 'Status',
  cloudStateReady: 'Disponível',
  cloudStateNotEntitled: 'Não incluído no seu plano',
  cloudStateExhausted: 'Créditos de IA esgotados',
  cloudStateUnavailable: 'Indisponível',
  cloudCredits: 'Créditos de IA',
  cloudCreditsLeft: 'Restam {remaining} / {limit}',
  cloudCreditsUnlimited: 'Ilimitado',
  cloudCreditsRenews: 'Renova em {date}',
  cloudSignedOutBody:
    'Entre no UniWork para usar pesquisa na web, geração de imagens e análise de mídia pagas com os créditos de IA da sua organização.',
  cloudNotEntitledBody:
    'O plano da sua organização não inclui a IA na nuvem UniWork. Você ainda pode usar seus próprios provedores abaixo.',
  cloudExhaustedBody:
    'Sua organização usou todos os créditos de IA UniWork deste período. As ferramentas na nuvem ficam pausadas até a renovação; seus próprios provedores continuam funcionando.',
  cloudUnavailableBody:
    'A IA na nuvem UniWork está indisponível no momento. Seus próprios provedores continuam funcionando.',
  cloudReadyBody:
    'Sem um provedor próprio, pesquisa, geração de imagens e análise de mídia usam os créditos de IA UniWork da sua organização.',
  cloudToolsToggle: 'Usar ferramentas na nuvem UniWork',
  cloudToolsToggleDesc:
    'Sem um provedor próprio, pesquisa na web, geração de imagens e análise de mídia usam a nuvem UniWork (consome créditos de IA).',
  cloudMediaLabel: 'Nuvem UniWork',
  cloudMediaDesc: 'Usa os créditos de IA UniWork da sua organização; sem chave.',
  cloudSearchAutoHint:
    'Primeiro a nuvem UniWork (consome créditos de IA), depois a pesquisa gratuita.',
} satisfies Record<keyof typeof zh, string>
