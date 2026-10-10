import type { zh } from './zh'

export const pt = {
  webCancel: 'Cancelar',
  webConflictTitle: 'Este documento foi alterado em outro lugar',
  webConflictBody:
    'Uma versão mais recente foi salva enquanto você editava. Deseja substituí-la pela sua versão ou recarregar a versão mais recente e descartar suas alterações?',
  webConflictOverwrite: 'Substituir',
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
} satisfies Record<keyof typeof zh, string>
