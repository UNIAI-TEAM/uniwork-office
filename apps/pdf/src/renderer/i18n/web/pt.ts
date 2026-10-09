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
  webReloaded: 'a versão mais recente foi recarregada e suas alterações foram descartadas',
  webViewOnlyNoSave: 'este documento é somente leitura',
  webMergeTitle: 'Mesclar PDFs',
  webMergeBody: '{count} PDF(s) selecionado(s). Adicionar outro PDF ou mesclar agora?',
  webMergeAdd: 'Adicionar outro PDF',
  webMergeNow: 'Mesclar agora',
} satisfies Record<keyof typeof zh, string>
