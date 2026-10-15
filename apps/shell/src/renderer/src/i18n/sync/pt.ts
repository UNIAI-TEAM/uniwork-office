import type { zh } from './zh'

export const pt = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Salvamento na fila — ainda não está no UniWork',
  uwChipQueuedNewer: 'Salvamento na fila · edições mais recentes',
  uwChipPausedAdmin: 'Salvamento na fila · envio pausado',
  uwChipReconciling: 'Verificando o último salvamento…',
  uwChipReconcileStuck: 'É preciso suporte para confirmar o salvamento',
  uwChipRemoteNewer: 'Versão mais recente no UniWork',
  uwTipQueued:
    'Seu salvamento das {time} fica guardado com segurança neste computador e será enviado quando você estiver online.',
  uwTipQueuedNewer:
    'O salvamento das {time} está aguardando envio. Edições posteriores não fazem parte dele.',
  uwTipPausedAdmin:
    'Seu administrador pausou o envio. O salvamento fica guardado neste computador.',
  uwTipPausedUser:
    'Você pausou o envio. O salvamento das {time} fica neste computador; escolha Retomar envio na central de sincronização.',
  uwTipReconciling:
    'Ainda não está claro se o último salvamento chegou ao UniWork. O app está verificando e não criará uma duplicata.',
  uwTipRemoteNewer: 'Você tem alterações não salvas, por isso o documento não foi recarregado.',
  uwTipFailed:
    'Este salvamento não será repetido automaticamente: {reason}. Suas alterações continuam neste computador.',
  uwTipWaitAi: 'Aguardando a IA terminar a etapa atual para salvar.',
  uwTipWaitAiLong: 'A IA não terminou a etapa atual. Pare a execução da IA para salvar agora.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'Ver fila',
  uwActSaveAgain: 'Salvar novamente',
  uwActStopAi: 'Parar IA',
  uwActBack: 'Voltar',
  uwQueuePopWaiting: 'Aguardando salvar: das {time} (com base na versão {base})',
  uwQueuePopNewer: 'Edições mais recentes desde então — não enviadas',
  uwQueueBlockedSave:
    'Seu último salvamento ainda está aguardando. Você poderá salvar novamente quando ele terminar.',
  uwQueueFull:
    'O armazenamento de sincronização deste computador está cheio, então o salvamento não entrou na fila. Suas alterações continuam na janela aberta; libere espaço na central de sincronização.',
  uwQueueOpenCenter: 'Abrir central de sincronização',
  uwQueueCancel: 'Cancelar salvamento…',
  uwQueueCancelConfirm:
    'Cancelar o salvamento na fila? Suas alterações continuam neste computador; o documento no UniWork não muda.',
  uwQueueCancelled: 'Salvamento na fila cancelado. Suas alterações continuam neste computador.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'entre novamente',
  uwReasonSignedOut: 'sessão encerrada',
  uwReasonForeign: 'pertence a outra conta',
  uwReasonArchived: 'documento arquivado',
  uwReasonSuspended: 'organização suspensa',
  uwReasonDeactivated: 'sua conta está desativada nesta organização',
  uwReasonLease: 'acesso offline expirado',
  uwReasonKeystore: 'o chaveiro deste computador está bloqueado',
  uwReasonClock: 'o relógio foi atrasado',
  uwReasonStoreFull: 'o armazenamento de sincronização deste computador está cheio',
  uwReasonStoreNewer: 'é necessária uma versão mais recente do app',

  // S2 queue-row badges
  uwBadgeQueued: 'Aguardando',
  uwBadgeWaitNetwork: 'Aguardando rede',
  uwBadgePausedUser: 'Pausado por você',
  uwBadgePausedAdmin: 'Pausado pelo administrador',
  uwBadgeSending: 'Enviando',
  uwBadgeReconciling: 'Verificando',
  uwBadgeReconcileStuck: 'Precisa de suporte',
  uwBadgeConflict: 'Conflito',
  uwBadgeBlocked: 'Bloqueado',
  uwBadgeLocked: 'Trancado',
  uwBadgeRevoked: 'Sem acesso',
  uwBadgeDeleted: 'Excluído',
  uwBadgeReconnect: 'Reconexão necessária',
  uwBadgeKeystore: 'Chaveiro bloqueado',
  uwBadgeFailed: 'Não foi possível enviar',
  uwBadgeSaved: 'Salvo',
  uwBadgeKeptDraft: 'Rascunho mantido',
  uwBadgeMoved: 'Movido',
  uwBadgeArchived: 'Arquivado',

  // S2 queue-row details
  uwRowQueued: 'Salvo {time} · com base na versão {base} · {size}',
  uwRowWaitNetwork: 'Será enviado quando houver conexão',
  uwRowPausedUser: 'Será enviado quando você escolher Retomar envio',
  uwRowPausedAdmin: 'Será enviado quando o administrador reativar o envio',
  uwRowUploading: 'Enviando {done} / {total}',
  uwRowCommitting: 'Criando a versão',
  uwRowReconciling:
    'O resultado do envio das {time} ainda não está claro. Verificando com o UniWork.',
  uwRowReconcileStuck:
    'Tentativas de verificação: {count}, ainda sem resultado. O app não reenviará; envie o código de suporte ao seu administrador.',
  uwStuckDiscardConfirm:
    'Descartar este salvamento? Se ele já chegou ao UniWork, essa versão permanece; sua cópia fica como rascunho na central de sincronização.',
  uwRowConflict: 'A versão {n} foi salva por {author} às {time}',
  uwRowFailed: 'Não foi possível enviar: {reason}',
  uwRowBlocked: 'Não é possível salvar: {reason}',
  uwRowCommitted: 'Versão {n} · {time}',
  uwRowKeptDraft: 'Mantido ao recarregar às {time}',
  uwRowMoved: 'O documento foi movido para {workspace}',
  uwRowArchived: 'O documento foi arquivado no UniWork',

  // S2 row actions
  uwActDiscard: 'Descartar',
  uwActDiscardSave: 'Descartar salvamento…',
  uwActSendNow: 'Enviar agora',
  uwActRecheck: 'Verificar novamente',
  uwActGuide: 'Guia',
  uwActOpenToResolve: 'Abrir para resolver',
  uwActCopySupport: 'Copiar código de suporte',
  uwActDownloadMine: 'Baixar minha versão',
  uwActOpenDraft: 'Abrir rascunho',
  uwActDiscardDraft: 'Descartar rascunho…',
  uwActSignInAgain: 'Entrar novamente',
  uwActSignIn: 'Entrar',
  uwActSwitchAccount: 'Trocar de conta',
  uwActReconnect: 'Reconectar',
  uwActDetails: 'Detalhes',
  uwActOpen: 'Abrir',
  uwDiscardDraftConfirm:
    'Descartar este rascunho? As alterações serão removidas deste computador e não poderão ser recuperadas.',

  // Sign-out prompt
  uwSignOutTitle: 'Sair do UniWork?',
  uwSignOutBody:
    'Documentos com alterações não salvas ou salvamentos na fila: {count}. Eles ficam trancados neste computador e só a sua conta poderá abri-los novamente.',
  uwSignOutKeystore:
    'O chaveiro do computador está bloqueado, então as alterações não salvas existem apenas nas janelas abertas. Sair agora as descarta; o que já está guardado criptografado permanece. Para mantê-las, desbloqueie o computador primeiro.',
  uwSignOutGo: 'Sair',
  uwSignOutWaiting: 'Concluindo o salvamento em andamento antes de sair…',
  uwSignOutCaptureFailed:
    'Algumas alterações não salvas não puderam ser capturadas a tempo; a versão salva ou salva automaticamente mais recente é mantida para sua conta.',

  // S2 sync center
  uwSyncTitle: 'Central de sincronização',
  uwSyncOpenFromSettings: 'Central de sincronização',
  uwSyncOnline: 'Conectado ao UniWork · sincronizado {time}',
  uwSyncOffline: 'Offline · última sincronização {time}',
  uwSyncPaused: 'Envio pausado — novos salvamentos vão aguardar',
  uwSyncAdminPaused:
    'Seu administrador pausou o envio. Os salvamentos ficam guardados neste computador.',
  uwSyncFeedOff:
    'Os avisos de nova versão estão pausados. O UniWork ainda verifica conflitos quando você salva.',
  uwSyncResynced: 'Totalmente ressincronizado às {time}',
  uwSyncResyncFailed:
    'Não foi possível ressincronizar após várias tentativas. Os avisos de nova versão estão pausados; o UniWork ainda verifica conflitos quando você salva.',
  uwSyncSignedOut: 'Você saiu. Itens mantidos trancados neste computador: {count}.',
  uwSyncSignedOutEmpty: 'Você saiu.',
  uwSyncSessionExpired: 'Sua sessão expirou. Entre novamente para continuar enviando.',
  uwSyncOtherOrg: 'Salvamentos aguardando em outra organização: {count}',
  uwSyncStoreBudget: 'Armazenamento de sincronização neste computador: {used} de {cap}',
  uwSyncStoreError: 'Não foi possível ler a fila deste computador. Nada foi excluído.',
  uwSyncNow: 'Sincronizar agora',
  uwSyncPause: 'Pausar envio',
  uwSyncResume: 'Retomar envio',
  uwSyncNowOffline: 'A sincronização precisa de conexão.',
  uwSyncTabAttention: 'Requer atenção',
  uwSyncTabQueue: 'Aguardando salvar',
  uwSyncTabOffline: 'Disponível offline',
  uwSyncTabRecent: 'Salvos recentemente',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Documento',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Detalhes',
  uwSyncColActions: 'Ações',
  uwSyncMoreActions: 'Mais ações para {doc}',
  uwSyncEmptyQueue: 'Nada aguardando salvamento.',
  uwSyncEmptyAttention: 'Nada requer atenção.',
  uwSyncEmptyRecent: 'Nenhum salvamento recente.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Disponibilizar offline',
  uwOfflineUnpin: 'Remover cópia offline',
  uwOfflineUnpinShort: 'Desafixar',
  uwOfflineAdd: 'Adicionar documentos…',
  uwOfflineUsage: 'Usando {used} de {cap} neste computador',
  uwOfflineEmpty: 'Ainda não há documentos disponíveis offline.',
  uwOfflineCapReached:
    'A biblioteca offline deste computador atingiu o limite: armazenamento {cap}; máximo de documentos: {maxDocs}. Remova uma cópia offline para adicionar outra.',
  uwOfflineReady: 'Disponível offline',
  uwOfflineBadgeWaiting: 'Aguardando rede',
  uwOfflineBadgeDownloading: 'Baixando',
  uwOfflineBadgeVerifying: 'Verificando',
  uwOfflineBadgeUpdate: 'Atualização disponível',
  uwOfflineBadgeInterrupted: 'Não está pronto',
  uwOfflineBadgeDiskFull: 'Espaço insuficiente',
  uwOfflineBadgeCorrupt: 'Download danificado',
  uwOfflineBadgeLeaseSoon: 'Acesso offline terminando em breve',
  uwOfflineBadgeViewOnly: 'Disponível offline · somente visualização',
  uwOfflineRowWaiting: 'Será baixado quando houver conexão',
  uwOfflineRowProgress: '{done} de {total}',
  uwOfflineRowProgressAria: '{done} de {total}',
  uwOfflineRowVerifying: 'Verificando a integridade',
  uwOfflineRowReady: 'Versão {n} · {size} · acesso offline até {datetime}',
  uwOfflineRowUpdate:
    'A versão {n} será baixada quando houver conexão; a versão {old} continua funcionando',
  uwOfflineRowUpdateKept:
    'Não foi possível atualizar para a versão {n}: {reason}. A versão {old} continua funcionando.',
  uwOfflineRowInterrupted:
    'O download foi interrompido. A cópia anterior (se houver) continua funcionando.',
  uwOfflineRowDiskFull: 'São necessários mais {size}. A cópia anterior é mantida.',
  uwOfflineRowCorrupt: 'A cópia danificada foi removida. Baixe-a novamente.',
  uwOfflineRowLeaseSoon: 'Conecte-se antes de {datetime} para renovar',
  uwOfflineRowRevoked:
    'Você não tem mais acesso a este documento. A cópia baixada foi removida; os rascunhos ficam trancados.',
  uwOfflineRowDeleted:
    'O documento foi excluído no UniWork. A cópia baixada foi removida; os rascunhos ficam trancados.',
  uwOfflineRowArchived:
    'O documento foi arquivado; a cópia local abre até o fim do acesso offline.',
  uwOfflineRowMoved: 'Movido para {workspace}; a cópia local continua funcionando.',
  uwOfflineRowViewOnly: 'Versão {n} · somente visualização · acesso offline até {datetime}',
  uwOfflineReadyAnnounce: 'Disponível offline: {doc}',
  uwOfflineUnpinConfirm:
    'A cópia baixada será removida deste computador. Rascunhos e salvamentos na fila são mantidos.',
  uwOfflineCancelDownload: 'Cancelar download',
  uwOfflineDownloadNow: 'Baixar agora',
  uwOfflineOpenFolder: 'Abrir pasta de armazenamento',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Reconexão necessária',
  uwLockKeystoreTitle: 'O chaveiro deste computador está bloqueado',
  uwLockClockTitle: 'Verificação de horário necessária',
  uwLockRevokedTitle: 'Sem acesso',
  uwLockDeletedTitle: 'Documento excluído',
  uwLockForeignTitle: 'Pertence a outra conta',
  uwLockOrgTitle: 'Não é possível abrir nesta organização',
  uwLockExpired:
    'O acesso offline expirou. O conteúdo continua criptografado; conecte-se para abri-lo novamente.',
  uwLockLibraryOff:
    'Seu administrador desativou os documentos offline, então o acesso offline não pode ser renovado. Os rascunhos ficam trancados na central de sincronização.',
  uwLockKeystore:
    'O chaveiro do computador está bloqueado, então o conteúdo criptografado não pode ser aberto. Desbloqueie-o e tente novamente; nada foi excluído.',
  uwLockClock:
    'O relógio do computador foi atrasado, então o acesso offline está bloqueado. Conecte-se para que o UniWork verifique o horário.',
  uwLockForeign:
    'Este documento pertence a outra conta neste computador. Troque para essa conta para abri-lo.',
  uwLockSuspended:
    'A organização está suspensa. O conteúdo continua criptografado; entre em contato com o administrador.',
  uwLockDeactivated:
    'Sua conta está desativada nesta organização. O conteúdo continua criptografado; entre em contato com o administrador.',
  uwLockSignedOutTitle: 'Você saiu',
  uwLockSignedOut:
    'O conteúdo fica trancado neste computador. Entre com a mesma conta para abri-lo novamente.',
  uwLockRegion: 'Status do documento',
  uwLockWhileOpen:
    'O documento foi trancado enquanto estava aberto. As alterações não salvas ficam guardadas criptografadas; você não pode salvar nem copiar até que ele seja desbloqueado.',
  uwLockWhileOpenRam:
    'O documento foi trancado enquanto estava aberto e este computador ainda não consegue guardar suas alterações com segurança. Elas existem apenas nesta janela (somente visualização); fechá-la as perde.',
  uwLockOtherWindow:
    'Este documento está aberto para edição em outra janela. Esta janela é somente para visualização.',
  uwLockOtherWindowGone:
    'A janela que editava este documento parou de responder. Você pode editar nesta janela.',
  uwLockGoToWindow: 'Ir para essa janela',
  uwLockTakeEdit: 'Editar nesta janela',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'Este documento foi alterado em outro lugar',
  uwConflictBody: 'Suas alterações ainda não estão no UniWork e estão seguras neste computador.',
  uwConflictReload: 'Recarregar a mais recente',
  uwConflictOverwrite: 'Substituir…',
  uwConflictCancel: 'Cancelar',
  uwConflictKeepUnavailable:
    'Este computador não consegue manter um rascunho agora (armazenamento de sincronização cheio ou chaveiro bloqueado).',
  uwConflictOfflineDesktop:
    'Você está offline e a versão mais recente não está neste computador, então ainda não é possível recarregar.',
  uwConflictReloadDesktopBody:
    'Escolha o que acontece com suas alterações antes de a versão {n} carregar.',
  uwConflictKeepDraft: 'Manter minha versão como rascunho',
  uwConflictDiscard: 'Descartar minhas alterações',
  uwConflictKeepDraftHint:
    'O rascunho fica na central de sincronização para ver ou copiar; ele nunca é aplicado automaticamente à nova versão.',
  uwConflictDraftCapReached:
    'Este documento atingiu o número máximo de rascunhos mantidos: {cap}. Descarte um rascunho antigo na central de sincronização para manter outro.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'O salvamento anterior precisa de suporte, então você ainda não pode recarregar nem substituir. Abra a central de sincronização para resolver.',
  uwRemoteRevoked:
    'Você não tem mais acesso a este documento. O salvamento parou; as alterações não salvas ficam trancadas neste computador.',
} satisfies Record<keyof typeof zh, string>
