import type { zh } from './zh'

export const pt = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'A UNI está pensando…',
  askUniYou: 'Você',
  askUniUni: 'UNI',
  askUniSources: 'Fontes',
  askUniKindDocument: 'Documento',
  askUniKindTask: 'Tarefa',
  askUniKindMeeting: 'Reunião',
  askUniKindChat: 'Conversa',
  askUniKindMember: 'Membro',
  askUniKindOther: 'Outro',
  askUniOpenDocument: 'Abrir documento',
  askUniOpenBrowser: 'Abrir no navegador',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'Não foi possível abrir esta fonte. Tente novamente ou abra-a na web.',
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
  askUniSignedOut:
    'Entre na sua conta UniWork para perguntar à UNI sobre o seu espaço de trabalho.',
  askUniNoticeNoSources:
    'Nada que você pode ver neste espaço de trabalho corresponde a esta pergunta ainda.',
  askUniNoticeUnavailable: 'A UNI não conseguiu responder a esta pergunta.',
  askUniStop: 'Parar',
  askUniSend: 'Enviar',
  askUniCounter: '{used}/{max} caracteres',
  askUniPlaceholder: 'Pergunte à UNI sobre o seu trabalho…',
} satisfies Record<keyof typeof zh, string>
