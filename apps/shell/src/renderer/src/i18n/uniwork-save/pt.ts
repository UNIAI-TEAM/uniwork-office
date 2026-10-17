import type { zh } from './zh'

export const pt = {
  usMyFolder: 'Minha pasta',
  usPrivateTag: 'Privado',
  usDialogTitle: 'Dar nome ao documento',
  usHint: 'Primeiro salvamento. Os próximos mantêm este nome; use “Salvar como” para mudá-lo.',
  usName: 'Nome',
  usLocation: 'Local',
  usSavingIn: 'Salvando em: {folder}',
  usMyFolderPrivate: 'Privado, só você vê',
  usChange: 'Alterar',
  usSave: 'Salvar',
  usClose: 'Fechar',
  usPickTitle: 'Escolher onde salvar',
  usBack: 'Voltar ao nome',
  usSearchFolders: 'Pesquisar pastas',
  usSharedNote: 'Ao salvar numa pasta compartilhada, o documento recebe as permissões dessa pasta.',
  usChooseFolder: 'Escolher “{folder}”',
  usSelected: 'Selecionado',
  usRootBlocked: 'Escolha uma pasta',
  usErrInvalidDestination: 'Não é possível salvar aqui. Escolha outra pasta.',
  usErrMyFolderLocked:
    'Minha pasta é sua pasta pessoal do sistema e não pode ser renomeada, compartilhada, movida nem arquivada.',
  usErrFlushFailed:
    'Ainda não foi possível gravar o documento neste dispositivo. Salve o documento primeiro e tente de novo.',
  usErrBindFailed:
    '“{title}” (ID {id}) foi criado, mas não pôde ser vinculado a esta aba. O documento foi movido para a lixeira e pode ser restaurado.',
  usErrOrphaned:
    '“{title}” (ID {id}) foi criado no UniWork, mas não pôde ser vinculado a esta aba nem movido para a lixeira. Exclua ou use esse documento no UniWork.',
  usErrAlreadyBound: 'Esta aba já está vinculada a um documento do UniWork. Salve como de costume.',
  usErrNotFound:
    'O arquivo a salvar ou a pasta escolhida não foi encontrado. Escolha onde salvar de novo e tente outra vez.',
} satisfies Record<keyof typeof zh, string>
