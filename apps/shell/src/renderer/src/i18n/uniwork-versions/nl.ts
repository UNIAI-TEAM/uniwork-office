import type { zh } from './zh'

export const nl = {
  vhsMenuEntry: 'Versiegeschiedenis',
  vhsTitle: 'Versiegeschiedenis',
  vhsDescription:
    'De versies die op de server worden bewaard. Herstellen schrijft een nieuwe versie; de geschiedenis wordt nooit gewist.',
  vhsLoading: 'Geschiedenis laden…',
  vhsError: 'De versiegeschiedenis kon niet worden geladen.',
  vhsRetry: 'Opnieuw proberen',
  vhsEmpty: 'Nog geen versies. Maak de eerste versie van de werkkopie.',
  vhsLoadMore: 'Meer laden',
  vhsRowVersion: 'Versie {no}',
  vhsAuthorSystem: 'Systeem',
  vhsAuthorFormer: 'Voormalig lid',
  vhsAuthorAgent: 'Agent',
  vhsCurrentBadge: 'Huidig',
  vhsView: 'Inhoud bekijken',
  vhsPreviewTitle: 'Inhoud van versie {no}',
  vhsPreviewError: 'De inhoud van deze versie kon niet worden geladen.',
  vhsPreviewEmpty: 'Deze versie heeft geen inhoud.',
  vhsOpenUnsupported:
    'Deze versie kan niet in de app worden geopend. Download hem in plaats daarvan.',
  vhsDownload: 'Deze versie downloaden',
  vhsDownloadVersion: 'Versie {no} downloaden',
  vhsDownloadFailed: 'Het bestand kon niet worden gedownload',
  vhsNameLabel: 'Naam van de versie',
  vhsNamePlaceholder: 'bijv. Vóór de wijzigingen uit de review',
  vhsNameHint: 'De versie bewaart de werkkopie; de naam is optioneel.',
  vhsNameSubmit: 'Versie maken',
  vhsNameSubmitting: 'Maken…',
  vhsNameDone: 'Versie {no} gemaakt',
  vhsNameFailed: 'De versie kon niet worden gemaakt. Wat je hebt getypt blijft behouden.',
  vhsNameUnchanged:
    'Er is niets veranderd sinds de laatste versie, dus er is geen nieuwe versie gemaakt.',
  vhsRestore: 'Versie {no} herstellen',
  vhsRestoreConfirmTitle: 'Versie {no} herstellen?',
  vhsRestoreConfirmDescription:
    'De werkkopie neemt de inhoud van deze versie over en er wordt een nieuwe herstelversie toegevoegd. De geschiedenis blijft behouden.',
  vhsRestoreConfirmSubmit: 'Herstellen',
  vhsRestoreSubmitting: 'Herstellen…',
  vhsRestoreFailed: 'Herstellen is mislukt. De werkkopie is niet gewijzigd.',
  vhsRestoreConflict:
    'De werkkopie is zojuist gewijzigd. Open de geschiedenis opnieuw en probeer het nog eens.',
  vhsManageOnly: 'Je hebt bewerkrechten nodig om een versie te herstellen.',
  vhsShelvedBlocked: 'Dit document is gearchiveerd en alleen-lezen.',
  vhsLockedByOther:
    'Iemand anders bewerkt dit document. Wacht tot die klaar is of neem het bewerken over en probeer het opnieuw.',
  vhsLockedByMe:
    'Je bewerkt dit document in een ander venster. Sla het daar op of sluit het en probeer het opnieuw.',
  vhsReasonUpload: 'geüpload',
  vhsReasonManual: 'handmatig',
  vhsReasonAuto: 'automatisch',
  vhsReasonRestore: 'herstel',
  vhsReasonAgent: 'agent',
  vhsReasonUnknown: 'overig',
  vhsCoalescedGroupOne: '{n} keer opgeslagen in deze sessie',
  vhsCoalescedGroupOther: '{n} keer opgeslagen in deze sessie',
  vhsCoalescedOrphanOne:
    '{n} keer opslaan is samengevoegd in de laatste versie van de bewerkingssessie',
  vhsCoalescedOrphanOther:
    '{n} keer opslaan is samengevoegd in de laatste versie van de bewerkingssessie',
  vhsReleasedNoContent: 'Deze versie heeft geen inhoud meer om te openen of te downloaden.',
  vhsErrVersionCoalesced:
    'Deze versie is samengevoegd in de laatste versie van haar bewerkingssessie en heeft daarom geen eigen inhoud. Open in plaats daarvan die laatste versie.',
  vhsErrFileChunkMissing:
    'Dit bestand kon niet worden gelezen omdat een deel van de opgeslagen gegevens ontbreekt. Probeer het over een paar minuten opnieuw; blijft het mislukken, meld het dan aan een beheerder.',
  vhsClose: 'Sluiten',
  vhsCancel: 'Annuleren',
} satisfies Record<keyof typeof zh, string>
