import type { zh } from './zh'

export const pt = {
  aiWebClose: 'Fechar',
  aiWebStateCreditsTitle: 'Créditos de IA esgotados',
  aiWebStateCreditsBody:
    'Sua organização usou todos os créditos do UniWork AI neste período. Fale com o administrador ou aguarde a renovação.',
  aiWebStateEntitlementTitle: 'A IA não está no seu plano',
  aiWebStateEntitlementBody:
    'O plano UniWork da sua organização não inclui este recurso de IA. Fale com o administrador.',
  aiWebStateRateTitle: 'Muitas solicitações de IA',
  aiWebStateRateBody: 'Aguarde {seconds} s e tente novamente.',
  aiWebStateRateBodyNow: 'Aguarde um momento e tente novamente.',
  aiWebStateUnreachableTitle: 'Provedor de IA inacessível',
  aiWebStateUnreachableBody:
    'O UniWork não conseguiu acessar o provedor de IA. Tente novamente em instantes.',
  aiWebStateCloudTitle: 'Ferramenta na nuvem indisponível',
  aiWebStateCloudBody: 'Esta ferramenta do UniWork AI ainda não está configurada no servidor.',
  aiWebStateOutageTitle: 'UniWork temporariamente indisponível',
  aiWebStateOutageBody: 'Não foi possível acessar o UniWork agora. Tente novamente em instantes.',
  aiWebStateSessionTitle: 'Sessão expirada',
  aiWebStateSessionBody: 'Reabra o documento pelo UniWork para continuar.',
  aiWebStateRefusedTitle: 'Solicitação recusada',
  aiWebStateRefusedBody: 'O servidor recusou a solicitação de IA.',
  aiWebStateUnknownTitle: 'Falha na solicitação de IA',
  aiWebStateUnknownBody: 'Algo deu errado. Tente novamente.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Esta pasta de trabalho é grande demais para a IA na web. Abra-a no app UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Continue com a próxima parte.',
} satisfies Record<keyof typeof zh, string>
