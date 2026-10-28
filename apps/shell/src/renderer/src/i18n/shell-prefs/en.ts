import type { zh } from './zh'

export const en = {
  setRestoreSession: 'Reopen documents from last time',
  setRestoreSessionDesc:
    'Documents open when UniWork Office closes reopen automatically the next time it starts.',
  setAutoUpdateCheck: 'Check for updates automatically',
  setAutoUpdateCheckDesc:
    'When off, UniWork Office no longer checks for new versions at launch or in the background. You can still check from Help › Check for Updates.',
} satisfies Record<keyof typeof zh, string>
