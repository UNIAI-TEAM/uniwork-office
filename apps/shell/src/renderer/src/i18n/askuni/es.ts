import type { zh } from './zh'

export const es = {
  askUniModeGroup: 'Modo',
  askUniModeChat: 'Asistente',
  askUniModeAsk: 'Preguntar a UNI',
  askUniTitle: 'Preguntar a UNI',
  askUniDescription:
    'UNI solo responde con los datos que puedes ver en este espacio de trabajo, con sus fuentes.',
  askUniWorkspace: 'Espacio de trabajo',
  askUniEmptyTitle: '¿Qué quieres saber sobre el trabajo del equipo?',
  askUniEmptyDescription:
    'UNI lee tareas, reuniones, chats en los que participas y miembros; sus respuestas siempre citan las fuentes.',
  askUniPlaceholder: 'Pregunta a UNI sobre tu trabajo…',
  askUniSend: 'Enviar',
  askUniStop: 'Detener',
  askUniStopped: 'Detenido. La respuesta no se mostrará.',
  askUniThinking: 'UNI está pensando…',
  askUniNewChat: 'Chat nuevo',
  askUniYou: 'Tú',
  askUniUni: 'UNI',
  askUniSources: 'Fuentes',
  askUniKindDocument: 'Documento',
  askUniKindTask: 'Tarea',
  askUniKindMeeting: 'Reunión',
  askUniKindChat: 'Conversación',
  askUniKindMember: 'Miembro',
  askUniOpenDocument: 'Abrir documento',
  askUniKindOther: 'Otro',
  askUniOpenBrowser: 'Abrir en el navegador',
  askUniCitationLabel: '{kind}: {title} — {action}',
  askUniCounter: '{used}/{max} caracteres',
  askUniLoading: 'Cargando…',
  askUniSignedOut:
    'Inicia sesión en tu cuenta de UniWork para preguntar a UNI sobre tu espacio de trabajo.',
  askUniNoWorkspace: 'Tu cuenta aún no tiene un espacio de trabajo para consultar.',
  askUniNoticeNoSources:
    'Nada de lo que puedes ver en este espacio de trabajo coincide todavía con esta pregunta.',
  askUniNoticeUnavailable: 'UNI no pudo responder a esta pregunta.',
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
} satisfies Record<keyof typeof zh, string>
