import type { zh } from './zh'

export const nl = {
  webCancel: 'Annuleren',
  webConflictTitle: 'Dit document is elders gewijzigd',
  webConflictBody:
    'Tijdens het bewerken is een nieuwere versie opgeslagen. Wilt u die overschrijven met uw versie, of de nieuwste versie opnieuw laden en uw wijzigingen negeren?',
  webConflictOverwrite: 'Overschrijven',
  webConflictReload: 'Nieuwste versie laden',
  webConflictNotSaved: 'het document is elders gewijzigd',
  webFatalTitle: 'Het document kan niet worden geopend',
  webFatalBody:
    'Bewerken en opslaan zijn uitgeschakeld. Laad de pagina opnieuw of open het document opnieuw vanuit UniWork.',
  webNoHost: 'Deze editor werkt binnen UniWork. Open het document vanuit UniWork.',
  webViewOnly: 'Alleen-lezen',
  webViewOnlyNotSaved: 'Dit document is alleen-lezen en kan niet worden opgeslagen',
  webNotUtf8:
    'Dit bestand is geen UTF-8-tekst. Het opent alleen-lezen zodat opslaan de bytes niet wijzigt',
  webDraftTitle: 'Niet-opgeslagen wijzigingen herstellen?',
  webDraftBody:
    'Deze browser heeft een kopie bewaard van niet-opgeslagen wijzigingen in dit document. Herstellen of verwijderen?',
  webDraftOlder:
    'De kopie is gebaseerd op een oudere versie van het document. Opslaan vervangt de nieuwere versie.',
  webDraftSavedAt: 'Kopie bewaard om',
  webDraftKept: 'Deze browser bewaart de kopie totdat je uitlogt.',
  webDraftRestore: 'Herstellen',
  webDraftDiscard: 'Verwijderen',
} satisfies Record<keyof typeof zh, string>
