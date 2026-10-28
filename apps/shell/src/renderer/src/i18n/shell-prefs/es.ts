import type { zh } from './zh'

export const es = {
  setRestoreSession: 'Volver a abrir los documentos de la última vez',
  setRestoreSessionDesc:
    'Los documentos abiertos al cerrar UniWork Office se vuelven a abrir automáticamente la próxima vez que se inicie.',
  setAutoUpdateCheck: 'Buscar actualizaciones automáticamente',
  setAutoUpdateCheckDesc:
    'Si está desactivado, UniWork Office deja de buscar nuevas versiones al iniciar y en segundo plano. Puede seguir comprobándolo en Ayuda › Buscar actualizaciones.',
} satisfies Record<keyof typeof zh, string>
