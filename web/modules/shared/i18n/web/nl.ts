import type { zh } from './zh'

export const nl = {
  webCancel: 'Annuleren',
  webConflictTitle: 'Dit document is elders gewijzigd',
  webConflictBody:
    'Je wijzigingen staan nog niet op UniWork en blijven in deze browser tot je je afmeldt.',
  webConflictOverwrite: 'Overschrijven…',
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
  webSaveNetwork: 'UniWork is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.',
  webSaveTimeout: 'Opslaan duurde te lang. Controleer je verbinding en probeer het opnieuw.',
  webClose: 'Sluiten',
  webSaveUnauthorized:
    'Je UniWork-sessie is verlopen. Meld je opnieuw aan en probeer opnieuw op te slaan.',
  webSaveForbidden: 'Je hebt geen toestemming om dit document op te slaan.',
  webSaveNotFound: 'Dit document bestaat niet meer of is verplaatst.',
  webSaveTooLarge: 'Het document is te groot om op te slaan.',
  webSaveRateLimited: 'Te veel verzoeken. Wacht even en probeer het opnieuw.',
  webSaveServer: 'UniWork had een probleem bij het opslaan. Probeer het zo opnieuw.',
  webSaveFailedGeneric: 'Het document kon niet worden opgeslagen. Probeer het opnieuw.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Je wijzigingen staan nog niet op UniWork en blijven in deze browser tot je je afmeldt.',
  uwConflictReloadWebBody:
    'De browser bewaart geen conflictconcepten. Download je versie om er later uit te kopiëren, of verwerp je wijzigingen.',
  uwConflictDownloadThenReload: 'Mijn versie downloaden en dan opnieuw laden',
  uwConflictDiscardThenReload: 'Wijzigingen verwerpen en opnieuw laden',
  uwConflictMineFileSuffix: '(mijn versie)',
  uwConflictDownloadCheck:
    'Je browser heeft je bestand ontvangen. Controleer of het is opgeslagen en kies dan Opnieuw laden.',
  uwConflictSessionWeb:
    'Je sessie is verlopen, dus er is niet overschreven. Je wijzigingen blijven in deze browser; meld je opnieuw aan en probeer het nog eens.',
  uwConflictTooLarge:
    'Je versie is groter dan de limiet van UniWork, dus overschrijven was niet mogelijk.',
  uwConflictDownloadFailed:
    'Kan je versie niet downloaden, dus het document is niet opnieuw geladen. Probeer het opnieuw.',
  uwConflictOfflineWeb:
    'Je bent offline. Op het web is hiervoor een verbinding nodig; je wijzigingen blijven in deze browser.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Jouw versie',
  uwConflictColServer: 'Versie op UniWork',
  uwConflictRowVersion: 'Versie',
  uwConflictRowTime: 'Tijd',
  uwConflictRowBy: 'Opgeslagen door',
  uwConflictMineUnsaved: 'Jij (niet opgeslagen)',
  uwConflictBasedOn: 'gebaseerd op versie {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Verschillen bekijken',
  uwConflictNoEdit: 'Je hebt geen bewerkrechten meer voor dit document.',
  uwConflictOverwriteTitle: 'Overschrijven met jouw versie?',
  uwConflictOverwriteConfirm:
    'UniWork maakt versie {next} van jouw kopie. Versie {server} van {author} blijft in de geschiedenis.',
  uwConflictOverwriteGo: 'Overschrijven',
  uwConflictBack: 'Terug',
  uwConflictHeadMoved:
    'Intussen heeft UniWork versie {n} gekregen. De tabel is bijgewerkt; kies opnieuw.',
  uwConflictReloadTitle: 'Nieuwste opnieuw laden',
  uwConflictReloadGo: 'Opnieuw laden',
  uwConflictSaveCopy: 'Opslaan als kopie…',
  uwConflictSaveCopyTitle: 'Opslaan als kopie?',
  uwConflictSaveCopyConfirm:
    'UniWork maakt een nieuw document van jouw versie, met dezelfde eigenaar en toegang als dit document. Het huidige document en versie {server} van {author} blijven ongewijzigd.',
  uwConflictSaveCopyGo: 'Kopie maken',
  uwConflictSaveCopyDone:
    'Je versie is opgeslagen als nieuw document: {title}. Dit document is niet gewijzigd; je kunt nog steeds opnieuw laden of overschrijven.',
  uwConflictSaveCopyFailed:
    'Kan de kopie niet maken. Je wijzigingen zijn nog veilig; probeer het opnieuw.',
  uwConflictSaveCopyOffline:
    'Je bent offline. Voor een kopie is een verbinding nodig; je wijzigingen blijven bewaard.',
  uwConflictReloadFailed:
    'Kan de nieuwste versie niet laden. Je document is niet gewijzigd; probeer het opnieuw.',
  uwConflictOverwriteFailed:
    'Overschrijven is nog niet gelukt. Je document is niet gewijzigd; probeer het opnieuw.',
  uwConflictClose: 'Sluiten',

  // S6 new-version bar
  uwRemoteRegion: 'Nieuwe versie',
  uwRemoteUpdated: 'Bijgewerkt naar versie {n}, opgeslagen door {author} om {time}.',
  uwRemoteUpdatedNoRev: 'Bijgewerkt naar de nieuwste versie op UniWork.',
  uwRemoteNewerDirty:
    'Er staat een nieuwere versie op UniWork (versie {n}). Je hebt niet-opgeslagen wijzigingen, dus het document is niet opnieuw geladen.',
  uwRemoteNewerAi:
    'Er staat een nieuwere versie op UniWork (versie {n}). UniWork AI is bezig, dus het document is niet opnieuw geladen; AI-resultaten gelden alleen voor de geopende kopie.',
  uwRemoteNowClean:
    'Je hebt alle wijzigingen ongedaan gemaakt. Versie {n} op UniWork is nieuwer dan de geopende kopie.',
  uwRemoteStopAiConfirm:
    'De lopende UniWork AI-run stoppen om opnieuw te laden? Wijzigingen die AI al heeft gemaakt horen bij de geopende kopie.',
  uwRemoteWaitCommit: 'Wachten tot de lopende opslag klaar is; daarna kun je opnieuw laden.',
  uwRemoteReload: 'Nieuwste opnieuw laden…',
  uwRemoteLater: 'Later',
  uwRemoteClose: 'Sluiten',
  uwRemoteReloadFailed: 'Kan versie {n} niet laden. Je bekijkt nog de vorige versie.',
  uwRemoteDeleted: 'Dit document is verwijderd op UniWork. Opslagen in de wachtrij zijn gestopt.',
  uwAuthorFallback: 'een lid',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Je hebt geen toegang meer tot dit document. Opslaan is gestopt; niet-opgeslagen wijzigingen blijven in deze browser tot je je afmeldt.',
  uwRemoteOrgBlockedWeb:
    'Opslaan mislukt: {reason}. Niet-opgeslagen wijzigingen blijven in deze browser tot je je afmeldt.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'document gearchiveerd',
  uwReasonSuspended: 'organisatie opgeschort',
  uwReasonDeactivated: 'je account is gedeactiveerd in deze organisatie',
} satisfies Record<keyof typeof zh, string>
