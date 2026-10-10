import type { zh } from './zh'

export const pt = {
  aiWebSettingsTitle: 'Configurações de IA',
  aiWebSettingsIntro:
    'O assistente usa a sua própria chave de API do provedor. O UniWork a guarda criptografada; a chave nunca é enviada para esta página.',
  aiWebProvider: 'Provedor',
  aiWebModel: 'Modelo',
  aiWebKeySaved: 'Chave salva {hint}',
  aiWebNoKey: 'Nenhuma chave salva',
  aiWebApiKey: 'Chave de API',
  aiWebApiKeyKeep: 'Nova chave de API (deixe vazio para manter a salva)',
  aiWebBaseUrl: 'URL base',
  aiWebSaveKey: 'Salvar chave',
  aiWebRemoveKey: 'Remover chave',
  aiWebDone: 'Concluído',
  aiWebLoading: 'Carregando…',
  aiWebLoadFailed: 'Não foi possível carregar as configurações de IA. Tente novamente mais tarde.',
  aiWebCloudTitle: 'Ferramentas na nuvem do UniWork AI',
  aiWebCloudOff: 'Não incluído no plano da sua organização',
  aiWebCredits: 'Créditos restantes: {remaining} de {limit}',
  aiWebCreditsUnlimited: 'Créditos: sem limite',
  aiWebCreditsRenew: 'Renova em {date}',
  aiWebOpenSettings: 'Configurações de IA',
  aiWebClose: 'Fechar',
  aiWebStateCreditsTitle: 'Créditos de IA esgotados',
  aiWebStateCreditsBody:
    'Sua organização usou todos os créditos do UniWork AI neste período. Fale com o administrador ou aguarde a renovação.',
  aiWebStateEntitlementTitle: 'A IA não está no seu plano',
  aiWebStateEntitlementBody:
    'O plano UniWork da sua organização não inclui este recurso de IA. Fale com o administrador.',
  aiWebStateKeyMissingTitle: 'Ainda não há chave de IA',
  aiWebStateKeyMissingBody:
    'Adicione uma chave de API nas configurações de IA para usar o assistente.',
  aiWebStateKeyRejectedTitle: 'A chave de IA foi recusada',
  aiWebStateKeyRejectedBody:
    'O provedor recusou a chave salva. Substitua-a nas configurações de IA.',
  aiWebStateRateTitle: 'Muitas solicitações de IA',
  aiWebStateRateBody: 'Aguarde {seconds} s e tente novamente.',
  aiWebStateRateBodyNow: 'Aguarde um momento e tente novamente.',
  aiWebStateUnreachableTitle: 'Provedor de IA inacessível',
  aiWebStateUnreachableBody:
    'O UniWork não conseguiu acessar o provedor de IA. Tente novamente em instantes.',
  aiWebStateCloudTitle: 'Ferramenta na nuvem indisponível',
  aiWebStateCloudBody: 'Esta ferramenta do UniWork AI ainda não está configurada no servidor.',
  aiWebStateSessionTitle: 'Sessão expirada',
  aiWebStateSessionBody: 'Reabra o documento pelo UniWork para continuar.',
  aiWebStateRefusedTitle: 'Solicitação recusada',
  aiWebStateRefusedBody: 'O servidor recusou a solicitação de IA.',
  aiWebStateModelTitle: 'Escolha um modelo',
  aiWebStateModelBody:
    'Escolha um modelo no menu de modelos ao lado da caixa de mensagem e envie novamente.',
  aiWebStateBaseUrlBody: 'Esta URL base não é permitida. Use um endereço https:// público.',
  aiWebStateProviderBody: 'Este provedor não é compatível.',
  aiWebStateUnknownTitle: 'Falha na solicitação de IA',
  aiWebStateUnknownBody: 'Algo deu errado. Tente novamente.',
} satisfies Record<keyof typeof zh, string>
