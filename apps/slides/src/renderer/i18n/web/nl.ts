import type { zh } from './zh'

export const nl = {
  webConflictTitle: 'Deze presentatie is elders gewijzigd',
  webConflictBody:
    'Iemand heeft een nieuwere versie opgeslagen. Overschrijven vervangt die door uw wijzigingen; Nieuwste laden verwijdert uw wijzigingen en opent de nieuwste versie.',
  webConflictOverwrite: 'Overschrijven',
  webConflictReload: 'Nieuwste laden',
  webConflictNotSaved: 'de presentatie is elders gewijzigd',
  webDiscardTitle: 'Niet-opgeslagen wijzigingen verwijderen?',
  webDiscardBody:
    'Deze presentatie heeft niet-opgeslagen wijzigingen. Als u een ander bestand opent, gaan ze verloren.',
  webDiscard: 'Verwijderen en openen',
  webCancel: 'Annuleren',
  webOk: 'OK',
  webFatalTitle: 'De presentatie kan niet worden geopend',
  webFatalBody:
    'Het bestand kan niet uit UniWork worden geladen. Sluit dit tabblad en probeer het opnieuw.',
  webNoHost: 'Deze editor draait binnen UniWork. Open de presentatie vanuit UniWork.',
  webLegacyPpt:
    'Dit is een ouder .ppt-bestand dat niet in de browser kan worden geopend. Sla het eerst op als .pptx in PowerPoint.',
  webEncryptedPptx:
    'Deze presentatie is met een wachtwoord beveiligd en kan niet in de browser worden geopend.',
  webCommentAuthor: 'Gebruiker',
  webExternalMedia: 'Gekoppelde externe media worden alleen in de desktop-app afgespeeld.',
  webReadOnly: 'Deze presentatie is alleen-lezen.',
  webSaveNetwork: 'UniWork is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.',
  webSaveTimeout: 'Opslaan duurde te lang. Controleer je verbinding en probeer het opnieuw.',
} satisfies Record<keyof typeof zh, string>
