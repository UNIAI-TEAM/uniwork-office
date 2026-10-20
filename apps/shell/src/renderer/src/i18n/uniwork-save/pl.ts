import type { zh } from './zh'

export const pl = {
  usMyFolder: 'Mój folder',
  usPrivateTag: 'Prywatne',
  usDialogTitle: 'Nazwij dokument',
  usHint: 'Pierwsze zapisanie. Kolejne zachowają tę nazwę; aby ją zmienić, użyj „Zapisz jako”.',
  usName: 'Nazwa',
  usLocation: 'Lokalizacja',
  usSavingIn: 'Zapisywanie w: {folder}',
  usMyFolderPrivate: 'Prywatne, widoczne tylko dla Ciebie',
  usChange: 'Zmień',
  usSave: 'Zapisz',
  usFirstTitle: 'Name the document',
  usFirstHint: 'You can rename or move it later.',
  usClose: 'Zamknij',
  usPickTitle: 'Wybierz miejsce zapisu',
  usBack: 'Wróć do nazwy',
  usSearchFolders: 'Szukaj folderów',
  usChooseFolder: 'Wybierz „{folder}”',
  usSelected: 'Wybrane',
  usRootBlocked: 'Wybierz folder',
  usErrInvalidDestination: 'Nie można tu zapisać. Wybierz inny folder.',
  usErrMyFolderLocked:
    'Mój folder to Twój osobisty folder systemowy – nie można zmienić jego nazwy, udostępnić go, przenieść ani zarchiwizować.',
  usErrFlushFailed:
    'Nie udało się jeszcze zapisać dokumentu na tym urządzeniu. Najpierw zapisz dokument, a potem spróbuj ponownie.',
  usErrBindFailed:
    'Utworzono „{title}” (ID {id}), ale nie udało się powiązać go z tą kartą. Dokument przeniesiono do kosza i można go przywrócić.',
  usErrOrphaned:
    'Utworzono „{title}” (ID {id}) w UniWork, ale nie udało się powiązać go z tą kartą ani przenieść do kosza. Usuń lub użyj tego dokumentu w UniWork.',
  usErrAlreadyBound: 'Ta karta jest już powiązana z dokumentem UniWork. Zapisuj jak zwykle.',
  usErrNotFound:
    'Nie znaleziono pliku do zapisania ani wybranego folderu. Wybierz ponownie miejsce zapisu i spróbuj jeszcze raz.',
} satisfies Record<keyof typeof zh, string>
