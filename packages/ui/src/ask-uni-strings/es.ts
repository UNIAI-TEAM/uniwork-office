import type { zh } from './zh'

export const es = {
  // copy shared with the Home Ask UNI pane
  askUniThinking: 'UNI está pensando…',
  askUniYou: 'Tú',
  askUniUni: 'UNI',
  askUniSources: 'Fuentes',
  askUniKindDocument: 'Documento',
  askUniKindTask: 'Tarea',
  askUniKindMeeting: 'Reunión',
  askUniKindChat: 'Conversación',
  askUniKindMember: 'Miembro',
  askUniKindOther: 'Otro',
  askUniOpenDocument: 'Abrir documento',
  askUniOpenBrowser: 'Abrir en el navegador',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniOpenFailed: 'No se pudo abrir esta fuente. Inténtalo de nuevo o ábrela en la web.',
  askUniErrForbidden: 'No tienes acceso a estos datos.',
  askUniErrQuota: 'La organización ha agotado su cuota de tokens de IA de este mes.',
  askUniErrRateLimited: 'Estás preguntando demasiado rápido; inténtalo de nuevo en un minuto.',
  askUniErrRateLimitedIn:
    'Estás preguntando demasiado rápido; inténtalo de nuevo en {seconds} segundos.',
  askUniErrDisabled: 'La IA no está configurada en este servidor.',
  askUniErrOffline: 'Estás sin conexión. Preguntar a UNI necesita conexión para buscar documentos.',
  askUniErrSession:
    'Tu sesión de UniWork ha caducado. Inicia sesión de nuevo para seguir preguntando.',
  askUniErrDefault: 'No se puede preguntar ahora; inténtalo más tarde.',
  askUniSignedOut:
    'Inicia sesión en tu cuenta de UniWork para preguntar a UNI sobre tu espacio de trabajo.',
  askUniNoticeNoSources:
    'Nada de lo que puedes ver en este espacio de trabajo coincide todavía con esta pregunta.',
  askUniNoticeUnavailable: 'UNI no pudo responder a esta pregunta.',
  askUniStop: 'Detener',
  askUniSend: 'Enviar',
  askUniCounter: '{used}/{max} caracteres',
  askUniPlaceholder: 'Pregunta a UNI sobre tu trabajo…',
} satisfies Record<keyof typeof zh, string>
