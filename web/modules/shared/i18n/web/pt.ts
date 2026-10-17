import type { zh } from './zh'

export const pt = {
  webCancel: 'Cancelar',
  webConflictTitle: 'Este documento foi alterado em outro lugar',
  webConflictBody:
    'Suas alterações ainda não estão no UniWork e ficam neste navegador até você sair.',
  webConflictOverwrite: 'Substituir…',
  webConflictReload: 'Recarregar a versão mais recente',
  webConflictNotSaved: 'o documento foi alterado em outro lugar',
  webFatalTitle: 'Não foi possível abrir o documento',
  webFatalBody:
    'A edição e o salvamento estão desativados. Recarregue a página ou abra o documento novamente pelo UniWork.',
  webNoHost: 'Este editor funciona dentro do UniWork. Abra o documento pelo UniWork.',
  webViewOnly: 'Somente leitura',
  webViewOnlyNotSaved: 'Este documento é somente leitura e não pode ser salvo',
  webNotUtf8:
    'Este arquivo não é texto UTF-8. Ele abre somente leitura para que salvar não altere seus bytes',
  webDraftTitle: 'Restaurar alterações não salvas?',
  webDraftBody:
    'Este navegador guardou uma cópia de alterações não salvas deste documento. Restaurar ou descartar?',
  webDraftOlder:
    'A cópia se baseia em uma versão mais antiga do documento. Salvá-la substitui a versão mais recente.',
  webDraftSavedAt: 'Cópia guardada às',
  webDraftKept: 'Este navegador mantém a cópia até você sair da conta.',
  webDraftRestore: 'Restaurar',
  webDraftDiscard: 'Descartar',
  webSaveNetwork: 'Não foi possível acessar o UniWork. Verifique sua conexão e tente novamente.',
  webSaveTimeout: 'Salvar demorou demais. Verifique sua conexão e tente novamente.',
  webClose: 'Fechar',
  webSaveUnauthorized: 'Sua sessão do UniWork terminou. Entre novamente e tente salvar de novo.',
  webSaveForbidden: 'Você não tem permissão para salvar este documento.',
  webSaveNotFound: 'Este documento não existe mais ou foi movido.',
  webSaveTooLarge: 'O documento é grande demais para ser salvo.',
  webSaveRateLimited: 'Muitas solicitações. Aguarde um momento e tente novamente.',
  webSaveServer: 'O UniWork teve um problema ao salvar. Tente novamente em instantes.',
  webSaveFailedGeneric: 'Não foi possível salvar o documento. Tente novamente.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Suas alterações ainda não estão no UniWork e ficam neste navegador até você sair.',
  uwConflictReloadWebBody:
    'O navegador não guarda rascunhos de conflito. Baixe sua versão para copiar dela depois ou descarte suas alterações.',
  uwConflictDownloadThenReload: 'Baixar minha versão e depois recarregar',
  uwConflictDiscardThenReload: 'Descartar alterações e recarregar',
  uwConflictMineFileSuffix: '(minha versão)',
  uwConflictDownloadCheck:
    'Seu navegador recebeu o arquivo. Verifique se ele foi salvo e escolha Recarregar.',
  uwConflictSessionWeb:
    'Sua sessão expirou, então a substituição não aconteceu. Suas alterações continuam neste navegador; entre novamente e tente de novo.',
  uwConflictTooLarge:
    'Sua versão ultrapassa o limite de tamanho do UniWork, então não foi possível substituir.',
  uwConflictDownloadTooLarge:
    'Sua versão ultrapassa o limite de tamanho do UniWork, então não é possível baixá-la aqui.',
  uwConflictDownloadFailed:
    'Não foi possível baixar sua versão, então o documento não foi recarregado. Tente novamente.',
  uwConflictOfflineWeb:
    'Você está offline. Na web isto precisa de conexão; suas alterações continuam neste navegador.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Sua versão',
  uwConflictColServer: 'Versão no UniWork',
  uwConflictRowVersion: 'Versão',
  uwConflictRowTime: 'Horário',
  uwConflictRowBy: 'Salvo por',
  uwConflictMineUnsaved: 'Você (não salvo)',
  uwConflictBasedOn: 'com base na versão {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'Ver diferenças',
  uwConflictDiffPending: 'Comparando…',
  uwConflictDiffFailed: 'Não foi possível comparar as versões agora. Tente novamente mais tarde.',
  uwConflictNoEdit: 'Você não tem mais permissão para editar este documento.',
  uwConflictOverwriteTitle: 'Substituir pela sua versão?',
  uwConflictOverwriteConfirm:
    'O UniWork criará a versão {next} a partir da sua cópia. A versão {server} de {author} permanece no histórico.',
  uwConflictOverwriteGo: 'Substituir',
  uwConflictBack: 'Voltar',
  uwConflictHeadMoved:
    'Enquanto isso, o UniWork recebeu a versão {n}. A tabela foi atualizada; escolha novamente.',
  uwConflictReloadTitle: 'Recarregar a mais recente',
  uwConflictReloadGo: 'Recarregar',
  uwConflictSaveCopy: 'Salvar como cópia…',
  uwConflictSaveCopyTitle: 'Salvar como cópia?',
  uwConflictSaveCopyConfirm:
    'O UniWork criará um novo documento a partir da sua versão, com o mesmo proprietário e acesso deste documento. O documento atual e a versão {server} de {author} permanecem como estão.',
  uwConflictSaveCopyGo: 'Criar cópia',
  uwConflictSaveCopyDone:
    'Sua versão foi salva como um novo documento: {title}. Este documento não mudou; você ainda pode recarregar ou substituir.',
  uwConflictSaveCopyFailed:
    'Não foi possível criar a cópia. Suas alterações continuam seguras; tente novamente.',
  uwConflictSaveCopyOffline:
    'Você está offline. Criar uma cópia precisa de conexão; suas alterações são mantidas.',
  uwConflictReloadFailed:
    'Não foi possível carregar a versão mais recente. Seu documento não mudou; tente novamente.',
  uwConflictOverwriteFailed:
    'Ainda não foi possível substituir. Seu documento não mudou; tente novamente.',
  uwConflictClose: 'Fechar',

  // S6 new-version bar
  uwRemoteRegion: 'Nova versão',
  uwRemoteUpdated: 'Atualizado para a versão {n}, salva por {author} às {time}.',
  uwRemoteUpdatedNoRev: 'Atualizado para a versão mais recente no UniWork.',
  uwRemoteNewerDirty:
    'Há uma versão mais recente no UniWork (versão {n}). Você tem alterações não salvas, por isso o documento não foi recarregado.',
  uwRemoteNewerAi:
    'Há uma versão mais recente no UniWork (versão {n}). O UniWork AI está em execução, por isso o documento não foi recarregado; os resultados da IA se aplicam só à cópia aberta.',
  uwRemoteNowClean:
    'Você desfez todas as alterações. A versão {n} no UniWork é mais recente que a cópia aberta.',
  uwRemoteStopAiConfirm:
    'Parar a execução do UniWork AI para recarregar? As alterações que a IA já fez pertencem à cópia aberta.',
  uwRemoteWaitCommit:
    'Aguardando o salvamento em andamento terminar; depois você poderá recarregar.',
  uwRemoteReload: 'Recarregar a mais recente…',
  uwRemoteLater: 'Depois',
  uwRemoteClose: 'Fechar',
  uwRemoteReloadFailed:
    'Não foi possível carregar a versão {n}. Você ainda está vendo a versão anterior.',
  uwRemoteDeleted: 'Este documento foi excluído no UniWork. Os salvamentos na fila pararam.',
  uwAuthorFallback: 'um membro',
  uwLockRegion: 'Estado do documento',
  uwActRetry: 'Tentar novamente',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'Você não tem mais acesso a este documento. O salvamento parou; as alterações não salvas ficam neste navegador até você sair.',
  uwRemoteOrgBlockedWeb:
    'Não foi possível salvar: {reason}. As alterações não salvas ficam neste navegador até você sair.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'documento arquivado',
  uwReasonSuspended: 'organização suspensa',
  uwReasonDeactivated: 'sua conta está desativada nesta organização',

  webSizeWarnChip: 'Aproximando-se do limite de {max} (atualmente {size}).',
  webSaveBlockTitle: 'Não foi possível salvar no UniWork',
  webSaveBlockBody:
    'Este documento ultrapassa {max}. Suas alterações ainda estão aqui. Baixe sua cópia no computador e depois reduza o tamanho das imagens ou divida o documento.',
  webSaveBlockDownload: 'Baixar minha cópia',
  uwConflictTooLargeWithLimit:
    'Sua versão ultrapassa {max} (atualmente {size}). Escolha “Baixar minha cópia” ou feche este diálogo para reduzir o tamanho do arquivo.',
} satisfies Record<keyof typeof zh, string>
