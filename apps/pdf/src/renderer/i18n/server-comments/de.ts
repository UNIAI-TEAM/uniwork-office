import type { zh } from './zh'

export const de = {
  serverCommentStartUnavailable:
    'Zu diesem Dokument kann gerade kein neuer Kommentar hinzugefügt werden.',
  serverCommentSaveFirst: 'Speichern Sie zuerst das Dokument, um einen Kommentar hinzuzufügen',
} satisfies Record<keyof typeof zh, string>
