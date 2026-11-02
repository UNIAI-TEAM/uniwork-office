import type { zh } from './zh'

export const es = {
  cloudTitle: 'IA en la nube de UniWork',
  cloudStateReady: 'Disponible',
  cloudStateNotEntitled: 'No incluido en tu plan',
  cloudStateExhausted: 'Sin créditos de IA',
  cloudStateUnavailable: 'No disponible',
  cloudStateInactive: 'Suscripción inactiva',
  cloudCredits: 'Créditos de IA',
  cloudCreditsLeft: 'Quedan {remaining} / {limit}',
  cloudCreditsUnlimited: 'Ilimitado',
  cloudCreditsRenews: 'Se renueva el {date}',
  cloudToolsToggle: 'Usar herramientas en la nube de UniWork',
  cloudToolsToggleDesc:
    'Sin un proveedor propio, la búsqueda web, la generación de imágenes y el análisis de medios usan la nube de UniWork (consume créditos de IA).',
} satisfies Record<keyof typeof zh, string>
