import type { zh } from './zh'

export const es = {
  cloudTitle: 'IA en la nube de UniWork',
  cloudStateReady: 'Disponible',
  cloudStateNotEntitled: 'No incluido en tu plan',
  cloudStateExhausted: 'Sin créditos de IA',
  cloudStateUnavailable: 'No disponible',
  cloudStateSignedOut: 'Sin iniciar sesión',
  cloudStateInactive: 'Suscripción inactiva',
  cloudCredits: 'Créditos de IA',
  cloudCreditsLeft: 'Quedan {remaining} / {limit}',
  cloudCreditsUnlimited: 'Ilimitado',
  cloudCreditsRenews: 'Se renueva el {date}',
  cloudSignedOutBody:
    'Inicia sesión en UniWork para usar búsqueda web, generación de imágenes y análisis de medios pagados con los créditos de IA de tu organización.',
  cloudNotEntitledBody:
    'El plan de tu organización no incluye la IA en la nube de UniWork. Puedes seguir usando tus propios proveedores abajo.',
  cloudExhaustedBody:
    'Tu organización usó todos sus créditos de IA de UniWork en este periodo. Las herramientas en la nube se pausan hasta que se renueven; tus propios proveedores siguen funcionando.',
  cloudUnavailableBody:
    'La IA en la nube de UniWork no está disponible ahora. Tus propios proveedores siguen funcionando.',
  cloudInactiveBody:
    'La suscripción de UniWork de su organización no está activa, por lo que la IA en la nube está en pausa. Pida a un administrador que la renueve; sus propios proveedores de abajo siguen funcionando.',
  cloudToolsOffBody:
    'Las herramientas en la nube de UniWork están desactivadas. Active «{switch}» en {section} para usar los créditos de IA de su organización; sus propios proveedores de abajo no se ven afectados.',
  cloudReadyBody:
    'Sin un proveedor propio, la búsqueda, la generación de imágenes y el análisis de medios usan los créditos de IA de UniWork de tu organización.',
  cloudToolsToggle: 'Usar herramientas en la nube de UniWork',
  cloudToolsToggleDesc:
    'Sin un proveedor propio, la búsqueda web, la generación de imágenes y el análisis de medios usan la nube de UniWork (consume créditos de IA).',
  cloudMediaLabel: 'Nube de UniWork',
  cloudMediaDesc: 'Usa los créditos de IA de UniWork de tu organización; no necesita clave.',
  cloudSearchAutoHint:
    'Primero la nube de UniWork (consume créditos de IA) y luego la búsqueda gratuita.',
  aiTestErrInvalidKey: 'Falta la clave API o fue rechazada',
  aiTestErrNetwork: 'No se puede conectar. Revisa tu conexión',
  aiTestErrLimit: 'Se alcanzó el límite del proveedor. Inténtalo más tarde',
  aiTestErrUnavailable: 'El servicio no responde. Inténtalo más tarde',
} satisfies Record<keyof typeof zh, string>
