import type { zh } from './zh'

export const pt = {
  cloudTitle: 'IA na nuvem UniWork',
  cloudStateReady: 'Disponível',
  cloudStateNotEntitled: 'Não incluído no seu plano',
  cloudStateExhausted: 'Créditos de IA esgotados',
  cloudStateUnavailable: 'Indisponível',
  cloudStateSignedOut: 'Sessão não iniciada',
  cloudStateInactive: 'Assinatura inativa',
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
  cloudInactiveBody:
    'A assinatura UniWork da sua organização não está ativa, por isso a IA na nuvem está pausada. Peça a um administrador para renová-la; seus próprios provedores abaixo continuam funcionando.',
  cloudToolsOffBody:
    'As ferramentas na nuvem do UniWork estão desativadas. Ative “{switch}” em {section} para usar os créditos de IA da sua organização; seus próprios provedores abaixo não são afetados.',
  cloudReadyBody:
    'Sem um provedor próprio, pesquisa, geração de imagens e análise de mídia usam os créditos de IA UniWork da sua organização.',
  cloudToolsToggle: 'Usar ferramentas na nuvem UniWork',
  cloudToolsToggleDesc:
    'Sem um provedor próprio, pesquisa na web, geração de imagens e análise de mídia usam a nuvem UniWork (consome créditos de IA).',
  cloudMediaLabel: 'Nuvem UniWork',
  cloudMediaDesc: 'Usa os créditos de IA UniWork da sua organização; sem chave.',
  cloudSearchAutoHint:
    'Primeiro a nuvem UniWork (consome créditos de IA), depois a pesquisa gratuita.',
  aiTestErrInvalidKey: 'Chave de API ausente ou recusada',
  aiTestErrNetwork: 'Não foi possível conectar. Verifique sua rede',
  aiTestErrLimit: 'Limite do provedor atingido. Tente mais tarde',
  aiTestErrUnavailable: 'O serviço não responde. Tente mais tarde',
} satisfies Record<keyof typeof zh, string>
