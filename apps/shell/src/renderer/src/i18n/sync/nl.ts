import type { zh } from './zh'

export const nl = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Opslaan in wachtrij — nog niet op UniWork',
  uwChipQueuedNewer: 'Opslaan in wachtrij · nieuwere wijzigingen',
  uwChipPausedAdmin: 'Opslaan in wachtrij · verzenden gepauzeerd',
  uwChipReconciling: 'Laatste opslag controleren…',
  uwChipReconcileStuck: 'Ondersteuning nodig om de opslag te bevestigen',
  uwErrReconcileStuck: 'Ondersteuning nodig om de opslag te bevestigen.',
  uwChipRemoteNewer: 'Nieuwere versie op UniWork',
  uwTipQueued:
    'Je opslag van {time} blijft veilig op deze computer en wordt verzonden zodra dat kan.',
  uwTipQueuedNewer:
    'De opslag van {time} wacht op verzending. Latere wijzigingen horen er niet bij.',
  uwTipPausedAdmin: 'Je beheerder heeft verzenden gepauzeerd. De opslag blijft op deze computer.',
  uwTipPausedUser:
    'Je hebt verzenden gepauzeerd. De opslag van {time} blijft op deze computer; kies Verzenden hervatten in het synchronisatiecentrum.',
  uwTipReconciling:
    'Het is nog niet duidelijk of de laatste opslag UniWork heeft bereikt. De app controleert dit en maakt geen duplicaat.',
  uwTipRemoteNewer:
    'Je hebt niet-opgeslagen wijzigingen, dus het document is niet opnieuw geladen.',
  uwTipFailed:
    'Deze opslag wordt niet vanzelf opnieuw geprobeerd: {reason}. Je wijzigingen blijven op deze computer.',
  uwTipWaitAi: 'Wachten tot AI de huidige stap afrondt, daarna opslaan.',
  uwTipWaitAiLong: 'AI heeft de huidige stap nog niet afgerond. Stop de AI-run om nu op te slaan.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Wachtrij bekijken',
  uwActSaveAgain: 'Opnieuw opslaan',
  uwActStopAi: 'AI stoppen',
  uwActBack: 'Terug',
  uwQueuePopWaiting: 'Wacht op opslaan: van {time} (gebaseerd op versie {base})',
  uwQueuePopNewer: 'Nieuwere wijzigingen sindsdien — niet verzonden',
  uwQueueBlockedSave: 'Je laatste opslag wacht nog. Je kunt opnieuw opslaan zodra die klaar is.',
  uwQueueFull:
    'De synchronisatieopslag op deze computer is vol, dus de opslag is niet in de wachtrij gezet. Je wijzigingen staan nog in het geopende venster; maak ruimte vrij in het synchronisatiecentrum.',
  uwQueueOpenCenter: 'Synchronisatiecentrum openen',
  uwQueueCancel: 'Opslaan annuleren…',
  uwQueueCancelConfirm:
    'Opslag in de wachtrij annuleren? Je wijzigingen blijven op deze computer; het document op UniWork verandert niet.',
  uwQueueCancelGo: 'Opslaan annuleren',
  uwQueueCancelled: 'Opslag in wachtrij geannuleerd. Je wijzigingen blijven op deze computer.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'opnieuw aanmelden',
  uwReasonSignedOut: 'afgemeld',
  uwReasonForeign: 'hoort bij een ander account',
  uwReasonArchived: 'document gearchiveerd',
  uwReasonSuspended: 'organisatie opgeschort',
  uwReasonDeactivated: 'je account is gedeactiveerd in deze organisatie',
  uwReasonLease: 'offline toegang verlopen',
  uwReasonKeystore: 'de sleutelhanger van deze computer is vergrendeld',
  uwReasonClock: 'de klok is teruggezet',
  uwReasonStoreFull: 'de synchronisatieopslag op deze computer is vol',
  uwReasonStoreNewer: 'een nieuwere app-versie is nodig',

  // S2 queue-row badges
  uwBadgeQueued: 'Wacht',
  uwBadgeWaitNetwork: 'Wacht op netwerk',
  uwBadgePausedUser: 'Door jou gepauzeerd',
  uwBadgePausedAdmin: 'Door beheerder gepauzeerd',
  uwBadgeSending: 'Verzenden',
  uwBadgeReconciling: 'Controleren',
  uwBadgeReconcileStuck: 'Ondersteuning nodig',
  uwBadgeConflict: 'Conflict',
  uwBadgeBlocked: 'Geblokkeerd',
  uwBadgeLocked: 'Vergrendeld',
  uwBadgeRevoked: 'Geen toegang',
  uwBadgeDeleted: 'Verwijderd',
  uwBadgeReconnect: 'Opnieuw verbinden nodig',
  uwBadgeKeystore: 'Sleutelhanger vergrendeld',
  uwBadgeFailed: 'Verzenden mislukt',
  uwBadgeSaved: 'Opgeslagen',
  uwBadgeKeptDraft: 'Bewaard concept',
  uwBadgeMoved: 'Verplaatst',
  uwBadgeArchived: 'Gearchiveerd',

  // S2 queue-row details
  uwRowQueued: 'Opgeslagen {time} · gebaseerd op versie {base} · {size}',
  uwRowWaitNetwork: 'Wordt verzonden zodra je online bent',
  uwRowPausedUser: 'Wordt verzonden wanneer je Verzenden hervatten kiest',
  uwRowPausedAdmin: 'Wordt verzonden wanneer je beheerder verzenden weer inschakelt',
  uwRowUploading: 'Uploaden {done} / {total}',
  uwRowCommitting: 'Versie wordt gemaakt',
  uwRowReconciling:
    'Het resultaat van de verzending om {time} is nog niet duidelijk. Navragen bij UniWork.',
  uwRowReconcileStuck:
    'Controlepogingen: {count}, nog geen resultaat. De app verzendt niet opnieuw; stuur de ondersteuningscode naar je beheerder.',
  uwStuckDiscardConfirm:
    'Deze opslag verwerpen? Als die UniWork al heeft bereikt, blijft die versie bestaan; je kopie wordt als concept bewaard in het synchronisatiecentrum.',
  uwRowConflict: 'Versie {n} is opgeslagen door {author} om {time}',
  uwRowFailed: 'Verzenden mislukt: {reason}',
  uwRowBlocked: 'Kan niet opslaan: {reason}',
  uwRowCommitted: 'Versie {n} · {time}',
  uwRowKeptDraft: 'Bewaard bij opnieuw laden om {time}',
  uwRowMoved: 'Het document is verplaatst naar {workspace}',
  uwRowArchived: 'Het document is gearchiveerd op UniWork',

  // S2 row actions
  uwActDiscard: 'Verwerpen',
  uwActDiscardSave: 'Opslag verwerpen…',
  uwActSendNow: 'Nu verzenden',
  uwActRecheck: 'Opnieuw controleren',
  uwActGuide: 'Handleiding',
  uwActOpenToResolve: 'Openen om op te lossen',
  uwActCopySupport: 'Ondersteuningscode kopiëren',
  uwActDownloadMine: 'Mijn versie downloaden',
  uwActOpenDraft: 'Concept openen',
  uwActDiscardDraft: 'Concept verwerpen…',
  uwActSignInAgain: 'Opnieuw aanmelden',
  uwActSignIn: 'Aanmelden',
  uwActSwitchAccount: 'Ander account',
  uwActReconnect: 'Opnieuw verbinden',
  uwActDetails: 'Details',
  uwActOpen: 'Openen',
  uwDiscardDraftConfirm:
    'Dit concept verwerpen? De wijzigingen worden van deze computer verwijderd en kunnen niet worden hersteld.',

  // Sign-out prompt
  uwSignOutTitle: 'Afmelden bij UniWork?',
  uwSignOutBody:
    'Documenten met niet-opgeslagen wijzigingen of opslag in de wachtrij: {count}. Ze blijven vergrendeld op deze computer en alleen jouw account kan ze weer openen.',
  uwSignOutKeystore:
    'De sleutelhanger van de computer is vergrendeld, dus niet-opgeslagen wijzigingen bestaan alleen in geopende vensters. Nu afmelden verwijdert ze; wat al versleuteld bewaard is, blijft. Ontgrendel eerst de computer om ze te houden.',
  uwSignOutGo: 'Afmelden',
  uwSignOutWaiting: 'Lopende opslag wordt afgerond voordat je wordt afgemeld…',
  uwSignOutCaptureFailed:
    'Sommige niet-opgeslagen wijzigingen konden niet op tijd worden vastgelegd; de laatst opgeslagen of automatisch opgeslagen versie blijft bewaard voor je account.',
  uwSignOutTimedOut: 'Afmelden duurde te lang om te bevestigen; het account kan nog steeds aangemeld zijn.',
  uwSwitchLostTitle:
    'Sommige niet-opgeslagen wijzigingen van het vorige account zijn verloren gegaan',
  uwSwitchLostBody:
    'Er is een ander account aangemeld op deze computer, dus het vorige account is vergrendeld. Documenten waarvan de niet-opgeslagen wijzigingen niet bewaard konden worden: {count}. Al het andere blijft voor dat account vergrendeld op deze computer.',
  uwSwitchLostOk: 'OK',

  // S2 sync center
  uwSyncTitle: 'Synchronisatiecentrum',
  uwSyncOpenFromSettings: 'Synchronisatiecentrum',
  uwSyncOnline: 'Verbonden met UniWork · gesynchroniseerd {time}',
  uwSyncOffline: 'Offline · laatst gesynchroniseerd {time}',
  uwSyncOnlineNoTime: 'Verbonden met UniWork',
  uwSyncOfflineNoTime: 'Offline',
  uwSyncPaused: 'Verzenden gepauzeerd — nieuwe opslagen wachten',
  uwSyncAdminPaused: 'Je beheerder heeft verzenden gepauzeerd. Opslagen blijven op deze computer.',
  uwSyncFeedOff:
    'Meldingen van nieuwe versies zijn gepauzeerd. UniWork controleert nog steeds op conflicten wanneer je opslaat.',
  uwSyncResynced: 'Volledig opnieuw gesynchroniseerd om {time}',
  uwSyncResyncFailed:
    'Opnieuw synchroniseren is na meerdere pogingen mislukt. Meldingen van nieuwe versies zijn gepauzeerd; UniWork controleert nog steeds op conflicten wanneer je opslaat.',
  uwSyncSignedOut:
    'Je bent afgemeld. Items die vergrendeld op deze computer bewaard worden: {count}.',
  uwSyncSignedOutEmpty: 'Je bent afgemeld.',
  uwSyncSessionExpired: 'Je sessie is verlopen. Meld je opnieuw aan om verder te verzenden.',
  uwSyncOtherOrg: 'Wachtende opslagen in een andere organisatie: {count}',
  uwSyncStoreBudget: 'Synchronisatieopslag op deze computer: {used} van {cap}',
  uwSyncStoreError: 'Kan de wachtrij op deze computer niet lezen. Er is niets verwijderd.',
  uwSyncNow: 'Nu synchroniseren',
  uwSyncPause: 'Verzenden pauzeren',
  uwSyncResume: 'Verzenden hervatten',
  uwSyncNowOffline: 'Voor synchroniseren is een verbinding nodig.',
  uwSyncTabAttention: 'Vraagt aandacht',
  uwSyncTabQueue: 'Wacht op opslaan',
  uwSyncTabOffline: 'Offline beschikbaar',
  uwSyncTabRecent: 'Recent opgeslagen',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Document',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Details',
  uwSyncColActions: 'Acties',
  uwSyncMoreActions: 'Meer acties voor {doc}',
  uwSyncEmptyQueue: 'Er wacht niets op opslaan.',
  uwSyncEmptyAttention: 'Niets vraagt aandacht.',
  uwSyncEmptyRecent: 'Geen recente opslagen.',
  uwSyncActionFailed: 'Dat is niet gelukt. Er is niets verwijderd; probeer het opnieuw.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Offline beschikbaar maken',
  uwOfflineUnpin: 'Offlinekopie verwijderen',
  uwOfflineUnpinShort: 'Losmaken',
  uwOfflineAdd: 'Documenten toevoegen…',
  uwOfflineUsage: '{used} van {cap} in gebruik op deze computer',
  uwOfflineEmpty: 'Er zijn nog geen documenten offline beschikbaar.',
  uwOfflineCapReached:
    'De offlinebibliotheek op deze computer heeft de limiet bereikt: opslag {cap}; maximaal aantal documenten: {maxDocs}. Verwijder een offlinekopie om een andere toe te voegen.',
  uwOfflineReady: 'Offline beschikbaar',
  uwOfflineBadgeWaiting: 'Wacht op netwerk',
  uwOfflineBadgeDownloading: 'Downloaden',
  uwOfflineBadgeVerifying: 'Verifiëren',
  uwOfflineBadgeUpdate: 'Update beschikbaar',
  uwOfflineBadgeInterrupted: 'Niet klaar',
  uwOfflineBadgeDiskFull: 'Onvoldoende ruimte',
  uwOfflineBadgeCorrupt: 'Download beschadigd',
  uwOfflineBadgeLeaseSoon: 'Offline toegang verloopt binnenkort',
  uwOfflineBadgeViewOnly: 'Offline beschikbaar · alleen weergeven',
  uwOfflineRowWaiting: 'Wordt gedownload zodra je online bent',
  uwOfflineRowProgress: '{done} van {total}',
  uwOfflineRowProgressAria: '{done} van {total}',
  uwOfflineRowVerifying: 'Integriteit controleren',
  uwOfflineRowReady: 'Versie {n} · {size} · offline toegang tot {datetime}',
  uwOfflineRowUpdate: 'Versie {n} wordt gedownload zodra je online bent; versie {old} werkt nog',
  uwOfflineRowUpdateKept: 'Bijwerken naar versie {n} is mislukt: {reason}. Versie {old} werkt nog.',
  uwOfflineRowInterrupted:
    'De download is onderbroken. De oudere kopie (indien aanwezig) werkt nog.',
  uwOfflineRowDiskFull: 'Nog {size} nodig. De oudere kopie blijft bewaard.',
  uwOfflineRowCorrupt: 'De beschadigde kopie is verwijderd. Download hem opnieuw.',
  uwOfflineRowLeaseSoon: 'Maak verbinding vóór {datetime} om te verlengen',
  uwOfflineRowRevoked:
    'Je hebt geen toegang meer tot dit document. De gedownloade kopie is verwijderd; concepten blijven vergrendeld.',
  uwOfflineRowDeleted:
    'Het document is verwijderd op UniWork. De gedownloade kopie is verwijderd; concepten blijven vergrendeld.',
  uwOfflineRowArchived:
    'Het document is gearchiveerd; de kopie hier opent tot de offline toegang verloopt.',
  uwOfflineRowMoved: 'Verplaatst naar {workspace}; de kopie hier werkt nog.',
  uwOfflineRowViewOnly: 'Versie {n} · alleen weergeven · offline toegang tot {datetime}',
  uwOfflineReadyAnnounce: 'Offline beschikbaar: {doc}',
  uwOfflineUnpinConfirm:
    'De gedownloade kopie wordt van deze computer verwijderd. Concepten en opslagen in de wachtrij blijven bewaard.',
  uwOfflineCancelDownload: 'Download annuleren',
  uwOfflineDownloadNow: 'Nu downloaden',
  uwOfflineOpenFolder: 'Opslagmap openen',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Opnieuw verbinden nodig',
  uwLockKeystoreTitle: 'De sleutelhanger van deze computer is vergrendeld',
  uwLockClockTitle: 'Tijdcontrole nodig',
  uwLockRevokedTitle: 'Geen toegang',
  uwLockDeletedTitle: 'Document verwijderd',
  uwLockForeignTitle: 'Hoort bij een ander account',
  uwLockOrgTitle: 'Kan niet openen in deze organisatie',
  uwLockExpired:
    'Offline toegang is verlopen. De inhoud blijft versleuteld; maak verbinding om hem weer te openen.',
  uwLockLibraryOff:
    'Je beheerder heeft offline documenten uitgeschakeld, dus offline toegang kan niet worden verlengd. Concepten blijven vergrendeld in het synchronisatiecentrum.',
  uwLockKeystore:
    'De sleutelhanger van de computer is vergrendeld, dus de versleutelde inhoud kan niet worden geopend. Ontgrendel hem en probeer het opnieuw; er is niets verwijderd.',
  uwLockClock:
    'De klok van de computer is teruggezet, dus offline toegang is vergrendeld. Maak verbinding zodat UniWork de tijd kan controleren.',
  uwLockForeign:
    'Dit document hoort bij een ander account op deze computer. Schakel over naar dat account om het te openen.',
  uwLockSuspended:
    'De organisatie is opgeschort. De inhoud blijft versleuteld; neem contact op met je beheerder.',
  uwLockDeactivated:
    'Je account is gedeactiveerd in deze organisatie. De inhoud blijft versleuteld; neem contact op met je beheerder.',
  uwLockSignedOutTitle: 'Je bent afgemeld',
  uwLockSignedOut:
    'De inhoud blijft vergrendeld op deze computer. Meld je aan met hetzelfde account om hem weer te openen.',
  uwLockRegion: 'Documentstatus',
  uwLockWhileOpen:
    'Het document is vergrendeld terwijl het open was. Niet-opgeslagen wijzigingen blijven versleuteld bewaard; je kunt niet opslaan of kopiëren totdat het ontgrendeld is.',
  uwLockWhileOpenRam:
    'Het document is vergrendeld terwijl het open was en deze computer kan je wijzigingen nog niet veilig bewaren. Ze bestaan alleen in dit venster (alleen weergeven); sluiten betekent dat ze verloren gaan.',
  uwLockOtherWindow:
    'Dit document is geopend om te bewerken in een ander venster. Dit venster is alleen voor weergeven.',
  uwLockOtherWindowGone:
    'Het venster waarin dit document werd bewerkt reageert niet meer. Je kunt in dit venster bewerken.',
  uwLockGoToWindow: 'Naar dat venster gaan',
  uwLockTakeEdit: 'In dit venster bewerken',

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
  uwConflictSaveCopyNoSeat:
    'Kan de kopie niet maken omdat je geen lid bent van de werkruimte waarin dit document staat. Je wijzigingen zijn nog veilig; je kunt je versie downloaden.',
  uwConflictSaveCopyFolderRefused:
    'Je kunt in deze map geen documenten maken. Download in plaats daarvan je versie.',
  uwConflictDownloadDone:
    'Je versie is op deze computer opgeslagen: {file}. Dit document is niet gewijzigd; je kunt nog steeds opnieuw laden of overschrijven.',
  uwConflictDownloadFailedDesktop:
    'Kan het bestand niet opslaan. Je wijzigingen zijn nog veilig; probeer het opnieuw.',
  uwConflictSaveCopyOffline:
    'Je bent offline. Voor een kopie is een verbinding nodig; je wijzigingen blijven bewaard.',
  uwConflictReloadFailed:
    'Kan de nieuwste versie niet laden. Je document is niet gewijzigd; probeer het opnieuw.',
  uwConflictOverwriteFailed:
    'Overschrijven is nog niet gelukt. Je document is niet gewijzigd; probeer het opnieuw.',
  uwConflictClose: 'Sluiten',

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Dit document is elders gewijzigd',
  uwConflictBody: 'Je wijzigingen staan nog niet op UniWork en zijn veilig op deze computer.',
  uwConflictReload: 'Nieuwste opnieuw laden',
  uwConflictOverwrite: 'Overschrijven…',
  uwConflictCancel: 'Annuleren',
  uwConflictKeepUnavailable:
    'Deze computer kan nu geen concept bewaren (synchronisatieopslag vol of sleutelhanger vergrendeld).',
  uwConflictOfflineDesktop:
    'Je bent offline en de nieuwste versie staat niet op deze computer, dus opnieuw laden kan nog niet.',
  uwConflictReloadDesktopBody:
    'Kies wat er met je wijzigingen gebeurt voordat versie {n} wordt geladen.',
  uwConflictKeepDraft: 'Mijn versie als concept bewaren',
  uwConflictDiscard: 'Mijn wijzigingen verwerpen',
  uwConflictKeepDraftHint:
    'Het concept blijft in het synchronisatiecentrum om te bekijken of te kopiëren; het wordt nooit automatisch op de nieuwe versie toegepast.',
  uwConflictDraftCapReached:
    'Dit document heeft het maximale aantal bewaarde concepten bereikt: {cap}. Verwerp een oud concept in het synchronisatiecentrum om een ander te bewaren.',

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
  uwRemoteWaitCommit: 'Wachten tot de lopende opslag klaar is; daarna kun je verdergaan.',
  uwRemoteReload: 'Nieuwste opnieuw laden…',
  uwRemoteLater: 'Later',
  uwRemoteClose: 'Sluiten',
  uwRemoteReloadFailed: 'Kan versie {n} niet laden. Je bekijkt nog de vorige versie.',
  uwRemoteDeleted: 'Dit document is verwijderd op UniWork. Opslagen in de wachtrij zijn gestopt.',
  uwAuthorFallback: 'een lid',

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'De eerdere opslag heeft ondersteuning nodig, dus je kunt nog niet opnieuw laden of overschrijven. Open het synchronisatiecentrum om dit op te lossen.',
  uwRemoteRevoked:
    'Je hebt geen toegang meer tot dit document. Opslaan is gestopt; niet-opgeslagen wijzigingen blijven vergrendeld op deze computer.',
} satisfies Record<keyof typeof zh, string>
