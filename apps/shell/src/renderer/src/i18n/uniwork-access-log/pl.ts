import type { zh } from './zh'

export const pl = {
  algMenu: 'Dziennik dostępu',
  algTitle: 'Dziennik dostępu',
  algDescription:
    'Kto wyświetlił, pobrał lub otworzył dokument przez link. Mogą go czytać tylko zarządzający.',
  algManageOnly: 'Aby czytać dziennik dostępu, potrzebujesz uprawnień zarządzania.',
  algLoading: 'Ładowanie dziennika…',
  algError: 'Nie udało się wczytać dziennika dostępu.',
  algEmpty: 'Nie zapisano jeszcze żadnego dostępu.',
  algFilterLabel: 'Akcja',
  algFilterAll: 'Wszystkie akcje',
  algActionView: 'Wyświetlenie',
  algActionDownload: 'Pobranie',
  algActionExport: 'Eksport',
  algActionLinkView: 'Otwarto przez link',
  algActionUnknown: 'Inne',
  algActorAnonymous: 'Anonim',
  algActorSystem: 'System',
  algActorUnknown: 'Nieznany',
  algVersion: 'wersja {no}',
} satisfies Record<keyof typeof zh, string>
