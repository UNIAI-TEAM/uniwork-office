import type { zh } from './zh'

export const nl = {
  usMyFolder: 'Mijn map',
  usPrivateTag: 'Privé',
  usDialogTitle: 'Geef het document een naam',
  usHint:
    'Eerste keer opslaan. Latere opslagen houden deze naam; gebruik ‘Opslaan als’ om hem te wijzigen.',
  usName: 'Naam',
  usLocation: 'Locatie',
  usSavingIn: 'Opslaan in: {folder}',
  usMyFolderPrivate: 'Privé, alleen jij ziet het',
  usChange: 'Wijzigen',
  usSave: 'Opslaan',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Sluiten',
  usPickTitle: 'Kies waar je opslaat',
  usBack: 'Terug naar naam',
  usSearchFolders: 'Mappen zoeken',
  usChooseFolder: '‘{folder}’ kiezen',
  usSelected: 'Geselecteerd',
  usRootBlocked: 'Kies een map',
  usErrInvalidDestination: 'Hier kan niet worden opgeslagen. Kies een andere map.',
  usErrMyFolderLocked:
    'Mijn map is je persoonlijke systeemmap en kan niet worden hernoemd, gedeeld, verplaatst of gearchiveerd.',
  usErrFlushFailed:
    'Het document kon nog niet naar dit apparaat worden geschreven. Sla het document eerst op en probeer het opnieuw.',
  usErrBindFailed:
    '‘{title}’ (ID {id}) is gemaakt, maar kon niet aan dit tabblad worden gekoppeld. Het document staat in de prullenbak en kan worden hersteld.',
  usErrOrphaned:
    '‘{title}’ (ID {id}) is in UniWork gemaakt, maar kon niet aan dit tabblad worden gekoppeld of naar de prullenbak worden verplaatst. Verwijder of gebruik dat document in UniWork.',
  usErrAlreadyBound:
    'Dit tabblad is al gekoppeld aan een UniWork-document. Sla op zoals gewoonlijk.',
  usErrNotFound:
    'Het op te slaan bestand of de gekozen map is niet gevonden. Kies opnieuw waar je opslaat en probeer het nog eens.',
} satisfies Record<keyof typeof zh, string>
