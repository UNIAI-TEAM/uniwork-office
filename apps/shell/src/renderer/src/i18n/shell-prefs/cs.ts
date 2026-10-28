import type { zh } from './zh'

export const cs = {
  setRestoreSession: 'Znovu otevřít dokumenty z minula',
  setRestoreSessionDesc:
    'Dokumenty otevřené při zavření UniWork Office se při příštím spuštění automaticky znovu otevřou.',
  setAutoUpdateCheck: 'Automaticky kontrolovat aktualizace',
  setAutoUpdateCheckDesc:
    'Po vypnutí UniWork Office nekontroluje nové verze při spuštění ani na pozadí. Ručně můžete zkontrolovat v Nápověda › Zkontrolovat aktualizace.',
} satisfies Record<keyof typeof zh, string>
