import type { zh } from './zh'

export const pl = {
  setRestoreSession: 'Otwieraj ponownie dokumenty z ostatniej sesji',
  setRestoreSessionDesc:
    'Dokumenty otwarte w chwili zamknięcia UniWork Office zostaną automatycznie otwarte przy następnym uruchomieniu.',
  setAutoUpdateCheck: 'Automatycznie sprawdzaj aktualizacje',
  setAutoUpdateCheckDesc:
    'Po wyłączeniu UniWork Office nie sprawdza nowych wersji przy uruchomieniu ani w tle. Nadal możesz sprawdzić ręcznie w Pomoc › Sprawdź aktualizacje.',
} satisfies Record<keyof typeof zh, string>
