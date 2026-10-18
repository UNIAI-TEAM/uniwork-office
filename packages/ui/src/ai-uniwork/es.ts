import type { zh } from './zh'

export const es = {
  // S7 provider row, picker footer and composer notes
  aiUniworkProvider: 'UniWork AI',
  aiUniworkCreditsAria: 'Créditos restantes: {remaining} de {limit}',
  aiUniworkFooterSignIn: 'Inicia sesión en UniWork para usar UniWork AI',
  aiUniworkSignedOut:
    'Has cerrado sesión en UniWork. Elige otro proveedor o vuelve a iniciar sesión.',
  aiUniworkOff: 'UniWork AI está desactivado para este documento. Elige otro proveedor.',
  aiUniworkViewOnly:
    'Solo lectura: la IA puede responder, pero no puede editar ni guardar el documento.',

  // S8 disclosure
  aiUniworkDisclosure:
    'UniWork AI lee lo que está abierto en este documento, incluidos los cambios sin guardar, y lo envía a UniWork y al proveedor del modelo para responder. Cada ejecución usa créditos de IA de {org}. La IA nunca guarda por ti: revisa y luego pulsa Guardar.',
  aiUniworkDisclosureLabel: 'Qué recibe UniWork AI',
  aiUniworkDisclosureShort:
    'Envía el contenido abierto (incluido lo no guardado) a UniWork · créditos de {org}',
  aiUniworkLocalFile:
    'Este archivo está en tu equipo, no en UniWork. Con UniWork AI, el contenido del archivo abierto se envía a UniWork y usa créditos de IA de {org}. El archivo no se sube como documento de UniWork.',
  aiUniworkAck: 'Entendido',
  aiUniworkLearnMore: 'Más información',
  aiUniworkDetails: 'Detalles',
  aiUniworkSendNeedsAck: 'Lee y confirma el aviso antes de enviar.',

  // S9 result chips and run controls
  aiResultAnswer: 'Respuesta',
  aiResultClarify: 'Necesita aclaración',
  aiResultEdited: 'Editado en el documento',
  aiResultUnsupported: 'No compatible',
  aiResultError: 'Error',
  aiResultEditedHint: 'Sin guardar: deshaz con Ctrl/⌘+Z o pulsa Guardar si está bien.',
  aiResultViewChanges: 'Ver cambios',
  aiRunStop: 'Detener',
  aiRunSend: 'Enviar',
  aiRunRunning: 'En ejecución… Pulsa Detener o Esc para detener.',
  aiRunStopped: 'Detenido. Los cambios ya aplicados siguen en el documento y se pueden deshacer.',
  aiRunRetry: 'Reintentar',
  aiRunAskAgain: 'Volver a preguntar',
  aiRunChooseOther: 'Elegir otro proveedor',
  aiRunOpenInApp: 'Abrir en la aplicación',
  aiConversationRestarted:
    'La conversación anterior caducó, así que UniWork AI empezó una nueva y ya no recuerda los turnos anteriores. Vuelve a enviar tu pregunta para continuar.',
  aiConversationBoundary: 'Nueva conversación con {provider}: los turnos de arriba no se envían.',

  // S10 run errors (the panel shows one at a time; the document and Save keep working)
  aiErrRunLimit:
    'Esta ejecución alcanzó el límite de pasos de UniWork AI. Los resultados obtenidos se conservan; divide la solicitud y vuelve a preguntar.',
  aiErrCredits:
    'Tu organización se quedó sin créditos de IA para este periodo. Esta ejecución se detuvo.',
  aiErrEntitlement: 'El plan de tu organización ya no incluye UniWork AI.',
  aiErrRateLimited: 'Estás enviando demasiado rápido. Inténtalo de nuevo en {seconds} s.',
  aiErrRateLimitedNoWait: 'Estás enviando demasiado rápido. Inténtalo de nuevo en unos minutos.',
  aiErrUnavailable:
    'UniWork AI no responde en este momento. Tu documento y Guardar siguen funcionando.',
  aiErrGeneric:
    'UniWork AI tuvo un problema inesperado, así que esta ejecución se detuvo. Tu documento y Guardar siguen funcionando.',
  aiErrDisconnected:
    'Se perdió la conexión, así que esta ejecución se detuvo. Los cambios ya aplicados siguen en el documento y se pueden deshacer.',
  aiErrOffline:
    'Estás sin conexión. UniWork AI no funciona sin conexión y las solicitudes no se ponen en cola.',
  aiErrSession:
    'Tu sesión de UniWork caducó, así que esta ejecución se detuvo. Vuelve a iniciar sesión para continuar.',
  aiErrRevoked: 'Ya no tienes acceso a este documento, así que la ejecución de IA se detuvo.',
  aiErrDowngraded:
    'Tu acceso acaba de cambiar a solo lectura, así que la IA dejó de editar. Las respuestas continúan.',
  aiErrCapabilityOff:
    'UniWork AI se acaba de desactivar para este documento, así que la ejecución se detuvo tras el paso actual.',
  aiErrUnsupported: 'UniWork AI todavía no puede hacer esto en {module}.',
  aiErrViewOnlyEdit:
    'Solo tienes acceso de lectura a este documento, así que la IA no puede editarlo.',
  // UniWork AI question limits (the façade takes text up to 8,000 characters)
  aiErrQuestionTooLong:
    'Tu solicitud es demasiado larga para UniWork AI. Acórtala a menos de 8.000 caracteres y envíala de nuevo.',
  aiErrQuestionRejected: 'UniWork AI no pudo aceptar esta solicitud. Cámbiala y vuelve a enviarla.',
  aiUniworkImagesNotSent: 'Las imágenes no se envían a UniWork AI; solo se envió tu texto.',
  // Cloud state, credits and account actions (shared with picker footer and composer note)
  cloudStateNotEntitled: 'No incluido en tu plan',
  cloudStateExhausted: 'Sin créditos de IA',
  cloudStateUnavailable: 'No disponible',
  cloudStateInactive: 'Suscripción inactiva',
  cloudCreditsLeft: 'Quedan {remaining} / {limit}',
  cloudCreditsUnlimited: 'Ilimitado',
  cloudInactiveBody:
    'La suscripción de UniWork de su organización no está activa, por lo que la IA en la nube está en pausa. Pida a un administrador que la renueve; sus propios proveedores de abajo siguen funcionando.',
  acctSignIn: 'Iniciar sesión',
  acctSignInAgain: 'Volver a iniciar sesión',
  // S8/S10 local-file conversation restart notice (G05BE-6)
  aiUniworkLocalFileRestart:
    'Los archivos locales inician una conversación nueva en tu organización y no conservan los turnos de otros archivos.',
  // S9 cells summary and S10 web workbook size limit
  aiResultCellsMeta:
    'Celdas escritas: {written} ({range}) · Celdas existentes sobrescritas: {overwritten}',
  aiResultCellsMetaNoOverwrite: 'Celdas escritas: {written} ({range})',
  aiErrWorkbookTooLarge:
    'Este libro es demasiado grande para la IA en la web. Ábrelo en la aplicación UniWork Office.',
  // S7 composer notice keys (not_entitled, credits_exhausted)
  not_entitled:
    'El plan de tu organización no incluye UniWork AI. Consulta el plan con un administrador de la organización o añade tu propia clave de IA en Configuración > Modelo de IA.',
  credits_exhausted:
    'Tu organización ha agotado todos sus créditos de IA para este período. Pide a un administrador de la organización que añada créditos o añade tu propia clave de IA en Configuración > Modelo de IA.',
} satisfies Record<keyof typeof zh, string>
