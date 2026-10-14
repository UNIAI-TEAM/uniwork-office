import type { zh } from './zh'

export const pt = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Restam {remaining} / {limit}',
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
  aiErrGeneric:
    'O UniWork AI encontrou um problema inesperado, então esta execução foi interrompida. Seu documento e Salvar continuam funcionando.',
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
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Sua solicitação é longa demais para o UniWork AI. Reduza para menos de 8.000 caracteres e envie novamente.',
  aiErrQuestionRejected:
    'O UniWork AI não pôde aceitar esta solicitação. Altere-a e envie novamente.',
  aiUniworkImagesNotSent: 'Imagens não são enviadas ao UniWork AI; apenas o seu texto foi enviado.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
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
  cloudInactiveBody:
    'A assinatura UniWork da sua organização não está ativa, por isso a IA na nuvem está pausada. Peça a um administrador para renová-la; seus próprios provedores abaixo continuam funcionando.',
  acctSignIn: 'Entrar',
  acctSignInAgain: 'Entrar novamente',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Arquivos locais iniciam uma nova conversa na sua organização e não mantêm os turnos de outros arquivos.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta:
    'Células gravadas: {written} ({range}) · Células existentes substituídas: {overwritten}',
  aiErrWorkbookTooLarge:
    'Esta pasta de trabalho é grande demais para a IA na web. Abra-a no app UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'O plano da sua organização não inclui o UniWork AI. Fale com um administrador da organização sobre o plano ou adicione sua própria chave de IA em Configurações > Modelo de IA.',
  credits_exhausted:
    'Sua organização usou todos os créditos de IA deste período. Peça a um administrador da organização para adicionar créditos ou adicione sua própria chave de IA em Configurações > Modelo de IA.',
} satisfies Record<keyof typeof zh, string>
