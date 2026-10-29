import type { zh } from './zh'

export const es = {
  aiWebClose: 'Cerrar',
  aiWebStateCreditsTitle: 'Créditos de IA agotados',
  aiWebStateCreditsBody:
    'Tu organización ha usado todos los créditos de UniWork AI de este periodo. Consulta a tu administrador o espera a la renovación.',
  aiWebStateEntitlementTitle: 'La IA no está en tu plan',
  aiWebStateEntitlementBody:
    'El plan de UniWork de tu organización no incluye esta función de IA. Consulta a tu administrador.',
  aiWebStateRateTitle: 'Demasiadas solicitudes de IA',
  aiWebStateRateBody: 'Espera {seconds} s y vuelve a intentarlo.',
  aiWebStateRateBodyNow: 'Espera un momento y vuelve a intentarlo.',
  aiWebStateUnreachableTitle: 'No se puede contactar con el proveedor de IA',
  aiWebStateUnreachableBody:
    'UniWork no pudo contactar con el proveedor de IA. Inténtalo de nuevo en un momento.',
  aiWebStateCloudTitle: 'Herramienta en la nube no disponible',
  aiWebStateCloudBody: 'Esta herramienta de UniWork AI aún no está configurada en el servidor.',
  aiWebStateOutageTitle: 'UniWork no disponible temporalmente',
  aiWebStateOutageBody:
    'No se puede acceder a UniWork en este momento. Inténtalo de nuevo en un momento.',
  aiWebStateSessionTitle: 'Sesión caducada',
  aiWebStateSessionBody: 'Vuelve a abrir el documento desde UniWork para continuar.',
  aiWebStateRefusedTitle: 'Solicitud rechazada',
  aiWebStateRefusedBody: 'El servidor rechazó la solicitud de IA.',
  aiWebStateUnknownTitle: 'Error en la solicitud de IA',
  aiWebStateUnknownBody: 'Algo salió mal. Inténtalo de nuevo.',

  // U-02 catalogue S10: workbook over the web AI size limit
  aiErrWorkbookTooLarge:
    'Este libro es demasiado grande para la IA en la web. Ábrelo en la aplicación UniWork Office.',

  // UNI-2264: the next turn of a job handed over from UniWork (ai.start)
  aiHandoffContinue: 'Continúa con la siguiente parte.',
} satisfies Record<keyof typeof zh, string>
