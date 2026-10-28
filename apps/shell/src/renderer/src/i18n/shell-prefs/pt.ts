import type { zh } from './zh'

export const pt = {
  setRestoreSession: 'Reabrir os documentos da última vez',
  setRestoreSessionDesc:
    'Os documentos abertos ao fechar o UniWork Office são reabertos automaticamente na próxima vez que ele for iniciado.',
  setAutoUpdateCheck: 'Verificar atualizações automaticamente',
  setAutoUpdateCheckDesc:
    'Desligado, o UniWork Office deixa de procurar novas versões ao iniciar e em segundo plano. Você ainda pode verificar em Ajuda › Procurar atualizações.',
} satisfies Record<keyof typeof zh, string>
