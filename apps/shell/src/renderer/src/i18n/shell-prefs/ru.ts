import type { zh } from './zh'

export const ru = {
  setRestoreSession: 'Открывать документы прошлого сеанса',
  setRestoreSessionDesc:
    'Документы, открытые при закрытии UniWork Office, автоматически откроются при следующем запуске.',
  setAutoUpdateCheck: 'Автоматически проверять обновления',
  setAutoUpdateCheckDesc:
    'Если выключено, UniWork Office не проверяет новые версии при запуске и в фоне. Проверить вручную можно через Справка › Проверить обновления.',
} satisfies Record<keyof typeof zh, string>
