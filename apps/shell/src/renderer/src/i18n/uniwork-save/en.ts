import type { zh } from './zh'

export const en = {
  usMyFolder: 'My Folder',
  usPrivateTag: 'Private',
  usDialogTitle: 'Name your document',
  usHint: 'First save. Later saves keep this name; use “Save as” to change it.',
  usName: 'Name',
  usLocation: 'Location',
  usSavingIn: 'Saving in: {folder}',
  usMyFolderPrivate: 'Private, only you can see it',
  usChange: 'Change',
  usSave: 'Save',
  usClose: 'Close',
  usPickTitle: 'Choose where to save',
  usBack: 'Back to naming',
  usSearchFolders: 'Search folders',
  usSharedNote: 'Saving into a shared folder gives the document that folder’s permissions.',
  usChooseFolder: 'Choose “{folder}”',
  usSelected: 'Selected',
  usRootBlocked: 'Choose a folder',
  usErrInvalidDestination: 'Can’t save there. Choose another folder.',
  usErrMyFolderLocked:
    'My Folder is your personal system folder and can’t be renamed, shared, moved or archived.',
  usErrFlushFailed:
    'The document couldn’t be written to this device yet. Save the document first, then try again.',
  usErrBindFailed:
    'Created “{title}” (ID {id}) but couldn’t link it to this tab. The document was moved to the trash and can be restored.',
  usErrOrphaned:
    'Created “{title}” (ID {id}) in UniWork but couldn’t link it to this tab or move it to the trash. Delete or use that document in UniWork.',
  usErrAlreadyBound: 'This tab is already linked to a UniWork document. Save as usual.',
  usErrNotFound:
    'The file to save or the chosen folder can’t be found. Choose where to save again and retry.',
} satisfies Record<keyof typeof zh, string>
