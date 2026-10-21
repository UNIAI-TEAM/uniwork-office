import type { zh } from './zh'

export const pt = {
  askUniModeGroup: 'Modo',
  askUniModeChat: 'Assistente',
  askUniModeAsk: 'Perguntar à UNI',
  askUniTitle: 'Perguntar à UNI',
  askUniDescription:
    'A UNI só responde com os dados que você pode ver neste espaço de trabalho, com as fontes.',
  askUniWorkspace: 'Espaço de trabalho',
  askUniEmptyTitle: 'O que você quer saber sobre o trabalho da equipe?',
  askUniEmptyDescription:
    'A UNI lê tarefas, reuniões, conversas de que você participa e membros; as respostas sempre citam as fontes.',
  askUniPlaceholder: 'Pergunte à UNI sobre o seu trabalho…',
  askUniSend: 'Enviar',
  askUniStop: 'Parar',
  askUniStopped: 'Parado. A resposta não será exibida.',
  askUniThinking: 'A UNI está pensando…',
  askUniNewChat: 'Nova conversa',
  askUniYou: 'Você',
  askUniUni: 'UNI',
  askUniSources: 'Fontes',
  askUniKindDocument: 'Documento',
  askUniKindTask: 'Tarefa',
  askUniKindMeeting: 'Reunião',
  askUniKindChat: 'Conversa',
  askUniKindMember: 'Membro',
  askUniOpenDocument: 'Abrir documento',
  askUniKindOther: 'Outro',
  askUniOpenBrowser: 'Abrir no navegador',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} caracteres',
  askUniLoading: 'Carregando…',
  askUniSignedOut:
    'Entre na sua conta UniWork para perguntar à UNI sobre o seu espaço de trabalho.',
  askUniNoWorkspace: 'Sua conta ainda não tem um espaço de trabalho para consultar.',
  askUniNoticeNoSources:
    'Nada que você pode ver neste espaço de trabalho corresponde a esta pergunta ainda.',
  askUniNoticeUnavailable: 'A UNI não conseguiu responder a esta pergunta.',
  askUniErrForbidden: 'Você não tem acesso a estes dados.',
  askUniErrQuota: 'A organização usou toda a cota de tokens de IA deste mês.',
  askUniErrRateLimited: 'Você está perguntando rápido demais; tente novamente em um minuto.',
  askUniErrRateLimitedIn:
    'Você está perguntando rápido demais; tente novamente em {seconds} segundos.',
  askUniErrDisabled: 'A IA não está configurada neste servidor.',
  askUniErrOffline:
    'Você está offline. Perguntar à UNI precisa de conexão para pesquisar documentos.',
  askUniErrSession: 'Sua sessão do UniWork expirou. Entre novamente para continuar perguntando.',
  askUniErrDefault: 'Não foi possível perguntar agora; tente novamente mais tarde.',
} satisfies Record<keyof typeof zh, string>
