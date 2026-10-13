import type { zh } from './zh'

export const pt = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Créditos restantes: {remaining} de {limit}',
  aiUniworkFooterSignIn: 'Entre no UniWork para usar o UniWork AI',
  aiUniworkSignedOut: 'Você saiu do UniWork. Escolha outro provedor ou entre novamente.',
  aiUniworkOff: 'O UniWork AI está desativado para este documento. Escolha outro provedor.',
  aiUniworkViewOnly:
    'Somente visualização: a IA pode responder, mas não pode editar nem salvar o documento.',

  // S8 disclosure
  aiUniworkDisclosure:
    'O UniWork AI lê o que está aberto neste documento, incluindo alterações não salvas, e envia ao UniWork e ao provedor do modelo para responder. Cada execução usa créditos de IA de {org}. A IA nunca salva por você: revise e depois pressione Salvar.',
  aiUniworkDisclosureLabel: 'O que o UniWork AI recebe',
  aiUniworkDisclosureShort:
    'Envia o conteúdo aberto (incluindo não salvo) ao UniWork · créditos de {org}',
  aiUniworkLocalFile:
    'Este arquivo está no seu computador, não no UniWork. Com o UniWork AI, o conteúdo do arquivo aberto é enviado ao UniWork e usa créditos de IA de {org}. O arquivo não é enviado como documento do UniWork.',
  aiUniworkAck: 'Entendi',
  aiUniworkLearnMore: 'Saiba mais',
  aiUniworkDetails: 'Detalhes',
  aiUniworkSendNeedsAck: 'Leia e confirme o aviso antes de enviar.',

  // S9 result chips and run controls
  aiResultAnswer: 'Resposta',
  aiResultClarify: 'Precisa de esclarecimento',
  aiResultEdited: 'Editado no documento',
  aiResultUnsupported: 'Não compatível',
  aiResultError: 'Erro',
  aiResultEditedHint: 'Não salvo — desfaça com Ctrl/⌘+Z ou pressione Salvar quando estiver certo.',
  aiResultViewChanges: 'Ver alterações',
  aiRunStop: 'Parar',
  aiRunSend: 'Enviar',
  aiRunRunning: 'Em execução… Pressione Parar ou Esc para parar.',
  aiRunStopped: 'Parado. As alterações já aplicadas continuam no documento e podem ser desfeitas.',
  aiRunAskAgain: 'Perguntar novamente',
  aiRunChooseOther: 'Escolher outro provedor',
  aiRunOpenInApp: 'Abrir no app',
  aiConversationRestarted:
    'A conversa anterior expirou, então o UniWork AI começou uma nova e não lembra mais as mensagens anteriores. Envie sua pergunta novamente para continuar.',
  aiConversationBoundary: 'Nova conversa com {provider}: as mensagens acima não são enviadas.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Esta execução atingiu o limite de etapas do UniWork AI. Os resultados até agora foram mantidos; divida a solicitação e pergunte novamente.',
  aiErrCredits: 'Sua organização ficou sem créditos de IA neste período. Esta execução parou.',
  aiErrEntitlement: 'O plano da sua organização não inclui mais o UniWork AI.',
  aiErrRateLimited: 'Você está enviando rápido demais. Tente novamente em {seconds} s.',
  aiErrRateLimitedNoWait: 'Você está enviando rápido demais. Tente novamente em alguns minutos.',
  aiErrUnavailable:
    'O UniWork AI não está respondendo agora. Seu documento e Salvar continuam funcionando.',
  aiErrDisconnected:
    'A conexão caiu, então esta execução parou. As alterações já aplicadas continuam no documento e podem ser desfeitas.',
  aiErrOffline:
    'Você está offline. O UniWork AI não funciona offline e as solicitações não entram na fila.',
  aiErrSession:
    'Sua sessão do UniWork expirou, então esta execução parou. Entre novamente para continuar.',
  aiErrRevoked: 'Você não tem mais acesso a este documento, então a execução da IA parou.',
  aiErrDowngraded:
    'Seu acesso acabou de mudar para somente visualização, então a IA parou de editar. As respostas continuam.',
  aiErrCapabilityOff:
    'O UniWork AI acabou de ser desativado para este documento, então a execução parou após a etapa atual.',
  aiErrUnsupported: 'O UniWork AI ainda não consegue fazer isso em {module}.',
  aiErrViewOnlyEdit:
    'Você só tem acesso de visualização a este documento, então a IA não pode editá-lo.',
} satisfies Record<keyof typeof zh, string>
