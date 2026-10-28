import type { zh } from './zh'

export const it = {
  setRestoreSession: "Riapri i documenti dell'ultima volta",
  setRestoreSessionDesc:
    'I documenti aperti alla chiusura di UniWork Office si riaprono automaticamente al successivo avvio.',
  setAutoUpdateCheck: 'Controlla automaticamente gli aggiornamenti',
  setAutoUpdateCheckDesc:
    "Se disattivato, UniWork Office non cerca più nuove versioni all'avvio o in background. Puoi comunque controllare da Aiuto › Controlla aggiornamenti.",
} satisfies Record<keyof typeof zh, string>
