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
  webViewOnly: 'Alleen lezen',
  webReloaded: 'de nieuwste versie is opnieuw geladen en je wijzigingen zijn verwijderd',
  webViewOnlyNoSave: 'dit document is alleen-lezen',
  webMergeTitle: "PDF's samenvoegen",
  webMergeBody: "{count} pdf('s) geselecteerd. Nog een pdf toevoegen of nu samenvoegen?",
  webMergeAdd: 'Nog een pdf toevoegen',
  webMergeNow: 'Nu samenvoegen',
} satisfies Record<keyof typeof zh, string>
