import type { zh } from './zh'

export const nl = {
  setRestoreSession: 'Documenten van de vorige keer opnieuw openen',
  setRestoreSessionDesc:
    'Documenten die open waren toen UniWork Office werd gesloten, worden bij de volgende start automatisch opnieuw geopend.',
  setAutoUpdateCheck: 'Automatisch controleren op updates',
  setAutoUpdateCheckDesc:
    'Uitgeschakeld controleert UniWork Office niet meer op nieuwe versies bij het starten of op de achtergrond. Je kunt nog steeds controleren via Help › Controleren op updates.',
} satisfies Record<keyof typeof zh, string>
